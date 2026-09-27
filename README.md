# 코웍-코인 : 프로젝트 예산 관리 시스템

> 프로젝트는 함께일 때 더 맛있으니까!

팀 회의비(분기 인원 × 단가)와 프로젝트 경비(팀 배분 금액)를 함께 관리하는 PWA입니다.
`../Cowork-Coin-kio` (Figma Make 프로토타입)를 아래 스택으로 재구성했습니다.

| 항목 | 버전 |
| --- | --- |
| JavaScript | ES2022+ |
| TypeScript | 5.9.3 |
| React / React DOM | 19.2 |
| Node | 24.13.1 이상 (`.nvmrc`) |
| Vite (+HMR) | 7.3.1 |
| Yarn Berry | 4.12.0 (`packageManager`, `nodeLinker: node-modules`) |
| PWA | vite-plugin-pwa (Workbox generateSW) |
| 스타일 | 순수 CSS + Media Query (CSS 변수 토큰) |

## 실행

```bash
corepack enable          # 최초 1회 — package.json 의 yarn@4.12.0 을 사용
yarn install
yarn dev                 # http://localhost:5176
yarn build               # tsc -b && vite build → dist/ (sw.js, manifest 포함)
yarn preview             # http://localhost:4176 — 서비스워커/설치 테스트는 여기서
```

> **한글 경로 주의** — 한국어 Windows 기본 콘솔(코드페이지 949)에서 Yarn 이 `node_modules/.bin` 절대 경로를
> 넘기면 `R&D센터` 가 깨져 `Cannot find module ...R&D?쇳꽣...` 오류가 납니다. 그래서 `package.json` scripts 는
> `node ./node_modules/vite/bin/vite.js` 처럼 **상대 경로로 직접 호출**합니다. 빌드는 Vite 설정을 `--configLoader runner`로 읽습니다.
> 스크립트를 추가할 때도 같은 방식을 쓰세요.

### 첫 실행

처음 열면 관리자 팀 이름과 비밀번호를 직접 설정합니다. 예시 팀·프로젝트·집행 데이터는 포함하지 않습니다.
현재 프론트엔드 데이터와 비밀번호는 브라우저 `localStorage`에 저장되므로, 서버 기반 인증이나 여러 사용자 간 데이터 공유 용도로 사용하지 마세요.

## 구조

```
src/
├─ main.tsx               엔트리 (StoreProvider + 전역 CSS)
├─ App.tsx                로그인 게이트 · 레이아웃 · 해시 라우팅(#/view)
├─ types.ts               도메인 타입
├─ data/seed.ts           빈 초기 데이터와 기본 설정
├─ lib/                   format(금액) · date(기준일/분기 계산)
├─ store/                 Context + useReducer, localStorage 영속화, selectors
├─ hooks/                 useHashView(뒤로가기 지원) · useToast
├─ components/
│  ├─ ui/                 Card/Badge/Btn/Input/AmountInput/MonthField… + ui.css
│  ├─ layout/             Header · Sidebar(데스크탑) · BottomNav(≤1024px) · nav 설정
│  ├─ icons.tsx           SVG 아이콘
│  └─ PwaPrompt.tsx       SW 등록 · 새 버전 · 오프라인 준비 · 홈 화면 설치 안내
├─ styles/                tokens.css(색/폰트/간격) · base.css · layout.css
└─ views/                 화면별 TSX + CSS
   Login · Home · Meeting · Project · ExecList · ExecRegister · Report · MyPage · Notification · Admin
```

### 반응형 기준

| 폭 | 레이아웃 |
| --- | --- |
| > 1024px | 좌측 GNB + 상단 헤더 |
| ≤ 1024px | GNB 숨김 → 하단 탭바, 3열 카드 → 2열 |
| ≤ 768px | 2열 그리드 → 1열 |
| ≤ 640px | 헤더 팀명 숨김, 표 일부 열 숨김, 입력 행 줄바꿈 |
| ≤ 480px | 모바일 세부 조정 |

## 데이터 흐름 (백엔드 없음)

모든 데이터는 `store/reducer.ts` 에서 관리하고 `localStorage['cowork-coin-v5']` 에 저장합니다.

- **집행 등록/수정/삭제** → 분기 회의비 사용액 · 프로젝트 사용액 · 월별 집계가 함께 증감하고 알림 생성.
  프로젝트 잔액이 15% 미만이 되면 예산 경고 알림.
- **분기 인원 저장** → 예산 = 인원 합 × 단가. 관리자가 단가를 바꾸면 이번 분기부터 재산정.
- **팀 비활성화** → 로그인 팀 목록에서 제외. 비밀번호 변경/초기화는 실제 로그인에 반영.
- 기준일은 `lib/date.ts` 의 `TODAY`(2026-09-24)로 고정되어 있습니다. 실서비스 전환 시 `new Date()` 로 교체.
- 초기 데이터/스키마를 바꾸면 `StoreContext.tsx` 의 `STORAGE_KEY` 버전을 올리세요.

## 브랜드 에셋 (로고 · 앱 아이콘 · OG 이미지)

원본은 `brand/` 에 있습니다 — `cowork-coin_logo.png`(투명 배경), `cowork-coin_icon.png`, `cowork-coin_og.webp`.
원본을 교체한 뒤 아래 명령으로 배포용 파일을 다시 만듭니다 (sharp 사용).

```bash
yarn brand
```

| 생성 파일 | 용도 |
| --- | --- |
| `public/icons/icon-192·512.png`, `icon-maskable-512.png` | PWA manifest 아이콘 (maskable 은 안전영역 78%) |
| `public/icons/apple-touch-icon.png`, `favicon-64.png` | iOS 홈 화면 · 파비콘 |
| `src/assets/kowok-logo.webp` | 헤더 로고 (투명 여백 trim, 높이 120px) |
| `src/assets/kowok-icon.png` | 로그인 · 설치 안내 아이콘 |
| `public/og-image.jpg` | OG/트위터 카드 이미지 1200×630 |
| `src/assets/kowok-kya.webp` | GNB 하단 '캬아!' 캐릭터 장식 (원본 `cowork-coin_kya.webp`) |

### 로딩 애니메이션 (Lottie)

첫 실행(탭 세션당 1회) 스플래시 — `src/assets/lottie/kowok-loading.json` (500×500 · 30fps · 약 92KB).
`brand/cowork-coin_kya.webp` 를 투명 영역 기준으로 몸통·'캬아!'·효과선·반짝이로 나눠 넣고, 움직임은 키프레임으로 작성합니다.

```bash
yarn lottie
```

| 구간 | 프레임 | 동작 |
| --- | --- | --- |
| intro | 0–96 | 1 동장 → 2 신나게 점프! → 3 최고!(웃는 얼굴·반짝이) → 4 캬아 효과! |
| idle | 96–156 | 5 반복 대기 (루프 가능) |

재생: `src/components/Splash.tsx` (lottie-web light). 주소에 `?splash` 를 붙이면 언제든 다시 재생되고, 화면을 누르면 건너뜁니다. 움직임 줄이기 설정 사용자에게는 나오지 않습니다.

### OG 태그

`index.html` 에 Open Graph · Twitter 카드 메타가 있습니다. 카카오톡·슬랙·페이스북 크롤러는 **절대 URL** 만 인식하므로
배포 전 `.env.example` 을 `.env.production` 으로 복사해 `VITE_SITE_URL=https://실제도메인` 을 지정하세요.
빌드 시 `__SITE_URL__` 이 치환됩니다. 공유 캐시가 남아 있으면 카카오 [공유 디버거](https://developers.kakao.com/tool/debugger/sharing)에서 초기화하세요.

## GNB 접기/펼치기

데스크탑(> 1024px) 좌측 GNB 상단의 패널 아이콘으로 220px ↔ 68px(아이콘 레일)을 전환합니다.
접힌 상태에서는 메뉴 이름이 툴팁으로 표시되며, 상태는 브라우저에 저장됩니다(`cowork-coin-gnb-collapsed`).
