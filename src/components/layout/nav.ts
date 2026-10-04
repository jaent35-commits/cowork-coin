import type { ComponentType, SVGProps } from 'react';
import type { View } from '@/types';
import { IconChecklist, IconFolder, IconHome, IconMeeting, IconReceipt, IconReport, IconShield } from '../icons';

export interface NavItem {
  view: View;
  label: string;
  short: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** 이 메뉴가 활성으로 보일 하위 화면 */
  match?: View[];
}

export const GNB: NavItem[] = [
  { view: 'home', label: '홈', short: '홈', icon: IconHome },
  { view: 'meeting', label: '팀 운영', short: '팀 운영', icon: IconMeeting },
  { view: 'project', label: '프로젝트 운영', short: 'pjt 운영', icon: IconFolder, match: ['project-new', 'project-detail'] },
  { view: 'exec', label: '집행 현황', short: '집행현황', icon: IconReceipt, match: ['exec-new'] },
  { view: 'cowork', label: '코웍 체크리스트', short: '코웍체크', icon: IconChecklist },
  { view: 'report', label: '코웍-코인 리포트', short: '리포트', icon: IconReport },
];

/** PC GNB 그룹 — 제목이 없는 그룹은 맨 위(홈) */
export const GNB_GROUPS: { title?: string; views: View[] }[] = [
  { views: ['home'] },
  { title: '코웍설정', views: ['meeting', 'project'] },
  { title: '코웍코인', views: ['exec', 'cowork', 'report'] },
];

/** 모바일 하단 탭 순서 — 코웍 체크리스트는 하단 탭 없이 집행 현황 화면의 버튼으로 진입 (집행현황 탭이 활성) */
const BOTTOM_ORDER: View[] = ['meeting', 'project', 'home', 'exec', 'report'];
export const BOTTOM_NAV: NavItem[] = BOTTOM_ORDER.map(v => {
  const item = GNB.find(i => i.view === v)!;
  return v === 'exec' ? { ...item, match: [...(item.match ?? []), 'cowork'] } : item;
});

export const ADMIN_NAV: NavItem = { view: 'admin', label: '관리자 메뉴', short: '관리자', icon: IconShield };

/** 모바일(≤1024) 상단 헤더에 표시할 화면 제목 — 코웍 체크리스트는 모바일에서 집행 현황 안의 화면이므로 '집행 현황' */
const MOBILE_TITLE: Record<View, string> = {
  home: '홈', meeting: '팀 운영', project: '프로젝트 운영', exec: '집행 현황', 'exec-new': '집행 등록', 'project-new': '프로젝트 등록', 'project-detail': '프로젝트 상세',
  cowork: '집행 현황', report: '리포트', mypage: '비밀번호 변경', settings: '화면 설정', notification: '알림', admin: '관리자', search: '검색 결과',
};
export const mobileTitle = (view: View) => MOBILE_TITLE[view];

export const isActive = (item: NavItem, view: View) => item.view === view || !!item.match?.includes(view);
