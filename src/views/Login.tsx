import { useEffect, useState, type FormEvent } from 'react';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { DEFAULT_TEAM_PASSWORD } from '@/data/seed';
import { getLastTeam, getRemember, saveLoginPrefs } from '@/lib/remember';
import { holdLightTheme } from '@/lib/theme';
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
 * 초기 비밀번호(DEFAULT_TEAM_PASSWORD — 팀 추가·관리자 초기화 값)로 로그인하면 바로 들어가지 않고
 * '비밀번호 변경' 단계를 거쳐야 앱에 진입합니다. 변경 전에는 세션을 만들지 않습니다.
 * pendingTeam: 이미 로그인된 세션이 초기 비밀번호인 경우(App 에서 전달) 변경 단계부터 시작.
 */
export default function Login({ pendingTeam }: { pendingTeam?: string } = {}) {
  const { teams } = useAppState();
  const dispatch = useDispatch();
  const activeTeams = teams.filter(t => t.active);
  const [team, setTeam] = useState(() => {
    const last = getLastTeam();
    return activeTeams.find(t => t.name === last)?.name ?? activeTeams[0]?.name ?? '';
  });
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

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    if (!password) { setError('비밀번호를 입력하세요.'); return; }
    setLoading(true);
    // 인증 서버 연동 전 데모 — 짧은 지연으로 흐름만 재현
    window.setTimeout(() => {
      setLoading(false);
      const found = activeTeams.find(t => t.name === team && t.password === password);
      if (!found) { setError('팀 또는 비밀번호가 일치하지 않습니다.'); return; }
      if (found.password === DEFAULT_TEAM_PASSWORD) {
        setPassword(''); setError(''); setChangeFor(found.name);
        return;
      }
      saveLoginPrefs(remember, found.name);
      dispatch({ type: 'LOGIN', session: { team: found.name, isAdmin: !!found.isAdmin } });
    }, 300);
  };

  // ── 초기 비밀번호 변경 단계 ──
  const [changeFor, setChangeFor] = useState(pendingTeam ?? '');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const changeTeam = teams.find(t => t.name === changeFor);

  const submitChange = (e: FormEvent) => {
    e.preventDefault();
    if (!changeTeam) return;
    if (!next || !next2) { setError('새 비밀번호를 두 번 입력하세요.'); return; }
    if (next.length < 4) { setError('비밀번호는 4자 이상이어야 합니다.'); return; }
    if (next === DEFAULT_TEAM_PASSWORD) { setError('초기 비밀번호와 다른 비밀번호를 입력하세요.'); return; }
    if (next !== next2) { setError('새 비밀번호가 서로 일치하지 않습니다.'); return; }
    dispatch({ type: 'SET_TEAM_PASSWORD', teamName: changeTeam.name, password: next, by: 'self' });
    saveLoginPrefs(remember, changeTeam.name);
    dispatch({ type: 'LOGIN', session: { team: changeTeam.name, isAdmin: !!changeTeam.isAdmin } });
  };
  // 변경하지 않고 돌아가기 = 로그인 취소 (세션이 있었다면 로그아웃)
  const cancelChange = () => {
    setChangeFor(''); setNext(''); setNext2(''); setError('');
    if (pendingTeam) dispatch({ type: 'LOGOUT' });
  };
  const editChange = (fn: (v: string) => void) => (v: string) => { fn(v); setError(''); };

  const submitSetup = (e: FormEvent) => {
    e.preventDefault();
    const name = setupName.trim();
    if (!name) return setError('관리자 팀 이름을 입력하세요.');
    if (setupPassword.length < 8) return setError('비밀번호는 8자 이상이어야 합니다.');
    if (setupPassword === DEFAULT_TEAM_PASSWORD) return setError('다른 비밀번호를 입력하세요.');
    if (setupPassword !== setupConfirm) return setError('비밀번호가 서로 일치하지 않습니다.');
    dispatch({ type: 'INITIALIZE', name, password: setupPassword });
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
                <span className="lg-only-desk">은(는) 초기 비밀번호로 로그인했어요. 안전을 위해 새 비밀번호로 바꾼 뒤 시작합니다.</span>
                <span className="lg-only-mob">은(는) 초기 비밀번호로 로그인했어요.<br />새 비밀번호로 바꾼 뒤 시작합니다.</span>
              </p>
            </div>

            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}

            <input type="text" name="username" value={changeTeam.name} autoComplete="username" readOnly hidden />
            <div className="lg-fields">
              <LgPassword id="login-pw-new" label="새 비밀번호" hint="4자 이상" value={next} onChange={editChange(setNext)}
                placeholder="새 비밀번호를 입력하세요" autoComplete="new-password" />
              <LgPassword id="login-pw-new2" label="새 비밀번호 확인" value={next2} onChange={editChange(setNext2)}
                placeholder="한 번 더 입력하세요" autoComplete="new-password" />
            </div>

            <button type="submit" className="lg-submit">변경하고 시작하기</button>

            <hr className="lg-divider" />
            <p className="lg-recovery">
              바꾼 비밀번호는 마이페이지에서 다시 변경할 수 있어요.{' '}
              <button type="button" className="lg-link" onClick={cancelChange}>다른 팀으로 로그인</button>
            </p>
          </form>
          ) : teams.length === 0 ? (
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
              <LgPassword id="setup-password" label="비밀번호" hint="8자 이상" value={setupPassword} onChange={editChange(setSetupPassword)} placeholder="비밀번호를 입력하세요" autoComplete="new-password" />
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
                <span className="lg-only-mob">소속 팀을 선택하고 비밀번호를 입력하세요</span>
              </p>
            </div>

            {error && <div className="lg-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>}

            <div className="lg-fields">
              <div className="lg-field">
                <label htmlFor="login-team">팀 선택</label>
                <div className="lg-input">
                  <Select bare hideChevron id="login-team" className="lg-select" value={team} onChange={e => { setTeam(e.target.value); setError(''); }}>
                    {activeTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
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

            <button type="submit" className="lg-submit" disabled={loading}>
              {loading ? '확인 중...' : '로그인'}
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
