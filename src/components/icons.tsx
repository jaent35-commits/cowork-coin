import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}><path className="icon-fill" d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-9" /></Svg>
);
export const IconMeeting = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M2.5 20c.8-3.8 3.2-5.5 6.5-5.5s5.7 1.7 6.5 5.5" />
    <path d="M16 4.5c1.5.5 2.5 1.8 2.5 3.5s-1 3-2.5 3.5M20 20c-.5-2.5-1.8-4-3.5-5" />
  </Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}><path className="icon-fill" d="M3 7a1 1 0 0 1 1-1h4l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></Svg>
);
/** 집행 현황 — 지그재그 하단의 영수증 */
export const IconReceipt = (p: P) => (
  <Svg {...p}>
    <path className="icon-fill" d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21V3Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
/** 코웍 체크리스트 — 체크 표시가 있는 클립보드 */
export const IconChecklist = (p: P) => (
  <Svg {...p}>
    <path className="icon-fill" d="M6 4h2.5a3.5 3.5 0 0 0 7 0H18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M9 3h6v2.5H9zM8.5 13l2.5 2.5 4.5-5" />
  </Svg>
);
export const IconReport = (p: P) => (
  <Svg {...p}>
    <path className="icon-fill" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
    <path d="M14 2v6h6M8 17v-2M12 17v-4M16 17v-6" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}><path className="icon-fill" d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></Svg>
);
export const IconBell = (p: P) => (
  <Svg strokeWidth={1.8} {...p}><path d="M18 8a6 6 0 1 0-12 0c0 5.4-2 7-2 7h16s-2-1.6-2-7Z" /><path d="M10 20a2 2 0 0 0 4 0" /></Svg>
);
export const IconUser = (p: P) => (
  <Svg strokeWidth={1.8} {...p}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.9-4.2 3.8-6.5 7.5-6.5s6.6 2.3 7.5 6.5" /></Svg>
);
export const IconLogout = (p: P) => (
  <Svg strokeWidth={1.8} {...p}><path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9" /></Svg>
);
export const IconSearch = (p: P) => (
  <Svg strokeWidth={2} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
);
export const IconPlus = (p: P) => (
  <Svg strokeWidth={2.2} {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconBack = (p: P) => (
  <Svg strokeWidth={2} {...p}><path d="M15 18l-6-6 6-6" /></Svg>
);
export const IconForward = (p: P) => (
  <Svg strokeWidth={2} {...p}><path d="M9 18l6-6-6-6" /></Svg>
);
/* 안내 상자(Alert) 아이콘 — 원 안에 i / ! / 금지 / 체크 */
export const IconInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" /></Svg>
);
export const IconWarn = (p: P) => (
  <Svg {...p}><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4.5M12 17.2h.01" /></Svg>
);
export const IconBan = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></Svg>
);
export const IconCheckCircle = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.7 2.7L16 9.6" /></Svg>
);
export const IconChevron = (p: P) => (
  <Svg strokeWidth={2} {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const IconCalendar = (p: P) => (
  <Svg strokeWidth={1.8} {...p}><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M8 2v4M16 2v4M3 10h18" /></Svg>
);
export const IconEdit = (p: P) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg strokeWidth={2} {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
);
export const IconEye = (p: P) => (
  <Svg strokeWidth={1.8} {...p}><path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12Z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
  </Svg>
);
/** GNB 접기(왼쪽 패널 + ‹) — rotate(180deg) 로 펼치기 표시 */
export const IconPanelToggle = (p: P) => (
  <Svg strokeWidth={1.8} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15.5 10 13.5 12l2 2" />
  </Svg>
);
export const IconDownload =(p: P) => (
  <Svg strokeWidth={2} {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></Svg>
);
export const IconCheck = (p: P) => (
  <Svg strokeWidth={2.4} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);
