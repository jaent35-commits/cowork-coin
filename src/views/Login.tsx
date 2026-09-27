import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Team } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { MIN_PASSWORD_LENGTH, passwordError } from '@/lib/password';
import { getLastTeam, getRemember, saveLoginPrefs } from '@/lib/remember';
import { holdLightTheme } from '@/lib/theme';
import { REMOTE_AUTH } from '@/lib/supabase';
import { AuthApiError, bootstrapAdmin, changePassword, listTeams, loginTeams, myTeam, needsSetup, signIn, signOut, type LoginTeam } from '@/lib/authApi';
import { IconEye } from '@/components/icons';
import { Select } from '@/components/ui';
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
 * 임시 비밀번호(팀 추가·관리자 초기화 때 관리자가 받은 8자, mustChangePassword)로 로그인하면 바로 들어가지 않고
 * '비밀번호 변경' 단계를 거쳐야 앱에 진입합니다. 변경 전에는 세션을 만들지 않습니다.
 * pendingTeam: 이미 로그인된 세션이 임시 비밀번호 상태인 경우(App 에서 전달) 변경 단계부터 시작.
 */
export default function Login({ pendingTeam }: { pendingTeam?: string } = {}) {
  const { teams } = useAppState();
  const dispatch = useDispatch();

  // ── 팀 목록: Supabase 로그인이면 login_teams() (활성 팀 이름·내부 이메일), 아니면 브라우저 저장본 ──
  const [remote, setRemote] = useState<{ teams: LoginTeam[]; setup: boolean } | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const loadRemote = () => {
    setRemoteError('');
    Promise.all([needsSetup(), loginTeams()])
      .then(([setup, list]) => setRemote({ setup, teams: list }))
      .catch((e: unknown) => setRemoteError(e instanceof AuthApiError ? e.message : '서버에 연결할 수 없습니다.'));
  };
  useEffect(() => { if (REMOTE_AUTH) loadRemote(); }, []);
  const activeTeams = REMOTE_AUTH ? (remote?.teams ?? []).map(t => t.name) : teams.filter(t => t.active).map(t => t.name);
  const needSetup = REMOTE_AUTH ? !!remote?.setup : teams.length === 0;

  const [team, setTeam] = useState('');
  // 목록이 준비되면 마지막 로그인 팀(없으면 첫 팀) 선택
  useEffect(() => {
    if (activeTeams.includes(team)) return;
    const last = getLastTeam();
    setTeam(activeTeams.find(n => n === last) ?? activeTeams[0] ?? '');
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

  const errText = (e: unknown) => (e instanceof AuthApiError ? e.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');

  /** 로그인 완료 — Supabase 팀 목록을 앱에 맞추고 세션 시작 */
  const enter = async (me: Team) => {
    if (REMOTE_AUTH) dispatch({ type: 'SYNC_TEAMS', teams: await listTeams() });
    saveLoginPrefs(remember, me.name);
    dispatch({ type: 'LOGIN', session: { team: me.name, isAdmin: !!me.isAdmin } });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    if (!password) { setError('비밀번호를 입력하세요.'); return; }
    setLoading(true);
    try {
      if (REMOTE_AUTH) {
        const email = remote?.teams.find(t => t.name === team)?.login_email;
        if (!email) { setError('팀을 선택하세요.'); return; }
        await signIn(email, password);
        const me = await myTeam();
        if (!me || !me.active) { await signOut(); setError('로그인할 수 없는 팀입니다. 관리자에게 문의하세요.'); return; }
        if (me.mustChangePassword) { tempPw.current = password; setPassword(''); setError(''); setChangeFor(me.name); return; }
        await enter(me);
        return;
      }
      // 브라우저 저장본 로그인 — 짧은 지연으로 흐름만 재현
      await new Promise(r => window.setTimeout(r, 300));
      const found = teams.find(t => t.active && t.name === team && t.password === password);
      if (!found) { setError('팀 또는 비밀번호가 일치하지 않습니다.'); return; }
      if (found.mustChangePassword) { setPassword(''); setError(''); setChangeFor(found.name); return; }
      await enter(found);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  // ── 초기 비밀번호 변경 단계 ──
  const [changeFor, setChangeFor] = useState(pendingTeam ?? '');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  // 방금 로그인에 쓴 임시 비밀번호 (Supabase 변경 요청에 필요) — 새로고침 등으로 없으면 입력칸을 보여 줌
  const tempPw = useRef('');
  const [curInput, setCurInput] = useState('');
  const changeTeam = changeFor ? (teams.find(t => t.name === changeFor) ?? (REMOTE_AUTH ? { name: changeFor } as Team : undefined)) : undefined;
  const askCurrent = REMOTE_AUTH && !tempPw.current;

  const submitChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!changeTeam || loading) return;
    if (!REMOTE_AUTH) {
      // 임시 비밀번호를 그대로 다시 쓰는 것도 막음
      const err = passwordError(next, next2, changeTeam.password);
      if (err) { setError(err); return; }
      dispatch({ type: 'SET_TEAM_PASSWORD', teamName: changeTeam.name, password: next, by: 'self' });
      await enter(changeTeam);
      return;
    }
    const current = tempPw.current || curInput;
    if (!current) { setError('관리자에게 받은 임시 비밀번호를 입력하세요.'); return; }
    const err = passwordError(next, next2, current);
    if (err) { setError(err); return; }
    setLoading(true);
    try {
      await changePassword(current, next);
      tempPw.current = '';
      const me = await myTeam();
      if (!me) throw new AuthApiError('not_team', '팀 정보를 불러오지 못했습니다.');
      await enter(me);
      dispatch({ type: 'SET_TEAM_PASSWORD', teamName: me.name, by: 'self' }); // 알림만 (비밀번호는 서버에)
    } catch (err) {
      setError(err instanceof AuthApiError && err.code === 'wrong_password' ? '임시 비밀번호가 일치하지 않습니다.' : errText(err));
    } finally {
      setLoading(false);
    }
  };
  // 변경하지 않고 돌아가기 = 로그인 취소 (세션이 있었다면 로그아웃)
  const cancelChange = () => {
    setChangeFor(''); setNext(''); setNext2(''); setCurInput(''); setError(''); tempPw.current = '';
    if (REMOTE_AUTH) void signOut();
    if (pendingTeam) dispatch({ type: 'LOGOUT' });
  };
  const editChange = (fn: (v: string) => void) => (v: string) => { fn(v); setError(''); };

  const submitSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const name = setupName.trim();
    if (!name) return setError('관리자 팀 이름을 입력하세요.');
    const err = passwordError(setupPassword, setupConfirm);
    if (err) return setError(err);
    if (!REMOTE_AUTH) { dispatch({ type: 'INITIALIZE', name, password: setupPassword }); return; }
    setLoading(true);
    try {
      const { team: created } = await bootstrapAdmin(name, setupPassword);
      await signIn(created.login_email, setupPassword);
      const me = await myTeam();
      if (!me) throw new AuthApiError('not_team', '팀 정보를 불러오지 못했습니다.');
      await enter(me);
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'already_setup') loadRemote();
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

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
          {changeTeam ? (
          <form key="change" className="lg-form view-enter" onSubmit={submitChange} noValidate>
            <div className="lg-welcome">
              <h1>비밀번호 변경</h1>
              <p>
                <b className="lg-welcome__team">{changeTeam.name}</b>
                <span className="lg-only-desk">은(는) 임시 비밀번호로 로그인했어요. 안전을 위해 새 비밀번호로 바꾼 뒤 시작합니다.</span>
                <span className="lg-only-mob">은(는) 임시 비밀번호로 로그인했어요.<br />새 비밀번호로 바꾼 뒤 시작합니다.</span>
              </p>
            </div>

            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}

            <input type="text" name="username" value={changeTeam.name} autoComplete="username" readOnly hidden />
            <div className="lg-fields">
              {askCurrent && (
                <LgPassword id="login-pw-temp" label="임시 비밀번호" value={curInput} onChange={editChange(setCurInput)}
                  placeholder="관리자에게 받은 임시 비밀번호" autoComplete="current-password" />
              )}
              <LgPassword id="login-pw-new" label="새 비밀번호" hint={`${MIN_PASSWORD_LENGTH}자 이상`} value={next} onChange={editChange(setNext)}
                placeholder="새 비밀번호를 입력하세요" autoComplete="new-password" />
              <LgPassword id="login-pw-new2" label="새 비밀번호 확인" value={next2} onChange={editChange(setNext2)}
                placeholder="한 번 더 입력하세요" autoComplete="new-password" />
            </div>

            <button type="submit" className="lg-submit" disabled={loading}>{loading ? '변경 중...' : '변경하고 시작하기'}</button>

            <hr className="lg-divider" />
            <p className="lg-recovery">
              바꾼 비밀번호는 마이페이지에서 다시 변경할 수 있어요.{' '}
              <button type="button" className="lg-link" onClick={cancelChange}>다른 팀으로 로그인</button>
            </p>
          </form>
          ) : needSetup ? (
          <form key="setup" className="lg-form view-enter" onSubmit={submitSetup} noValidate>
            <div className="lg-welcome">
              <h1>처음 시작하기</h1>
              <p>첫 관리자 팀을 등록하세요.{!REMOTE_AUTH && ' 데이터는 이 브라우저에 저장됩니다.'}</p>
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
            <button type="submit" className="lg-submit" disabled={loading}>{loading ? '만드는 중...' : '관리자 팀 만들기'}</button>
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
                <span className="lg-only-mob">소속 팀을 선택하고 비밀번호를 입력하세요</span>
              </p>
            </div>

            {(error || remoteError) && (
              <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error || remoteError}
                {remoteError && !error && <button type="button" className="lg-link" onClick={loadRemote}>다시 시도</button>}</div>
            )}

            <div className="lg-fields">
              <div className="lg-field">
                <label htmlFor="login-team">팀 선택</label>
                <div className="lg-input">
                  <Select bare hideChevron id="login-team" className="lg-select" value={team} onChange={e => { setTeam(e.target.value); setError(''); }}>
                    {activeTeams.map(n => <option key={n} value={n}>{n}</option>)}
                  </Select>
                  <span className="lg-input__icon" aria-hidden="true"><DualIcon desk={chevronDown} mob={chevronDownM} /></span>
                </div>
              </div>

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
            <p className="lg-recovery">비밀번호를 잊으셨나요? 관리자에게 초기화를 요청하세요.</p>

          </form>
          )}
        </div>
      </main>
    </div>
  );
}
