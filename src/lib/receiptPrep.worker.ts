/**
 * 영수증 전처리 Web Worker — 사진 확대·이진화(가장 무거운 단계)를 메인 스레드 밖에서 (화면 멈춤 방지)
 * 메시지: load(file, box) → { w, h } / image(targetW, C, full) → PNG Blob / close
 * - 종이 영역(box)은 메인 스레드에서 <img> 로 찾아서 받음: 200px 축소 결과가 <img> 와 ImageBitmap 에서 달라
 *   같은 영역을 얻으려면 <img> 로 계산해야 함 (축소본이라 가벼움). 확대·이진화 결과는 두 경로가 같음
 * 계산은 receiptPrep.ts (메인 스레드 대체 경로와 같은 함수)
 */
import { prepare, type Box } from './receiptPrep';

type Req =
  | { id: number; type: 'load'; file: Blob; box: Box }
  | { id: number; type: 'image'; targetW: number; C: number; full: boolean }
  | { id: number; type: 'upload'; file: Blob; maxEdge: number; quality: number }
  | { id: number; type: 'close' };

const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);
const make = (w: number, h: number) => new OffscreenCanvas(w, h);

let img: ImageBitmap | null = null;
let box: Box | null = null;

self.addEventListener('message', async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      img?.close();
      // 휴대폰 사진 방향(EXIF) 반영 — <img> 로 그릴 때와 같은 방향
      img = await createImageBitmap(m.file, { imageOrientation: 'from-image' });
      box = m.box;
      post({ id: m.id, w: img.width, h: img.height });
    } else if (m.type === 'image') {
      if (!img || !box) throw new Error('no image');
      const area = m.full ? { x: 0, y: 0, w: img.width, h: img.height } : box;
      const blob = await (prepare(img, area, m.targetW, m.C, make) as OffscreenCanvas).convertToBlob({ type: 'image/png' });
      post({ id: m.id, blob });
    } else if (m.type === 'upload') {
      // PaddleOCR 서버로 보낼 사진 — 긴 변 maxEdge 초과만 비율 유지 축소(EXIF 방향 반영) → JPEG. 작으면 blob 없이 응답(원본 그대로)
      const bmp = await createImageBitmap(m.file, { imageOrientation: 'from-image' });
      try {
        const long = Math.max(bmp.width, bmp.height);
        if (long <= m.maxEdge) { post({ id: m.id }); return; }
        const k = m.maxEdge / long, w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const c = new OffscreenCanvas(w, h), x = c.getContext('2d')!;
        x.imageSmoothingQuality = 'high';
        x.drawImage(bmp, 0, 0, w, h);
        post({ id: m.id, blob: await c.convertToBlob({ type: 'image/jpeg', quality: m.quality }) });
      } finally {
        bmp.close();
      }
    } else {
      img?.close(); img = null; box = null;
      post({ id: m.id });
    }
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
});
