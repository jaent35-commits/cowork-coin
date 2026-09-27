/**
 * 영수증 사진 → 글자 인식(tesseract.js, 한국어) → 날짜·상호명·총 합계 추출
 * - 라이브러리·언어 데이터는 처음 사용할 때만 불러오고, Tesseract worker 는 재사용 · 전처리는 Web Worker
 */

export interface ReceiptResult {
  /** 'YYYY-MM-DD' — 못 읽으면 null */
  date: string | null;
  store: string | null;
  total: number | null;
  text: string;
  /** 교차 확인된 값인지 (검증 파이프라인이 Tesseract 쪽 확신도로 사용) */
  sure?: { store: boolean; total: boolean };
}

/* ── 사진 → 인식용 이미지 (receiptPrep.ts — Web Worker 기본, 미지원 브라우저는 메인 스레드) ── */

/** 인식할 이미지 한 장을 만들어 주는 쪽 — full: 종이 영역 대신 사진 전체 */
interface Prep {
  image(targetW: number, C: number, full?: boolean): Promise<Blob | HTMLCanvasElement>;
  close(): void;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((ok, fail) => {
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); ok(el); };
    el.onerror = () => { URL.revokeObjectURL(url); fail(new Error('이미지를 열 수 없습니다')); };
    el.src = url;
  });
}

const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** 사진 열기 + 종이 영역 — 항상 메인 스레드 <img> 로 (200px 축소본이라 가벼움, 기존과 같은 영역) */
async function openImage(file: File) {
  const [{ findPaper, prepare }, img] = await Promise.all([import('./receiptPrep'), loadImage(file)]);
  const W = img.naturalWidth, H = img.naturalHeight;
  return { img, W, H, box: findPaper(img, W, H, makeCanvas), prepare };
}

/** 메인 스레드 전처리 (Worker·OffscreenCanvas 를 못 쓰는 브라우저) — 기존 방식 */
function mainPrep({ img, W, H, box, prepare }: Awaited<ReturnType<typeof openImage>>): Prep {
  return {
    image: async (targetW, C, full) => prepare(img, full ? { x: 0, y: 0, w: W, h: H } : box, targetW, C, makeCanvas) as HTMLCanvasElement,
    close: () => {},
  };
}

const prepInWorker = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  && typeof createImageBitmap === 'function' && 'convertToBlob' in OffscreenCanvas.prototype;

let prepWorker: Worker | null = null;
let msgId = 0;
const waiting = new Map<number, { ok: (d: { blob?: Blob }) => void; fail: (e: Error) => void }>();

function getPrepWorker(): Worker {
  if (prepWorker) return prepWorker;
  const w = new Worker(new URL('./receiptPrep.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; error?: string; blob?: Blob }>) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.fail(new Error(e.data.error)); else job.ok(e.data);
  };
  // 워커 자체가 실패(스크립트 로드 불가 등) → 기다리던 요청은 실패 처리, 다음 스캔은 새로 만듦
  w.onerror = () => { waiting.forEach(j => j.fail(new Error('prep worker error'))); waiting.clear(); w.terminate(); if (prepWorker === w) prepWorker = null; };
  return (prepWorker = w);
}

function ask(msg: Record<string, unknown>): Promise<{ blob?: Blob }> {
  const w = getPrepWorker(), id = ++msgId;
  return new Promise((ok, fail) => { waiting.set(id, { ok, fail }); w.postMessage({ ...msg, id }); });
}

/** Worker 전처리 — 도중에 실패하면 남은 이미지는 메인 스레드로 (결과는 같은 계산) */
async function openPrep(file: File): Promise<Prep> {
  const opened = await openImage(file);
  if (!prepInWorker()) return mainPrep(opened);
  try {
    await ask({ type: 'load', file, box: opened.box });
  } catch {
    return mainPrep(opened);
  }
  let main: Prep | null = null;
  return {
    image: async (targetW, C, full = false) => {
      if (!main) {
        try { return (await ask({ type: 'image', targetW, C, full })).blob!; } catch { main = mainPrep(opened); }
      }
      return main.image(targetW, C, full);
    },
    close: () => { if (prepWorker) void ask({ type: 'close' }).catch(() => {}); },
  };
}

/* ── PaddleOCR 서버로 보낼 사진 ──
 * 서버는 긴 변을 1600~2200px 로 맞춘 뒤 인식하므로(backend image_preprocess LONG_MAX) 그보다 큰 원본은 전송만 낭비.
 * 후보 테스트(원본 · 2560/2200/2048/1920/1600 × JPEG 0.95/0.9/0.85) 결과 2200px · 0.9 가 날짜·금액·상호명·숫자 줄을
 * 원본과 같게 유지하면서 용량이 가장 작았음 (2048 이하는 작은 글씨 상호명 띄어쓰기·숫자 줄 보존이 흔들림).
 * Tesseract 는 이 축소본이 아니라 원본을 그대로 읽음(1단계와 같은 입력). */
const UPLOAD_MAX_EDGE = 2200;
const UPLOAD_QUALITY = 0.9;

/** 긴 변 2200px 초과 사진만 줄여 JPEG 로 — 작거나, 줄여도 더 크거나, 줄일 수 없으면(미지원 브라우저·디코딩 실패) 원본 그대로 */
export async function uploadImage(file: File): Promise<Blob> {
  if (!prepInWorker()) return file;
  try {
    const { blob } = await ask({ type: 'upload', file, maxEdge: UPLOAD_MAX_EDGE, quality: UPLOAD_QUALITY });
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/* ── Tesseract worker — 집행 등록 화면 안에서 재사용 (언어 모델 로딩은 첫 스캔 때만)
 *    마지막 스캔 후 1분간 추가 스캔이 없거나 화면을 벗어나면(releaseReceiptOcr) 해제, 오류 시 다음 스캔에서 새로 ── */

type TessWorker = import('tesseract.js').Worker;
const IDLE_MS = 60_000;
let tess: Promise<TessWorker> | null = null;
let onTessProgress: ((p: number) => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** 해제할 때마다 +1 — 해제 전에 요청된(대기 중인) 스캔은 시작하지 않음 */
let generation = 0;
/** 진행 중인 스캔 중단 — tesseract.js 의 terminate 는 진행 중인 인식을 끝내지 않아 직접 끊어야 대기열이 막히지 않음 */
let abortScan: ((e: Error) => void) | null = null;

function getTess(): Promise<TessWorker> {
  if (!tess) {
    tess = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      // 한국어 전용 모델: kor+eng 는 한글 지점명을 영문으로 잘못 읽는 경우가 많음 (예: 계양점 → AIH)
      const w = await createWorker('kor', undefined, {
        logger: m => { if (m.status === 'recognizing text') onTessProgress?.(m.progress); },
      });
      // 한 덩어리 글(영수증처럼 세로로 이어진 줄) + 줄 안 여백 유지
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      return w;
    })();
    tess.catch(() => { tess = null; }); // 로딩 실패(네트워크 등) → 다음 스캔에서 다시
  }
  return tess;
}

function dropWorkers() {
  clearTimeout(idleTimer);
  const t = tess;
  tess = null;
  if (t) void t.then(w => w.terminate()).catch(() => {});
  prepWorker?.terminate();
  prepWorker = null;
  waiting.forEach(j => j.fail(new Error('ocr released')));
  waiting.clear();
  abortScan?.(new Error('ocr released'));
}

/** 집행 등록 화면을 벗어날 때 — 진행 중·대기 중인 스캔은 중단하고 worker 즉시 해제 */
export function releaseReceiptOcr() {
  generation++;
  dropWorkers();
}

/** 스캔은 한 번에 하나씩 (워커 하나를 같이 쓰므로 진행률이 섞이지 않게) */
let queue: Promise<unknown> = Promise.resolve();

export function readReceipt(file: File, onProgress?: (p: number) => void): Promise<ReceiptResult> {
  const gen = generation;
  const run = queue.then(() => {
    if (gen !== generation) throw new Error('ocr released');
    return scan(file, onProgress);
  });
  queue = run.catch(() => {});
  return run;
}

async function scan(file: File, onProgress?: (p: number) => void): Promise<ReceiptResult> {
  clearTimeout(idleTimer);
  const aborted = new Promise<never>((_, fail) => { abortScan = fail; });
  aborted.catch(() => {});
  const guard = <T,>(p: Promise<T>) => Promise.race([p, aborted]);
  let prep: Prep | null = null;
  try {
    // Tesseract 준비(첫 스캔만 오래 걸림)와 사진 전처리를 동시에
    const [worker, opened] = await guard(Promise.all([getTess(), openPrep(file)]));
    prep = opened;
    onTessProgress = onProgress;
    const read = async (targetW: number, C: number, full?: boolean) => (await guard(worker.recognize(await guard(opened.image(targetW, C, full))))).data.text;
    const a = parseReceipt(await read(1600, 20));
    if (a.date && a.sure.store && a.sure.total) return a;
    // 인식 결과가 글자 크기에 민감 → 확신이 낮은 항목이 있으면 다른 크기로 한 번 더 읽고 항목별로 더 믿을 만한 값 선택
    const b = parseReceipt(await read(2200, 12));
    const pick = <T,>(x: T | null, xs: boolean, y: T | null, ys: boolean) => (x != null && (xs || !ys) ? x : y ?? x);
    // 날짜는 작고 흐린 회색 글씨(앱 영수증 캡처)이거나 종이 영역 판단에서 잘려 나가는 경우가 많음
    // → 둘 다 못 읽으면 사진 전체를 약한 기준(흐린 글씨도 살림)으로 한 번 더 읽음
    let date = a.date ?? b.date;
    if (!date) date = findDate(await read(1600, 8, true));
    return {
      date,
      store: pick(a.store, a.sure.store, b.store, b.sure.store),
      total: pick(a.total, a.sure.total || a.total === b.total, b.total, b.sure.total),
      text: `${a.text}\n${b.text}`,
      sure: { store: a.sure.store || b.sure.store, total: a.sure.total || b.sure.total || (a.total != null && a.total === b.total) },
    };
  } catch (e) {
    dropWorkers(); // 워커가 망가졌을 수 있음 → 다음 스캔은 새로
    throw e;
  } finally {
    abortScan = null;
    onTessProgress = undefined;
    prep?.close();
    clearTimeout(idleTimer);
    // 해제(화면 이탈)로 끝난 스캔이 아니면 1분 뒤 해제 예약
    if (tess) idleTimer = setTimeout(dropWorkers, IDLE_MS);
  }
}

/* ── 글자 → 항목 추출 ── */

const pad = (n: number) => String(n).padStart(2, '0');

function findDate(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');
  const now = new Date().getFullYear();
  const ok = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  // 미래 연도는 오인식(2026 → 2028) → 올해로
  const year = (y: number) => (y > now ? now : y);
  const found: string[] = [];
  const add = (y: number, m: number, d: number) => { if (y >= 2000 && ok(m, d)) found.push(`${year(y)}-${pad(m)}-${pad(d)}`); };
  // 2026-09-24 · 2026.09.24 · 2026/9/24 · 2026년 9월 24일 · 2018넌01월18일(오인식) · 2026:09-19
  for (const m of t.matchAll(/(20\d{2})\s*(?:[.\-/:]|[가-힣])\s*(\d{1,2})\s*(?:[.\-/]|[가-힣])\s*(\d{1,2})(?!\d)/g)) add(+m[1], +m[2], +m[3]);
  // 점 하나가 공백으로 읽힌 경우 (2018.12 19 · 2018 12.19)
  for (const m of t.matchAll(/(?<!\d)(20\d{2})(?:\.\s?|\s)(\d{1,2})(?:\.\s?|\s)(\d{1,2})(?=\s+\d{1,2}\s*[:.;]+\s*\d{2})/g)) add(+m[1], +m[2], +m[3]);
  // 승인일자: 2501010000000 (YYMMDD + 시각) — '승인·거래·결제 일자/일시' 표기 뒤에서만
  for (const m of t.matchAll(/(?:승인|거래|결제|매출)\s?일[자시][^\d]{0,4}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{0,7}(?!\d)/g)) add(2000 + +m[1], +m[2], +m[3]);
  // 구분자 없는 8자리 (이마트 바코드 아래 '20260919/61347102/…' 등)
  for (const m of t.matchAll(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g)) add(+m[1], +m[2], +m[3]);
  // 26-09-24 · 26.09.24 (전화번호와 헷갈리지 않게 앞뒤가 숫자가 아닌 경우만)
  for (const m of t.matchAll(/(?<!\d)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?!\d)/g)) add(2000 + +m[1], +m[2], +m[3]);
  // 연도 앞자리가 깨진 경우 (0025-09-19 → 올해) — 다른 날짜가 하나도 없을 때만
  if (!found.length) for (const m of t.matchAll(/(?<!\d)\d{4}\s*[.\-/:]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g)) add(now, +m[1], +m[2]);
  if (!found.length) return null;
  // 영수증엔 날짜가 여러 번 찍힘(구매·발행일·바코드) → 가장 많이 나온 날짜, 같으면 최근 날짜
  const count = new Map<string, number>();
  found.forEach(d => count.set(d, (count.get(d) ?? 0) + 1));
  return [...count].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? 1 : -1))[0][0];
}

/**
 * 줄에서 금액 후보 (1,234 · 1.234 · 10 000(쉼표를 공백으로 오인식) · 12345원)
 * — 사업자·전화·카드·바코드 번호처럼 '-' '/' '*' ':' 로 이어진 숫자는 제외
 */
function amountsIn(raw: string): number[] {
  const out: number[] = [];
  // 숫자 사이 0 을 ㅁ·O 로 읽은 경우 (5.ㅁ00원 → 5.000원)
  const line = raw.replace(/(?<=\d[,.]?\d*)[ㅁOoD](?=[\d,.ㅁOo]*(?:원|\s|$))/g, '0');
  for (const m of line.matchAll(/(?<![\d,\-*/:])(?<!\d\.)(\d{1,3}(?:[,.]\s?\d{3})+|\d{2,3}(?: \d{3})+|\d{3,7})(?![\d,.]?\d|[-/*]\d|\*)/g)) {
    const n = Number(m[1].replace(/[,. ]/g, ''));
    if (n >= 100 && n < 100_000_000) out.push(n);
  }
  return out;
}

/** 글자 인식에서 자주 틀리는 글자 보정 후 비교 (결세·결재 → 결제, 대정·대성·내상·때상 → 대상, 급액 → 금액) */
const norm = (l: string) => l.replace(/\s+/g, '').toUpperCase()
  .replace(/[결펄필엘렐걸겔][세재께제]/g, '결제').replace(/제(?:급여|골대|금웨|금애|금색|급액)/g, '제금액').replace(/[대내때][정성상][금급]/g, '대상금').replace(/[급]액|금색/g, '금액').replace(/합[게개]/g, '합계');

/**
 * 총 합계 표현 — 우선순위 높은 것부터 (실제 결제할 금액 > 합계 > 할인 전 구매액)
 * 예) 이마트: 총 구매액 11,000 / 행사할인 -1,000 / 결제대상금액 10,000 → 10,000
 */
const TOTAL_KEYS = [
  '결제대상금액', '결제대상', '대상금액', '실결제금액', '결제할금액', '받을금액', '청구금액', '결제금액',
  '합계금액', '총합계', '금액합계', '합계', '영수금액', '총금액', '총액', 'TOTAL', '승인금액', '판매금액', '총구매액', '구매금액', '일시불', '요금',
];
const NOT_TOTAL = /부가세|부가가치세|과세|면세|공급가|할인|포인트|거스름|잔돈|받은금액|적립/;
const NOT_AMOUNT_LINE = /km|거리|시간|사업자|등록번호|대표|전화|TEL|T:|승인번호|카드번호|번호|POS|No|[캐개계]셔|캐서|포인트|적립/i;

/**
 * 표현 뒤가 숫자·기호뿐이면 숫자 조각을 이어 붙인 값 (쉼표가 공백으로 쪼개진 경우: '결제대상금액 1000 0' → 10000)
 * — 영수증 다른 줄에도 같은 금액이 있을 때만 채택 (우연히 붙은 숫자 방지)
 */
function joinedAfter(line: string, others: number[]): number | null {
  const m = line.match(/[금액색계불][\s.:~…/]*(\d[\d\s,.。]*)/);
  if (!m) return null;
  // 뒤에 잡음 숫자가 붙을 수 있어('1000 01') 긴 앞자리부터 다른 줄 금액과 맞춰 봄
  const digits = m[1].replace(/\D/g, '');
  for (let len = Math.min(8, digits.length); len >= 3; len--) {
    const n = Number(digits.slice(0, len));
    if (others.includes(n)) return n;
  }
  return null;
}

function keywordTotal(lines: string[], flat: string[], others: number[]): number | null {
  for (const key of TOTAL_KEYS) {
    for (let i = 0; i < flat.length; i++) {
      if (!flat[i].includes(key) || NOT_TOTAL.test(flat[i])) continue;
      const here = amountsIn(lines[i]);
      const joined = joinedAfter(lines[i], others);
      if (joined != null && (!here.length || joined > here[here.length - 1])) return joined;
      if (here.length) return here[here.length - 1];
      const next = lines[i + 1] ? amountsIn(lines[i + 1]) : [];
      if (next.length) return next[next.length - 1];
    }
  }
  return null;
}

/**
 * 상품 목록 줄 — '상품명·단가·수량' 머리글 다음부터 합계·결제 등 요약 줄 전까지, 금액이 2개 이상인 줄(단가 … 금액)
 * 각 줄의 마지막 금액 = 상품 금액
 */
function itemLines(flat: string[], lines: string[]): { idx: Set<number>; sum: number } {
  const idx = new Set<number>();
  let sum = 0;
  const start = flat.findIndex(f => /품명|품목|메뉴|단가|수량/.test(f));
  if (start < 0) return { idx, sum };
  for (let i = start + 1; i < lines.length; i++) {
    if (/합계|결제|공급가|과세|부가세|총|받을|청구|내역|할인|포인트/.test(flat[i])) break;
    const a = amountsIn(lines[i]);
    if (a.length >= 2) { idx.add(i); sum += a[a.length - 1]; }
  }
  return { idx, sum };
}

function findTotal(lines: string[]): { value: number | null; sure: boolean } {
  const flat = lines.map(norm);
  const items = itemLines(flat, lines);
  const isCand = (l: string, i: number) => !NOT_TOTAL.test(flat[i]) && !NOT_AMOUNT_LINE.test(l);
  const cands = lines.filter(isCand).flatMap(amountsIn);
  // 결제 금액은 합계·결제대상·카드 승인 등으로 여러 번 찍힘 → 2번 이상 나온 금액으로 교차 확인
  // (상품 목록 줄은 제외 — 같은 값 상품 2개(2,500 · 2,500)를 합계로 오인하지 않도록)
  const count = new Map<number, number>();
  lines.forEach((l, i) => { if (isCand(l, i) && !items.idx.has(i)) amountsIn(l).forEach(n => count.set(n, (count.get(n) ?? 0) + 1)); });
  const repeated = [...count].filter(([, c]) => c >= 2).map(([n]) => n);
  const rep = repeated.length ? Math.max(...repeated) : null;
  const key = keywordTotal(lines, flat, cands);
  // 부가세 검산: 과세물품가액 + 부가세 = 합계 (한국 영수증 공통) — 맞는 후보가 있으면 그것으로 확정
  const lastAmt = (re: RegExp, not?: RegExp) => {
    const i = flat.findIndex(f => re.test(f) && !(not?.test(f)));
    const a = i >= 0 ? amountsIn(lines[i]) : [];
    return a.length ? a[a.length - 1] : null;
  };
  const supply = lastAmt(/과세물품|공급가/);
  const vat = lastAmt(/부가세|부가가치세|세액/, /과세물품|공급가|면세/);
  if (supply != null && vat != null && Math.abs(supply / 10 - vat) <= 2) {
    const sum = supply + vat;
    const hit = [key, rep].find(n => n != null && Math.abs(n - sum) <= 1);
    return { value: hit ?? sum, sure: true };
  }
  // 앞자리 잡음이 붙은 금액('65,000' → 5,000) 후보
  const trim = (n: number) => (n >= 10_000 ? Number(String(n).slice(1)) : null);
  const pool = [key, rep, ...cands].filter((n): n is number => n != null);
  const pool2 = [...pool, ...pool.map(trim).filter((n): n is number => n != null)];
  // 표기가 깨져도 숫자 쌍으로 검산: 공급가액 a 와 그 1/10 인 부가세 v 가 함께 있고, a + v 가 영수증에 찍혀 있으면 확정
  // (과세물품 9,091 · 부가세 909 → 10,000)
  const all = lines.flatMap(amountsIn);
  const sums = new Set<number>();
  for (const a of all) for (const v of all) if (a >= 1000 && Math.abs(Math.round(a / 10) - v) <= 1) sums.add(a + v);
  const pairHit = [...sums].filter(n => pool2.some(p => Math.abs(p - n) <= 1)).sort((x, y) => y - x)[0];
  if (pairHit) return { value: pairHit, sure: true };
  // 부가세 줄을 못 읽었으면 공급가액 × 1.1 과 맞는 후보
  if (supply != null) {
    const expect = supply * 1.1;
    const hit = pool2.find(n => Math.abs(n - expect) <= Math.max(10, expect * 0.005));
    if (hit) return { value: hit, sure: true };
  }
  // 상품 금액 합계로 검산 (코코라떼 2,500 + 리얼허니라떼 2,500 = 5,000)
  const S = items.sum;
  if (S > 0) {
    if (key === S || (key != null && trim(key) === S)) return { value: S, sure: true };
    if (key == null) return { value: S, sure: pool.includes(S) };
  }
  // 표현 옆 금액이 반복 금액보다 작으면 자릿수 오인식(10,000 → 1000)으로 보고 반복 금액 사용
  let value = key != null && (rep == null || key >= rep) ? key : rep ?? (cands.length ? Math.max(...cands) : null);
  // 합계가 공급가액보다 작을 수는 없음 → 공급가액 × 1.1 (10원 단위)
  if (supply != null && (value == null || value < supply)) return { value: Math.round((supply * 1.1) / 10) * 10, sure: false };
  if (value == null && S > 0) value = S;
  return { value, sure: value != null && ((count.get(value) ?? 0) >= 2 || value === S) };
}

/**
 * 상호명 — ① '상호:' 표기 ② 윗부분에서 'OO점' (지점명) ③ 윗부분의 첫 한글 줄
 * 줄 끝에 붙은 전화·사업자번호·대표자는 잘라내고 판단 (예: '이마트 계양점 T:(032)717-1234' → '이마트 계양점')
 */
const STORE_KEYS = /(상호명|상호|가맹점명|가맹점|매장명|점포명|업체명)\s*[:：]?\s*/;
const NOT_STORE = /[영엄염]수\s?[증중]|감사|이용해|전표|고객용|카드|사업자|등록번호|대표|전화|TEL|주소|일시|번호|승인|결제|합계|금액|단가|수량|품명|POS|No\.|교환|환불|반품|상품|이내|한함|지참|광역시|특별시|[시군구]\s|[로길동]\s?\d/i;
const TAIL = /\s*(?:T\s?[:.]|TEL|☎|전화|대표|사업자|\(?\d{2,4}[-)]\d{3,4}|\d{3}-\d{2}-\d{5}).*$/i;

const cleanStore = (s: string) =>
  s.replace(/[ㄱ-ㅣ]+/g, ' ').replace(TAIL, '').replace(/^\(?주\)?\s*(?=\S)|\(주\)|㈜/g, '').replace(/[^\p{L}\p{N}\s&·\-]/gu, '').replace(/\s{2,}/g, ' ').trim().slice(0, 24);

/** 대형 매장명 — 앞에 붙은 인식 잡음 제거·띄어쓰기 보정 (… 이마트계양점 → 이마트 계양점) */
const CHAIN = '이마트24|이마트|홈플러스|롯데마트|트레이더스|노브랜드|코스트코|하나로마트|GS25|CU|세븐일레븐|다이소|올리브영|스타벅스|투썸플레이스|이디야|파리바게뜨|뚜레쥬르';
const CHAIN_BRANCH = new RegExp(`(${CHAIN})\\s?([가-힣]{1,6}점)`);
/** 'OO점' 지점명 — 앞뒤 인식 잡음은 버리고 '상호 지점' 두 단어만 */
const BRANCH = /(?:^|\s)([가-힣A-Za-z0-9&]{2,})\s?([가-힣]{1,6}점)(?=\s|$)/;
/** 이마트 첫 글자 누락·오인식 보정 (마트·미마트·0마트 계양점 → 이마트 계양점) */
const fixEmart = (s: string) => s.replace(/(^|\s)[미이0O○]?마트(?=\s?[가-힣]{1,6}점)/, '$1이마트');

function findStore(lines: string[]): { value: string | null; sure: boolean } {
  for (const l of lines) {
    const m = l.match(STORE_KEYS);
    if (!m) continue;
    const rest = cleanStore(l.slice((m.index ?? 0) + m[0].length));
    if (/[가-힣A-Za-z]{2,}/.test(rest)) return { value: rest, sure: true };
  }
  for (const l of lines.slice(0, 8)) {
    const m = l.match(/^\[([^\]]{3,30})\]?/);
    const v = m && cleanStore(m[1]);
    if (v && /[가-힣A-Za-z]{2,}/.test(v) && !NOT_STORE.test(v.replace(/\s/g, '')) && !/구매|매출|판매|반품|결제/.test(v)) return { value: v, sure: true };
  }
  const top = lines.slice(0, 12).map(l => fixEmart(cleanStore(l)));
  for (const s of top) {
    const m = s.match(CHAIN_BRANCH);
    if (m) return { value: `${m[1]} ${m[2]}`, sure: true };
  }
  for (const s of top) {
    const m = s.match(BRANCH);
    if (m && !NOT_STORE.test(s)) return { value: `${m[1]} ${m[2]}`, sure: true };
  }
  const hangulRatio = (s: string) => (s.match(/[가-힣]/g)?.length ?? 0) / Math.max(1, s.replace(/\s/g, '').length);
  return { value: top.find(s => /[가-힣]{3,}/.test(s) && hangulRatio(s) >= 0.6 && !NOT_STORE.test(s.replace(/\s/g, '')) && !/\d{3,}/.test(s)) ?? null, sure: false };
}

/** sure: 교차 확인된 값인지 (확신 낮으면 다른 크기로 다시 읽음) */
export function parseReceipt(text: string): ReceiptResult & { sure: { store: boolean; total: boolean } } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const store = findStore(lines), total = findTotal(lines);
  return { date: findDate(text), store: store.value, total: total.value, text, sure: { store: store.sure, total: total.sure } };
}
