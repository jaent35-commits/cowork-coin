/**
 * 영수증 인식 파이프라인 — Primary: Google Cloud Vision(Edge Function ocr-receipt) · 보조: Tesseract.js 한국어(휴대폰 안, receiptOcr.ts)
 *
 * 1. 서버(Vision)로 글자를 읽고, 날짜·상호명·합계는 앱의 영수증 분석(parseReceipt)으로 뽑음
 *    - 날짜·합계를 모두 읽었으면 그대로 끝 (휴대폰 인식 생략)
 * 2. 서버를 못 쓰면(월 한도 소진 · 설정 없음 · 오류) 또는 결과가 비면 휴대폰(Tesseract)으로 읽어 필드별로 합침
 *    - 둘 다 읽은 필드가 다르면 서버 값을 쓰고 needsReview
 * - 월 한도는 관리자가 관리자 > 영수증 인식 에서 정함 (서비스 전체 · 0 ~ 1,000건)
 * - 사진 · 인식한 글자는 저장하거나 로그로 남기지 않음
 */
import { deviceImage, parseReceipt, readReceipt, releaseReceiptOcr, uploadImage, type ReceiptResult } from './receiptOcr';
import { AuthApiError, ocrReceiptText } from './authApi';
import { REMOTE_AUTH } from './supabase';
import { isMobileDevice } from './install';

export type Engine = 'vision' | 'tesseract';
type Field = 'date' | 'amount';

export interface FinalReceipt {
  date: string | null;
  amount: number | null;
  merchant: string | null;
  confidence: Record<Field, number>;
  validatedBy: Engine[];
  needsReview: boolean;
}

/** 서버 인식 결과 — ok: 읽은 글자 분석 / quota: 이번 달 한도 소진 / off: 서버 인식 없음·실패 */
type ServerRead = { kind: 'ok'; r: ReturnType<typeof parseReceipt> } | { kind: 'quota' } | { kind: 'off' };

/** 서버 인식이 설정되지 않았거나 연결이 안 되면 잠시 건너뜀 (매번 실패를 기다리지 않게) */
const SERVER_RETRY_MS = 60_000;
let serverDownUntil = 0;
/** 화면을 벗어나면 서버 결과를 버림 (요청 자체는 서버에서 끝남) */
let generation = 0;

const toBase64 = (blob: Blob) => new Promise<string>((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).replace(/^data:[^,]*,/, ''));
  fr.onerror = () => fail(fr.error ?? new Error('read failed'));
  fr.readAsDataURL(blob);
});

async function serverRead(file: File): Promise<ServerRead> {
  if (!REMOTE_AUTH || Date.now() < serverDownUntil) return { kind: 'off' };
  const gen = generation;
  try {
    // 큰 사진은 긴 변 2200px JPEG 로 줄여 전송 (원본보다 작을 때만)
    const text = await ocrReceiptText(await toBase64(await uploadImage(file)));
    if (gen !== generation) return { kind: 'off' };
    return { kind: 'ok', r: parseReceipt(text) };
  } catch (e) {
    if (e instanceof AuthApiError && e.code === 'quota') return { kind: 'quota' };
    // 설정 없음 · 네트워크 오류 → 잠시 서버 건너뜀 (Vision 일시 오류 'unavailable' 은 다음 사진에서 다시 시도)
    if (!(e instanceof AuthApiError) || e.code !== 'unavailable' || /설정/.test(e.message)) serverDownUntil = Date.now() + SERVER_RETRY_MS;
    return { kind: 'off' };
  }
}

/** 집행 등록 화면을 벗어날 때 — 서버 결과는 버리고 Tesseract·전처리 worker 해제 */
export function releaseReceiptScan() {
  generation++;
  releaseReceiptOcr();
}

/** 휴대폰 안 인식 상한 — 넘으면 중단하고(작업자 해제) 읽은 만큼만 사용 */
const DEVICE_TIMEOUT = 30_000;
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  if (!ms) return task;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { releaseReceiptOcr(); reject(new Error('device timeout')); }, ms);
    task.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** 인식 단계 — 화면 안내용 (server: 서버에서 읽는 중 · device: 휴대폰에서 읽는 중 · device-quota: 이번 달 서버 한도를 다 써서 휴대폰에서) */
export type ScanStage = 'server' | 'device' | 'device-quota';

interface FieldResult<T> { value: T | null; confidence: number; by: Engine[]; review: boolean }

/** 필드 하나 결정 — 서버(Vision) 값 우선, 휴대폰 값은 비었을 때 채우거나 같으면 확신을 높임 */
function decide<T extends string | number>(v: T | null, vSure: boolean, t: T | null, tSure: boolean): FieldResult<T> {
  if (v == null && t == null) return { value: null, confidence: 0, by: [], review: true };
  if (v != null && t != null) {
    if (v === t) return { value: v, confidence: 0.97, by: ['vision', 'tesseract'], review: false };
    return { value: v, confidence: 0.6, by: ['vision'], review: true };
  }
  if (v != null) return { value: v, confidence: vSure ? 0.9 : 0.8, by: ['vision'], review: false };
  return { value: t, confidence: tSure ? 0.75 : 0.55, by: ['tesseract'], review: !tSure };
}

/**
 * 영수증 이미지 → 최종 결과 (UI 는 ReceiptResult 형태 그대로 받음 — 기존 화면·동작 유지)
 * 순서: ① 서버(Vision) → 날짜·합계를 모두 읽었으면 끝 ② 서버를 못 쓰거나 빠진 칸이 있으면 휴대폰(Tesseract)으로 읽어 합침
 */
export async function scanReceipt(file: File, onProgress?: (p: number) => void, onStage?: (s: ScanStage) => void): Promise<ReceiptResult & { final: FinalReceipt }> {
  onStage?.('server');
  const s = await serverRead(file);
  const v = s.kind === 'ok' ? s.r : null;
  const serverDone = !!v?.date && v.total != null;
  // 휴대폰: 서버가 날짜·합계 중 하나라도 읽었으면 그 결과로 끝 (휴대폰 안 인식은 카메라 사진에서 수십 초 → 못 읽은 칸만 직접 입력)
  const serverSome = !!v && (!!v.date || v.total != null);
  let t: ReceiptResult | null = null;
  if (!serverDone && !(isMobileDevice && serverSome)) {
    onStage?.(s.kind === 'quota' ? 'device-quota' : 'device');
    t = await withTimeout(readReceipt(await deviceImage(file), onProgress), isMobileDevice ? DEVICE_TIMEOUT : 0).catch(() => null);
  }
  if (!v && !t) throw new Error('ocr failed');

  const date = decide<string>(v?.date ?? null, !!v?.date, t?.date ?? null, !!t?.date);
  const amount = decide<number>(v?.total ?? null, !!v?.sure.total, t?.total ?? null, !!t?.sure?.total);
  const final: FinalReceipt = {
    date: date.value,
    amount: amount.value,
    merchant: v?.store ?? t?.store ?? null,
    confidence: { date: date.confidence, amount: amount.confidence },
    validatedBy: [...new Set([...date.by, ...amount.by])],
    needsReview: date.review || amount.review,
  };
  return { date: final.date, store: final.merchant, total: final.amount, text: v?.text ?? t?.text ?? '', final };
}
