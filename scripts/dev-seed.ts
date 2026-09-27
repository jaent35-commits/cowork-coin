/**
 * 개발용 테스트 데이터 — 앱 저장본(localStorage 'cowork-coin-v5') 형식
 *   · 내용은 db/seed.sql (Supabase 테스트 데이터)과 같게 맞춤. 한쪽을 고치면 다른 쪽도 고칠 것
 *   · vite.config.ts 의 devSeed 플러그인이 개발 서버에서만 /__dev/seed 로 넣어 줌 (운영 빌드에는 없음)
 *   · 사용액·분기·월별 집계는 집행 이력에서 계산해 앱 reducer 규칙과 맞춤
 *
 * 앱 저장 구조의 한계 (DB 와 다른 점)
 *   · 회의비 분기표(quarters) · 업무비 월 예산(workBudgets) · 단가(meetingRate) 가 팀별이 아니라 하나 → 개발팀 값을 사용
 *   · 분기 회의비 사용액은 앱 규칙대로 모든 팀의 회의비 집행 합
 *   · 알림 읽음 표시가 팀별이 아니라 하나
 */

export const STORAGE_KEY = 'cowork-coin-v5';
const YEAR = 2026;

/** 테스트 팀 비밀번호 — 로컬 개발 서버 전용 테스트 값 (Supabase 에는 넣지 않음) */
export const TEST_TEAMS = [
  { id: 't1', name: '개발팀',   password: 'devteam-2026',   active: true,  isAdmin: true,  mustChangePassword: false, note: '관리자' },
  { id: 't2', name: '디자인팀', password: 'design-2026',    active: true,  isAdmin: false, mustChangePassword: false, note: '일반 팀' },
  { id: 't3', name: '기획팀',   password: 'Temp7plan',      active: true,  isAdmin: false, mustChangePassword: true,  note: '임시 비밀번호 — 로그인하면 변경 화면' },
  { id: 't4', name: '영업팀',   password: 'sales-2026',     active: false, isAdmin: false, mustChangePassword: false, note: '휴면 — 로그인 목록에 안 보임' },
];

const RATE_BEFORE = 30000; // 2025-01 ~
const RATE_NOW = 35000;    // 2026-07 ~
const HEADCOUNTS = [[8, 8, 8], [8, 8, 8], [9, 9, 9], [9, 9, 9]]; // 개발팀 (4분기는 앱 테스트용으로 3분기 인원 유지)

const PROJECTS = [
  { id: 'p1', name: 'AI 학습 플랫폼 고도화', client: '교육청', startDate: '2026-03-01', endDate: '2026-12-31', totalAmount: 50000000, allocPool: 30000000, ownerTeam: '개발팀',   active: true },
  { id: 'p2', name: '브랜드 리뉴얼',         client: '대교',   startDate: '2026-05-01', endDate: '2026-10-31', totalAmount: 20000000, allocPool: 12000000, ownerTeam: '디자인팀', active: true },  // 다음 달 종료 → 기한 임박 알림
  { id: 'p3', name: '신규 서비스 기획',      client: '',       startDate: '2026-01-01', endDate: '2026-06-30', totalAmount: 8000000,  allocPool: 5000000,  ownerTeam: '기획팀',   active: false },
];

const ALLOCS: Record<string, [string, number][]> = {
  p1: [['개발팀', 12000000], ['디자인팀', 8000000], ['기획팀', 5000000]],
  p2: [['디자인팀', 7000000], ['개발팀', 4000000]],
  p3: [['기획팀', 3000000], ['개발팀', 2000000]],
};

const CHECKLIST = [
  { id: 'c1', projectId: 'p1', title: '킥오프 워크숍 식비',   amount: 800000,  category: '식비',   date: '2026-03-15', visibility: 'public',  checked: true },
  { id: 'c2', projectId: 'p1', title: '외부 전문가 자문',     amount: 2000000, category: '기타',   date: '2026-10-20', visibility: 'private', checked: false },
  { id: 'c3', projectId: 'p1', title: '현장 방문 교통비',     amount: 450000,  category: '교통비', date: '2026-10-05', visibility: 'public',  checked: false },
  { id: 'c4', projectId: 'p2', title: '시안 출력 자재비',     amount: 600000,  category: '자재비', date: '2026-09-30', visibility: 'public',  checked: false },
  { id: 'c5', projectId: 'p2', title: '촬영 숙박비',          amount: 900000,  category: '숙박비',                     visibility: 'public',  checked: false },
  { id: 'c6', projectId: 'p3', title: '사용자 인터뷰 사례비', amount: 500000,  category: '기타',   date: '2026-04-10', visibility: 'public',  checked: true },
];

type BudgetType = 'meeting' | 'work' | 'project';
// [id, 팀, 유형, 프로젝트, 사용일자, 등록일, 항목명, 금액] — 앱은 1건 = 1항목
const RECORDS: [string, string, BudgetType, string | null, string, string, string, number][] = [
  ['e1',    '개발팀',   'meeting', null, '2026-02-12', '2026-02-12', '회의 식대',         180000],
  ['e2',    '개발팀',   'meeting', null, '2026-08-21', '2026-08-22', '회의 식대',         210000],
  ['e2-1',  '개발팀',   'meeting', null, '2026-08-21', '2026-08-22', '다과',               45000],
  ['e3',    '디자인팀', 'meeting', null, '2026-05-08', '2026-05-08', '회의 식대',         120000],
  ['e4',    '기획팀',   'meeting', null, '2026-09-10', '2026-09-11', '회의 식대',         180000],
  ['e5',    '영업팀',   'meeting', null, '2026-01-20', '2026-01-20', '회의 식대',          90000],
  ['e6',    '개발팀',   'work',    null, '2026-07-14', '2026-07-14', '사무용품',           85000],
  ['e6-1',  '개발팀',   'work',    null, '2026-07-14', '2026-07-14', '도서 구입',          42000],
  ['e7',    '디자인팀', 'work',    null, '2026-09-03', '2026-09-03', '소프트웨어 구독',    99000],
  ['e8',    '개발팀',   'project', 'p1', '2026-03-15', '2026-03-16', '워크숍 식비',       760000],
  ['e9',    '디자인팀', 'project', 'p1', '2026-06-20', '2026-06-20', 'UI 리서치 도구',   1200000],
  ['e10',   '기획팀',   'project', 'p1', '2026-08-11', '2026-08-12', '현장 교통비',       230000],
  ['e11',   '디자인팀', 'project', 'p2', '2026-07-02', '2026-07-02', '시안 출력',         350000],
  ['e11-1', '디자인팀', 'project', 'p2', '2026-07-02', '2026-07-02', '폼보드',             80000],
  ['e12',   '개발팀',   'project', 'p3', '2026-03-30', '2026-03-30', '프로토타입 호스팅', 150000],
  ['e13',   '기획팀',   'project', 'p3', '2026-04-10', '2026-04-10', '인터뷰 사례비',     500000],
];

const NOTIFICATIONS = [
  { id: 'n6', type: 'setting',  team: '기획팀',   read: false, time: '1일 전',  title: '비밀번호 초기화',      desc: '관리자가 기획팀 계정의 비밀번호를 초기화했습니다. 관리자에게 받은 임시 비밀번호로 로그인하면 새 비밀번호로 변경한 뒤 시작합니다.' },
  { id: 'n5', type: 'deadline', team: '개발팀',   read: false, time: '3시간 전', title: '체크리스트 기한 임박', desc: 'AI 학습 플랫폼 고도화 — 현장 방문 교통비 예정일(10/5)이 다가옵니다.' },
  { id: 'n4', type: 'exec',     team: '개발팀',   read: false, time: '7월 14일', title: '집행 등록 완료',       desc: '팀 업무비 사무용품 외 1건, 합계 127,000원이 정상 등록되었습니다.' },
  { id: 'n2', type: 'setting',                    read: false, time: '6월 25일', title: '회의비 단가 변경',     desc: '7월부터 팀 회의비 1인당 월 단가가 35,000원으로 바뀝니다.' },
  { id: 'n3', type: 'alloc',    team: '디자인팀', read: true,  time: '3월 2일',  title: '새 프로젝트 배분',     desc: 'AI 학습 플랫폼 고도화 프로젝트에 우리 팀 예산 8,000,000원이 배분되었습니다.' },
  { id: 'n1', type: 'system',                     read: true,  time: '1월 5일',  title: '코웍-코인 오픈',       desc: '코웍-코인 예산 관리 서비스를 시작합니다.' },
];

const allOn = { exec: true, setting: true, alloc: true, deadline: true };
const NOTIF_PREFS = {
  개발팀: { push: true, kinds: allOn },
  디자인팀: { push: false, kinds: allOn },
  기획팀: { push: true, kinds: { ...allOn, deadline: false } },
};

/** 앱 저장본 (AppState) — 로그인 전 상태 */
export function buildDevSeed() {
  const records = RECORDS.map(([id, team, type, projectId, useDate, date, name, amount]) => ({
    id, month: useDate.slice(0, 7), useDate, date, type, ...(projectId ? { projectId } : {}), team,
    items: [{ name, amount }], total: amount,
  }));
  const thisYear = records.filter(r => r.month.startsWith(`${YEAR}-`));
  const monthIdx = (r: { month: string }) => Number(r.month.slice(5, 7)) - 1;
  const sum = (rs: { total: number }[]) => rs.reduce((s, r) => s + r.total, 0);

  const quarters = HEADCOUNTS.map((headcounts, qi) => ({
    quarter: qi + 1,
    label: `${qi + 1}분기`,
    months: [0, 1, 2].map(i => `${qi * 3 + i + 1}월`),
    headcounts,
    budget: headcounts.reduce((s, n) => s + n, 0) * (qi >= 2 ? RATE_NOW : RATE_BEFORE),
    used: sum(thisYear.filter(r => r.type === 'meeting' && Math.floor(monthIdx(r) / 3) === qi)),
  }));

  const projectRecs = (pid: string) => records.filter(r => r.type === 'project' && r.projectId === pid);
  const projects = PROJECTS.map(p => ({ ...p, used: sum(projectRecs(p.id)), isMine: false }));
  const allocs = Object.fromEntries(Object.entries(ALLOCS).map(([pid, rows]) => [pid, rows.map(([teamName, amount], i) => ({
    id: `a-${pid}-${i + 1}`, teamName, amount, used: sum(projectRecs(pid).filter(r => r.team === teamName)),
  }))]));
  const projectMonthly = Object.fromEntries(PROJECTS.map(p => [p.id, Array.from({ length: 12 }, (_, m) =>
    sum(projectRecs(p.id).filter(r => r.month.startsWith(`${YEAR}-`) && monthIdx(r) === m)))]));
  const monthly = Array.from({ length: 12 }, (_, month) => ({
    month,
    meeting: sum(thisYear.filter(r => r.type === 'meeting' && monthIdx(r) === month)),
    project: sum(thisYear.filter(r => r.type === 'project' && monthIdx(r) === month)),
  }));

  return {
    session: null,
    teams: TEST_TEAMS.map(({ note: _note, ...t }) => t),
    projects,
    allocs,
    checklist: CHECKLIST,
    quarters,
    monthly,
    projectMonthly,
    records,
    notifications: NOTIFICATIONS,
    notifPrefs: NOTIF_PREFS,
    meetingRate: RATE_NOW,
    workBudgets: { '2026-01': 500000, '2026-07': 600000 },
  };
}
