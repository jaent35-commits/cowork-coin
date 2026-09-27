// brand/ 의 원본 이미지로 앱 아이콘 · 헤더 로고 · OG 이미지를 생성한다.
// 실행: yarn brand
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const brand = (f) => `${root}brand/${f}`;
const out = (f) => `${root}${f}`;
const ICON = brand('cowork-coin_icon.png');
const LOGO = brand('cowork-coin_logo.png');
const OG = brand('cowork-coin_og.webp');
const KYA = brand('cowork-coin_kya.webp'); // 캬아! 캐릭터 (GNB 하단 장식)
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
// 아이콘 배경 그라데이션(좌상 → 우하). 모서리를 채워야 하는 maskable / apple-touch 배경에 사용
const GRAD = ['#FFD35E', '#FFB133'];

await mkdir(out('public/icons'), { recursive: true });

// 원본 둘레의 투명 여백을 잘라 아이콘 본체만 사용
const ICON_BUF = await sharp(ICON).trim({ threshold: 1 }).toBuffer();

const gradientBg = (size) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRAD[0]}"/><stop offset="1" stop-color="${GRAD[1]}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`,
);

/** 정사각 캔버스 중앙에 아이콘 배치 (scale = 캔버스 대비 아이콘 폭, fill = 그라데이션 배경) */
async function icon(size, file, { scale = 1, fill = false } = {}) {
  const inner = Math.round(size * scale);
  let img = await sharp(ICON_BUF).resize(inner, inner, { fit: 'contain', background: CLEAR }).toBuffer();
  if (inner > size) {
    // 캔버스보다 크게 확대한 경우 중앙을 잘라 모서리 투명 영역을 없앤다
    const off = Math.floor((inner - size) / 2);
    img = await sharp(img).extract({ left: off, top: off, width: size, height: size }).toBuffer();
  }
  const base = fill
    ? sharp(gradientBg(size))
    : sharp({ create: { width: size, height: size, channels: 4, background: CLEAR } });
  await base.composite([{ input: img, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(out(`public/icons/${file}`));
}

await icon(64, 'favicon-64.png');
await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');
// 캐릭터 영역이 아이콘의 ~76% 라 꽉 채워도 안전영역(80%) 안 — 둥근 모서리만 그라데이션으로 채움
await icon(512, 'icon-maskable-512.png', { scale: 1, fill: true });
await icon(180, 'apple-touch-icon.png', { scale: 1.08, fill: true }); // iOS 는 투명 모서리를 검게 칠함

// 로그인·설치 안내·접힌 GNB 아이콘 (76px 표시 × 3)
await sharp(ICON_BUF).resize(228, 228, { fit: 'contain', background: CLEAR }).png({ compressionLevel: 9 }).toFile(out('src/assets/kowok-icon.png'));

// GNB·헤더 로고: 투명 여백 trim 후 높이 132px(표시 44px × 3) WebP
await sharp(LOGO).trim({ threshold: 1 }).resize({ height: 132 }).webp({ quality: 92, alphaQuality: 100 }).toFile(out('src/assets/kowok-logo.webp'));

// OG 이미지: 1200×630(1.91:1) 권장 비율로 중앙 크롭
// GNB 하단 장식 — 표시 폭 84px 의 2배
await sharp(KYA).trim({ threshold: 1 }).resize({ width: 168 }).webp({ quality: 90, alphaQuality: 100 }).toFile(out('src/assets/kowok-kya.webp'));

await sharp(OG).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 86, mozjpeg: true }).toFile(out('public/og-image.jpg'));

console.log('brand assets generated');
