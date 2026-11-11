import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Team } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { MIN_PASSWORD_LENGTH, passwordError } from '@/lib/password';
import { getLastTeam, getRemember, saveLoginPrefs } from '@/lib/remember';
import { holdLightTheme } from '@/lib/theme';
import { REMOTE_AUTH } from '@/lib/supabase';
import {
  AuthApiError, changePassword, importMembers, listTeams, manageableTeamIds, myMember, needsSetup, signIn, signOut,
  type ImportResult, type ImportRow,
} from '@/lib/authApi';
import { readMemberSheet, unitPath } from '@/lib/memberSheet';
import { IconEye } from '@/components/icons';
import { Select } from '@/components/ui';
import ImportResults from '@/components/ImportResults';
import kowokIcon from '@/assets/kowok-icon.png';
import wave from '@/assets/login/wave.svg';
import featureIcon from '@/assets/login/feature-icon.svg';
import budgetRing from '@/assets/login/budget-ring.svg';
import budgetCircle from '@/assets/login/budget-circle.svg';
import accentCircle from '@/assets/login/accent-circle.svg';
import chevronDown from '@/assets/login/chevron-down.svg';
import chevronDownM from '@/assets/login/m-chevron-down.svg';
import eyeOff from '@/assets/login/eye-off.svg';
import eyeOffM from '@/assets/login/m-eye-off.svg';
import check from '@/assets/login/check.svg';
import circleLeftM from '@/assets/login/m-circle-left.svg';
import circleRightM from '@/assets/login/m-circle-right.svg';
import './Login.css';

/** 데스크탑/모바일 디자인의 색이 다른 아이콘 — 미디어 쿼리로 하나만 노출 */
function DualIcon({ desk, mob }: { desk: string; mob: string }) {
  return (
    <>
      <img src={desk} alt="" width={18} height={18} className="lg-only-desk" />
      <img src={mob} alt="" width={18} height={18} className="lg-only-mob" />
    </>
  );
}

/** 비밀번호 입력칸 (보기 토글 포함) — 로그인 화면 디자인 */
function LgPassword({ id, label, value, onChange, placeholder, autoComplete, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string;
  autoComplete: 'current-password' | 'new-password'; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="lg-field">
      <label htmlFor={id}>{label}{hint && <span className="lg-field__hint"> · {hint}</span>}</label>
      <div className="lg-input">
        <input id={id} type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
          autoComplete={autoComplete} onChange={e => onChange(e.target.value)} />
        <button type="button" className="lg-input__icon lg-input__toggle" onClick={() => setShow(v => !v)}
          aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={show}>
          {show ? <IconEye size={18} /> : <DualIcon desk={eyeOff} mob={eyeOffM} />}
        </button>
      </div>
    </div>
  );
}

/**
 * 로그인 화면.
 * Supabase: 사번 + 비밀번호 (1인 1계정). 초기 비밀번호(가입 · 초기화 때 슬랙 DM 으로 받은 8자)로 로그인하면
 * '비밀번호 변경' 단계를 거쳐야 앱에 진입. 사용자가 없으면 '처음 시작하기' 에서 사용자 엑셀로 첫 등록.
 * 브라우저 저장본(Supabase 없음): 예전처럼 팀 선택 + 팀 비밀번호.
 * pendingName: 이미 로그인된 세션이 초기 비밀번호 상태인 경우(App 에서 전달) 변경 단계부터 시작.
 */
export default function Login({ pendingName }: { pendingName?: string } = {}) {
  const { teams } = useAppState();
  const dispatch = useDispatch();

  // ── Supabase: 첫 설치 여부 ──
  const [remote, setRemote] = useState<{ setup: boolean } | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const loadRemote = () => {
    setRemoteError('');
    needsSetup()
      .then(setup => setRemote({ setup }))
      .catch((e: unknown) => setRemoteError(e instanceof AuthApiError ? e.message : '서버에 연결할 수 없습니다.'));
  };
  useEffect(() => { if (REMOTE_AUTH) loadRemote(); }, []);
  const activeTeams = REMOTE_AUTH ? [] : teams.filter(t => t.active).map(t => t.name);
  const needSetup = REMOTE_AUTH ? !!remote?.setup : teams.length === 0;

  // 아이디: Supabase = 사번 입력, 브라우저 저장본 = 팀 선택 (마지막 로그인 값 기억)
  const [loginId, setLoginId] = useState(() => (REMOTE_AUTH ? getLastTeam() ?? '' : ''));
  useEffect(() => {
    if (REMOTE_AUTH || activeTeams.includes(loginId)) return;
    const last = getLastTeam();
    setLoginId(activeTeams.find(n => n === last) ?? activeTeams[0] ?? '');
  }, [activeTeams.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(getRemember);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  // 로그인 화면은 Figma 라이트 전용 디자인(고정 색 일러스트) — 다크 모드에서도 라이트로 보임
  useEffect(() => holdLightTheme(), []);

  const errText = (e: unknown) => (e instanceof AuthApiError || e instanceof Error ? e.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');

  /** Supabase 로그인 완료 — 조직 목록 · 내 정보 · 관리 권한으로 세션 시작 */
  const enterRemote = async () => {
    const me = await myMember();
    if (!me) throw new AuthApiError('not_member', '사용자 정보를 불러오지 못했습니다.');
    const [list, manage] = await Promise.all([listTeams(), manageableTeamIds()]);
    dispatch({ type: 'SYNC_TEAMS', teams: list });
    saveLoginPrefs(remember, me.member.employeeNo);
    dispatch({ type: 'LOGIN', session: { team: me.team.name, isAdmin: me.isAdmin, canManage: manage.length > 0, member: me.member } });
  };
  /** 브라우저 저장본 로그인 완료 */
  const enterLocal = (me: Team) => {
    saveLoginPrefs(remember, me.name);
    dispatch({ type: 'LOGIN', session: { team: me.name, isAdmin: !!me.isAdmin } });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    if (REMOTE_AUTH && !loginId.trim()) { setError('사번을 입력하세요.'); return; }
    if (!password) { setError('비밀번호를 입력하세요.'); return; }
    setLoading(true);
    try {
      if (REMOTE_AUTH) {
        await signIn(loginId, password);
        const me = await myMember();
        if (!me || !me.active) { await signOut(); setError('로그인할 수 없는 계정입니다. 관리자에게 문의하세요.'); return; }
        if (me.member.mustChangePassword) { tempPw.current = password; setPassword(''); setError(''); setChangeFor(me.member.name); return; }
        await enterRemote();
        return;
      }
      // 브라우저 저장본 로그인 — 짧은 지연으로 흐름만 재현
      await new Promise(r => window.setTimeout(r, 300));
      const found = teams.find(t => t.active && t.name === loginId && t.password === password);
      if (!found) { setError('팀 또는 비밀번호가 일치하지 않습니다.'); return; }
      if (found.mustChangePassword) { setPassword(''); setError(''); setChangeFor(found.name); return; }
      enterLocal(found);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  // ── 초기 비밀번호 변경 단계 ──
  const [changeFor, setChangeFor] = useState(pendingName ?? '');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  // 방금 로그인에 쓴 초기 비밀번호 (Supabase 변경 요청에 필요) — 새로고침 등으로 없으면 입력칸을 보여 줌
  const tempPw = useRef('');
  const [curInput, setCurInput] = useState('');
  const localChangeTeam = !REMOTE_AUTH && changeFor ? teams.find(t => t.name === changeFor) : undefined;
  const askCurrent = REMOTE_AUTH && !tempPw.current;

  const submitChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!changeFor || loading) return;
    if (!REMOTE_AUTH) {
      if (!localChangeTeam) return;
      // 임시 비밀번호를 그대로 다시 쓰는 것도 막음
      const err = passwordError(next, next2, localChangeTeam.password);
      if (err) { setError(err); return; }
      dispatch({ type: 'SET_TEAM_PASSWORD', teamName: localChangeTeam.name, password: next, by: 'self' });
      enterLocal(localChangeTeam);
      return;
    }
    const current = tempPw.current || curInput;
    if (!current) { setError('슬랙 DM 으로 받은 초기 비밀번호를 입력하세요.'); return; }
    const err = passwordError(next, next2, current);
    if (err) { setError(err); return; }
    setLoading(true);
    try {
      await changePassword(current, next);
      tempPw.current = '';
      await enterRemote();
    } catch (err) {
      setError(err instanceof AuthApiError && err.code === 'wrong_password' ? '초기 비밀번호가 일치하지 않습니다.' : errText(err));
    } finally {
      setLoading(false);
    }
  };
  // 변경하지 않고 돌아가기 = 로그인 취소 (세션이 있었다면 로그아웃)
  const cancelChange = () => {
    setChangeFor(''); setNext(''); setNext2(''); setCurInput(''); setError(''); tempPw.current = '';
    if (REMOTE_AUTH) void signOut();
    if (pendingName) dispatch({ type: 'LOGOUT' });
  };
  const editChange = (fn: (v: string) => void) => (v: string) => { fn(v); setError(''); };

  // ── 처음 시작하기 ──
  // 브라우저 저장본: 첫 관리자 팀 만들기
  const submitSetup = (e: FormEvent) => {
    e.preventDefault();
    const name = setupName.trim();
    if (!name) return setError('관리자 팀 이름을 입력하세요.');
    const err = passwordError(setupPassword, setupConfirm);
    if (err) return setError(err);
    dispatch({ type: 'INITIALIZE', name, password: setupPassword });
  };
  // Supabase: 사용자 엑셀로 첫 사용자 등록 → 각자 슬랙 DM 으로 초기 비밀번호
  const [sheet, setSheet] = useState<{ file: string; rows: ImportRow[]; problems: string[] } | null>(null);
  const [imported, setImported] = useState<ImportResult[] | null>(null);
  const pickSheet = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setSheet(null);
    try {
      const r = await readMemberSheet(file);
      setSheet({ file: file.name, ...r });
    } catch (err) {
      setError(errText(err));
    }
  };
  const submitImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!sheet || loading) return;
    if (sheet.problems.length) return setError('엑셀의 빈 칸을 고친 뒤 다시 올리세요.');
    if (!sheet.rows.some(r => r.isAdmin)) return setError('관리자 여부 열에 관리자를 1명 이상 지정하세요.');
    setLoading(true);
    try {
      const r = await importMembers(sheet.rows);
      setImported(r.results);
    } catch (err) {
      if (err instanceof AuthApiError && (err.code === 'unauthorized' || err.code === 'forbidden')) loadRemote(); // 그사이 누군가 먼저 등록
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };
  const finishImport = () => { setImported(null); setSheet(null); loadRemote(); };

  return (
    <div className="lg">
      {/* ── 데스크탑: 좌측 프로젝트 소개 ── */}
      <aside className="lg-intro" aria-label="코웍-코인 소개">
        <img src={budgetRing} alt="" width={160} height={160} className="lg-intro__ring" />
        <img src={budgetCircle} alt="" width={330} height={330} className="lg-intro__circle" />
        <img src={accentCircle} alt="" width={150} height={150} className="lg-intro__accent" />
        <div className="lg-intro__wave" aria-hidden="true">
          <img src={wave} alt="" width={2001} height={582} />
        </div>

        <div className="lg-intro__content">
          <div className="lg-brand">
            <span className="lg-brand__logo"><img src={kowokIcon} alt="" width={68} height={68} /></span>
            <div className="lg-brand__names">
              <strong>코웍-코인</strong>
              <span>Cowork-Coin</span>
            </div>
          </div>

          <div className="lg-hero">
            <h2 className="lg-hero__title">프로젝트는<br />함께할 때 더 맛있으니까!</h2>
            <p className="lg-hero__desc">코웍의 프로젝트 경비를 편리하게 관리하세요.</p>
          </div>

          <div className="lg-note">
            <div className="lg-feature">
              <img src={featureIcon} alt="" width={42} height={42} />
              <div>
                <strong>프로젝트 예산</strong>
                <span>모두가 같은 숫자를 봅니다</span>
              </div>
            </div>
            <hr className="lg-note__divider" />
            <dl className="lg-values">
              <div><dt>계획</dt><dd>함께</dd></div>
              <div><dt>기록</dt><dd>명확하게</dd></div>
            </dl>
          </div>

          <p className="lg-intro__wordmark">COWORK-COIN</p>
        </div>
      </aside>

      {/* ── 로그인 패널 (모바일: 상단 브랜드 + 하단 시트) ── */}
      <main className="lg-panel">
        <div className="lg-mhead">
          <img src={circleLeftM} alt="" width={132} height={132} className="lg-mhead__circle-l" />
          <img src={circleRightM} alt="" width={230} height={230} className="lg-mhead__circle-r" />
          <div className="lg-mbrand">
            <span className="lg-mbrand__logo"><img src={kowokIcon} alt="" width={96} height={96} /></span>
            <strong>코웍-코인</strong>
            <span>Cowork-Coin</span>
          </div>
        </div>

        <div className="lg-sheet">
          {changeFor ? (
          <form key="change" className="lg-form view-enter" onSubmit={submitChange} noValidate>
            <div className="lg-welcome">
              <h1>비밀번호 변경</h1>
              <p>
                <b className="lg-welcome__team">{changeFor}</b>
                <span className="lg-only-desk">{REMOTE_AUTH ? '님은 초기 비밀번호로 로그인했어요.' : '은(는) 임시 비밀번호로 로그인했어요.'} 안전을 위해 새 비밀번호로 바꾼 뒤 시작합니다.</span>
                <span className="lg-only-mob">{REMOTE_AUTH ? '님은 초기 비밀번호로 로그인했어요.' : '은(는) 임시 비밀번호로 로그인했어요.'}<br />새 비밀번호로 바꾼 뒤 시작합니다.</span>
              </p>
            </div>

            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}

            <input type="text" name="username" value={REMOTE_AUTH ? loginId : changeFor} autoComplete="username" readOnly hidden />
            <div className="lg-fields">
              {askCurrent && (
                <LgPassword id="login-pw-temp" label="초기 비밀번호" value={curInput} onChange={editChange(setCurInput)}
                  placeholder="슬랙 DM 으로 받은 초기 비밀번호" autoComplete="current-password" />
              )}
              <LgPassword id="login-pw-new" label="새 비밀번호" hint={`${MIN_PASSWORD_LENGTH}자 이상`} value={next} onChange={editChange(setNext)}
                placeholder="새 비밀번호를 입력하세요" autoComplete="new-password" />
              <LgPassword id="login-pw-new2" label="새 비밀번호 확인" value={next2} onChange={editChange(setNext2)}
                placeholder="한 번 더 입력하세요" autoComplete="new-password" />
            </div>

            <button type="submit" className="lg-submit" disabled={loading}>{loading ? '변경 중...' : '변경하고 시작하기'}</button>

            <hr className="lg-divider" />
            <p className="lg-recovery">
              바꾼 비밀번호는 오른쪽 위 이름 메뉴 › 비밀번호 변경에서 다시 바꿀 수 있어요.{' '}
              <button type="button" className="lg-link" onClick={cancelChange}>{REMOTE_AUTH ? '다른 사번으로 로그인' : '다른 팀으로 로그인'}</button>
            </p>
          </form>
          ) : needSetup && REMOTE_AUTH ? (
          <form key="import" className="lg-form view-enter" onSubmit={submitImport} noValidate>
            <div className="lg-welcome">
              <h1>처음 시작하기</h1>
              <p>사용자 엑셀을 올리면 조직과 계정을 만들고, 각자 슬랙 DM 으로 초기 비밀번호를 보내요.</p>
            </div>
            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}
            {imported ? (
              <>
                <ImportResults results={imported} />
                <button type="button" className="lg-submit" onClick={finishImport}>로그인하러 가기</button>
              </>
            ) : (
              <>
                <div className="lg-field">
                  <label htmlFor="setup-file">사용자 엑셀 (.xlsx)<span className="lg-field__hint"> · 본부 · 부서 · 파트 · 사원번호 · 성명 · 직위 · 이메일 · 관리자 여부</span></label>
                  <input id="setup-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => { void pickSheet(e); }} />
                </div>
                {sheet && (
                  <div className="import-preview">
                    <b>{sheet.file}</b> · {sheet.rows.length}명 · 관리자 {sheet.rows.filter(r => r.isAdmin).length}명
                    <ul>
                      {sheet.rows.slice(0, 8).map(r => <li key={r.employeeNo}>{r.name} ({r.employeeNo}) · {unitPath(r)}{r.isAdmin ? ' · 관리자' : ''}</li>)}
                      {sheet.rows.length > 8 && <li>… 외 {sheet.rows.length - 8}명</li>}
                    </ul>
                    {sheet.problems.length > 0 && <ul className="import-preview__problems">{sheet.problems.map(p => <li key={p}>{p}</li>)}</ul>}
                  </div>
                )}
                <button type="submit" className="lg-submit" disabled={loading || !sheet || !sheet.rows.length}>{loading ? '등록 중...' : '등록하고 DM 보내기'}</button>
              </>
            )}
          </form>
          ) : needSetup ? (
          <form key="setup" className="lg-form view-enter" onSubmit={submitSetup} noValidate>
            <div className="lg-welcome">
              <h1>처음 시작하기</h1>
              <p>첫 관리자 팀을 등록하세요. 데이터는 이 브라우저에 저장됩니다.</p>
            </div>
            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}
            <div className="lg-fields">
              <div className="lg-field">
                <label htmlFor="setup-name">관리자 팀 이름</label>
                <div className="lg-input">
                  <input id="setup-name" value={setupName} onChange={e => { setSetupName(e.target.value); setError(''); }} placeholder="팀 이름" autoComplete="organization" />
                </div>
              </div>
              <LgPassword id="setup-password" label="비밀번호" hint={`${MIN_PASSWORD_LENGTH}자 이상`} value={setupPassword} onChange={editChange(setSetupPassword)} placeholder="비밀번호를 입력하세요" autoComplete="new-password" />
              <LgPassword id="setup-confirm" label="비밀번호 확인" value={setupConfirm} onChange={editChange(setSetupConfirm)} placeholder="한 번 더 입력하세요" autoComplete="new-password" />
            </div>
            <button type="submit" className="lg-submit">관리자 팀 만들기</button>
          </form>
          ) : (
          <form key="login" className="lg-form view-enter" onSubmit={submit} noValidate>
            <div className="lg-welcome">
              <h1>
                <span className="lg-only-desk">캬아! 만나 반가워요!</span>
                <span className="lg-only-mob">로그인</span>
              </h1>
              <p>
                <span className="lg-only-desk">코웍-코인에 로그인해 오늘도 맛있게 이어가세요.</span>
                <span className="lg-only-mob">{REMOTE_AUTH ? '사번과 비밀번호를 입력하세요' : '소속 팀을 선택하고 비밀번호를 입력하세요'}</span>
              </p>
            </div>

            {(error || remoteError) && (
              <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error || remoteError}
                {remoteError && !error && <button type="button" className="lg-link" onClick={loadRemote}>다시 시도</button>}</div>
            )}

            <div className="lg-fields">
              {REMOTE_AUTH ? (
                <div className="lg-field">
                  <label htmlFor="login-id">사번</label>
                  <div className="lg-input">
                    <input id="login-id" value={loginId} placeholder="사번을 입력하세요" inputMode="numeric" autoComplete="username"
                      onChange={e => { setLoginId(e.target.value.trim()); setError(''); }} />
                  </div>
                </div>
              ) : (
                <div className="lg-field">
                  <label htmlFor="login-team">팀 선택</label>
                  <div className="lg-input">
                    <Select bare hideChevron id="login-team" className="lg-select" value={loginId} onChange={e => { setLoginId(e.target.value); setError(''); }}>
                      {activeTeams.map(n => <option key={n} value={n}>{n}</option>)}
                    </Select>
                    <span className="lg-input__icon" aria-hidden="true"><DualIcon desk={chevronDown} mob={chevronDownM} /></span>
                  </div>
                </div>
              )}

              <div className="lg-field">
                <label htmlFor="login-pw">비밀번호</label>
                <div className="lg-input">
                  <input id="login-pw" type={showPw ? 'text' : 'password'} value={password} placeholder="비밀번호를 입력하세요"
                    autoComplete="current-password" onChange={e => { setPassword(e.target.value); setError(''); }} />
                  <button type="button" className="lg-input__icon lg-input__toggle" onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={showPw}>
                    {showPw ? <IconEye size={18} /> : <DualIcon desk={eyeOff} mob={eyeOffM} />}
                  </button>
                </div>
              </div>
            </div>

            <label className="lg-remember">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span className="lg-remember__box" aria-hidden="true"><img src={check} alt="" width={12} height={12} /></span>
              로그인 정보 저장
            </label>

            <button type="submit" className="lg-submit" disabled={loading || (REMOTE_AUTH && !remote)}>
              {loading ? '확인 중...' : REMOTE_AUTH && !remote && !remoteError ? '불러오는 중...' : '로그인'}
            </button>

            <hr className="lg-divider" />
            <p className="lg-recovery">비밀번호를 잊으셨나요? {REMOTE_AUTH ? '부서장 또는 관리자에게 초기화를 요청하면 슬랙 DM 으로 새 비밀번호가 와요.' : '관리자에게 초기화를 요청하세요.'}</p>

          </form>
          )}
        </div>
      </main>
    </div>
  );
}
