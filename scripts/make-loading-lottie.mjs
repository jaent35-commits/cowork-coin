/**
 * 로딩 애니메이션(Lottie JSON) 생성 — `yarn lottie`
 * 원본: brand/cowork-coin_kya.webp (투명 '캬아! ㅋㅇ' 캐릭터)를 부위별로 잘라 이미지 에셋으로 넣고,
 * 움직임은 키프레임으로 작성. 500×500 · 30fps
 *   0–96  인트로: 1 동장 → 2 신나게 점프! → 3 최고!(웃는 얼굴·반짝이) → 4 캬아 효과!
 *   96–156 반복 대기 (루프 구간, 첫·끝 프레임 동일)
 * 출력: src/assets/lottie/kowok-loading.json
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = `${root}brand/cowork-coin_kya.webp`;
const OUT = `${root}src/assets/lottie/kowok-loading.json`;

const FR = 30, W = 500, H = 500, INTRO = 96, OP = 156;
const ART = 0.36;   // 원본(1305×1206) → 화면 배율
const RES = 0.54;   // 에셋 해상도(화면 1.5배)
const K = 100 / RES; // 에셋을 원본 좌표계로 되돌리는 배율(%)

/* ── 부위 나누기: 투명 영역으로 떨어진 획(연결 요소) 단위로 분류 → 경계가 잘리지 않음 ── */
const { data: raw, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const IW = info.width, IH = info.height, TH = 8;
const label = new Int32Array(IW * IH).fill(-1);
const comps = [];
for (let s0 = 0; s0 < IW * IH; s0++) {
  if (label[s0] !== -1 || raw[s0 * 4 + 3] < TH) continue;
  const c = { id: comps.length, n: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  const stack = [s0];
  label[s0] = c.id;
  while (stack.length) {
    const p = stack.pop(), x = p % IW, y = (p / IW) | 0;
    c.n++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
    for (const q of [p - 1, p + 1, p - IW, p + IW]) {
      if (q < 0 || q >= IW * IH || Math.abs((q % IW) - x) > 1) continue;
      if (label[q] === -1 && raw[q * 4 + 3] >= TH) { label[q] = c.id; stack.push(q); }
    }
  }
  comps.push(c);
}
// 가장자리의 아주 옅은 픽셀(<TH)은 이웃 획에 붙임
for (let pass = 0; pass < 2; pass++) {
  const next = label.slice();
  for (let p = 0; p < IW * IH; p++) {
    if (label[p] !== -1 || raw[p * 4 + 3] === 0) continue;
    const x = p % IW;
    for (const q of [p - 1, p + 1, p - IW, p + IW]) {
      if (q >= 0 && q < IW * IH && Math.abs((q % IW) - x) <= 1 && label[q] !== -1) { next[p] = label[q]; break; }
    }
  }
  label.set(next);
}
const bodyId = comps.reduce((m, c) => (c.n > m.n ? c : m)).id;
const kind = c => {
  if (c.id === bodyId) return 'body';
  const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
  if (cy < 420 && cx >= 370 && cx <= 960) return 'kya';          // '캬아!' 글자
  if (cx >= 520 && cx <= 810 && c.y0 >= 410 && c.y1 < 575) return 'lines'; // 머리 위 효과선
  if (c.y0 >= 555) return 'body';
  return 'sparks';                                               // 반짝이·점선
};
const kindOf = comps.map(kind);

async function part(name) {
  const own = comps.filter(c => kindOf[c.id] === name);
  const x0 = Math.max(0, Math.min(...own.map(c => c.x0)) - 3), y0 = Math.max(0, Math.min(...own.map(c => c.y0)) - 3);
  const x1 = Math.min(IW, Math.max(...own.map(c => c.x1)) + 4), y1 = Math.min(IH, Math.max(...own.map(c => c.y1)) + 4);
  const w = x1 - x0, h = y1 - y0;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y0 + y) * IW + (x0 + x);
      if (label[si] !== -1 && kindOf[label[si]] === name) raw.copy(buf, (y * w + x) * 4, si * 4, si * 4 + 4);
    }
  }
  const png = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .resize(Math.round(w * RES), Math.round(h * RES))
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { id: `img_${name}`, w: meta.width, h: meta.height, u: '', p: `data:image/png;base64,${png.toString('base64')}`, e: 1, x0, y0, x1, y1 };
}

const A = { kya: await part('kya'), lines: await part('lines'), sparks: await part('sparks'), body: await part('body') };
// 레이어 기준 좌표(원본 좌표계 bbox)
const R = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, [v.x0, v.y0, v.x1, v.y1]]));

/* ── 키프레임 도우미 ── */
const EASE = { o: [0.33, 0], i: [0.67, 1] };      // 부드럽게
const POP = { o: [0.34, 1.56], i: [0.64, 1] };   // 튕김(easeOutBack) — 커질 때만
const IN = { o: [0.5, 0], i: [0.9, 0.6] };       // 쏙 들어감
const arr = v => (Array.isArray(v) ? v : [v]);
function anim(keys, ease = EASE) {
  // keys: [[frame, value, 이 구간 ease?], ...]
  return {
    a: 1,
    k: keys.map(([t, v, e], idx) => {
      const s = arr(v);
      if (idx === keys.length - 1) return { t, s };
      const n = s.length, E = e ?? ease;
      return { t, s, i: { x: Array(n).fill(E.i[0]), y: Array(n).fill(E.i[1]) }, o: { x: Array(n).fill(E.o[0]), y: Array(n).fill(E.o[1]) } };
    }),
  };
}
const stat = v => ({ a: 0, k: v });
const ks = ({ o = stat(100), r = stat(0), p = stat([0, 0, 0]), a = stat([0, 0, 0]), s = stat([100, 100, 100]) } = {}) => ({ o, r, p, a, s });
const split = (x, y) => ({ s: true, x, y });
let ind = 0;
const layer = (ty, nm, extra) => ({ ddd: 0, ind: ++ind, ty, nm, sr: 1, ao: 0, ip: 0, op: OP, st: 0, bm: 0, ...extra });

/* ── 좌표계: art(원본 좌표 → 화면) / rig(발 아래 중심 기준 점프·찌그러짐) ── */
const ART_X = 12.4, ART_Y = 30;
const FEET = [660, 1130];

const art = layer(3, 'art', { ks: ks({ p: stat([ART_X, ART_Y, 0]), s: stat([ART * 100, ART * 100, 100]) }) });

const ry = FEET[1];
const rig = layer(3, 'rig', {
  parent: art.ind,
  ks: ks({
    a: stat([FEET[0], FEET[1], 0]),
    p: split(stat(FEET[0]), anim([
      [0, ry + 260], [10, ry - 30], [16, ry],           // 1 동장: 아래에서 톡
      [20, ry], [30, ry - 230], [38, ry],               // 2 점프!
      [44, ry], [58, ry], [62, ry - 40], [67, ry],      // 3 최고 → 4 캬아 콩
      [96, ry], [111, ry - 18], [126, ry], [141, ry - 18], [156, ry], // 5 대기 둥실
    ])),
    s: anim([
      [0, [30, 30, 100]], [10, [108, 108, 100]], [16, [100, 100, 100]],
      [20, [114, 86, 100]], [26, [92, 110, 100]], [31, [100, 100, 100]],
      [37, [100, 100, 100]], [39, [116, 84, 100]], [44, [96, 104, 100]], [48, [100, 100, 100]],
      [58, [100, 100, 100]], [60, [108, 92, 100]], [64, [97, 104, 100]], [68, [100, 100, 100]],
      [96, [100, 100, 100]], [126, [101, 99, 100]], [156, [100, 100, 100]],
    ]),
    r: anim([
      [0, -8], [16, 0], [24, -6], [32, 5], [40, 0],
      [96, 0], [116, 2], [136, -2], [156, 0],
    ]),
  }),
});

const imgLayer = (a, nm, extra) => layer(2, nm, { refId: a.id, ...extra });

// 몸통
const body = imgLayer(A.body, 'body', {
  parent: rig.ind,
  ks: ks({ p: stat([A.body.x0, A.body.y0, 0]), s: stat([K, K, 100]), o: anim([[0, 0], [6, 100]]) }),
});

// 3 최고! — ㅇ 위에 웃는 얼굴 (벡터)
const CREAM = [0.988, 0.965, 0.922, 1], BROWN = [0.235, 0.078, 0.047, 1], PINK = [0.96, 0.62, 0.6, 1];
const path = (v, i, o, c = false) => ({ ty: 'sh', ks: stat({ c, v, i: i ?? v.map(() => [0, 0]), o: o ?? v.map(() => [0, 0]) }) });
const fill = c => ({ ty: 'fl', c: stat(c), o: stat(100), r: 1 });
const stroke = (c, w) => ({ ty: 'st', c: stat(c), o: stat(100), w: stat(w), lc: 2, lj: 2 });
const trs = (o = 100) => ({ ty: 'tr', p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(o) });
const group = (nm, it) => ({ ty: 'gr', nm, it: [...it, trs()] });
const ellipse = (p, s) => ({ ty: 'el', p: stat(p), s: stat(s) });
const face = layer(4, 'face', {
  parent: rig.ind,
  ks: ks({
    p: stat([898, 770, 0]),
    s: anim([[40, [0, 0, 100]], [45, [118, 118, 100]], [49, [100, 100, 100]], [55, [100, 100, 100], IN], [59, [0, 0, 100]]], POP),
  }),
  shapes: [
    group('blush', [ellipse([-104, 44], [46, 28]), { ...fill(PINK), o: stat(55) }]),
    group('eyes', [
      path([[-74, -52], [-34, -28], [-74, -4]]),
      path([[74, -52], [34, -28], [74, -4]]),
      stroke(BROWN, 16),
    ]),
    // 활짝 웃는 입: 윗선은 직선, 아랫선은 곡선으로 닫힘
    group('smile', [path([[-46, 20], [46, 20]], [[10, 52], [0, 0]], [[0, 0], [-10, 52]], true),
      fill([0.62, 0.16, 0.12, 1]), stroke(BROWN, 14)]),
    group('blush2', [ellipse([104, 44], [46, 28]), { ...fill(PINK), o: stat(55) }]),
    group('disc', [ellipse([0, 0], [318, 318]), fill(CREAM)]),
  ],
});

// 머리 위 효과선 — 동장과 함께 톡, 캬아 때 번쩍, 대기 중엔 깜빡
const lc = [(R.lines[0] + R.lines[2]) / 2, R.lines[3]];
const lines = imgLayer(A.lines, 'lines', {
  parent: rig.ind,
  ks: ks({
    a: stat([(lc[0] - A.lines.x0) * RES, (lc[1] - A.lines.y0) * RES, 0]),
    p: stat([lc[0], lc[1], 0]),
    s: anim([
      [6, [0, 0, 100]], [12, [K * 1.15, K * 1.15, 100]], [16, [K, K, 100]],
      [58, [K, K, 100]], [62, [K * 1.25, K * 1.25, 100]], [68, [K, K, 100]],
      [96, [K, K, 100]], [111, [K * 1.1, K * 1.1, 100]], [126, [K, K, 100]], [141, [K * 1.1, K * 1.1, 100]], [156, [K, K, 100]],
    ]),
    o: anim([[6, 0], [9, 100], [96, 100], [111, 55], [126, 100], [141, 55], [156, 100]]),
  }),
});

// 반짝이 — 3 최고!에서 뿅, 4 캬아까지 유지 후 사라짐
const sc = [(R.sparks[0] + R.sparks[2]) / 2, (R.sparks[1] + R.sparks[3]) / 2];
const sparks = imgLayer(A.sparks, 'sparks', {
  parent: art.ind,
  ks: ks({
    a: stat([(sc[0] - A.sparks.x0) * RES, (sc[1] - A.sparks.y0) * RES, 0]),
    p: stat([sc[0], sc[1] + 20, 0]),
    s: anim([[40, [K * 0.6, K * 0.6, 100]], [46, [K * 1.08, K * 1.08, 100]], [50, [K, K, 100], EASE], [86, [K, K, 100], EASE], [94, [K * 1.1, K * 1.1, 100]]], POP),
    o: anim([[40, 0], [44, 100], [86, 100], [94, 0]]),
    r: anim([[40, -6], [50, 0], [70, 2], [86, 0]]),
  }),
});

// 4 캬아 효과! — 글자가 뿅
const kc = [(R.kya[0] + R.kya[2]) / 2, (R.kya[1] + R.kya[3]) / 2];
const kya = imgLayer(A.kya, 'kya', {
  parent: art.ind,
  ks: ks({
    a: stat([(kc[0] - A.kya.x0) * RES, (kc[1] - A.kya.y0) * RES, 0]),
    p: split(stat(kc[0]), anim([[58, kc[1] + 80], [64, kc[1] - 10], [68, kc[1]], [86, kc[1]], [94, kc[1] - 50]])),
    s: anim([[58, [0, 0, 100]], [64, [K * 1.18, K * 1.18, 100]], [68, [K, K, 100], EASE], [86, [K, K, 100], IN], [94, [K * 0.9, K * 0.9, 100]]], POP),
    r: anim([[58, -14], [64, 4], [70, 0]]),
    o: anim([[58, 0], [61, 100], [86, 100], [94, 0]]),
  }),
});

// 바닥 그림자 — 점프할수록 작고 옅게
const shadow = layer(4, 'shadow', {
  parent: art.ind,
  ks: ks({
    p: stat([FEET[0], FEET[1] + 22, 0]),
    s: anim([[0, [0, 0, 100]], [12, [100, 100, 100]], [20, [108, 100, 100]], [30, [58, 70, 100]], [38, [112, 100, 100]], [44, [100, 100, 100]],
      [58, [100, 100, 100]], [62, [86, 90, 100]], [67, [100, 100, 100]],
      [96, [100, 100, 100]], [111, [92, 95, 100]], [126, [100, 100, 100]], [141, [92, 95, 100]], [156, [100, 100, 100]]]),
    o: anim([[0, 0], [12, 100], [30, 55], [38, 100]]),
  }),
  shapes: [group('shadow', [ellipse([0, 0], [640, 56]), { ...fill([0.33, 0.2, 0.13, 1]), o: stat(16) }])],
});

const strip = a => ({ id: a.id, w: a.w, h: a.h, u: a.u, p: a.p, e: a.e });
const lottie = {
  v: '5.12.2', fr: FR, ip: 0, op: OP, w: W, h: H, nm: '코웍-코인 로딩', ddd: 0,
  assets: Object.values(A).map(strip),
  // 위 → 아래 순서
  layers: [kya, sparks, lines, face, body, rig, shadow, art],
  markers: [{ tm: 0, cm: 'intro', dr: INTRO }, { tm: INTRO, cm: 'idle', dr: OP - INTRO }],
};

await mkdir(new URL('../src/assets/lottie/', import.meta.url), { recursive: true });
const json = JSON.stringify(lottie);
await writeFile(OUT, json);
console.log(`kowok-loading.json ${(json.length / 1024).toFixed(0)} KB · ${OP} frames @${FR}fps (intro 0–${INTRO}, loop ${INTRO}–${OP})`);
