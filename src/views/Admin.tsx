import { Fragment, useState, type FormEvent } from 'react';
import type { Team } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { DEFAULT_TEAM_PASSWORD } from '@/data/seed';
import { useToast } from '@/hooks/useToast';
import { Badge, Btn, Card, ConfirmLayer, Input, PageHead, Segmented, Switch, TableWrap, Toast, cx } from '@/components/ui';
import { IconEdit, IconPlus, IconTrash } from '@/components/icons';
import './Pages.css';

type Confirm = { kind: 'reset' | 'delete'; id: string } | null;
/** 모바일 펼침 편집 초안 — 저장을 눌러야 반영 */
type Draft = { id: string; name: string; active: boolean; isAdmin: boolean };

/** 관리자 메뉴 — 팀(사용자) 관리 */
export default function Admin() {
  const { teams, session } = useAppState();
  const dispatch = useDispatch();
  const [toast, showToast] = useToast();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const isSelf = (name: string) => session?.team === name;
  const nameError = (name: string, exceptId?: string) => {
    const n = name.trim();
    if (!n) return '팀명을 입력하세요';
    if (teams.some(t => t.id !== exceptId && t.name === n)) return '이미 등록된 팀명입니다';
    return '';
  };
  const target = confirm && teams.find(t => t.id === confirm.id);

  const addTeam = (e?: FormEvent) => {
    e?.preventDefault();
    if (nameError(newName)) return;
    dispatch({ type: 'ADD_TEAM', name: newName.trim(), password: DEFAULT_TEAM_PASSWORD });
    showToast(`${newName.trim()}이(가) 추가되었습니다. 초기 비밀번호 ${DEFAULT_TEAM_PASSWORD}`);
    setNewName('');
    setAdding(false);
  };
  const saveEdit = (id: string) => {
    if (nameError(editName, id)) return;
    dispatch({ type: 'RENAME_TEAM', id, name: editName.trim() });
    showToast('팀명이 수정되었습니다.');
    setEditId(null);
  };
  // 모바일: [수정] → 아래로 펼쳐 팀명·상태·관리자 권한·삭제를 한 번에 편집
  const openDraft = (t: Team) => setDraft(d => (d?.id === t.id ? null : { id: t.id, name: t.name, active: t.active, isAdmin: !!t.isAdmin }));
  const saveDraft = (t: Team) => {
    if (!draft || nameError(draft.name, t.id)) return;
    const name = draft.name.trim();
    if (name !== t.name) dispatch({ type: 'RENAME_TEAM', id: t.id, name });
    if (draft.active !== t.active) dispatch({ type: 'TOGGLE_TEAM', id: t.id });
    if (draft.isAdmin !== !!t.isAdmin) dispatch({ type: 'SET_TEAM_ADMIN', id: t.id, isAdmin: draft.isAdmin });
    showToast(`${name} 정보가 저장되었습니다.`);
    setDraft(null);
  };
  const askReset = (id: string) => setConfirm({ kind: 'reset', id });

  const runConfirm = () => {
    if (!confirm || !target) return;
    if (confirm.kind === 'reset') {
      dispatch({ type: 'SET_TEAM_PASSWORD', teamName: target.name, password: DEFAULT_TEAM_PASSWORD, by: 'reset' });
      showToast(`${target.name} 비밀번호가 ${DEFAULT_TEAM_PASSWORD}(으)로 초기화되었습니다.`);
    } else {
      dispatch({ type: 'DELETE_TEAM', id: target.id });
      showToast(`${target.name}이(가) 삭제되었습니다.`);
      if (draft?.id === target.id) setDraft(null);
    }
    setConfirm(null);
  };

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead title="관리자"
        actions={<Btn onClick={() => { setAdding(true); setEditId(null); }} disabled={adding}><IconPlus size={14} />사용자 추가</Btn>} />

      {confirm && target && (
        <ConfirmLayer tone={confirm.kind === 'delete' ? 'danger' : 'default'}
          title={confirm.kind === 'reset' ? '비밀번호 초기화' : '팀 삭제'}
          confirmLabel={confirm.kind === 'reset' ? '초기화' : '삭제'} onConfirm={runConfirm} onCancel={() => setConfirm(null)}>
          {confirm.kind === 'reset'
            ? <><b>{target.name}</b> 비밀번호를 <b>{DEFAULT_TEAM_PASSWORD}</b>(으)로 초기화할까요?</>
            : <><b>{target.name}</b>을(를) 삭제할까요? 로그인 목록에서 사라집니다.</>}
        </ConfirmLayer>
      )}

      <Card className="card--clip">
        <TableWrap>
          <table className="table team-table">
            <thead>
              <tr>
                <th className="team-table__no">순번</th><th>팀명</th><th>상태</th><th>관리자 권한</th>
                <th>비밀번호 초기화</th><th className="t-center">수정</th><th className="t-center">삭제</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => {
                const editing = editId === t.id;
                const err = editing ? nameError(editName, t.id) : '';
                const open = draft?.id === t.id;
                const dErr = open ? nameError(draft.name, t.id) : '';
                const self = isSelf(t.name);
                return (
                  <Fragment key={t.id}>
                  <tr className={cx(!t.active && 'is-dormant', open && 'is-open')}>
                    <td className="team-table__no t-muted">{i + 1}</td>
                    <td className="team-table__name">
                      {editing ? (
                        <form className="team-edit" onSubmit={e => { e.preventDefault(); saveEdit(t.id); }}>
                          <Input value={editName} onChange={e => setEditName(e.target.value)} aria-label="팀명" autoFocus
                            aria-invalid={!!err} onKeyDown={e => { if (e.key === 'Escape') setEditId(null); }} />
                          <Btn size="sm" type="submit" disabled={!!err}>저장</Btn>
                          <Btn size="sm" variant="secondary" onClick={() => setEditId(null)}>취소</Btn>
                          {err && editName.trim() && <small className="team-edit__err">{err}</small>}
                        </form>
                      ) : (
                        <span className="t-strong t-nowrap">{t.name}{isSelf(t.name) && <Badge variant="amber" size="sm" className="team-table__me">나</Badge>}</span>
                      )}
                    </td>
                    <td data-label="상태">
                      <Badge variant={t.active ? 'green' : 'gray'} size="lg" pressed={t.active}
                        title={isSelf(t.name) ? '로그인한 팀은 휴면 처리할 수 없습니다' : `${t.active ? '휴면' : '활성'}으로 변경`}
                        disabled={isSelf(t.name) && t.active}
                        onClick={() => { dispatch({ type: 'TOGGLE_TEAM', id: t.id }); showToast(`${t.name}이(가) ${t.active ? '휴면' : '활성'} 처리되었습니다.`); }}>
                        ● {t.active ? '활성' : '휴면'}
                      </Badge>
                    </td>
                    <td data-label="관리자 권한">
                      <Switch checked={!!t.isAdmin} disabled={isSelf(t.name)} label={`${t.name} 관리자 권한`} text={t.isAdmin ? '관리자' : '일반'}
                        title={isSelf(t.name) ? '로그인한 팀의 권한은 변경할 수 없습니다' : undefined}
                        onChange={v => { dispatch({ type: 'SET_TEAM_ADMIN', id: t.id, isAdmin: v }); showToast(`${t.name} 관리자 권한 ${v ? '부여' : '해제'}`); }} />
                    </td>
                    <td data-label="비밀번호">
                      <Btn size="sm" variant="secondary" onClick={() => askReset(t.id)}>초기화</Btn>
                    </td>
                    <td className="t-center team-table__act">
                      <button type="button" className="icon-btn icon-btn--sm icon-btn--primary" title="수정" aria-label={`${t.name} 수정`}
                        onClick={() => { setEditId(t.id); setEditName(t.name); setConfirm(null); }} disabled={editing}>
                        <IconEdit size={14} />
                      </button>
                    </td>
                    <td className="t-center team-table__act">
                      <button type="button" className="icon-btn icon-btn--sm icon-btn--red" aria-label={`${t.name} 삭제`}
                        title={isSelf(t.name) ? '로그인한 팀은 삭제할 수 없습니다' : '삭제'} disabled={isSelf(t.name)}
                        onClick={() => setConfirm({ kind: 'delete', id: t.id })}>
                        <IconTrash size={14} />
                      </button>
                    </td>
                    {/* 모바일 전용: 펼쳐서 편집 */}
                    <td className="team-table__m-edit">
                      <Btn size="sm" variant={open ? 'primary' : 'secondary'} onClick={() => openDraft(t)} aria-expanded={open}>
                        <IconEdit size={13} />수정
                      </Btn>
                    </td>
                  </tr>
                  {open && (
                    <tr className="team-table__panel">
                      <td colSpan={8}>
                        <div className="team-panel fade-in">
                          <label className="team-panel__field">
                            <span className="label">팀명</span>
                            <Input value={draft.name} aria-invalid={!!dErr} onChange={e => setDraft(d => (d ? { ...d, name: e.target.value } : d))} />
                            {dErr && draft.name.trim() && <small className="team-edit__err">{dErr}</small>}
                          </label>
                          <div className="team-panel__row">
                            <span className="label">상태</span>
                            <Segmented label="상태" value={draft.active ? 'on' : 'off'}
                              options={[{ value: 'on', label: '● 활성' }, { value: 'off', label: '휴면' }]}
                              onChange={v => { if (self && v === 'off') return; setDraft(d => (d ? { ...d, active: v === 'on' } : d)); }} />
                          </div>
                          {self && <small className="team-panel__note">로그인한 팀은 휴면·권한 변경·삭제를 할 수 없습니다</small>}
                          <div className="team-panel__row">
                            <span className="label">관리자 권한</span>
                            <Switch checked={draft.isAdmin} disabled={self} label={`${t.name} 관리자 권한`} text={draft.isAdmin ? '관리자' : '일반'}
                              onChange={v => setDraft(d => (d ? { ...d, isAdmin: v } : d))} />
                          </div>
                          <div className="team-panel__actions">
                            <Btn size="sm" variant="danger" disabled={self} onClick={() => setConfirm({ kind: 'delete', id: t.id })}>
                              <IconTrash size={13} />삭제
                            </Btn>
                            <div className="row">
                              <Btn size="sm" variant="secondary" onClick={() => setDraft(null)}>취소</Btn>
                              <Btn size="sm" onClick={() => saveDraft(t)} disabled={!!dErr}>저장</Btn>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}

              {adding && (
                <tr className="team-table__new">
                  <td className="team-table__no t-muted">{teams.length + 1}</td>
                  <td colSpan={6}>
                    <form className="team-edit" onSubmit={addTeam}>
                      <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="팀명 입력" aria-label="새 팀명" autoFocus
                        onKeyDown={e => { if (e.key === 'Escape') setAdding(false); }} />
                      <Btn size="sm" type="submit" disabled={!!nameError(newName)}>추가</Btn>
                      <Btn size="sm" variant="secondary" onClick={() => { setAdding(false); setNewName(''); }}>취소</Btn>
                      <small className={cx('team-edit__hint', newName.trim() && nameError(newName) && 'is-err')}>
                        {newName.trim() && nameError(newName) ? nameError(newName) : `초기 비밀번호 ${DEFAULT_TEAM_PASSWORD} · 활성 · 일반 권한으로 추가됩니다`}
                      </small>
                    </form>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
