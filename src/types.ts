export type View =
  | 'home'
  | 'meeting'
  | 'project'
  | 'exec'
  | 'exec-new'
  | 'project-new'
  | 'project-detail'
  | 'cowork'
  | 'report'
  | 'mypage'
  | 'notification'
  | 'admin'
  | 'search';

export interface Session {
  team: string;
  isAdmin: boolean;
}

export interface Team {
  id: string;
  name: string;
  password: string;
  /** false = 휴면 (로그인 팀 선택에서 제외) */
  active: boolean;
  /** 팀 로그인만으로 관리자 메뉴 접근 */
  isAdmin?: boolean;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  /** YYYY-MM */
  startDate: string;
  /** YYYY-MM */
  endDate: string;
  totalAmount: number;
  /** 팀 배분 가능 금액 (= 프로젝트 경비 예산) */
  allocPool: number;
  used: number;
  active: boolean;
  /** 주관(등록) 팀 */
  ownerTeam: string;
  /** 화면용 계산값 — 로그인한 팀이 주관 팀 (StoreContext 에서 채움, 저장값은 무시) */
  isMine: boolean;
  /** 화면용 계산값 — 로그인한 팀이 주관 팀은 아니지만 배분받은 참여 팀 */
  joined?: boolean;
}

export type ProjectDraft = Omit<Project, 'id' | 'active' | 'isMine' | 'joined' | 'ownerTeam'>;

export interface AllocRow {
  id: string;
  teamName: string;
  amount: number;
  /** 이 팀이 배분액에서 사용한 금액 */
  used?: number;
}

export type Category = '식비' | '교통비' | '자재비' | '숙박비' | '기타';

/** 체크리스트 공개 범위 — public: 배분받은 코웍 팀 모두, private: 주관 팀만 */
export type CheckVisibility = 'public' | 'private';

export interface ChecklistItem {
  id: string;
  title: string;
  amount: number;
  category: Category | '';
  /** YYYY-MM-DD */
  date?: string;
  checked: boolean;
  projectId: string;
  /** 없으면 공개 */
  visibility?: CheckVisibility;
}

export interface QuarterData {
  quarter: number;
  label: string;
  months: string[];
  headcounts: number[];
  budget: number;
  used: number;
}

/**
 * 알림 종류
 * - exec: 집행 등록 완료 (My 프로젝트·팀 회의비)
 * - setting: 설정 변경 (비밀번호 본인 변경 / 관리자 초기화)
 * - alloc: 새 프로젝트 배분 (우리 팀에 예산 배분)
 * - deadline: 기한 임박 (다음 달 종료 프로젝트 — 1개월 전)
 * - budget / project / admin / system: 기존 알림(예산 경고 등)
 */
export type NotifType = 'exec' | 'setting' | 'alloc' | 'deadline' | 'budget' | 'project' | 'admin' | 'system';
/** 푸시 on/off 를 종류별로 고를 수 있는 알림 */
export type PushKind = 'exec' | 'setting' | 'alloc' | 'deadline';

export interface NotifItem {
  id: string;
  title: string;
  desc: string;
  type: NotifType;
  time: string;
  read: boolean;
  /** 받는 팀 — 없으면 모든 팀 */
  team?: string;
  /** 중복 발송 방지 키 (예: 기한 임박 알림은 프로젝트·종료월당 1회) */
  key?: string;
}

/** 팀별 알림 설정 — push: 기기 푸시 전체 on/off, kinds: 종류별 푸시 on/off */
export interface NotifPrefs {
  push: boolean;
  kinds: Record<PushKind, boolean>;
}

export interface MonthlyExec {
  /** 0 ~ 11 */
  month: number;
  meeting: number;
  project: number;
}

/** meeting·work = 팀 운영(팀 회의비·팀 업무비), project = 프로젝트 운영 */
export type BudgetType = 'meeting' | 'work' | 'project';

export interface ExecItem {
  name: string;
  amount: number;
}

export interface ExecRecord {
  id: string;
  /** 사용월 YYYY-MM — 예산 집계 기준 (사용일자에서 자동) */
  month: string;
  /** 사용일자 YYYY-MM-DD (없으면 등록일·사용월로 대신) */
  useDate?: string;
  /** 등록일 YYYY-MM-DD */
  date: string;
  type: BudgetType;
  projectId?: string;
  /** 집행한 팀 — 프로젝트 팀 배분 사용액 집계용 */
  team?: string;
  items: ExecItem[];
  total: number;
}
