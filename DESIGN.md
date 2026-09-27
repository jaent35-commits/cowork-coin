# 코웍-코인 디자인 가이드 & 표준

모든 값은 [`src/styles/tokens.css`](src/styles/tokens.css) 한 곳에서 정의합니다.
컴포넌트/뷰 CSS·TSX 에는 원시 값(`#hex`, `rgba()`, px 반경, 그림자, z-index)을 직접 쓰지 않고 토큰을 사용합니다.

> 예외: 로그인 화면(`Login.css`)은 Figma 원본 치수·전용 팔레트(`--lg-*`)를 유지합니다. 전역 팔레트와 같은 색만 토큰에 연결되어 있습니다.

## 1. 색상

| 역할 | 토큰 | 값 | 용도 |
|---|---|---|---|
| 잉크 | `--ink` / `--ink-hover` | #3b241a / #4e3226 | 주 버튼 글자, 다크 버튼 |
| 앰버 | `--primary` | #e8a23a | 막대·아이콘·포커스 |
| 앰버 텍스트 | `--primary-600` / `-700` | #b06d0e / #7a4c10 | 링크·강조 수치 / 연한 앰버 배경 위 글자 |
| 앰버 배경 | `--primary-25` · `-50` · `-200` · `-300` | | 선택·활성 GNB·테두리 |
| 코랄 | `--coral` / `-50` | #e5896f | 팀 회의비 |
| 세이지 | `--sage` / `-50` | #7fa99a | 프로젝트 경비 |
| 라벤더 | `--violet` / `-50` / `-700` | #a58fcb | 보조 강조 |
| 샌드·클레이 | `--sand` / `--clay` | #c9a77a / #d98c6a | 추가 집행 구간 / 숙박비 분류 |
| 예산 | `--budget` 계열 | #f5c53a | 차트 예산(노랑) |
| 운영일지 | `--log-plus` / `--log-minus` | #e5484d / #3b6fe0 | 회의비(+) 붉은색 / 프로젝트(−) 파란색 |
| 상태 | `--success` · `--warning` · `--danger` (+ 50·100·200·600·700·800) | | 배지·알림·진행 바 |
| 바탕 | `--bg` | #faf7f2 | 앱 배경 |
| 표면 | `--surface` · `--surface-alt` · `--surface-muted` | #fff · #fdfaf6 · #faf6f0 | 카드·입력·표 / 카드 안 블록 |
| 선 | `--line` · `--line-soft` · `--line-input` | | 카드 테두리 · 구분선 · 입력 테두리 |
| 글자 | `--text` · `--text-2` · `--text-3` · `--muted` · `--faint` · `--faint-2` · `--faint-3` | | 진한 순 (아래 가독성 기준) |
| 흰색 | `--white` | #fff | 색 배경 위 글자·스위치 노브 (표면은 `--surface`) |

**그라데이션**: `--grad-primary`(주 버튼, 브라운 글자) · `--grad-hero`(홈 히어로) · `--grad-bar`(기본 진행 바) · `--grad-success/-warning/-danger`(상태 진행 바).

## 1-1. 가독성 기준

| 토큰 | 흰 배경 대비 | 쓰임 |
|---|---|---|
| `--muted` #7a6b60 | 5.1 : 1 | 보조 텍스트 |
| `--faint` #857669 | 4.4 : 1 | 설명·라벨·표 머리 |
| `--faint-2` #948679 | 3.5 : 1 | 힌트·시간·날짜 (짧은 보조 정보만) |
| `--faint-3` #cdc2b8 | 1.8 : 1 | **텍스트 금지** — 구분점·장식·비활성 아이콘 |
| `--primary-600` #b06d0e | 4.2 : 1 | 앰버 강조 텍스트 |

- 최소 글자 크기 11px (하단 GNB 라벨만 ≤360px 에서 10px).
- 한글은 단어 단위 줄바꿈(`word-break: keep-all`, 전역).
- 카드 안쪽 여백: PC 22/24px → ≤640px 18px → ≤360px 16px.

## 1-2. 다크 모드

- 설정: 마이페이지 › 화면 설정 › 화면 모드 — **라이트 / 다크 / 시스템 설정**(기본). [`lib/theme.ts`](src/lib/theme.ts) 가 `<html data-theme>` 를 바꾸고, 값은 `tokens.css` 의 `:root[data-theme="dark"]` 에만 있습니다. 첫 페인트는 `index.html` 인라인 스크립트가 같은 규칙으로 먼저 적용합니다.
- 시스템 설정이 다크라서 다크로 보이면 접속당 한 번 안내 토스트(`ThemeNotice`). 사용자가 직접 고른 경우에는 안내하지 않습니다.
- 뒤집히는 토큰: 연한 배경(`*-25/50/100/200`) → 어둡게, 텍스트용(`*-600/700/800` · `--text*` · `--muted` · `--faint*`) → 밝게, 바탕·면·선, 그림자(`--shadow-*` 는 진한 브라운), 오버레이(`--dim` · `--glass*` · `--deco-*`), `--grad-hero`.
- 그대로인 토큰: 채움 색(`--primary` · `--coral` · `--sage` · 상태 기본색 …), `--ink`(앰버 위 글자), `--white`(색 배경 위 글자), `--danger-solid`(흰 글자를 얹는 빨간 배지), `--grad-primary` 등 색 그라데이션.
- 규칙: 색 배경 위 글자는 `--white` 또는 `--ink` 를 쓰고 `--surface`·`--text` 를 글자/배경으로 바꿔 쓰지 않습니다(다크에서 둘 다 뒤집혀 대비가 사라짐). 새 반투명 값은 토큰으로 추가합니다.
- 다크 팔레트(v1.2, 2026-09-27 노란 빛 정리): 바탕·면·선은 채도 낮은 웜 차콜(bg #131110 · surface #1b1816 · line #2f2926), 앰버는 버튼 채움·강조 글자에만. 선택 배경(`--primary-50`)·테두리(`--primary-200`)와 상태 연한 배경은 웜 그레이 톤.
- 다크 그림자: 앰버 그림자(`--shadow-btn` · `--shadow-brand` · `--shadow-hero`)와 `--shadow-card` 는 `none`(카드는 1px 선으로 구분), 떠 있는 요소만 무채색 검정, 고정 바는 1px 선, `--ring` 은 번지지 않는 2px. **그림자 토큰은 다크에서 `none` 일 수 있으므로 쉼표로 다른 그림자와 묶어 쓰지 않습니다.**
- 다크 대비(면 #1b1816 기준): `--text` 14.9 · `--muted` 7.1 · `--faint` 5.8 · `--faint-2` 5.2 · `--primary-600` 9.5.
- 다크에서 뒤집히는 상태 토큰(2026-09-27 점검): `--surface-raised`(팝오버·토스트·확인 레이어·시트는 카드보다 한 단계 밝게), `--btn-danger-bg/-text/-line`(위험 버튼: 라이트 연한 빨강 → 다크 진한 빨강 + 흰 글자 — 연한 빨강은 다크에서 비활성처럼 보임), `--bar-bg` · `--bar-line`(선택 모드 바), `--inverse-bg`(바 위 밝은 버튼), `--hover-dim`(마우스 오버: 라이트 어둡게 / 다크 밝게). 새 떠 있는 요소는 `--surface-raised` 를 씁니다.
- 모바일(≤1024) 홈 히어로(잔여 금액): `--hero-m-bg` · `--hero-m-line` · `--hero-m-amount` — 다크에서만 웜 틴트 면(#221c16) + `--primary-300` 선 + `--primary-700` 금액으로 강조(그림자 없음). 라이트는 기본 히어로와 같습니다.
- 예외: 로그인 화면은 라이트 전용(Figma 고정 색 일러스트) — `holdLightTheme()` 로 떠 있는 동안 라이트. 헤더 로고는 다크용 `kowok-logo-dark.webp`(글자만 밝게).
- Figma: [코웍-코인 Design System](https://www.figma.com/design/d5D502xKkImyVvMWLH5vh2) Color 컬렉션 Light / Dark 모드, 그림자 색 변수(`shadow/*`)로 이펙트 스타일도 모드 전환.

## 2. 타이포

- 본문 `--font-body`(Inter/Pretendard), 제목·수치 `--font-display`(Nunito).
- 글씨 크기는 **항상** `calc(Npx * var(--fs))` — 큰 글씨 모드(`data-font="lg"`)에서 1.4배.
  예외: 모바일 헤더(`min(var(--fs), 1.15)`), 글씨 크기 토글 글리프(고정).
- 굵기: 500 보조 · 600 본문 강조 · 700 라벨/버튼 · 800 제목 · 900 로고/수치.

## 3. 모서리 (Radius)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--r-xs` | 6 | 태그·칩·포커스 아웃라인 |
| `--r-sm` | 8 | 작은 아이콘 버튼·메뉴 항목·작은 아바타 |
| `--r-md` | 10 | 버튼·입력·세그먼트·로고 |
| `--r-lg` | 12 | 카드 안 블록·팝오버·알림·토스트 |
| `--r-xl` | 16 | 카드 |
| `--r-2xl` | 20 | 히어로·큰 아바타 |
| `--r-3xl` | 24 | 시트 |
| `--r-pill` | 999 | 배지·진행 바·필터 칩 |

원형 요소는 `50%`, 2–3px 미세 요소(범례·하이라이트)는 그대로 둡니다.

## 4. 그림자 · 포커스

그림자 색은 브라운(59,36,26) 또는 앰버 계열만 사용합니다(검정 금지).

| 토큰 | 용도 |
|---|---|
| `--shadow-xs` | 보조 버튼·세그먼트 활성·스위치 노브 |
| `--shadow-card` / `--shadow-card-hover` | 카드 / 카드 호버 |
| `--shadow-drop` | 헤더 아래로 펼쳐지는 영역(모바일 검색·이스터에그) |
| `--shadow-pop` | 팝오버·토스트 |
| `--shadow-header` · `--shadow-sidebar` · `--shadow-bottom-nav` | 고정 바 |
| `--shadow-btn` · `--shadow-fab` | 주 버튼 · 플로팅 버튼 |
| `--shadow-hero` · `--shadow-brand(-sm)` | 히어로 · 로고 타일 |
| `--ring` | 입력 포커스 (box-shadow) |
| `--focus` | 키보드 포커스 아웃라인 (`outline: 2px solid var(--focus)`) |

## 5. 레이어 (z-index)

`--z-egg 49` < `--z-header 50` < `--z-sidebar 55` < `--z-fab 58` < `--z-bottom-nav 60` < `--z-drop 65` < `--z-pop 70` < `--z-picker 200` < `--z-prompt 250` < `--z-toast 300` < `--z-splash 500`.
컴포넌트 내부 겹침(`z-index: 1`)만 직접 씁니다.

## 6. 컴포넌트 규칙 (`components/ui`)

- **버튼** `Btn`: `primary`(앰버 그라데이션+브라운 글자) · `secondary`(흰 바탕+입력선) · `ghost` · `danger`, 크기 기본/`sm`.
- **아이콘 버튼** `.icon-btn`: 기본 / `--sm`(32px) / `--primary` · `--red` · `--remove`.
- **배지** `.badge--green/amber/red/purple/gray` (`--blue`는 앰버 텍스트 — 이름만 레거시).
- **알림** `.alert--info/warn/danger/success` — 50 배경 + 200 테두리 + 진한 글자.
- **카드** `Card`: `--r-xl`, `--line` 테두리, `pad`(22) / `pad="lg"`(24).
- **페이지 헤드** `PageHead`: 제목 + `extra`(제목 오른쪽, 예: 조회 연도) + `actions`. 설명 문구는 쓰지 않습니다.

## 7. 반응형

| 구간 | 의미 |
|---|---|
| ≤1024 | 모바일 모드 — 하단 GNB·FAB·헤더 페이지명·상단 연도 바, `.hide-mobile` |
| ≤768 · ≤640 · ≤480 · ≤360 | 단계별 여백·글자 축소 |
| 최소 너비 | 340px |

보조 구간(1280·1200·1180·900)은 특정 그리드 열 수 조정용입니다.

## 8. 모션

- 기본 전환 0.15s, 카드 호버 0.18s, 진행 바 0.7s `cubic-bezier(0.4,0,0.2,1)`.
- `prefers-reduced-motion` 사용자는 스플래시·애니메이션을 생략합니다.
