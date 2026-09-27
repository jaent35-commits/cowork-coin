import { useSyncExternalStore } from 'react';
import type { AppState } from '@/store/reducer';
import type { View } from '@/types';
import { checkDateOf, visibleChecklist } from '@/store/selectors';
import { fmt } from './format';
import { CUR_YEAR, spentDateOf, ym } from './date';
import { workBudgetOf, workUsedOf } from './budget';

/**
 * 전체 메뉴 검색
 * - menu    메뉴 바로가기 (화면·기능 이름)
 * - project 우리 팀 주관 프로젝트 · joined 다른 팀 주관 참여 프로젝트
 * - check   진행 중 프로젝트의 체크리스트 항목 (My · 코웍)
 * - quarter 팀 회의비 분기 · work 팀 업무비 월 (올해)
 * - exec    집행 내역
 */
export type HitKind = 'menu' | 'project' | 'joined' | 'check' | 'quarter' | 'work' | 'exec';
/** 결과 묶음 (헤더 목록·검색 결과 페이지 카드) */
export type HitGroup = 'menu' | 'project' | 'check' | 'team' | 'exec';

export const GROUPS: { key: HitGroup; title: string; empty: string }[] = [
  { key: 'menu', title: '메뉴 바로가기', empty: '일치하는 메뉴가 없습니다' },
  { key: 'project', title: '프로젝트 운영', empty: '일치하는 프로젝트가 없습니다' },
  { key: 'check', title: '체크리스트', empty: '일치하는 체크리스트 항목이 없습니다' },
  { key: 'team', title: '팀 운영', empty: '일치하는 팀 운영 항목이 없습니다' },
  { key: 'exec', title: '집행 내역', empty: '일치하는 집행 내역이 없습니다' },
];

export interface SearchHit {
  key: string;
  kind: HitKind;
  group: HitGroup;
  /** 이동할 화면 */
  view: View;
  /** 이동 후 포커스할 대상 — 프로젝트·체크리스트·집행 기록 id, 분기 번호(0~3), 업무비 월(YYYY-MM) */
  id: string;
  title: string;
  sub: string;
  meta?: string;
  /** 이동하면서 열 탭 (팀 회의비 / My 체크리스트 / 알림 설정 …) */
  tab?: string;
  /** 이동 후 스크롤할 영역 (data-search-anchor) */
  anchor?: string;
}

export type SearchResult = Record<HitGroup, SearchHit[]> & { count: Record<HitGroup, number> };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 메뉴 바로가기 — kw: 메뉴 이름 외에 이 이름으로도 찾힘 */
const MENUS: { title: string; view: View; sub: string; kw: string; tab?: string; anchor?: string; admin?: boolean }[] = [
  { title: '홈', view: 'home', sub: '예산 현황 · 내 체크리스트', kw: '대시보드 메인 잔여 금액' },
  { title: '팀 회의비', view: 'meeting', tab: '팀 회의비', sub: '팀 운영 · 분기별 인원·예산', kw: '팀운영 회의비 분기 인원 기준 수량' },
  { title: '팀 업무비', view: 'meeting', tab: '팀 업무비', sub: '팀 운영 · 월별 예산', kw: '팀운영 업무비 월 예산 변경' },
  { title: 'My 프로젝트', view: 'project', tab: 'My 프로젝트', sub: '프로젝트 운영 · 주관 프로젝트 목록·팀 배분', kw: '프로젝트운영 사업 배분 지분' },
  { title: 'My 체크리스트', view: 'project', tab: 'My 체크리스트', sub: '프로젝트 운영 · 경비 집행 체크리스트', kw: '프로젝트운영 체크리스트 예정' },
  { title: '프로젝트 등록', view: 'project-new', sub: '프로젝트 운영 · 새 사업 등록', kw: '신규 사업 추가 생성 만들기' },
  { title: '집행 현황', view: 'exec', sub: '집행 이력 조회·수정·삭제', kw: '집행 이력 내역 조회 기간' },
  { title: '집행 등록', view: 'exec-new', sub: '경비 사용 입력 · 영수증 촬영', kw: '영수증 사용 경비 입력 등록 OCR 촬영' },
  { title: '코웍 체크리스트', view: 'cowork', sub: '참여 프로젝트의 공개 체크리스트', kw: '코웍 참여 공개 체크리스트' },
  { title: '코웍-코인 리포트', view: 'report', sub: '보유 코웍-코인 · 운영일지 · 차트', kw: '리포트 보유 코인 운영일지 차트 통계 달력' },
  { title: '알림', view: 'notification', sub: '받은 알림 목록', kw: '알림 소식' },
  { title: '알림 설정', view: 'notification', tab: '알림 설정', sub: '알림 · 푸시 알림 켜기/끄기', kw: '푸시 알림 설정 끄기 켜기' },
  { title: '비밀번호 변경', view: 'mypage', anchor: 'password', sub: '마이페이지', kw: '마이페이지 비밀번호 암호 계정' },
  { title: '화면 설정 (글씨 크기 · 화면 모드)', view: 'mypage', anchor: 'display', sub: '마이페이지', kw: '마이페이지 글씨 크기 큰글씨 폰트 화면 다크 모드 라이트 테마 어둡게 밝게 야간' },
  { title: '관리자 메뉴', view: 'admin', sub: '팀(사용자) 추가·수정·비밀번호 초기화', kw: '관리자 팀 사용자 추가 휴면 권한 초기화', admin: true },
];

/** 검색 — limit: 묶음별 최대 건수 (count 는 자르기 전 전체 건수) */
export function searchAll(q: string, state: AppState, limit = 8): SearchResult {
  const out: Record<HitGroup, SearchHit[]> = { menu: [], project: [], check: [], team: [], exec: [] };
  const nq = norm(q);
  const count = (): Record<HitGroup, number> => ({ menu: out.menu.length, project: out.project.length, check: out.check.length, team: out.team.length, exec: out.exec.length });
  if (!nq) return { ...out, count: count() };
  const has = (s?: string) => !!s && norm(s).includes(nq);
  const projById = new Map(state.projects.map(p => [p.id, p]));
  const projName = (id?: string) => projById.get(id ?? '')?.name ?? '삭제된 프로젝트';

  // 메뉴 바로가기
  for (const m of MENUS) {
    if (m.admin && !state.session?.isAdmin) continue;
    if (!has(m.title) && !has(m.kw) && !has(m.sub)) continue;
    out.menu.push({ key: `m-${m.title}`, kind: 'menu', group: 'menu', view: m.view, id: m.title, title: m.title, sub: m.sub, tab: m.tab, anchor: m.anchor });
  }

  // 프로젝트 — 주관(My) + 참여(배분받은 다른 팀 주관)
  // 진행 중 프로젝트의 체크리스트 항목은 '체크리스트' 묶음에서 따로 찾으므로, 체크리스트 이름 일치는 종료된 프로젝트만
  for (const p of state.projects.filter(p => p.isMine || p.joined)) {
    const teams = (state.allocs[p.id] ?? []).filter(a => has(a.teamName)).map(a => a.teamName);
    const checks = p.active ? [] : state.checklist.filter(c => c.projectId === p.id && has(c.title)).map(c => c.title);
    const hitBase = has(p.name) || has(p.client) || has(p.ownerTeam);
    if (!hitBase && !teams.length && !checks.length) continue;
    const why = checks.length ? `체크리스트 · ${checks.join(', ')}`
      : teams.length && !hitBase ? `팀 배분 · ${teams.join(', ')}`
      : `${p.client} · ${p.startDate} – ${p.endDate}`;
    if (p.isMine) out.project.push({ key: `p-${p.id}`, kind: 'project', group: 'project', view: 'project', id: p.id, title: p.name, sub: why, meta: 'My' });
    // 참여 프로젝트는 상세를 열 수 없음 → 진행 중이면 코웍 체크리스트(해당 프로젝트로 조회), 종료면 리포트
    else out.project.push({ key: `j-${p.id}`, kind: 'joined', group: 'project', view: p.active ? 'cowork' : 'report', id: p.id, title: p.name, sub: `주관 ${p.ownerTeam ?? '타팀'} · ${why}`, meta: '참여' });
  }

  // 체크리스트 항목 — 진행 중 프로젝트 (My: 주관 / 코웍: 참여 프로젝트의 공개 항목)
  for (const c of visibleChecklist(state)) {
    const p = projById.get(c.projectId);
    if (!p?.active) continue;
    if (!has(c.title) && !has(c.category) && !has(checkDateOf(c))) continue;
    const mine = p.isMine;
    out.check.push({
      key: `c-${c.id}`, kind: 'check', group: 'check', view: mine ? 'project' : 'cowork', id: c.id, tab: mine ? 'My 체크리스트' : undefined,
      title: c.title, sub: [mine ? 'My 체크리스트' : '코웍 체크리스트', p.name, c.category, c.checked ? `집행 ${checkDateOf(c)}` : c.date ?? '예정일 없음'].filter(Boolean).join(' · '),
      meta: c.checked ? `완료 · 집행 ${fmt(c.spent ?? c.amount)}` : fmt(c.amount),
    });
  }

  // 팀 운영 — 팀 회의비 분기 · 팀 업무비 월 (올해)
  state.quarters.forEach((qd, i) => {
    const title = `${qd.label} 팀 회의비`;
    if (!has(title) && !qd.months.some(has) && !has('팀운영')) return;
    const hc = qd.headcounts.some(h => h > 0) ? `인원 ${qd.headcounts.join('·')}명` : '인원 미입력';
    out.team.push({
      key: `q-${i}`, kind: 'quarter', group: 'team', view: 'meeting', id: String(i), tab: '팀 회의비',
      title, sub: `${CUR_YEAR}년 ${qd.months.join('·')} · ${hc} · 예산 ${fmt(qd.budget)}`, meta: `잔액 ${fmt(qd.budget - qd.used)}`,
    });
  });
  for (let m = 0; m < 12; m++) {
    const key = ym(CUR_YEAR, m);
    const title = `${m + 1}월 팀 업무비`;
    if (!has(title) && !has('팀운영')) continue;
    const budget = workBudgetOf(state, key).amount, used = workUsedOf(state, key);
    out.team.push({
      key: `w-${key}`, kind: 'work', group: 'team', view: 'meeting', id: key, tab: '팀 업무비',
      title, sub: `${CUR_YEAR}년 ${m + 1}월 · 예산 ${fmt(budget)} · 집행 ${fmt(used)}`, meta: `잔액 ${fmt(budget - used)}`,
    });
  }

  // 집행 내역 (최근 등록 순)
  for (const r of [...state.records].sort((a, b) => b.date.localeCompare(a.date))) {
    const label = r.type === 'meeting' ? '팀 회의비' : r.type === 'work' ? '팀 업무비' : projName(r.projectId);
    const items = r.items.filter(i => has(i.name)).map(i => i.name);
    if (!items.length && !has(label) && !has(r.month) && !has(r.team)) continue;
    out.exec.push({
      key: `e-${r.id}`, kind: 'exec', group: 'exec', view: 'exec', id: r.id,
      title: `${spentDateOf(r)} · ${label}`,
      sub: (items.length ? items : r.items.map(i => i.name)).join(', '),
      meta: fmt(r.total),
    });
  }

  const total = count();
  for (const g of Object.keys(out) as HitGroup[]) out[g] = out[g].slice(0, limit);
  return { ...out, count: total };
}

/* ── 검색 결과 페이지의 검색어 (새로고침해도 유지 — sessionStorage) ── */
const Q_KEY = 'cowork-coin-search-q';
let query = (() => { try { return sessionStorage.getItem(Q_KEY) ?? ''; } catch { return ''; } })();
const qSubs = new Set<() => void>();

export function setSearchQuery(q: string) {
  query = q.trim();
  try { sessionStorage.setItem(Q_KEY, query); } catch { /* noop */ }
  qSubs.forEach(f => f());
}

export function useSearchQuery(): string {
  return useSyncExternalStore(f => { qSubs.add(f); return () => { qSubs.delete(f); }; }, () => query);
}

/* ── 검색 결과로 이동할 때 대상 화면에 포커스 전달 ──
 * 종류별로 따로 보관 → '탭 전환(tab) + 항목 강조(check 등)' 를 한 번에 요청할 수 있음
 * - 화면이 새로 열리면 takeFocus 로 가져감, 이미 열린 화면은 onFocusRequest 로 받음
 */
export type FocusKind = 'project' | 'joined' | 'check' | 'quarter' | 'work' | 'exec' | 'tab';
const FOCUS_EVENT = 'cowork-coin-focus';
const pending = new Map<FocusKind, string>();

export function requestFocus(kind: FocusKind, id: string) {
  pending.set(kind, id);
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { kind, id } }));
}

/** 화면이 새로 마운트될 때 대기 중인 포커스를 가져간다 — accept 가 false 면 남겨 둠 (다른 화면 몫) */
export function takeFocus(kind: FocusKind, accept?: (id: string) => boolean): string | null {
  const id = pending.get(kind);
  if (id == null || (accept && !accept(id))) return null;
  pending.delete(kind);
  return id;
}

/** 이미 열린 화면에서 받기 — cb 가 false 를 돌려주면 처리하지 않은 것으로 보고 남겨 둠 */
export function onFocusRequest(kind: FocusKind, cb: (id: string) => boolean | void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<{ kind: FocusKind; id: string }>).detail;
    if (d.kind === kind && pending.get(kind) === d.id && cb(d.id) !== false) pending.delete(kind);
  };
  window.addEventListener(FOCUS_EVENT, h);
  return () => window.removeEventListener(FOCUS_EVENT, h);
}

/** 이동 후 영역으로 스크롤 (data-search-anchor) — 화면이 그려진 뒤 */
export function scrollToAnchor(anchor: string) {
  let n = 0;
  const tick = () => {
    const el = document.querySelector(`[data-search-anchor="${anchor}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('is-flash'); window.setTimeout(() => el.classList.remove('is-flash'), 1800); }
    else if (n++ < 20) window.setTimeout(tick, 50);
  };
  window.setTimeout(tick, 50);
}
