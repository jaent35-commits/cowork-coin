import { Fragment, useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { Team, UnitLevel } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import {
  AuthApiError, createMember, deleteMember, importMembers, listMembers, listTeams, manageableTeamIds, removeTeam,
  resetMemberPassword, saveTeam, updateMember, type ImportResult, type ImportRow, type MemberAdminRow,
} from '@/lib/authApi';
import { readMemberSheet } from '@/lib/memberSheet';
import { useToast } from '@/hooks/useToast';
import { Alert, Avatar, Badge, Btn, Card, ConfirmLayer, EmptyState, Field, FilterChip, Input, PageHead, Segmented, Switch, TableWrap, Toast, cx } from '@/components/ui';
import { Select } from '@/components/ui/SelectBox';
import { IconEdit, IconPlus, IconTrash } from '@/components/icons';
import ImportResults from '@/components/ImportResults';
import MemberImportDialog from '@/components/MemberImportDialog';
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
  | null;
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
  const visible = useMemo(() => shown
    .filter(m => !orgFilter || within(m.teamId, orgFilter))
    .filter(m => !query.trim() || [m.name, m.employeeNo, m.position ?? '', m.email ?? ''].some(v => v.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => pathOf(a.teamId).localeCompare(pathOf(b.teamId), 'ko') || a.name.localeCompare(b.name, 'ko')),
  [shown, orgFilter, query, within, pathOf]);

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

  const runConfirm = async () => {
    if (!confirm || busy) return;
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
  // 모바일: 조직 줄을 누르면 선택(색 표시) + 줄 아래로 추가 · 수정 · 삭제 버튼이 펼쳐짐 (다시 누르면 닫힘)
  const isMobile = useIsMobile();
  const [picked, setPicked] = useState<string | null>(null);
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
  const allClosed = openable.every(id => !openSet.has(id));

  /**
   * 조직 한 칸 — 들여쓰기 대신 왼쪽 연결선으로 단계를 보여 줌
   *   본부 > 부서 > 파트 순으로 글자 굵기 · 크기를 한 단계씩 낮춤, 관리 버튼은 PC 에서 줄에 올렸을 때만 진하게
   */
  const renderOrg = (n: OrgNode): ReactNode => {
    const t = n.team;
    const lv = levelOf(t);
    const people = membersOf.get(t.id) ?? [];
    const hasBody = n.children.length > 0 || (showPeople && people.length > 0);
    const isOpen = hasBody && openSet.has(t.id);
    const total = totalOf(n);
    const child = CHILD_LEVEL[lv];
    const isPicked = isMobile && picked === t.id;
    const addChild = () => { setPicked(null); setOrg({ name: '', level: child!, parentId: t.id, active: true }); };
    const editOrg = () => { setPicked(null); setOrg({ id: t.id, name: t.name, level: lv, parentId: t.parentId, active: t.active }); };
    const deleteOrg = () => { setPicked(null); setConfirm({ kind: 'delete-org', team: t }); };
    const showAdd = canAddChild(t) && !!child;
    const showEdit = canEditOrg(t);
    // 바로 아래 조직 수 — 예: 경영지원본부 (2)
    const subCount = n.children.length > 0 && (
      <span className="org-node__sub" title={`하위 ${child ?? '조직'} ${n.children.length}개`} aria-label={`하위 조직 ${n.children.length}개`}>({n.children.length})</span>
    );
    return (
      <li key={t.id} className={cx('org-node', `org-node--${LEVEL_CLASS[lv]}`)}>
        <div className={cx('org-node__row', !t.active && 'is-dormant', dropId === t.id && 'is-drop', isPicked && 'is-picked')} {...dropProps(t)}>
          {hasBody
            ? <button type="button" className="org-node__toggle" aria-expanded={isOpen} aria-label={`${t.name} ${isOpen ? '접기' : '펼치기'}`} onClick={() => toggleOrg(t.id)}>{isOpen ? '−' : '+'}</button>
            : <span className="org-node__toggle is-empty" aria-hidden="true" />}
          {isMobile ? (
            <button type="button" className="org-node__title" aria-pressed={isPicked} aria-label={`${t.name} ${isPicked ? '선택 해제' : '선택 — 관리 버튼 보기'}`}
              onClick={() => setPicked(p => (p === t.id ? null : t.id))}>
              <span className="org-node__level">{lv}</span>
              <span className="org-node__name">{t.name}</span>
              {subCount}
            </button>
          ) : (
            <button type="button" className="org-node__title" disabled={!hasBody} onClick={() => toggleOrg(t.id)} tabIndex={-1}>
              <span className="org-node__level">{lv}</span>
              <span className="org-node__name">{t.name}</span>
              {subCount}
            </button>
          )}
          <span className="org-node__meta">
            {!t.active && <Badge variant="gray" size="sm">비활성</Badge>}
            <span className={cx('org-node__count', !total && 'is-zero')} title={total !== people.length ? `직속 ${people.length}명 · 하위 포함 ${total}명` : undefined}>
              {total}명
            </span>
          </span>
          {!isMobile && (showAdd || showEdit) && (
            <span className="org-node__acts">
              {showAdd && (
                <Btn size="sm" variant="ghost" disabled={!!org} aria-label={`${t.name} 아래 ${child} 추가`} onClick={addChild}>
                  <IconPlus size={12} /><span className="org-node__add-label">{child}</span>
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
            </span>
          )}
        </div>
        {isPicked && (
          <div className="org-node__drawer" role="group" aria-label={`${t.name} 관리`}>
            {showAdd || showEdit ? (
              <>
                {showAdd && <Btn size="sm" variant="secondary" disabled={!!org} onClick={addChild}><IconPlus size={12} />{child} 추가</Btn>}
                {showEdit && <Btn size="sm" variant="secondary" disabled={!!org} onClick={editOrg}><IconEdit size={13} />수정</Btn>}
                {showEdit && <Btn size="sm" variant="secondary" className="org-node__drawer-del" onClick={deleteOrg}><IconTrash size={13} />삭제</Btn>}
              </>
            ) : (
              <span className="org-node__drawer-note">이 조직은 관리 권한이 없어요.</span>
            )}
          </div>
        )}
        {isOpen && (
          <div className="org-node__body">
            {showPeople && people.length > 0 && (
              <ul className="org-people" aria-label={`${t.name} 소속 사용자`}>
                {people.map(m => {
                  const movable = canEditMember(m) && !busy;
                  return (
                    <li key={m.id} className={cx('org-person', !m.active && 'is-dormant', movable && 'is-movable', dragging?.id === m.id && 'is-dragging')}
                      draggable={movable} title={movable ? '다른 조직으로 끌어 놓으면 소속을 옮겨요' : undefined}
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); setDragging(m); }}
                      onDragEnd={endDrag}>
                      <span className="org-person__grip" aria-hidden="true">⠿</span>
                      <Avatar name={m.name} size="sm" muted={!m.active} />
                      <span className="org-person__who">
                        <span className="org-person__name">{m.name}</span>
                        {m.position && <span className="org-person__pos">{m.position}</span>}
                      </span>
                      <span className="org-person__no">{m.employeeNo}</span>
                      <span className="org-person__tags">
                        {m.id === myId && <Badge variant="amber" size="sm">나</Badge>}
                        {m.isAdmin && <Badge variant="outline" size="sm">관리자</Badge>}
                        {!m.active && <Badge variant="gray" size="sm">휴면</Badge>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {n.children.length > 0 && <ul className="org-tree__children">{n.children.map(c => renderOrg(c))}</ul>}
          </div>
        )}
      </li>
    );
  };

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
          title={confirm.kind === 'reset' ? '비밀번호 초기화' : confirm.kind === 'move' ? '소속 옮기기' : confirm.kind === 'delete' ? '사용자 삭제' : '조직 삭제'}
          confirmLabel={busy ? '처리 중...' : confirm.kind === 'reset' ? '초기화' : confirm.kind === 'move' ? '옮기기' : '삭제'}
          onConfirm={() => { void runConfirm(); }} onCancel={() => setConfirm(null)}>
          {confirm.kind === 'reset' && <><b>{confirm.member.name}</b>({confirm.member.employeeNo}) 비밀번호를 새 초기 비밀번호로 바꾸고 슬랙 DM 으로 보낼까요? 지금 비밀번호는 더 이상 쓸 수 없어요.</>}
          {confirm.kind === 'move' && <><b>{confirm.member.name}</b>을(를) {pathOf(confirm.member.teamId)}에서 <b>{pathOf(confirm.team.id)}</b>(으)로 옮길까요? 옮기면 새 조직의 데이터를 보고 쓰게 돼요.</>}
          {confirm.kind === 'delete' && <><b>{confirm.member.name}</b>({confirm.member.employeeNo}) 계정을 삭제할까요? 등록한 집행 기록은 조직에 남아요. 잠시 쉬는 경우라면 휴면을 쓰세요.</>}
          {confirm.kind === 'delete-org' && <><b>{pathOf(confirm.team.id)}</b> 조직을 삭제할까요? 소속 사용자 · 하위 조직 · 이력이 있으면 지울 수 없어요(비활성으로 바꾸세요).</>}
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

          <Card className="card--clip">
            {members === null ? (
              <EmptyState message={loadError ? '목록을 불러오지 못했어요' : '불러오는 중...'} />
            ) : !visible.length ? (
              <EmptyState icon="👤" message="사용자가 없어요" sub={orgFilter || query ? '조직 · 검색 조건을 바꿔 보세요' : '사용자 추가 또는 엑셀로 등록하세요'} />
            ) : isMobile ? (
              /* 모바일: 사번 · 성명 · 직위만, 줄을 누르면 색 표시 + 아래로 상세 · 관리 버튼 */
              <table className="table member-table member-table--m">
                <thead><tr><th>사번</th><th>성명</th><th>직위</th></tr></thead>
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
              </table>
            ) : (
              <TableWrap>
                <table className="table member-table">
                  <thead>
                    <tr>
                      <th>성명</th><th>사번</th><th>소속</th><th>슬랙 DM</th><th>상태</th>{isAdmin && <th>관리자</th>}
                      <th className="t-center">비밀번호</th><th className="t-center">수정</th><th className="t-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(m => {
                      const self = m.id === myId;
                      const editable = canEditMember(m);
                      return (
                        <tr key={m.id} className={cx(!m.active && 'is-dormant')}>
                          <td className="member-table__name">
                            <span className="t-strong">{m.name}</span>{m.position && <span className="t-muted"> {m.position}</span>}
                            {self && <Badge variant="amber" size="sm" className="team-table__me">나</Badge>}
                            {m.mustChangePassword && <Badge variant="gray" size="sm" className="team-table__me" title="초기 비밀번호를 아직 바꾸지 않았어요">초기 비밀번호</Badge>}
                          </td>
                          <td className="t-muted">{m.employeeNo}</td>
                          <td className="member-table__org">{pathOf(m.teamId)}</td>
                          <td title={m.slackError ?? m.email ?? '회사 이메일 없음'}>{slackStatus(m)}</td>
                          <td>{activeBadge(m)}</td>
                          {isAdmin && <td>{adminSwitch(m)}</td>}
                          <td className="t-center">
                            <Btn size="sm" variant="secondary" disabled={!editable || self} title={self ? '내 비밀번호는 내 정보에서 바꾸세요' : undefined}
                              onClick={() => setConfirm({ kind: 'reset', member: m })}>초기화</Btn>
                          </td>
                          <td className="t-center team-table__act">
                            <button type="button" className="icon-btn icon-btn--sm icon-btn--primary" aria-label={`${m.name} 수정`} title="수정"
                              disabled={!editable} onClick={() => openEdit(m)}><IconEdit size={14} /></button>
                          </td>
                          <td className="t-center team-table__act">
                            <button type="button" className="icon-btn icon-btn--sm icon-btn--red" aria-label={`${m.name} 삭제`}
                              title={self ? '내 계정은 삭제할 수 없어요' : '삭제'} disabled={!editable || self}
                              onClick={() => setConfirm({ kind: 'delete', member: m })}><IconTrash size={14} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
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

          <Card className="card--clip">
            {!roots.length ? (
              <EmptyState icon="🏢" message="관리할 수 있는 조직이 없어요" />
            ) : (
              <>
                <div className="org-tree__tools">
                  <p className="org-tree__hint">
                    {showPeople ? (
                      <>
                        <span className="hide-touch">사용자를 끌어 다른 조직에 놓으면 소속이 바뀌어요.</span>
                        <span className="show-touch">소속은 사용자 관리 → 수정에서 바꿀 수 있어요.</span>
                      </>
                    ) : '조직 구조만 보고 있어요. 인원 수는 하위 조직까지 합친 수예요.'}
                  </p>
                  <span className="org-tree__ctrls">
                    <Segmented label="조직 트리 보기 형식" value={showPeople ? 'people' : 'org'} onChange={v => setShowPeople(v === 'people')}
                      options={[{ value: 'people', label: '사용자 포함' }, { value: 'org', label: '조직만' }]} />
                    <span className="chip-row">
                      <FilterChip label={isMobile ? '펼치기' : '모두 펼치기'} active={allOpen} onClick={() => setExpanded(new Set(scopeTeams.map(t => t.id)))} />
                      <FilterChip label={isMobile ? '접기' : '모두 접기'} active={allClosed} onClick={() => setExpanded(new Set())} />
                    </span>
                  </span>
                </div>
                <ul className="org-tree">{roots.map(n => renderOrg(n))}</ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
