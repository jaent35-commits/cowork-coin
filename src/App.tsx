import { useEffect, useState } from 'react';
import { useAppState, useDispatch } from './store/StoreContext';
import { unreadCount } from './store/selectors';
import { useHashView } from './hooks/useHashView';
import Login from './views/Login';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import BottomNav from './components/layout/BottomNav';
import PwaPrompt from './components/PwaPrompt';
import { usePushDelivery } from './lib/push';
import { IconPlus } from './components/icons';
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

  // 모바일 플로팅 + 버튼: 아래로 스크롤 중이면 숨김, 위로 스크롤·맨 위면 표시
  const [fabAway, setFabAway] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, d = y - lastY;
      if (Math.abs(d) < 8) return;
      setFabAway(d > 0 && y > 80);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setFabAway(false); }, [view]);

  const toggleGnb = () => setGnbCollapsed(v => {
    try { localStorage.setItem(GNB_KEY, v ? '0' : '1'); } catch { /* 저장 불가 시 세션 동안만 유지 */ }
    return !v;
  });

  // 관리자 전용 화면 보호
  useEffect(() => {
    if (session && view === 'admin' && !session.isAdmin) navigate('home');
  }, [session, view, navigate]);

  // 새 알림 → 설정에 따라 기기 푸시 (아래 기한 확인보다 먼저 등록해야 로그인 직후 알림도 푸시됨)
  usePushDelivery(state);
  // 로그인(팀 전환)·프로젝트 변경 시 다음 달 종료 프로젝트 기한 임박 알림 확인 (중복은 key 로 방지)
  useEffect(() => { if (session?.team) dispatch({ type: 'CHECK_DEADLINES' }); }, [session?.team, state.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // 임시 비밀번호 상태인 팀 세션(이전 로그인·관리자 초기화 후 새로고침 등)은 변경 단계부터
  const mustChangePw = !!session && !!state.teams.find(t => t.name === session.team)?.mustChangePassword;
  if (!session || mustChangePw) {
    return (
      <>
        <Login key={mustChangePw ? 'change' : 'login'} pendingTeam={mustChangePw ? session?.team : undefined} />
        <PwaPrompt />
      </>
    );
  }

  const logout = () => {
    dispatch({ type: 'LOGOUT' });
    navigate('home');
  };

  // is-sheet: 모바일 집행 등록·프로젝트 등록은 풀페이지 팝업 (헤더 메뉴·하단 GNB 숨김)
  const sheetBack: Partial<Record<typeof view, typeof view>> = { 'exec-new': 'exec', 'project-new': 'project', 'project-detail': 'project' };
  const backTo = sheetBack[view];
  return (
    <div className={['app', gnbCollapsed && 'is-gnb-collapsed', backTo && 'is-sheet'].filter(Boolean).join(' ')}>
      <Header view={view} teamName={session.team} isAdmin={session.isAdmin} unread={unreadCount(state)} onNavigate={navigate} onLogout={logout}
        onBack={backTo ? () => navigate(backTo) : undefined}
        title={view === 'project-detail' ? state.projects.find(p => p.id === readDetailId())?.name : undefined} />
      <Sidebar view={view} isAdmin={session.isAdmin} collapsed={gnbCollapsed} onToggle={toggleGnb} onNavigate={navigate} />

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
          {view === 'mypage' && <MyPage />}
          {view === 'notification' && <Notification />}
          {view === 'search' && <Search onNavigate={navigate} />}
          {view === 'admin' && session.isAdmin && <Admin />}
        </div>
      </main>

      {/* 모바일: 공통 집행 등록 플로팅 버튼 (등록·관리자 화면에서는 숨김) */}
      {!backTo && view !== 'admin' && (
        <button type="button" className={fabAway ? 'fab is-away' : 'fab'} onClick={() => navigate('exec-new')} aria-label="집행 등록" title="집행 등록">
          <IconPlus size={24} />
        </button>
      )}

      <BottomNav view={view} onNavigate={navigate} />
      <PwaPrompt />
    </div>
  );
}
