import { useEffect, useLayoutEffect, useState } from 'react';
import { useAppState, useDispatch } from './store/StoreContext';
import { unreadCount } from './store/selectors';
import { useHashView } from './hooks/useHashView';
import Login from './views/Login';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import BottomNav from './components/layout/BottomNav';
import { isAdminView } from './components/layout/nav';
import PwaPrompt from './components/PwaPrompt';
import { usePushDelivery } from './lib/push';
import { IconPlus } from './components/icons';
import { REMOTE_AUTH, supabase } from './lib/supabase';
import { hasSession, listTeams, manageableTeamIds, myMember, signOut } from './lib/authApi';
import Home from './views/Home';
import Meeting from './views/Meeting';
import ProjectView, { readDetailId } from './views/Project';
import ExecList from './views/ExecList';
import ExecRegister from './views/ExecRegister';
import ProjectNew from './views/ProjectNew';
import Report from './views/Report';
import CoworkChecklist from './views/CoworkChecklist';
import MyPage from './views/MyPage';
import Notification from './views/Notification';
import Search from './views/Search';
import Admin from './views/Admin';
import AdminLocal from './views/AdminLocal';
import { SYNC_ERROR_EVENT } from './store/StoreContext';
import { useToast } from './hooks/useToast';
import { Toast } from './components/ui';

const GNB_KEY = 'cowork-coin-gnb-collapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(GNB_KEY) === '1'; } catch { return false; }
}

export default function App() {
  const state = useAppState();
  const dispatch = useDispatch();
  const [view, navigate] = useHashView();
  const [gnbCollapsed, setGnbCollapsed] = useState(readCollapsed);
  const session = state.session;

  // Supabase 반영 실패 안내 (화면은 서버 값으로 되돌아감)
  const [syncToast, showSync] = useToast(4000);
  useEffect(() => {
    const onError = (e: Event) => showSync((e as CustomEvent<string>).detail, 'warn');
    window.addEventListener(SYNC_ERROR_EVENT, onError);
    return () => window.removeEventListener(SYNC_ERROR_EVENT, onError);
  }, [showSync]);
  // 메뉴(화면)를 옮기면 새 화면이 그려진 뒤 맨 위(main 시작)로 — 이전 화면의 스크롤 위치가 남지 않게
  useLayoutEffect(() => { window.scrollTo({ top: 0 }); }, [view]);

  const toggleGnb = () => setGnbCollapsed(v => {
    try { localStorage.setItem(GNB_KEY, v ? '0' : '1'); } catch { /* 저장 불가 시 세션 동안만 유지 */ }
    return !v;
  });

  // 관리 화면 보호 — 관리자 · 부서장 이상(관리 범위가 있는 사용자)만
  const canAdmin = !!session && (session.isAdmin || !!session.canManage);
  useEffect(() => {
    if (session && isAdminView(view) && !canAdmin) navigate('home');
    else if (!REMOTE_AUTH && view === 'admin-org') navigate('admin'); // 브라우저 저장본: 팀 = 조직
  }, [session, canAdmin, view, navigate]);

  // Supabase 로그인: 앱 세션과 Auth 세션을 맞춤 (시작할 때 한 번 + 다른 곳에서 로그아웃되면)
  useEffect(() => {
    if (!REMOTE_AUTH) return;
    let alive = true;
    (async () => {
      const authed = await hasSession();
      if (!alive) return;
      if (!session) { if (authed) await signOut(); return; } // '로그인 정보 저장' 안 함 → 새로 열면 로그아웃
      if (!authed) { dispatch({ type: 'LOGOUT' }); return; }
      try {
        // 내 정보 · 소속 조직 · 관리 권한을 서버 값으로 (다른 사람이 바꾼 소속 · 권한 · 초기화 반영)
        const me = await myMember();
        if (!alive) return;
        if (!me || !me.active) { await signOut(); dispatch({ type: 'LOGOUT' }); return; }
        if (me.member.mustChangePassword) {
          dispatch({ type: 'SYNC_TEAMS', teams: [me.team] });
          dispatch({ type: 'SET_SESSION', patch: { team: me.team.name, isAdmin: me.isAdmin, canManage: false, member: me.member } });
          return;
        }
        const [list, manage] = await Promise.all([listTeams(), manageableTeamIds()]);
        if (!alive) return;
        dispatch({ type: 'SYNC_TEAMS', teams: list });
        dispatch({ type: 'SET_SESSION', patch: { team: me.team.name, isAdmin: me.isAdmin, canManage: manage.length > 0, member: me.member } });
      } catch { /* 네트워크 오류 — 저장된 정보로 계속 */ }
    })();
    const { data } = supabase!.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') dispatch({ type: 'LOGOUT' }); });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 새 알림 → 설정에 따라 기기 푸시 (아래 기한 확인보다 먼저 등록해야 로그인 직후 알림도 푸시됨)
  usePushDelivery(state);
  // 로그인(팀 전환)·프로젝트 변경 시 다음 달 종료 프로젝트 기한 임박 알림 확인 (중복은 key 로 방지)
  useEffect(() => { if (session?.team) dispatch({ type: 'CHECK_DEADLINES' }); }, [session?.team, state.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // 초기(임시) 비밀번호 상태인 세션(관리자 초기화 후 새로고침 등)은 변경 단계부터
  const mustChangePw = !!session && (REMOTE_AUTH
    ? !!session.member?.mustChangePassword
    : !!state.teams.find(t => t.name === session.team)?.mustChangePassword);
  if (!session || mustChangePw) {
    return (
      <>
        <Login key={mustChangePw ? 'change' : 'login'} pendingName={mustChangePw ? (session?.member?.name ?? session?.team) : undefined} />
        <PwaPrompt />
      </>
    );
  }

  const logout = () => {
    if (REMOTE_AUTH) void signOut();
    dispatch({ type: 'LOGOUT' });
    navigate('home');
  };

  // is-sheet: 모바일 집행 등록·프로젝트 등록은 풀페이지 팝업 (헤더 메뉴·하단 GNB 숨김)
  const sheetBack: Partial<Record<typeof view, typeof view>> = { 'exec-new': 'exec', 'project-new': 'project', 'project-detail': 'project' };
  const backTo = sheetBack[view];
  return (
    <div className={['app', gnbCollapsed && 'is-gnb-collapsed', backTo && 'is-sheet'].filter(Boolean).join(' ')}>
      <Header view={view} teamName={session.member?.name ?? session.team} isAdmin={canAdmin} unread={unreadCount(state)} onNavigate={navigate} onLogout={logout}
        onBack={backTo ? () => navigate(backTo) : undefined}
        title={view === 'project-detail' ? state.projects.find(p => p.id === readDetailId())?.name : undefined} />
      <Sidebar view={view} isAdmin={canAdmin} collapsed={gnbCollapsed} onToggle={toggleGnb} onNavigate={navigate} />

      <Toast msg={syncToast} />
      <main className="app-main">
        <div className="app-main__inner" key={view}>
          {view === 'home' && <Home onNavigate={navigate} />}
          {view === 'meeting' && <Meeting onNavigate={navigate} />}
          {view === 'project' && <ProjectView onNavigate={navigate} />}
          {view === 'project-detail' && <ProjectView onNavigate={navigate} sheet />}
          {view === 'exec' && <ExecList onNavigate={navigate} />}
          {view === 'exec-new' && <ExecRegister onBack={() => navigate('exec')} />}
          {view === 'project-new' && <ProjectNew onBack={() => navigate('project')} />}
          {view === 'cowork' && <CoworkChecklist onNavigate={navigate} />}
          {view === 'report' && <Report onNavigate={navigate} />}
          {view === 'mypage' && <MyPage section="password" />}
          {view === 'settings' && <MyPage section="display" />}
          {view === 'notification' && <Notification />}
          {view === 'search' && <Search onNavigate={navigate} />}
          {view === 'admin' && canAdmin && (REMOTE_AUTH ? <Admin section="users" /> : <AdminLocal />)}
          {view === 'admin-org' && canAdmin && REMOTE_AUTH && <Admin section="org" />}
        </div>
      </main>

      {/* 모바일: 공통 집행 등록 플로팅 버튼 (등록·관리자 화면에서는 숨김) */}
      {!backTo && !isAdminView(view) && (
        <button type="button" className="fab" onClick={() => navigate('exec-new')} aria-label="집행 등록" title="집행 등록">
          <IconPlus size={24} />
        </button>
      )}

      <BottomNav view={view} onNavigate={navigate} />
      <PwaPrompt />
    </div>
  );
}
