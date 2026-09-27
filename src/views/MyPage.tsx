import { useState } from 'react';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { useToast } from '@/hooks/useToast';
import { Alert, Avatar, Btn, Card, Divider, Field, Input, PageHead, PasswordInput, Segmented, Toast } from '@/components/ui';
import { useFontMode } from '@/lib/fontScale';
import { useTheme, setThemePref, type ThemePref } from '@/lib/theme';
import { CUR_YEAR } from '@/lib/date';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import './Pages.css';

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: '라이트' }, { value: 'dark', label: '다크' }, { value: 'system', label: '시스템 설정' },
];

type PwError = '' | 'current' | 'mismatch' | 'short' | 'same';
const ERR: Record<Exclude<PwError, ''>, { v: 'danger' | 'warn'; msg: string }> = {
  current: { v: 'danger', msg: '현재 비밀번호가 일치하지 않습니다.' },
  mismatch: { v: 'danger', msg: '새 비밀번호가 서로 일치하지 않습니다.' },
  short: { v: 'warn', msg: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` },
  same: { v: 'warn', msg: '현재 비밀번호와 다른 비밀번호를 입력하세요.' },
};

export default function MyPage() {
  const { session, teams } = useAppState();
  const dispatch = useDispatch();
  const [toast, showToast] = useToast();
  const [font, setFont] = useFontMode();
  const { pref: themePref, theme } = useTheme();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<PwError>('');

  const teamName = session?.team ?? '';
  const team = teams.find(t => t.name === teamName);

  const save = () => {
    if (!team) return;
    if (cur !== team.password) return setError('current');
    if (next.length < MIN_PASSWORD_LENGTH) return setError('short');
    if (next !== next2) return setError('mismatch');
    if (next === cur) return setError('same');
    dispatch({ type: 'SET_TEAM_PASSWORD', teamName, password: next, by: 'self' });
    setError('');
    setCur(''); setNext(''); setNext2('');
    showToast('비밀번호가 변경되었습니다!');
  };
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); setError(''); };

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead title="마이페이지" />

      <div className="narrow">
        <Card pad className="mb-16">
          <div className="profile">
            <Avatar name={teamName} size="lg" />
            <div>
              <div className="profile__name">{teamName}</div>
              <div className="profile__sub">{session?.team === '관리자' ? '관리자 계정' : `팀 계정${session?.isAdmin ? ' · 관리자 권한' : ''} · ${CUR_YEAR}년 업무 진행 중`}</div>
            </div>
          </div>
          <Divider />
          <Field label="팀명" htmlFor="my-team">
            <Input id="my-team" className="input--lg" value={teamName} disabled />
          </Field>
        </Card>

        <Card pad className="mb-16">
          <h2 className="card-title" data-search-anchor="display">🔠 화면 설정</h2>
          <div className="row row--between row--wrap mb-14">
            <span className="text-muted">글씨 크기</span>
            <Segmented options={[{ value: 'sm', label: '작은 글씨' }, { value: 'lg', label: '큰 글씨' }]} value={font} onChange={setFont} label="글씨 크기" />
          </div>
          <div className="row row--between row--wrap">
            <span className="text-muted">
              화면 모드
              {themePref === 'system' && <span className="theme-now"> · 지금 {theme === 'dark' ? '다크' : '라이트'}</span>}
            </span>
            <Segmented<ThemePref> options={THEME_OPTIONS} value={themePref} onChange={setThemePref} label="화면 모드" />
          </div>
        </Card>

        <Card pad>
          <h2 className="card-title" data-search-anchor="password">🔐 비밀번호 변경</h2>
          {!team ? (
            <Alert variant="info">관리자 비밀번호는 시스템 설정에서 관리됩니다.</Alert>
          ) : (
            <form onSubmit={e => { e.preventDefault(); save(); }}>
              {error && <div className="mb-14"><Alert variant={ERR[error].v}>{ERR[error].msg}</Alert></div>}
              <input type="text" name="username" value={teamName} autoComplete="username" readOnly hidden />
              <Field label="현재 비밀번호" htmlFor="pw-cur">
                <PasswordInput id="pw-cur" value={cur} onChange={edit(setCur)} autoComplete="current-password" />
              </Field>
              <Field label="새 비밀번호 입력" htmlFor="pw-new" hint={`${MIN_PASSWORD_LENGTH}자 이상`}>
                <PasswordInput id="pw-new" value={next} onChange={edit(setNext)} autoComplete="new-password" />
              </Field>
              <Field label="새 비밀번호 확인" htmlFor="pw-new2">
                <PasswordInput id="pw-new2" value={next2} onChange={edit(setNext2)} autoComplete="new-password" />
              </Field>
              <Btn type="submit" disabled={!cur || !next || !next2}>비밀번호 저장</Btn>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
