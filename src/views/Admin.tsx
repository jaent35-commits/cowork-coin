import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Team, UnitLevel } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import {
  AuthApiError, createMember, deleteMember, importMembers, listMembers, listTeams, manageableTeamIds, removeTeam,
  resetMemberPassword, saveTeam, updateMember, type ImportResult, type ImportRow, type MemberAdminRow,
} from '@/lib/authApi';
import { readMemberSheet, unitPath } from '@/lib/memberSheet';
import { useToast } from '@/hooks/useToast';
import { Alert, Badge, Btn, Card, ConfirmLayer, EmptyState, Field, Input, PageHead, Switch, TableWrap, Toast, cx } from '@/components/ui';
import { Select } from '@/components/ui/SelectBox';
import { IconEdit, IconPlus, IconTrash } from '@/components/icons';
import ImportResults from '@/components/ImportResults';
import './Pages.css';

type Tab = 'members' | 'orgs';
/** 사용자 추가 · 수정 폼 (id 가 있으면 수정) */
type MemberDraft = { id?: string; employeeNo: string; name: string; position: string; email: string; teamId: string; isAdmin: boolean };
type OrgDraft = { id?: string; name: string; level: UnitLevel; parentId?: string; active: boolean };
type Confirm =
  | { kind: 'reset' | 'delete'; member: MemberAdminRow }
  | { kind: 'delete-org'; team: Team }
  | null;
/** DM 을 못 보내 화면에 한 번 보여 주는 초기 비밀번호 */
type Issued = { name: string; password: string } | null;

const LEVELS: UnitLevel[] = ['본부', '부서', '파트'];
const CHILD_LEVEL: Partial<Record<UnitLevel, UnitLevel>> = { 본부: '부서', 부서: '파트' };
const errMsg = (e: unknown, fallback = '처리하지 못했습니다. 잠시 후 다시 시도하세요.') => (e instanceof AuthApiError ? e.message : fallback);

/**
 * 사용자 관리 (Supabase 로그인) — 사용자(1인 1계정) · 조직(본부 › 부서 › 파트)
 *   관리자: 전체 · 관리자 지정
 *   부서장 이상(소속이 본부 · 부서): 내 조직 아래 사용자 등록 · 수정 · 초기화 · 삭제, 내 조직 아래 부서의 파트 추가 · 수정 · 삭제
 *   권한 확인은 서버(DB 함수 · Edge Function)가 다시 함 — 화면은 할 수 있는 것만 보여 줌
 */
export default function Admin() {
  const { teams, session } = useAppState();
  const dispatch = useDispatch();
  const [toast, showToast] = useToast(3500);
  const isAdmin = !!session?.isAdmin;
  const myId = session?.member?.id;

  const [tab, setTab] = useState<Tab>('members');
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
  const pathOf = useCallback((id?: string) => {
    const names: string[] = [];
    for (let t = id ? byId.get(id) : undefined, n = 0; t && n < 5; t = t.parentId ? byId.get(t.parentId) : undefined, n++) names.unshift(t.name);
    return names.join(' › ');
  }, [byId]);
  /** 본부 › 부서 › 파트 순서로 펼친 조직 (관리 범위만) */
  const tree = useMemo(() => {
    const out: { team: Team; depth: number }[] = [];
    const walk = (parent: string | undefined, depth: number) => {
      teams.filter(t => t.parentId === parent).sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(t => {
        if (scope.has(t.id)) out.push({ team: t, depth });
        walk(t.id, depth + 1);
      });
    };
    walk(undefined, 0);
    // 상위가 목록에 없는(관리 범위 밖) 조직의 들여쓰기 맞춤
    const minDepth = Math.min(...out.map(o => o.depth));
    return out.map(o => ({ ...o, depth: o.depth - (Number.isFinite(minDepth) ? minDepth : 0) }));
  }, [teams, scope]);
  const scopeTeams = tree.map(o => o.team);
  const memberCount = (teamId: string) => members?.filter(m => m.teamId === teamId).length ?? 0;
  /** 이 조직을 내가 바꿀 수 있는지 — 관리자: 전부, 부서장 이상: 관리 범위의 파트 */
  const canEditOrg = (t: Team) => isAdmin || (scope.has(t.id) && t.level === '파트');
  /** 이 조직 아래 하위 조직을 만들 수 있는지 — 관리자: 본부 · 부서 아래, 부서장 이상: 관리 범위의 부서 아래 파트 */
  const canAddChild = (t: Team) => !!CHILD_LEVEL[t.level ?? '파트'] && (isAdmin || (scope.has(t.id) && t.level === '부서'));

  // ── 사용자 ──
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => (members ?? [])
    .filter(m => scope.has(m.teamId) || m.id === myId)
    .filter(m => !filter || m.teamId === filter)
    .filter(m => !query.trim() || [m.name, m.employeeNo, m.position ?? '', m.email ?? ''].some(v => v.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => pathOf(a.teamId).localeCompare(pathOf(b.teamId), 'ko') || a.name.localeCompare(b.name, 'ko')),
  [members, scope, filter, query, myId, pathOf]);
  /** 이 사용자를 내가 바꿀 수 있는지 — 관리자 계정은 관리자만 */
  const canEditMember = (m: MemberAdminRow) => isAdmin || (scope.has(m.teamId) && !m.isAdmin);

  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [issued, setIssued] = useState<Issued>(null);

  const openNew = () => setDraft({ employeeNo: '', name: '', position: '', email: '', teamId: filter || scopeTeams[0]?.id || '', isAdmin: false });
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

  // ── 엑셀 일괄 등록 ──
  const [sheet, setSheet] = useState<{ file: string; rows: ImportRow[]; problems: string[] } | null>(null);
  const [imported, setImported] = useState<ImportResult[] | null>(null);
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
  const runImport = async () => {
    if (!sheet || !sheet.rows.length) return;
    const rows = isAdmin ? sheet.rows : sheet.rows.map(r => ({ ...r, isAdmin: false }));
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

  const teamOptions = scopeTeams.map(t => <option key={t.id} value={t.id}>{pathOf(t.id)}</option>);

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead title="사용자 관리"
        actions={tab === 'members'
          ? <>
              <label className={cx('btn btn--secondary', (busy || !scopeTeams.length) && 'is-disabled')}>
                엑셀로 등록
                <input type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy || !scopeTeams.length} onChange={e => { void pickSheet(e); }} />
              </label>
              <Btn onClick={openNew} disabled={!!draft || !scopeTeams.length}><IconPlus size={14} />사용자 추가</Btn>
            </>
          : isAdmin && <Btn onClick={() => setOrg({ name: '', level: '본부', active: true })} disabled={!!org}><IconPlus size={14} />본부 추가</Btn>} />

      <div className="pill-tabs" role="tablist">
        {([['members', '사용자'], ['orgs', '조직']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx('pill-tabs__tab', tab === k && 'is-active')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {loadError && <div className="mb-14"><Alert variant="danger">{loadError} <button type="button" className="text-link" onClick={() => { void reload(); }}>다시 시도</button></Alert></div>}
      {!isAdmin && (
        <div className="mb-14"><Alert variant="info">내 조직({pathOf(session?.member ? teams.find(t => t.name === session.team)?.id : undefined) || session?.team}) 아래의 사용자와 파트를 관리할 수 있어요. 본부 · 부서 조직과 관리자 지정은 관리자만 바꿀 수 있어요.</Alert></div>
      )}

      {/* 확인 창 */}
      {confirm && (
        <ConfirmLayer tone={confirm.kind === 'reset' ? 'default' : 'danger'}
          title={confirm.kind === 'reset' ? '비밀번호 초기화' : confirm.kind === 'delete' ? '사용자 삭제' : '조직 삭제'}
          confirmLabel={busy ? '처리 중...' : confirm.kind === 'reset' ? '초기화' : '삭제'} onConfirm={() => { void runConfirm(); }} onCancel={() => setConfirm(null)}>
          {confirm.kind === 'reset' && <><b>{confirm.member.name}</b>({confirm.member.employeeNo}) 비밀번호를 새 초기 비밀번호로 바꾸고 슬랙 DM 으로 보낼까요? 지금 비밀번호는 더 이상 쓸 수 없어요.</>}
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

      {tab === 'members' && (
        <>
          {/* 엑셀 미리보기 · 결과 */}
          {sheet && (
            <Card pad className="mb-16">
              <h2 className="card-title">엑셀로 등록 — {sheet.file}</h2>
              <div className="import-preview">
                {sheet.rows.length}명{isAdmin && ` · 관리자 ${sheet.rows.filter(r => r.isAdmin).length}명`}
                <ul>
                  {sheet.rows.slice(0, 10).map(r => <li key={r.employeeNo}>{r.name} ({r.employeeNo}) · {unitPath(r)}{isAdmin && r.isAdmin ? ' · 관리자' : ''}</li>)}
                  {sheet.rows.length > 10 && <li>… 외 {sheet.rows.length - 10}명</li>}
                </ul>
                {sheet.problems.length > 0 && <ul className="import-preview__problems">{sheet.problems.map(p => <li key={p}>{p}</li>)}</ul>}
              </div>
              <p className="form-note">이미 있는 사번은 건너뛰어요. 없는 조직은 새로 만들어요{isAdmin ? '' : ' (내 조직 아래 부서의 파트만)'}. 새 사용자에게는 슬랙 DM 으로 사번과 초기 비밀번호를 보내요.</p>
              <div className="row row--end">
                <Btn variant="secondary" onClick={() => setSheet(null)}>취소</Btn>
                <Btn onClick={() => { void runImport(); }} disabled={busy || !sheet.rows.length || sheet.problems.length > 0}>{busy ? '등록 중...' : `${sheet.rows.length}명 등록`}</Btn>
              </div>
            </Card>
          )}
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
            <Select value={filter} onChange={e => setFilter(e.target.value)} aria-label="조직으로 거르기">
              <option value="">전체 조직</option>
              {teamOptions}
            </Select>
            <Input value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery('')} placeholder="성명 · 사번 · 이메일 검색" aria-label="사용자 검색" />
          </div>

          <Card className="card--clip">
            {members === null ? (
              <EmptyState message={loadError ? '목록을 불러오지 못했어요' : '불러오는 중...'} />
            ) : !visible.length ? (
              <EmptyState icon="👤" message="사용자가 없어요" sub="사용자 추가 또는 엑셀로 등록하세요" />
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
                          <td title={m.slackError ?? m.email ?? '회사 이메일 없음'}>
                            {!m.email ? <span className="t-muted">이메일 없음</span>
                              : m.slackLinked === true ? <Badge variant="green" size="sm">연결됨</Badge>
                              : m.slackLinked === false ? <Badge variant="red" size="sm">실패</Badge>
                              : <span className="t-muted">보낸 적 없음</span>}
                          </td>
                          <td>
                            <Badge variant={m.active ? 'green' : 'gray'} size="lg" pressed={m.active} disabled={!editable || self || busy}
                              title={self ? '내 계정은 휴면으로 바꿀 수 없어요' : `${m.active ? '휴면' : '활성'}으로 변경`}
                              onClick={() => { void setActive(m, !m.active); }}>
                              ● {m.active ? '활성' : '휴면'}
                            </Badge>
                          </td>
                          {isAdmin && (
                            <td>
                              <Switch checked={m.isAdmin} disabled={self || busy} label={`${m.name} 관리자 권한`} text={m.isAdmin ? '관리자' : '일반'}
                                title={self ? '내 권한은 바꿀 수 없어요' : undefined} onChange={v => { void setAdmin(m, v); }} />
                            </td>
                          )}
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

      {tab === 'orgs' && (
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
                      {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </Select>
                  </Field>
                )}
                {isAdmin && org.id && org.level !== '본부' && (
                  <Field label="상위 조직" htmlFor="of-parent">
                    <Select id="of-parent" value={org.parentId ?? ''} onChange={e => setOrg(o => o && { ...o, parentId: e.target.value || undefined })}>
                      {teams.filter(t => t.id !== org.id && LEVELS.indexOf(t.level ?? '파트') < LEVELS.indexOf(org.level))
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
            {!tree.length ? (
              <EmptyState icon="🏢" message="관리할 수 있는 조직이 없어요" />
            ) : (
              <ul className="org-tree">
                {tree.map(({ team: t, depth }) => (
                  <li key={t.id} className={cx('org-tree__row', !t.active && 'is-dormant')} style={{ paddingLeft: 16 + depth * 22 }}>
                    <Badge variant={t.level === '본부' ? 'blue' : t.level === '부서' ? 'amber' : 'gray'} size="sm">{t.level ?? '조직'}</Badge>
                    <span className="org-tree__name">{t.name}</span>
                    <span className="t-muted org-tree__count">{memberCount(t.id)}명{!t.active && ' · 비활성'}</span>
                    <span className="org-tree__acts">
                      {canAddChild(t) && (
                        <Btn size="sm" variant="secondary" disabled={!!org} onClick={() => setOrg({ name: '', level: CHILD_LEVEL[t.level ?? '파트']!, parentId: t.id, active: true })}>
                          <IconPlus size={12} />{CHILD_LEVEL[t.level ?? '파트']}
                        </Btn>
                      )}
                      {canEditOrg(t) && (
                        <>
                          <button type="button" className="icon-btn icon-btn--sm icon-btn--primary" aria-label={`${t.name} 수정`} title="수정" disabled={!!org}
                            onClick={() => setOrg({ id: t.id, name: t.name, level: t.level ?? '파트', parentId: t.parentId, active: t.active })}><IconEdit size={14} /></button>
                          <button type="button" className="icon-btn icon-btn--sm icon-btn--red" aria-label={`${t.name} 삭제`} title="삭제"
                            onClick={() => setConfirm({ kind: 'delete-org', team: t })}><IconTrash size={14} /></button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
