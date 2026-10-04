/**
 * 영수증 사진 → 인식용 흑백 이미지 (종이 영역 찾기 + 주변 밝기 기준 이진화)
 * — 캔버스를 주입받아 메인 스레드(HTMLCanvasElement)와 Web Worker(OffscreenCanvas) 양쪽에서 같은 계산을 한다.
 *   (receiptPrep.worker.ts 가 기본, 지원하지 않는 브라우저는 receiptOcr.ts 에서 메인 스레드로)
 */

/** 전처리 이미지 최대 화소 — 휴대폰은 메모리가 작아 낮춤 (확대·이진화에 화소당 약 20바이트: 9백만 화소 ≈ 180MB) */
const MAX_PIXELS = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 6_000_000 : 9_000_000;

export interface Box { x: number; y: number; w: number; h: number }
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type MakeCanvas = (w: number, h: number) => AnyCanvas;
type Src = HTMLImageElement | ImageBitmap;

const ctx2d = (c: AnyCanvas) => c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * 값이 기준을 넘는 가장 긴 연속 구간 [시작, 끝)
 * — 글자가 몰린 줄은 종이 비율이 낮게 나와 구간이 끊기므로 이동평균으로 다듬고, 기준은 최댓값의 절반
 */
function longestRun(raw: number[]): [number, number] {
  const r = Math.max(1, Math.round(raw.length * 0.025));
  const arr = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(raw.length - 1, i + r); j++) { s += raw[j]; n++; }
    return s / n;
  });
  const th = Math.max(0.2, Math.max(...arr) * 0.5);
  const maxGap = Math.max(1, Math.round(raw.length * 0.05));
  let best: [number, number] = [0, 0], s = -1, last = -1;
  for (let i = 0; i <= arr.length; i++) {
    if (i < arr.length && arr[i] > th) { if (s < 0) s = i; last = i; }
    else if (s >= 0 && (i === arr.length || i - last > maxGap)) {
      if (last + 1 - s > best[1] - best[0]) best = [s, last + 1];
      s = -1;
    }
  }
  return best;
}

/**
 * 진한 글자(검정·파랑 잉크)가 있는 범위 + 여백 — 흐린 뒷면 비침·그림자는 제외.
 * 글자가 거의 없으면 사진 전체.
 */
function inkBox(p: Uint8ClampedArray, sw: number, sh: number, W: number, H: number): Box {
  const dark = (i: number) => {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b < 110 || (b - r > 40 && b > 100);
  };
  const colN = new Array(sw).fill(0), rowN = new Array(sh).fill(0);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (dark(y * sw + x)) { colN[x]++; rowN[y]++; }
  const span = (arr: number[], min: number): [number, number] => {
    const a = arr.findIndex(n => n >= min);
    let b = arr.length - 1;
    while (b > a && arr[b] < min) b--;
    return [a, b + 1];
  };
  const [x0, x1] = span(colN, 2), [y0, y1] = span(rowN, 2);
  if (x0 < 0 || y0 < 0 || x1 - x0 < sw * 0.1 || y1 - y0 < sh * 0.05) return { x: 0, y: 0, w: W, h: H };
  const k = W / sw, px = (x1 - x0) * 0.05, py = (y1 - y0) * 0.03;
  const left = Math.max(0, (x0 - px) * k), top = Math.max(0, (y0 - py) * k);
  return { x: left, y: top, w: Math.min(W, (x1 + px) * k) - left, h: Math.min(H, (y1 + py) * k) - top };
}

/**
 * 영수증 종이 영역 — 밝고 파란 기 없는 픽셀이 많은 열·행의 가장 긴 구간.
 * 천·책상 같은 배경 무늬가 글자로 오인식되는 것을 막음. 못 찾으면 사진 전체.
 * W·H = 사진 크기(EXIF 방향 반영)
 */
export function findPaper(img: Src, W: number, H: number, make: MakeCanvas): Box {
  const sw = 200, sh = Math.max(1, Math.round((H * sw) / W));
  const c = make(sw, sh);
  const x = ctx2d(c);
  x.drawImage(img, 0, 0, sw, sh);
  const p = x.getImageData(0, 0, sw, sh).data;
  const isPaper = (i: number) => {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    const mx = Math.max(r, g, b);
    // 영수증 감열지는 흰색~약간 누런색(빨강 ≥ 파랑), 천·책상 배경은 회색·푸른 기가 많음
    return mx > 150 && b - r < 3 && mx - Math.min(r, g, b) < 40;
  };
  const cols = Array.from({ length: sw }, (_, cx) => { let n = 0; for (let y = 0; y < sh; y++) if (isPaper(y * sw + cx)) n++; return n / sh; });
  const [x0, x1] = longestRun(cols);
  if (x1 - x0 < sw * 0.2) return inkBox(p, sw, sh, W, H);
  // 배경도 흰색이면(흰 책상·종이 위) 종이 구분이 안 되므로 진한 글자가 있는 범위로 자름
  if (x1 - x0 > sw * 0.9) return inkBox(p, sw, sh, W, H);
  const isInk = (i: number) => {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mx < 100 && mx - mn < 60) || b - r > 40; // 검정 글자·가림 줄 / 파란 잉크
  };
  const rows = Array.from({ length: sh }, (_, cy) => { let n = 0; for (let cx = x0; cx < x1; cx++) { const i = cy * sw + cx; if (isPaper(i) || isInk(i)) n++; } return n / (x1 - x0); });
  let [y0, y1] = longestRun(rows);
  if (y1 - y0 < sh * 0.2) [y0, y1] = [0, sh];
  const k = W / sw, padX = (x1 - x0) * 0.03;
  const left = Math.max(0, (x0 - padX) * k), right = Math.min(W, (x1 + padX) * k);
  return { x: left, y: y0 * k, w: right - left, h: Math.min(H, y1 * k) - y0 * k };
}

/**
 * 종이 영역만 잘라 글자가 충분히 크도록 확대 → 주변 밝기 기준 이진화(흑/백)
 * — 그림자·구김으로 밝기가 고르지 않은 사진에서 단순 흑백 변환보다 훨씬 정확
 */
export function prepare(img: Src, box: Box, targetW: number, C: number, make: MakeCanvas): AnyCanvas {
  const scale = Math.min(3, Math.max(targetW / box.w, Math.min(1, 2400 / box.w)), Math.sqrt(MAX_PIXELS / (box.w * box.h)));
  const W = Math.round(box.w * scale), H = Math.round(box.h * scale);
  const c = make(W, H);
  const ctx = ctx2d(c);
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H), p = d.data;
  const lum = (i: number) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  // 적분 영상 → 각 픽셀 주변 평균 밝기
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += lum((y * W + x) * 4);
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const half = Math.max(10, Math.round(W / 40));
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(H, y + half + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(W, x + half + 1);
      const mean = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const i = (y * W + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = lum(i) < mean - C ? 0 : 255;
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
