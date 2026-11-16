import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { Team, UnitLevel } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import {
  AuthApiError, createMember, deleteMember, importMembers, listMembers, listTeams, manageableTeamIds, removeTeam,
  resetMemberPassword, saveTeam, updateMember, type ImportResult, type ImportRow, type MemberAdminRow,
} from '@/lib/authApi';
import { readMemberSheet } from '@/lib/memberSheet';
import { useToast } from '@/hooks/useToast';
import { Alert, Avatar, Badge, Btn, Card, Checkbox, ConfirmLayer, EmptyState, Field, FilterChip, Input, PageHead, Segmented, Switch, TableWrap, Toast, cx } from '@/components/ui';
import { Select } from '@/components/ui/SelectBox';
import { IconEdit, IconPlus, IconTrash } from '@/components/icons';
import ImportResults from '@/components/ImportResults';
import MemberImportDialog from '@/components/MemberImportDialog';
// 사용자 관리 = 집행 현황 표 형식 (Exec.css) · 조직 관리 = 코웍 체크리스트 줄 목록 형식 (CheckRows.css · Project.css)
import './Exec.css';
import '@/components/CheckRows.css';
import './Project.css';
import './Pages.css';

const ORG_PEOPLE_KEY = 'cowork-coin-org-people'; // localStorage: 조직 트리에 사용자 보기 (1 = 켬, 기본 끔)
const MOBILE_MQ = '(max-width: 640px)'; // Pages.css 모바일 구간과 같게

/** 모바일 폭인지 (화면 회전 · 창 크기 변경 따라감) */
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
/** 사용자 추가 · 수정 폼 (id 가 있으면 수정) */
type MemberDraft = { id?: string; employeeNo: string; name: string; position: string; email: string; teamId: string; isAdmin: boolean };
type OrgDraft = { id?: string; name: string; level: UnitLevel; parentId?: string; active: boolean };
type Confirm =
  | { kind: 'reset' | 'delete'; member: MemberAdminRow }
  | { kind: 'move'; member: MemberAdminRow; team: Team }
  | { kind: 'delete-org'; team: Team }
  | { kind: 'delete-many'; members: MemberAdminRow[] }
  | null;
/** 사용자 표 정렬 (집행 현황과 같은 머리글 정렬) */
type MemberSortKey = 'name' | 'no' | 'org' | 'active';
const MEMBER_SORT_COLS: { key: MemberSortKey; label: string }[] = [
  { key: 'name', label: '성명' }, { key: 'no', label: '사번' }, { key: 'org', label: '소속' },
];
type MemberState = 'all' | 'active' | 'dormant';
type OrgState = 'all' | 'active' | 'dormant';
/** 조직 단계 표시 색 (코웍 체크리스트 분류 배지와 같은 tint 배지) */
const LEVEL_COLOR: Record<UnitLevel, string> = { 회사: 'var(--primary)', 본부: 'var(--violet)', 부서: 'var(--sage)', 파트: 'var(--clay)' };
/** DM 을 못 보내 화면에 한 번 보여 주는 초기 비밀번호 */
type Issued = { name: string; password: string } | null;
/** 조직 트리 — 관리 범위의 조직만, 범위 밖 상위 조직은 건너뛰고 아래 조직을 끌어올림 */
type OrgNode = { team: Team; children: OrgNode[] };

const LEVELS: UnitLevel[] = ['회사', '본부', '부서', '파트'];
const CHILD_LEVEL: Partial<Record<UnitLevel, UnitLevel>> = { 회사: '본부', 본부: '부서', 부서: '파트' };
const LEVEL_CLASS: Record<UnitLevel, string> = { 회사: 'co', 본부: 'hq', 부서: 'dept', 파트: 'part' };
const levelOf = (t: Team): UnitLevel => t.level ?? '파트';
const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, 'ko');
const errMsg = (e: unknown, fallback = '처리하지 못했습니다. 잠시 후 다시 시도하세요.') => (e instanceof AuthApiError ? e.message : fallback);

/**
 * 관리자 메뉴 (Supabase 로그인) — 사용자 관리(1인 1계정) · 조직 관리(회사 › 본부 › 부서 › 파트)
 *   관리자: 전체 · 관리자 지정
 *   부서장 이상(소속이 본부 · 부서): 내 조직 아래 사용자 등록 · 수정 · 초기화 · 삭제, 내 조직 아래 부서의 파트 추가 · 수정 · 삭제
 *   권한 확인은 서버(DB 함수 · Edge Function)가 다시 함 — 화면은 할 수 있는 것만 보여 줌
 */
export default function Admin({ section }: { section: 'users' | 'org' }) {
  const { teams, session } = useAppState();
  const dispatch = useDispatch();
  const [toast, showToast] = useToast(3500);
  const isAdmin = !!session?.isAdmin;
  const myId = session?.member?.id;

  const tab = section === 'users' ? '사용자' : '조직';
  const [members, setMembers] = useState<MemberAdminRow[] | null>(null);
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ms, list, ids] = await Promise.all([listMembers(), listTeams(), manageableTeamIds()]);
      setMembers(ms);
      setScope(new Set(ids));
      dispatch({ type: 'SYNC_TEAMS', teams: list });
      dispatch({ type: 'SET_SESSION', patch: { canManage: ids.length > 0 } });
      setLoadError('');
    } catch (e) {
      setLoadError(errMsg(e, '목록을 불러오지 못했습니다.'));
    }
  }, [dispatch]);
  useEffect(() => { void reload(); }, [reload]);

  /** 서버 요청 → 목록 다시 읽기 → 안내 */
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (ok) showToast(ok);
      return true;
    } catch (e) {
      showToast(errMsg(e), 'warn');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── 조직 ──
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  /** 조직 경로 (본부 › 부서 › 파트) — 모두 같은 회사라 회사 이름은 회사 소속일 때만 */
  const pathOf = useCallback((id?: string) => {
    const names: string[] = [];
    for (let t = id ? byId.get(id) : undefined, n = 0; t && n < 5; t = t.parentId ? byId.get(t.parentId) : undefined, n++) {
      if (t.level !== '회사' || !names.length) names.unshift(t.name);
    }
    return names.join(' › ');
  }, [byId]);
  /** teamId 가 ancestorId 이거나 그 아래 조직인지 */
  const within = useCallback((teamId: string, ancestorId: string) => {
    for (let t = byId.get(teamId), n = 0; t && n < 5; t = t.parentId ? byId.get(t.parentId) : undefined, n++) if (t.id === ancestorId) return true;
    return false;
  }, [byId]);
  const roots = useMemo(() => {
    const build = (parent?: string): OrgNode[] => teams.filter(t => t.parentId === parent).sort(byName)
      .flatMap(t => (scope.has(t.id) ? [{ team: t, children: build(t.id) }] : build(t.id)));
    return build(undefined);
  }, [teams, scope]);
  /** 본부 › 부서 › 파트 순서로 펼친 관리 범위 조직 */
  const scopeTeams = useMemo(() => {
    const out: Team[] = [];
    const walk = (ns: OrgNode[]) => ns.forEach(n => { out.push(n.team); walk(n.children); });
    walk(roots);
    return out;
  }, [roots]);
  /** 최상위 회사 (대교CNS) — 새 본부는 이 아래에 */
  const company = teams.find(t => t.level === '회사');
  /** 이 조직을 내가 바꿀 수 있는지 — 관리자: 전부, 부서장 이상: 관리 범위의 파트 */
  const canEditOrg = (t: Team) => isAdmin || (scope.has(t.id) && t.level === '파트');
  /** 이 조직 아래 하위 조직을 만들 수 있는지 — 관리자: 본부 · 부서 아래, 부서장 이상: 관리 범위의 부서 아래 파트 */
  const canAddChild = (t: Team) => !!CHILD_LEVEL[levelOf(t)] && (isAdmin || (scope.has(t.id) && t.level === '부서'));

  // ── 사용자 ──
  /** 화면에 보이는 사용자 — 관리 범위 + 나 */
  const shown = useMemo(() => (members ?? []).filter(m => scope.has(m.teamId) || m.id === myId), [members, scope, myId]);
  /** 이 사용자를 내가 바꿀 수 있는지 — 관리자 계정은 관리자만 */
  const canEditMember = (m: MemberAdminRow) => isAdmin || (scope.has(m.teamId) && !m.isAdmin);

  // 조직 필터 — 본부 · 부서 · 파트 따로 (위를 바꾸면 아래는 '전체'로)
  const [hq, setHq] = useState('');
  const [dept, setDept] = useState('');
  const [part, setPart] = useState('');
  const hqOpts = scopeTeams.filter(t => t.level === '본부');
  const deptOpts = scopeTeams.filter(t => t.level === '부서' && (!hq || within(t.id, hq)));
  const partOpts = scopeTeams.filter(t => levelOf(t) === '파트' && (dept ? within(t.id, dept) : !hq || within(t.id, hq)));
  const orgFilter = part || dept || hq;
  const [query, setQuery] = useState('');
  /** 조직 · 검색 조건에 맞는 사용자 (상태 칩 건수 기준) */
  const matched = useMemo(() => shown
    .filter(m => !orgFilter || within(m.teamId, orgFilter))
    .filter(m => !query.trim() || [m.name, m.employeeNo, m.position ?? '', m.email ?? ''].some(v => v.toLowerCase().includes(query.trim().toLowerCase()))),
  [shown, orgFilter, query, within]);
  // 상태 칩 [전체 (n)] [활성 (n)] [휴면 (n)] — 집행 현황의 유형 칩과 같은 형식
  const [memberState, setMemberState] = useState<MemberState>('all');
  const stateCounts = { all: matched.length, active: matched.filter(m => m.active).length, dormant: matched.filter(m => !m.active).length };
  // 머리글 정렬 (같은 머리글을 다시 누르면 반대 순서) — 기본: 소속 순
  const [sort, setSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: 'org', dir: 1 });
  const sortBy = (key: MemberSortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  /** 정렬 머리글 (집행 현황과 같은 ▲ ▼ ↕ 표시) */
  const sortHead = (key: MemberSortKey, label: string) => {
    const on = sort.key === key;
    return (
      <th key={key} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={cx('exec-sort', on && 'is-on')} onClick={() => sortBy(key)} title={`${label} 기준 정렬`}>
          {label}<span className="exec-sort__ico" aria-hidden="true">{on ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };
  const visible = useMemo(() => {
    const byOrg = (a: MemberAdminRow, b: MemberAdminRow) => pathOf(a.teamId).localeCompare(pathOf(b.teamId), 'ko') || a.name.localeCompare(b.name, 'ko');
    const cmp: Record<MemberSortKey, (a: MemberAdminRow, b: MemberAdminRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
      no: (a, b) => a.employeeNo.localeCompare(b.employeeNo, 'ko', { numeric: true }),
      org: byOrg,
      active: (a, b) => Number(b.active) - Number(a.active) || byOrg(a, b),
    };
    return matched
      .filter(m => (memberState === 'active' ? m.active : memberState === 'dormant' ? !m.active : true))
      .sort((a, b) => cmp[sort.key](a, b) * sort.dir || byOrg(a, b));
  }, [matched, memberState, sort, pathOf]);

  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [issued, setIssued] = useState<Issued>(null);

  const openNew = () => setDraft({
    employeeNo: '', name: '', position: '', email: '', isAdmin: false,
    teamId: (orgFilter && scope.has(orgFilter) ? orgFilter : '') || scopeTeams[0]?.id || '',
  });
  const openEdit = (m: MemberAdminRow) => setDraft({
    id: m.id, employeeNo: m.employeeNo, name: m.name, position: m.position ?? '', email: m.email ?? '', teamId: m.teamId, isAdmin: m.isAdmin,
  });
  const draftError = (d: MemberDraft) => {
    if (!d.id && !/^[0-9A-Za-z]{3,20}$/.test(d.employeeNo.trim())) return '사번은 영문 · 숫자 3~20자로 입력하세요';
    if (!d.name.trim()) return '성명을 입력하세요';
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return '이메일 형식을 확인하세요';
    if (!d.teamId) return '소속 조직을 고르세요';
    return '';
  };
  const saveMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || draftError(draft) || busy) return;
    const d = { ...draft, employeeNo: draft.employeeNo.trim(), name: draft.name.trim(), position: draft.position.trim(), email: draft.email.trim() };
    if (d.id) {
      const before = members?.find(m => m.id === d.id);
      const ok = await run(() => updateMember(d.id!, {
        name: d.name, position: d.position, email: d.email,
        teamId: d.teamId !== before?.teamId ? d.teamId : undefined,
        isAdmin: isAdmin && d.isAdmin !== before?.isAdmin ? d.isAdmin : undefined,
      }), `${d.name} 정보를 저장했어요.`);
      if (ok) setDraft(null);
      return;
    }
    const ok = await run(async () => {
      const r = await createMember({ employeeNo: d.employeeNo, name: d.name, position: d.position || undefined, email: d.email || undefined, teamId: d.teamId, isAdmin: isAdmin && d.isAdmin });
      if (r.tempPassword) setIssued({ name: d.name, password: r.tempPassword });
      else showToast(`${d.name} 등록 완료 — 슬랙 DM 으로 사번과 초기 비밀번호를 보냈어요.`);
    });
    if (ok) setDraft(null);
  };

  const setActive = (m: MemberAdminRow, active: boolean) =>
    run(() => updateMember(m.id, { active }), `${m.name}을(를) ${active ? '활성' : '휴면'}으로 바꿨어요.`);
  const setAdmin = (m: MemberAdminRow, on: boolean) =>
    run(() => updateMember(m.id, { isAdmin: on }), `${m.name} 관리자 권한을 ${on ? '부여' : '해제'}했어요.`);
  const setWork = (m: MemberAdminRow, on: boolean) =>
    run(() => updateMember(m.id, { workEnabled: on }), `${m.name}의 업무비 권한을 ${on ? '켰어요' : '껐어요. 업무비 메뉴가 숨겨져요'}.`);
  const setMeetingEdit = (m: MemberAdminRow, on: boolean) =>
    run(() => updateMember(m.id, { meetingEdit: on }), `${m.name}의 팀 회의비 편집 권한을 ${on ? '켰어요' : '껐어요. 팀 회의비는 보기만 해요'}.`);

  // ── 체크박스로 골라 한 번에 삭제 (집행 현황의 [선택 삭제]와 같음) — 내 계정 · 바꿀 수 없는 사용자는 못 고름 ──
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const checkable = (m: MemberAdminRow) => canEditMember(m) && m.id !== myId;
  const checkableRows = visible.filter(checkable);
  const visibleChecked = checkableRows.filter(m => checked.has(m.id));
  const allChecked = checkableRows.length > 0 && visibleChecked.length === checkableRows.length;
  const toggleCheck = (id: string) => setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(checkableRows.map(m => m.id)));
  // 행 선택 (색 표시) — 선택된 행을 한 번 더 누르면 수정
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest('.member-table tbody tr')) setSelectedId(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [selectedId]);
  const onMemberRow = (m: MemberAdminRow, onControl: boolean) => {
    if (onControl) { setSelectedId(m.id); return; }
    if (selectedId === m.id && canEditMember(m)) { openEdit(m); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSelectedId(m.id);
  };

  const runConfirm = async () => {
    if (!confirm || busy) return;
    if (confirm.kind === 'delete-many') {
      const list = confirm.members;
      let failed = 0;
      const ok = await run(async () => {
        for (const m of list) { try { await deleteMember(m.id); } catch { failed++; } }
      });
      if (ok) {
        setConfirm(null);
        setChecked(new Set());
        showToast(failed ? `${list.length - failed}명을 삭제했어요. ${failed}명은 삭제하지 못했어요.` : `${list.length}명을 삭제했어요.`, failed ? 'warn' : 'ok');
      }
      return;
    }
    if (confirm.kind === 'delete-org') {
      const t = confirm.team;
      if (await run(() => removeTeam(t.id), `${t.name}을(를) 삭제했어요.`)) setConfirm(null);
      return;
    }
    if (confirm.kind === 'move') {
      const { member: m, team: t } = confirm;
      if (await run(() => updateMember(m.id, { teamId: t.id }), `${m.name}을(를) ${pathOf(t.id)}(으)로 옮겼어요.`)) setConfirm(null);
      return;
    }
    if (confirm.kind === 'reset') {
      const m = confirm.member;
      const ok = await run(async () => {
        const r = await resetMemberPassword(m.id);
        if (r.tempPassword) setIssued({ name: m.name, password: r.tempPassword });
        else showToast(`${m.name} 비밀번호를 초기화하고 슬랙 DM 으로 보냈어요.`);
      });
      if (ok) setConfirm(null);
    } else {
      const m = confirm.member;
      if (await run(() => deleteMember(m.id), `${m.name}을(를) 삭제했어요.`)) setConfirm(null);
    }
  };

  // ── 엑셀 일괄 등록 (팝업에서 등록할 사람만 골라서) ──
  const [sheet, setSheet] = useState<{ file: string; rows: ImportRow[]; problems: string[] } | null>(null);
  const [imported, setImported] = useState<ImportResult[] | null>(null);
  const registeredNos = useMemo(() => new Set((members ?? []).map(m => m.employeeNo.trim())), [members]);
  const pickSheet = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImported(null);
    try {
      setSheet({ file: file.name, ...(await readMemberSheet(file)) });
    } catch (err) {
      setSheet(null);
      showToast(errMsg(err, err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.'), 'warn');
    }
  };
  const runImport = async (picked: ImportRow[]) => {
    if (!picked.length) return;
    const rows = isAdmin ? picked : picked.map(r => ({ ...r, isAdmin: false }));
    await run(async () => {
      const r = await importMembers(rows);
      setImported(r.results);
      setSheet(null);
    });
  };

  // ── 조직 추가 · 수정 ──
  const [org, setOrg] = useState<OrgDraft | null>(null);
  const saveOrg = async (e: FormEvent) => {
    e.preventDefault();
    if (!org || !org.name.trim()) return;
    const ok = await run(() => saveTeam({ ...org, name: org.name.trim() }), `${org.name.trim()} 조직을 저장했어요.`);
    if (ok) setOrg(null);
  };

  // ── 조직 트리: 펼치기 · 접기 (처음엔 맨 위 조직만 펼침) ──
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const openSet = expanded ?? new Set(roots.flatMap(n => [n.team.id, ...(n.team.level === '회사' ? n.children.map(c => c.team.id) : [])]));
  const toggleOrg = (id: string) => setExpanded(() => { const s = new Set(openSet); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const isMobile = useIsMobile();
  // 모바일 사용자 목록: 누른 사용자 (아래로 상세 · 관리 버튼)
  const [pickedMember, setPickedMember] = useState<string | null>(null);

  // 사용자 표 칸 — PC 표와 모바일 펼침 영역이 함께 씀
  const slackStatus = (m: MemberAdminRow) => (
    !m.email ? <span className="t-muted">이메일 없음</span>
      : m.slackLinked === true ? <Badge variant="green" size="sm">연결됨</Badge>
      : m.slackLinked === false ? <Badge variant="red" size="sm">실패</Badge>
      : <span className="t-muted">보낸 적 없음</span>
  );
  const activeBadge = (m: MemberAdminRow) => {
    const self = m.id === myId;
    return (
      <Badge variant={m.active ? 'green' : 'gray'} size="lg" pressed={m.active} disabled={!canEditMember(m) || self || busy}
        title={self ? '내 계정은 휴면으로 바꿀 수 없어요' : `${m.active ? '휴면' : '활성'}으로 변경`}
        onClick={() => { void setActive(m, !m.active); }}>
        ● {m.active ? '활성' : '휴면'}
      </Badge>
    );
  };
  const adminSwitch = (m: MemberAdminRow) => {
    const self = m.id === myId;
    return (
      <Switch checked={m.isAdmin} disabled={self || busy} label={`${m.name} 관리자 권한`} text={m.isAdmin ? '관리자' : '일반'}
        title={self ? '내 권한은 바꿀 수 없어요' : undefined} onChange={v => { void setAdmin(m, v); }} />
    );
  };
  // 메뉴 권한 (관리자만)
  //   업무비 = 조회 + 편집 Y/N — 끄면 그 사람의 업무비 메뉴 · 집행 선택지가 숨겨지고 업무비 기록도 안 보임
  const workSwitch = (m: MemberAdminRow) => (
    <Switch checked={m.workEnabled !== false} disabled={busy} label={`${m.name} 업무비 조회 · 편집 권한`} text={m.workEnabled !== false ? 'Y' : 'N'}
      onChange={v => { void setWork(m, v); }} />
  );
  //   팀 회의비 편집 Y/N — 끄면 회의비는 보기만 (관리자 계정은 늘 편집)
  const meetingSwitch = (m: MemberAdminRow) => (
    <Switch checked={m.isAdmin || m.meetingEdit !== false} disabled={busy || m.isAdmin} label={`${m.name} 팀 회의비 편집 권한`}
      text={m.isAdmin || m.meetingEdit !== false ? 'Y' : 'N'} title={m.isAdmin ? '관리자는 늘 편집할 수 있어요' : undefined}
      onChange={v => { void setMeetingEdit(m, v); }} />
  );
  // 사용자 보기 끄면 조직만 펼치고 접는 트리 (이 기기에 기억)
  // 기본은 '조직만' — 사용자 포함을 고른 적이 있으면 그 선택을 따름
  const [showPeople, setShowPeopleState] = useState(() => { try { return localStorage.getItem(ORG_PEOPLE_KEY) === '1'; } catch { return false; } });
  const setShowPeople = (v: boolean) => {
    setShowPeopleState(v);
    try { localStorage.setItem(ORG_PEOPLE_KEY, v ? '1' : '0'); } catch { /* 저장 불가 시 이번 세션만 */ }
  };
  const membersOf = useMemo(() => {
    const map = new Map<string, MemberAdminRow[]>();
    for (const m of [...shown].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) map.set(m.teamId, [...(map.get(m.teamId) ?? []), m]);
    return map;
  }, [shown]);

  // ── 사용자 끌어서 조직 옮기기 ──
  const [dragging, setDragging] = useState<MemberAdminRow | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const canDropTo = (t: Team) => !!dragging && dragging.teamId !== t.id && t.active && scope.has(t.id);
  const endDrag = () => { setDragging(null); setDropId(null); };
  const dropProps = (t: Team) => ({
    onDragOver: (e: DragEvent) => { if (!canDropTo(t)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropId !== t.id) setDropId(t.id); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropId === t.id) setDropId(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging && canDropTo(t)) setConfirm({ kind: 'move', member: dragging, team: t });
      endDrag();
    },
  });

  /** 하위 조직까지 합친 사용자 수 */
  const totalOf = (n: OrgNode): number => (membersOf.get(n.team.id)?.length ?? 0) + n.children.reduce((s, c) => s + totalOf(c), 0);
  /** 펼칠 수 있는 조직 (하위 조직 또는 보이는 사용자가 있음) — 모두 펼치기 · 접기 상태 표시용 */
  const openable: string[] = [];
  const walk = (n: OrgNode) => {
    if (n.children.length || (showPeople && membersOf.get(n.team.id)?.length)) openable.push(n.team.id);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  const allOpen = openable.length > 0 && openable.every(id => openSet.has(id));
  // 접기 = 맨 위 조직(대교CNS)만 펼쳐 본부까지 보이게
  const rootIds = new Set(roots.map(n => n.team.id));
  const collapseAll = () => setExpanded(new Set(rootIds));
  const allClosed = openable.every(id => openSet.has(id) === rootIds.has(id));

  // 조직 활성 · 비활성 — 목록에서 바로 바꿈 (회사 · 내 조직은 못 끔)
  const myTeamId = members?.find(m => m.id === myId)?.teamId;
  const setOrgActive = (t: Team, active: boolean) =>
    run(() => saveTeam({ id: t.id, name: t.name, level: levelOf(t), parentId: t.parentId, active }),
      `${t.name} 조직을 ${active ? '활성' : '비활성'}으로 바꿨어요.`);
  const orgActiveBadge = (t: Team) => {
    const locked = levelOf(t) === '회사' || (t.active && t.id === myTeamId);
    const editable = canEditOrg(t) && !locked;
    if (!editable) return !t.active ? <Badge variant="gray" size="sm">비활성</Badge> : null;
    return (
      <Badge variant={t.active ? 'green' : 'gray'} size="sm" pressed={t.active} disabled={busy || !!org}
        title={`${t.active ? '비활성' : '활성'}으로 변경`} onClick={() => { void setOrgActive(t, !t.active); }}>
        ● {t.active ? '활성' : '비활성'}
      </Badge>
    );
  };

  // ── 조직 목록 (코웍 체크리스트와 같은 줄 목록 형식) ──
  //   위: [본부 선택] ··· [조직만 | 사용자 포함] / 카드 머리: [전체 n | 활성 n | 비활성 n] ··· 사용자 N명
  //   한 줄: [+/−] [조직명 (직속) ··· 하위 포함 N명] / [단계 · 활성] — 단계는 들여쓰기, 누른 줄은 선택 색
  const [orgHq, setOrgHq] = useState('');
  const [orgState, setOrgState] = useState<OrgState>('all');
  const [selOrg, setSelOrg] = useState<string | null>(null);
  const nodeOf = useMemo(() => {
    const map = new Map<string, OrgNode>();
    const index = (n: OrgNode) => { map.set(n.team.id, n); n.children.forEach(index); };
    roots.forEach(index);
    return map;
  }, [roots]);
  const orgRoots = orgHq ? [nodeOf.get(orgHq)].filter((n): n is OrgNode => !!n) : roots;
  const orgPool = scopeTeams.filter(t => !orgHq || within(t.id, orgHq));
  const orgCounts = { all: orgPool.length, active: orgPool.filter(t => t.active).length, dormant: orgPool.filter(t => !t.active).length };
  const orgPeople = orgPool.reduce((s, t) => s + (membersOf.get(t.id)?.length ?? 0), 0);
  const depthStyle = (depth: number) => ({ '--depth': depth }) as CSSProperties;

  /** 사용자 줄 (사용자 포함) — PC 에서 끌어 다른 조직 줄에 놓으면 소속 옮김 */
  const personRows = (t: Team, depth: number): ReactNode[] => (!showPeople ? [] : (membersOf.get(t.id) ?? []).map(m => {
    const movable = canEditMember(m) && !busy;
    return (
      <li key={`m-${m.id}`} style={depthStyle(depth)}
        className={cx('check-row org-row org-row--person', !m.active && 'is-dormant', movable && 'is-movable', dragging?.id === m.id && 'is-dragging')}
        draggable={movable} title={movable ? '다른 조직으로 끌어 놓으면 소속을 옮겨요' : undefined}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); setDragging(m); }}
        onDragEnd={endDrag}>
        <Avatar name={m.name} size="sm" muted={!m.active} />
        <div className="check-row__body">
          <div className="check-row__head">
            <span className="check-row__title">{m.name}{m.position && <span className="org-row__pos">{m.position}</span>}</span>
            <span className="org-row__no num">{m.employeeNo}</span>
          </div>
          {(m.id === myId || m.isAdmin || !m.active) && (
            <div className="check-row__meta">
              {m.id === myId && <Badge variant="amber" size="sm">나</Badge>}
              {m.isAdmin && <Badge variant="outline" size="sm">관리자</Badge>}
              {!m.active && <Badge variant="gray" size="sm">휴면</Badge>}
            </div>
          )}
        </div>
      </li>
    );
  }));

  /** 조직 줄 — flat: 상태로 거른 목록(단계 없이 한 줄씩, 위 조직 경로 표시) */
  const orgRow = (t: Team, depth: number, o: { hasBody: boolean; isOpen: boolean; total: number; flat: boolean }): ReactNode => {
    const lv = levelOf(t);
    const direct = membersOf.get(t.id)?.length ?? 0;
    const child = CHILD_LEVEL[lv];
    const sel = selOrg === t.id;
    const showAdd = canAddChild(t) && !!child;
    const showEdit = canEditOrg(t);
    // 관리 버튼: PC 는 줄 오른쪽 끝에 늘, 모바일은 누른(선택한) 줄에만 둘째 줄로
    const showActs = (showAdd || showEdit) && (!isMobile || sel);
    const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    const addChild = () => { setSelOrg(null); setOrg({ name: '', level: child!, parentId: t.id, active: true }); top(); };
    const editOrg = () => { setSelOrg(null); setOrg({ id: t.id, name: t.name, level: lv, parentId: t.parentId, active: t.active }); top(); };
    const deleteOrg = () => { setSelOrg(null); setConfirm({ kind: 'delete-org', team: t }); };
    return (
      <li key={t.id} data-org={t.id} style={depthStyle(depth)}
        className={cx('check-row org-row', `org-row--${LEVEL_CLASS[lv]}`, !t.active && 'is-dormant', sel && 'is-selected', dropId === t.id && 'is-drop', showActs && 'has-actions')}
        {...dropProps(t)}
        onClick={e => {
          // 버튼(펼치기 · 활성 · 관리)을 누르면 그 줄을 선택(해제하지 않음), 나머지 영역은 선택 ↔ 해제
          const onControl = !!(e.target as HTMLElement).closest('input, button');
          setSelOrg(s => (s === t.id && !onControl ? null : t.id));
        }}>
        {o.hasBody
          ? <button type="button" className="org-row__toggle" aria-expanded={o.isOpen} aria-label={`${t.name} ${o.isOpen ? '접기' : '펼치기'}`}
              onClick={() => toggleOrg(t.id)}>{o.isOpen ? '−' : '+'}</button>
          : <span className="org-row__toggle is-empty" aria-hidden="true" />}
        <div className="check-row__body">
          <div className="check-row__head">
            {/* 한 줄: 조직명 (직속 사용자 수) · 단계 · 활성 ··· 하위 포함 인원 */}
            <span className="org-row__line">
              <span className="check-row__title">
                {t.name}<span className="org-row__sub" title={`직속 사용자 ${direct}명`} aria-label={`직속 사용자 ${direct}명`}>({direct})</span>
              </span>
              <span className="org-row__tags">
                <Badge variant="tint" size="sm" color={LEVEL_COLOR[lv]}>{lv}</Badge>
                {orgActiveBadge(t)}
                {o.flat && t.parentId && <span className="check-row__proj org-row__path">{pathOf(t.parentId)}</span>}
              </span>
            </span>
            <span className={cx('check-row__amt num org-row__count', !o.total && 'is-zero')} title={`하위 조직 포함 ${o.total}명`}>{o.total}명</span>
          </div>
        </div>
        {showActs && (
          <div className="check-row__actions" role="group" aria-label={`${t.name} 관리`}>
            {isMobile ? (
              <>
                {showAdd && <Btn size="sm" variant="secondary" disabled={!!org} onClick={addChild}><IconPlus size={12} />{child} 추가</Btn>}
                {showEdit && <Btn size="sm" variant="secondary" disabled={!!org} onClick={editOrg}><IconEdit size={13} />수정</Btn>}
                {showEdit && <Btn size="sm" variant="secondary" className="org-row__del" onClick={deleteOrg}><IconTrash size={13} />삭제</Btn>}
              </>
            ) : (
              <>
                {showAdd && (
                  <Btn size="sm" variant="ghost" disabled={!!org} aria-label={`${t.name} 아래 ${child} 추가`} onClick={addChild}>
                    <IconPlus size={12} /><span className="org-row__add-label">{child}</span>
                  </Btn>
                )}
                {showEdit && (
                  <>
                    <button type="button" className="icon-btn icon-btn--sm" aria-label={`${t.name} 수정`} title="수정" disabled={!!org}
                      onClick={editOrg}><IconEdit size={14} /></button>
                    <button type="button" className="icon-btn icon-btn--sm icon-btn--red" aria-label={`${t.name} 삭제`} title="삭제"
                      onClick={deleteOrg}><IconTrash size={14} /></button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  const orgRows: ReactNode[] = [];
  if (orgState === 'all') {
    // 전체: 회사 › 본부 › 부서 › 파트 순서로 펼친 줄 (접힌 조직의 아래는 숨김)
    const addRows = (n: OrgNode, depth: number) => {
      const hasBody = n.children.length > 0 || (showPeople && (membersOf.get(n.team.id)?.length ?? 0) > 0);
      const isOpen = hasBody && openSet.has(n.team.id);
      orgRows.push(orgRow(n.team, depth, { hasBody, isOpen, total: totalOf(n), flat: false }));
      if (!isOpen) return;
      orgRows.push(...personRows(n.team, depth + 1));
      n.children.forEach(c => addRows(c, depth + 1));
    };
    orgRoots.forEach(n => addRows(n, 0));
  } else {
    // 활성 · 비활성으로 거르면 단계 없이 한 줄씩
    orgPool.filter(t => (orgState === 'active' ? t.active : !t.active)).forEach(t => {
      const n = nodeOf.get(t.id);
      orgRows.push(orgRow(t, 0, { hasBody: false, isOpen: false, total: n ? totalOf(n) : 0, flat: true }));
      orgRows.push(...personRows(t, 1));
    });
  }

  const teamOptions = scopeTeams.map(t => <option key={t.id} value={t.id}>{pathOf(t.id)}</option>);

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead title={section === 'users' ? '사용자 관리' : '조직 관리'}
        actions={tab === '사용자'
          ? <>
              <label className={cx('btn btn--secondary', (busy || !scopeTeams.length) && 'is-disabled')}>
                엑셀로 등록
                <input type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy || !scopeTeams.length} onChange={e => { void pickSheet(e); }} />
              </label>
              <Btn onClick={openNew} disabled={!!draft || !scopeTeams.length}><IconPlus size={14} />사용자 추가</Btn>
            </>
          : isAdmin && <Btn onClick={() => setOrg({ name: '', level: '본부', parentId: company?.id, active: true })} disabled={!!org}><IconPlus size={14} />본부 추가</Btn>} />

      {loadError && <div className="mb-14"><Alert variant="danger">{loadError} <button type="button" className="text-link" onClick={() => { void reload(); }}>다시 시도</button></Alert></div>}
      {!isAdmin && (
        <div className="mb-14"><Alert variant="info">내 조직({pathOf(session?.member ? teams.find(t => t.name === session.team)?.id : undefined) || session?.team}) {tab === '사용자' ? '아래의 사용자를 관리할 수 있어요. 관리자 지정은 관리자만 할 수 있어요.' : '아래의 파트를 추가 · 수정할 수 있어요. 회사 · 본부 · 부서 조직은 관리자만 바꿀 수 있어요.'}</Alert></div>
      )}

      {/* 확인 창 */}
      {confirm && (
        <ConfirmLayer tone={confirm.kind === 'reset' || confirm.kind === 'move' ? 'default' : 'danger'}
          title={confirm.kind === 'reset' ? '비밀번호 초기화' : confirm.kind === 'move' ? '소속 옮기기' : confirm.kind === 'delete' || confirm.kind === 'delete-many' ? '사용자 삭제' : '조직 삭제'}
          confirmLabel={busy ? '처리 중...' : confirm.kind === 'reset' ? '초기화' : confirm.kind === 'move' ? '옮기기' : '삭제'}
          onConfirm={() => { void runConfirm(); }} onCancel={() => setConfirm(null)}>
          {confirm.kind === 'reset' && <><b>{confirm.member.name}</b>({confirm.member.employeeNo}) 비밀번호를 새 초기 비밀번호로 바꾸고 슬랙 DM 으로 보낼까요? 지금 비밀번호는 더 이상 쓸 수 없어요.</>}
          {confirm.kind === 'move' && <><b>{confirm.member.name}</b>을(를) {pathOf(confirm.member.teamId)}에서 <b>{pathOf(confirm.team.id)}</b>(으)로 옮길까요? 옮기면 새 조직의 데이터를 보고 쓰게 돼요.</>}
          {confirm.kind === 'delete' && <><b>{confirm.member.name}</b>({confirm.member.employeeNo}) 계정을 삭제할까요? 등록한 집행 기록은 조직에 남아요. 잠시 쉬는 경우라면 휴면을 쓰세요.</>}
          {confirm.kind === 'delete-many' && <>체크한 사용자 <b>{confirm.members.length}명</b>({confirm.members.slice(0, 3).map(m => m.name).join(', ')}{confirm.members.length > 3 && ' 외'}) 계정을 삭제할까요? 등록한 집행 기록은 조직에 남아요. 잠시 쉬는 경우라면 휴면을 쓰세요.</>}
          {confirm.kind === 'delete-org' &&<><b>{pathOf(confirm.team.id)}</b> 조직을 삭제할까요? 소속 사용자 · 하위 조직 · 이력이 있으면 지울 수 없어요(비활성으로 바꾸세요).</>}
        </ConfirmLayer>
      )}
      {issued && (
        <ConfirmLayer title={`${issued.name} 초기 비밀번호`} confirmLabel="닫기" cancelLabel="복사"
          onConfirm={() => setIssued(null)} onCancel={() => { void navigator.clipboard?.writeText(issued.password).catch(() => undefined); setIssued(null); }}>
          슬랙 DM 을 보내지 못했어요. 초기 비밀번호 <code className="temp-pw">{issued.password}</code>
          <span className="temp-pw__note">이 창을 닫으면 다시 볼 수 없어요. 본인에게 직접 전달하면 첫 로그인 때 새 비밀번호로 바꿉니다. 회사 이메일이 슬랙 로그인 이메일과 같은지도 확인하세요.</span>
        </ConfirmLayer>
      )}
      {sheet && (
        <MemberImportDialog file={sheet.file} rows={sheet.rows} problems={sheet.problems} existing={registeredNos} isAdmin={isAdmin} busy={busy}
          onCancel={() => setSheet(null)} onSubmit={rows => { void runImport(rows); }} />
      )}

      {tab === '사용자' && (
        <>
          {imported && (
            <Card pad className="mb-16">
              <h2 className="card-title">등록 결과</h2>
              <ImportResults results={imported} />
              <div className="row row--end"><Btn variant="secondary" onClick={() => setImported(null)}>닫기</Btn></div>
            </Card>
          )}

          {/* 사용자 추가 · 수정 */}
          {draft && (
            <Card pad className="mb-16">
              <h2 className="card-title">{draft.id ? `${draft.name || '사용자'} 정보 수정` : '사용자 추가'}</h2>
              <form className="member-form" onSubmit={e => { void saveMember(e); }} noValidate>
                <Field label="사번" htmlFor="mf-no" hint={draft.id ? '로그인 아이디 · 바꿀 수 없음' : '로그인 아이디'}>
                  <Input id="mf-no" value={draft.employeeNo} disabled={!!draft.id} inputMode="numeric" autoFocus={!draft.id}
                    onChange={e => setDraft(d => d && { ...d, employeeNo: e.target.value })} />
                </Field>
                <Field label="성명" htmlFor="mf-name">
                  <Input id="mf-name" value={draft.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} />
                </Field>
                <Field label="직위" htmlFor="mf-pos">
                  <Input id="mf-pos" value={draft.position} placeholder="예: 책임" onChange={e => setDraft(d => d && { ...d, position: e.target.value })} />
                </Field>
                <Field label="회사 이메일" htmlFor="mf-mail" hint="슬랙 로그인 이메일과 같아야 DM 이 가요">
                  <Input id="mf-mail" type="email" value={draft.email} onChange={e => setDraft(d => d && { ...d, email: e.target.value })} />
                </Field>
                <Field label="소속" htmlFor="mf-team">
                  <Select id="mf-team" value={draft.teamId} onChange={e => setDraft(d => d && { ...d, teamId: e.target.value })}>
                    {!draft.teamId && <option value="">조직 선택</option>}
                    {teamOptions}
                  </Select>
                </Field>
                {isAdmin && (
                  <div className="member-form__switch">
                    <span className="label">관리자 권한</span>
                    <Switch checked={draft.isAdmin} disabled={draft.id === myId} label="관리자 권한" text={draft.isAdmin ? '관리자' : '일반'}
                      onChange={v => setDraft(d => d && { ...d, isAdmin: v })} />
                  </div>
                )}
                {draftError(draft) && (draft.name || draft.employeeNo) && <small className="member-form__err">{draftError(draft)}</small>}
                <div className="row row--end member-form__btns">
                  <Btn variant="secondary" onClick={() => setDraft(null)}>취소</Btn>
                  <Btn type="submit" disabled={busy || !!draftError(draft)}>{busy ? '저장 중...' : draft.id ? '저장' : '등록하고 DM 보내기'}</Btn>
                </div>
              </form>
            </Card>
          )}

          <div className="member-toolbar">
            {hqOpts.length > 0 && (
              <Select className="member-toolbar__org" value={hq} aria-label="본부로 거르기" onChange={e => { setHq(e.target.value); setDept(''); setPart(''); }}>
                <option value="">전체 본부</option>
                {hqOpts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            {(deptOpts.length > 0 || dept) && (
              <Select className="member-toolbar__org" value={dept} aria-label="부서로 거르기" onChange={e => { setDept(e.target.value); setPart(''); }}>
                <option value="">전체 부서</option>
                {deptOpts.map(t => <option key={t.id} value={t.id}>{hq ? t.name : pathOf(t.id)}</option>)}
              </Select>
            )}
            {(partOpts.length > 0 || part) && (
              <Select className="member-toolbar__org" value={part} aria-label="파트로 거르기" onChange={e => setPart(e.target.value)}>
                <option value="">전체 파트</option>
                {partOpts.map(t => <option key={t.id} value={t.id}>{dept ? t.name : pathOf(t.id)}</option>)}
              </Select>
            )}
            <Input value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery('')} placeholder="성명 · 사번 · 이메일 검색" aria-label="사용자 검색" />
          </div>

          {/* 집행 현황과 같은 형식: [상태 칩 (건수)] ··· [선택 삭제] / 안내 / 표 */}
          <div className="exec-filter">
            <div className="chip-row">
              {([['all', '전체'], ['active', '활성'], ['dormant', '휴면']] as [MemberState, string][]).map(([v, label]) => (
                <FilterChip key={v} label={label} count={stateCounts[v]} active={memberState === v} onClick={() => { setMemberState(v); setChecked(new Set()); }} />
              ))}
            </div>
            {!isMobile && (
              <Btn variant="danger" size="sm" className="exec-filter__del" disabled={!visibleChecked.length || busy}
                onClick={() => setConfirm({ kind: 'delete-many', members: visibleChecked })}>
                <IconTrash size={13} />선택 삭제{visibleChecked.length > 0 && ` (${visibleChecked.length})`}
              </Btn>
            )}
          </div>
          <p className="exec-hint">
            {isMobile
              ? '줄을 누르면 상세 정보와 초기화 · 수정 · 삭제 버튼이 열려요.'
              : '수정: 행을 선택한 뒤 한 번 더 누르세요. · 삭제: 체크박스로 선택한 뒤 [선택 삭제]'}
          </p>

          <Card className="card--clip">
            {members === null ? (
              <EmptyState message={loadError ? '목록을 불러오지 못했어요' : '불러오는 중...'} />
            ) : !visible.length ? (
              <EmptyState icon="👤" message="사용자가 없어요" sub={orgFilter || query || memberState !== 'all' ? '조직 · 상태 · 검색 조건을 바꿔 보세요' : '사용자 추가 또는 엑셀로 등록하세요'} />
            ) : isMobile ? (
              /* 모바일: 사번 · 성명 · 직위만, 줄을 누르면 색 표시 + 아래로 상세 · 관리 버튼 */
              <table className="table member-table member-table--m">
                <thead>
                  <tr>
                    {sortHead('no', '사번')}
                    {sortHead('name', '성명')}
                    <th>직위</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(m => {
                    const self = m.id === myId;
                    const editable = canEditMember(m);
                    const open = pickedMember === m.id;
                    const toggle = () => setPickedMember(p => (p === m.id ? null : m.id));
                    return (
                      <Fragment key={m.id}>
                        <tr className={cx('member-table__row', !m.active && 'is-dormant', open && 'is-picked')} tabIndex={0} aria-expanded={open}
                          onClick={toggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
                          <td className="t-muted">{m.employeeNo}</td>
                          <td className="member-table__name">
                            <span className="t-strong">{m.name}</span>
                            {self && <Badge variant="amber" size="sm" className="team-table__me">나</Badge>}
                          </td>
                          <td className="t-muted">{m.position || '—'}</td>
                        </tr>
                        {open && (
                          <tr className="member-table__panel">
                            <td colSpan={3}>
                              <dl className="member-detail">
                                <div><dt>소속</dt><dd>{pathOf(m.teamId) || '—'}</dd></div>
                                <div><dt>슬랙 DM</dt><dd title={m.slackError ?? undefined}>{slackStatus(m)}</dd></div>
                                <div><dt>상태</dt><dd>{activeBadge(m)}</dd></div>
                                {isAdmin && <div><dt>관리자</dt><dd>{adminSwitch(m)}</dd></div>}
                                {isAdmin && <div><dt>업무비 조회·편집</dt><dd>{workSwitch(m)}</dd></div>}
                                {isAdmin && <div><dt>회의비 편집</dt><dd>{meetingSwitch(m)}</dd></div>}
                                {m.mustChangePassword && <div><dt>비밀번호</dt><dd><Badge variant="gray" size="sm">초기 비밀번호 사용 중</Badge></dd></div>}
                              </dl>
                              <div className="member-detail__btns">
                                <Btn size="sm" variant="secondary" disabled={!editable || self} title={self ? '내 비밀번호는 내 정보에서 바꾸세요' : undefined}
                                  onClick={() => setConfirm({ kind: 'reset', member: m })}>비밀번호 초기화</Btn>
                                <Btn size="sm" variant="secondary" disabled={!editable}
                                  onClick={() => { openEdit(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><IconEdit size={13} />수정</Btn>
                                <Btn size="sm" variant="secondary" className="member-detail__del" disabled={!editable || self}
                                  onClick={() => setConfirm({ kind: 'delete', member: m })}><IconTrash size={13} />삭제</Btn>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="member-table__total">
                    <td colSpan={3}>합계 <small>{visible.length}명</small></td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <TableWrap>
                <table className="table member-table">
                  <thead>
                    <tr>
                      <th className="member-table__check">
                        <Checkbox checked={allChecked} disabled={!checkableRows.length}
                          ref={el => { if (el) el.indeterminate = visibleChecked.length > 0 && !allChecked; }}
                          onChange={toggleAll} aria-label="전체 선택" />
                      </th>
                      {MEMBER_SORT_COLS.map(c => sortHead(c.key, c.label))}
                      <th>슬랙 DM</th>
                      {sortHead('active', '상태')}
                      {isAdmin && <><th>관리자</th><th title="팀 운영 › 업무비 메뉴 조회 · 편집">업무비 조회·편집</th><th title="팀 운영 › 팀 회의비 편집">회의비 편집</th></>}
                      <th className="t-center">비밀번호</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(m => {
                      const self = m.id === myId;
                      const editable = canEditMember(m);
                      const sel = selectedId === m.id;
                      return (
                        <tr key={m.id} tabIndex={0} aria-selected={sel}
                          className={cx('is-clickable', !m.active && 'is-dormant', sel && 'is-selected', checked.has(m.id) && 'is-checked')}
                          title={sel && editable ? '한 번 더 누르면 수정' : undefined}
                          onClick={e => onMemberRow(m, !!(e.target as HTMLElement).closest('input, button, label'))}
                          onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onMemberRow(m, false); }}>
                          <td className="member-table__check" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={checked.has(m.id)} disabled={!checkable(m)} onChange={() => toggleCheck(m.id)}
                              title={self ? '내 계정은 삭제할 수 없어요' : !editable ? '바꿀 수 없는 사용자예요' : undefined} aria-label={`${m.name} 선택`} />
                          </td>
                          <td className="member-table__name">
                            <span className="t-strong">{m.name}</span>{m.position && <span className="t-muted"> {m.position}</span>}
                            {self && <Badge variant="amber" size="sm" className="team-table__me">나</Badge>}
                            {m.mustChangePassword && <Badge variant="gray" size="sm" className="team-table__me" title="초기 비밀번호를 아직 바꾸지 않았어요">초기 비밀번호</Badge>}
                          </td>
                          <td className="t-muted num">{m.employeeNo}</td>
                          <td className="member-table__org">{pathOf(m.teamId)}</td>
                          <td title={m.slackError ?? m.email ?? '회사 이메일 없음'}>{slackStatus(m)}</td>
                          <td>{activeBadge(m)}</td>
                          {isAdmin && <><td>{adminSwitch(m)}</td><td>{workSwitch(m)}</td><td>{meetingSwitch(m)}</td></>}
                          <td className="t-center">
                            <Btn size="sm" variant="secondary" disabled={!editable || self} title={self ? '내 비밀번호는 내 정보에서 바꾸세요' : undefined}
                              onClick={() => setConfirm({ kind: 'reset', member: m })}>초기화</Btn>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="member-table__total">
                      <td />
                      <td colSpan={isAdmin ? 9 : 6}>합계 <small>{visible.length}명 · 활성 {visible.filter(m => m.active).length} · 휴면 {visible.filter(m => !m.active).length}</small></td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      {tab === '조직' && (
        <>
          {org && (
            <Card pad className="mb-16">
              <h2 className="card-title">{org.id ? '조직 수정' : `${org.level} 추가`}{org.parentId && ` — ${pathOf(org.parentId)} 아래`}</h2>
              <form className="member-form" onSubmit={e => { void saveOrg(e); }} noValidate>
                <Field label="조직명" htmlFor="of-name">
                  <Input id="of-name" value={org.name} autoFocus onChange={e => setOrg(o => o && { ...o, name: e.target.value })} />
                </Field>
                {isAdmin && org.id && (
                  <Field label="구분" htmlFor="of-level">
                    <Select id="of-level" value={org.level} onChange={e => setOrg(o => o && { ...o, level: e.target.value as UnitLevel })}>
                      {LEVELS.filter(l => l !== '회사' || org.level === '회사').map(l => <option key={l} value={l}>{l}</option>)}
                    </Select>
                  </Field>
                )}
                {isAdmin && org.id && org.level !== '회사' && (
                  <Field label="상위 조직" htmlFor="of-parent">
                    <Select id="of-parent" value={org.parentId ?? ''} onChange={e => setOrg(o => o && { ...o, parentId: e.target.value || undefined })}>
                      {org.level === '본부' && <option value="">상위 없음 (최상위)</option>}
                      {teams.filter(t => t.id !== org.id && LEVELS.indexOf(levelOf(t)) < LEVELS.indexOf(org.level))
                        .map(t => <option key={t.id} value={t.id}>{pathOf(t.id)}</option>)}
                    </Select>
                  </Field>
                )}
                {org.id && (
                  <div className="member-form__switch">
                    <span className="label">상태</span>
                    <Switch checked={org.active} label="조직 활성" text={org.active ? '활성' : '비활성'} onChange={v => setOrg(o => o && { ...o, active: v })} />
                  </div>
                )}
                <div className="row row--end member-form__btns">
                  <Btn variant="secondary" onClick={() => setOrg(null)}>취소</Btn>
                  <Btn type="submit" disabled={busy || !org.name.trim()}>{busy ? '저장 중...' : '저장'}</Btn>
                </div>
              </form>
            </Card>
          )}

          {/* [본부 선택] / 상태 칩 [전체 (n)] [활성 (n)] [비활성 (n)] — 사용자 관리와 같은 버튼 / 카드 머리 [조직만 | 사용자 포함] ··· 사용자 수 */}
          {hqOpts.length > 1 && (
            <div className="proj-check__filters">
              <Select className="proj-check__proj" value={orgHq} onChange={e => { setOrgHq(e.target.value); setSelOrg(null); }} aria-label="본부 선택">
                <option value="">전체 본부</option>
                {hqOpts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          )}
          <div className="exec-filter">
            <div className="chip-row">
              {([['all', '전체'], ['active', '활성'], ['dormant', '비활성']] as [OrgState, string][]).map(([v, label]) => (
                <FilterChip key={v} label={label} count={orgCounts[v]} active={orgState === v} onClick={() => { setOrgState(v); setSelOrg(null); }} />
              ))}
            </div>
          </div>
          <Card pad>
            {!roots.length ? (
              <EmptyState icon="🏢" message="관리할 수 있는 조직이 없어요" />
            ) : (
              <>
                <div className="proj-check__head">
                  <Segmented label="조직 목록 보기 형식" value={showPeople ? 'people' : 'org'} onChange={v => setShowPeople(v === 'people')}
                    options={[{ value: 'org', label: '조직만' }, { value: 'people', label: '사용자 포함' }]} />
                  <p className="proj-check__todo">사용자 <b className="num">{orgPeople}명</b></p>
                </div>
                <div className="org-list__note">
                  <p className="proj-check__budget">
                    {showPeople ? (
                      <>
                        <span className="hide-touch">사용자를 끌어 다른 조직에 놓으면 소속이 바뀌어요.</span>
                        <span className="show-touch">소속은 사용자 관리 → 수정에서 바꿀 수 있어요.</span>
                      </>
                    ) : <>( )는 직속 사용자, 오른쪽은 하위 조직까지 합친 인원이에요.</>}
                    {isMobile && ' 줄을 누르면 관리 버튼이 나와요.'}
                  </p>
                  {orgState === 'all' && (
                    <span className="chip-row">
                      <FilterChip label={isMobile ? '펼치기' : '모두 펼치기'} active={allOpen} onClick={() => setExpanded(new Set(scopeTeams.map(t => t.id)))} />
                      <FilterChip label={isMobile ? '접기' : '모두 접기'} active={allClosed} onClick={collapseAll} />
                    </span>
                  )}
                </div>
                {orgRows.length
                  ? <ul className="check-list is-selectable org-list">{orgRows}</ul>
                  : <EmptyState icon="🏢" message={orgState === 'dormant' ? '비활성 조직이 없어요' : '조회된 조직이 없어요'} />}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
