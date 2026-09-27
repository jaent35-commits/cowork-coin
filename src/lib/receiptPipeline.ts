/**
 * 영수증 인식 파이프라인 — Primary: PaddleOCR(백엔드 API) · Secondary 검증: Tesseract.js v7 한국어(브라우저, receiptOcr.ts)
 *
 * 1. 같은 이미지를 PaddleOCR API 와 Tesseract 에 동시에 보냄
 * 2. 각 엔진 결과에서 날짜·결제금액을 뽑음 (전체 텍스트가 아니라 최종 필드 단위로 비교)
 * 3. 같으면 confidence 를 높이고, 다르면 PaddleOCR 후보 점수(키워드·bbox 위치·OCR 신뢰도·부가세 검산·금액 형식)로 결정
 * 4. 그래도 판단이 어려우면 needsReview = true
 * - 백엔드가 없거나 실패하면 Tesseract 결과만 사용 (기존 동작과 같음)
 * - 운영 환경에서는 이미지·OCR 텍스트를 저장하거나 로그로 남기지 않음. 개발 환경에서만 엔진 통계(필드 결과 개수)를 저장
 */
import { readReceipt, releaseReceiptOcr, uploadImage, type ReceiptResult } from './receiptOcr';

export type Engine = 'paddleocr' | 'tesseract';
type Field = 'date' | 'amount';

export interface FinalReceipt {
  date: string | null;
  amount: number | null;
  /** 내부 추출값 — 화면에는 항목명 채우기(기존 동작)에만 사용 */
  merchant: string | null;
  confidence: Record<Field, number>;
  validatedBy: Engine[];
  needsReview: boolean;
}

interface Candidate<T> { value: T; score: number }
interface PaddleResponse {
  success: boolean;
  receipt: { date: string | null; amount: number | null; merchant: string | null };
  confidence: Record<Field, number>;
  needsReview: boolean;
  candidates: { date: Candidate<string>[]; amount: Candidate<number>[] };
}

const API = `${(import.meta.env.VITE_OCR_API_URL as string | undefined)?.replace(/\/+$/, '') ?? ''}/api/receipt/ocr`;
const TIMEOUT = 30_000;
/** 두 후보 점수 차이가 이보다 작으면 판단 보류(needsReview) */
const DECIDE_MARGIN = 0.12;
const REVIEW_BELOW = 0.6;

/** 진행 중인 PaddleOCR 요청 — 집행 등록 화면을 벗어나면 연결까지 끊어 서버 대기열에서도 빠지게 함 */
const inflight = new Set<AbortController>();

async function paddleOcr(file: File): Promise<PaddleResponse | null> {
  const ctrl = new AbortController();
  inflight.add(ctrl);
  try {
    // 큰 사진은 서버가 쓰는 크기(긴 변 2200px)로 줄여 전송 — 원본보다 작으면 원본 그대로
    const img = await uploadImage(file);
    if (ctrl.signal.aborted) return null; // 줄이는 사이 화면 이탈
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const body = new FormData();
      body.append('file', img, img === file ? (file.name || 'receipt.jpg') : 'receipt.jpg');
      const res = await fetch(API, { method: 'POST', body, signal: ctrl.signal });
      if (!res.ok) return null; // 서버 대기 초과(503) 등 → Tesseract 만 사용
      return (await res.json()) as PaddleResponse;
    } catch {
      return null; // 백엔드 미실행·네트워크 오류·취소 → Tesseract 만 사용
    } finally {
      clearTimeout(t);
    }
  } finally {
    inflight.delete(ctrl);
  }
}

/** 집행 등록 화면을 벗어날 때 — 서버 요청을 먼저 끊고(대기 중이면 서버가 추론하지 않음) Tesseract·전처리 worker 해제 */
export function releaseReceiptScan() {
  inflight.forEach(c => c.abort());
  inflight.clear();
  releaseReceiptOcr();
}

/** Tesseract 쪽 필드 확신도 — 날짜는 표기 규칙이 엄격해 읽히면 비교적 신뢰, 금액은 교차 확인(sure) 여부 */
const tessConf = (t: ReceiptResult | null, f: Field) =>
  !t ? 0 : f === 'date' ? (t.date ? 0.7 : 0) : t.total == null ? 0 : t.sure?.total ? 0.8 : 0.55;

interface FieldResult<T> { value: T | null; confidence: number; by: Engine[]; review: boolean; agree: boolean | null }

/** 필드 하나 결정 — agree: 두 엔진 모두 읽었을 때 같은지 (한쪽만 읽었으면 null) */
function decide<T extends string | number>(p: PaddleResponse | null, t: ReceiptResult | null, f: Field): FieldResult<T> {
  const pv = (p?.receipt[f] ?? null) as T | null;
  const tv = (f === 'date' ? t?.date : t?.total) as T | null | undefined ?? null;
  const pc = p?.confidence[f] ?? 0;
  const tc = tessConf(t, f);
  if (pv == null && tv == null) return { value: null, confidence: 0, by: [], review: true, agree: null };
  if (pv != null && tv != null && pv === tv) {
    // 두 엔진 일치 → 1 − (둘 다 틀릴 확률), 최소 0.95
    const c = Math.min(0.99, Math.max(0.95, 1 - (1 - pc) * (1 - tc)));
    return { value: pv, confidence: round(c), by: ['paddleocr', 'tesseract'], review: false, agree: true };
  }
  if (pv == null || tv == null) {
    const onlyPaddle = pv != null;
    const c = onlyPaddle ? pc * 0.9 : tc * 0.85;
    return { value: onlyPaddle ? pv : tv, confidence: round(c), by: [onlyPaddle ? 'paddleocr' : 'tesseract'], review: c < REVIEW_BELOW, agree: null };
  }
  // 불일치 → PaddleOCR 후보 점수표에서 두 값을 비교 (Tesseract 값이 Paddle 쪽에 후보로 있으면 그 점수 + 교차 확인 가산)
  const cands = (p?.candidates[f] ?? []) as Candidate<T>[];
  const sp = cands.find(c => c.value === pv)?.score ?? pc;
  const st = (cands.find(c => c.value === tv)?.score ?? 0) + (f === 'amount' && t?.sure?.total ? 0.08 : 0);
  if (sp - st >= DECIDE_MARGIN) return { value: pv, confidence: round(Math.min(0.9, sp * 0.85)), by: ['paddleocr'], review: sp * 0.85 < REVIEW_BELOW, agree: false };
  if (st - sp >= DECIDE_MARGIN) return { value: tv, confidence: round(Math.min(0.9, st * 0.85)), by: ['tesseract'], review: st * 0.85 < REVIEW_BELOW, agree: false };
  // 점수가 비슷 → 판단 보류, Primary(PaddleOCR) 값을 채우고 확인 필요 표시
  return { value: pv, confidence: round(Math.min(0.5, sp * 0.6)), by: ['paddleocr'], review: true, agree: false };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** 영수증 이미지 → 최종 결과 (UI 는 ReceiptResult 형태 그대로 받음 — 기존 화면·동작 유지) */
export async function scanReceipt(file: File, onProgress?: (p: number) => void): Promise<ReceiptResult & { final: FinalReceipt }> {
  const [ps, ts] = await Promise.allSettled([paddleOcr(file), readReceipt(file, onProgress)]);
  const p = ps.status === 'fulfilled' ? ps.value : null;
  const t = ts.status === 'fulfilled' ? ts.value : null;
  if (!p && !t) throw new Error('ocr failed');

  const date = decide<string>(p, t, 'date');
  const amount = decide<number>(p, t, 'amount');
  const final: FinalReceipt = {
    date: date.value,
    amount: amount.value,
    merchant: p?.receipt.merchant ?? t?.store ?? null,
    confidence: { date: date.confidence, amount: amount.confidence },
    validatedBy: [...new Set([...date.by, ...amount.by])],
    needsReview: date.review || amount.review,
  };
  if (import.meta.env.DEV) recordDevStats(p, t, date.agree, amount.agree, final);
  return { date: final.date, store: final.merchant, total: final.amount, text: t?.text ?? '', final };
}

/* ── 개발 환경 전용 통계 (필드 결과 개수만 — 이미지·텍스트·금액 값은 저장하지 않음) ── */

const STATS_KEY = 'cowork-coin-ocr-dev-stats';
interface DevStats { scans: number; paddleOk: number; paddleDown: number; tessOk: number; bothRead: number; agree: number; disagree: number; review: number }
const EMPTY: DevStats = { scans: 0, paddleOk: 0, paddleDown: 0, tessOk: 0, bothRead: 0, agree: 0, disagree: 0, review: 0 };

function loadStats(): DevStats {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}') }; } catch { return { ...EMPTY }; }
}

function recordDevStats(p: PaddleResponse | null, t: ReceiptResult | null, dateAgree: boolean | null, amountAgree: boolean | null, final: FinalReceipt) {
  const s = loadStats();
  s.scans++;
  if (!p) s.paddleDown++;
  // 단독 성공 = 날짜·금액을 모두 읽음
  if (p?.receipt.date && p.receipt.amount != null) s.paddleOk++;
  if (t?.date && t.total != null) s.tessOk++;
  // 일치/불일치 = 두 엔진이 날짜·금액을 모두 읽은 영수증 중에서 두 필드가 모두 같은지
  if (dateAgree != null && amountAgree != null) {
    s.bothRead++;
    if (dateAgree && amountAgree) s.agree++; else s.disagree++;
  }
  if (final.needsReview) s.review++;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* noop */ }
  printDevStats(s);
}

const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

function printDevStats(s = loadStats()) {
  console.table({
    'PaddleOCR 단독 성공률': pctOf(s.paddleOk, s.scans),
    'Tesseract 단독 성공률': pctOf(s.tessOk, s.scans),
    '두 엔진 일치율': pctOf(s.agree, s.bothRead),
    '불일치율': pctOf(s.disagree, s.bothRead),
    'needsReview 비율': pctOf(s.review, s.scans),
    '인식 횟수': s.scans,
    'PaddleOCR 서버 응답 없음': s.paddleDown,
  });
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // 개발자 도구 콘솔: receiptOcrStats() 로 통계 보기, receiptOcrStats.reset() 으로 초기화
  const fn = Object.assign(() => printDevStats(), { reset: () => { try { localStorage.removeItem(STATS_KEY); } catch { /* noop */ } } });
  (window as unknown as { receiptOcrStats: typeof fn }).receiptOcrStats = fn;
}
