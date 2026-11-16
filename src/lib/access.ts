import type { Session, Team } from '@/types';

/**
 * 회의비 · 업무비 권한 (db/migrations/20261115_meeting_dept_work_personal.sql 과 같은 규칙)
 *   · 팀 회의비 = 부서 단위 — 파트 소속은 위 부서의 회의비를 함께 봄, 인원 설정은 부서에 바로 속한 사람(팀장) · 관리자
 *   · 업무비 = 사람별 — 관리자가 사용자별로 사용 여부를 켜고 끔
 * 브라우저 저장본 로그인(팀 계정)은 지금처럼 팀 = 조직이라 모두 허용
 */
type Ctx = { session?: Session | null; teams: Team[] };

/** 회의비 단위 조직 — 파트면 상위 조직(부서), 그 외는 자기 자신 */
export function deptOf(teams: Team[], teamName?: string): Team | undefined {
  const t = teams.find(x => x.name === teamName);
  if (t?.level !== '파트' || !t.parentId) return t;
  return teams.find(x => x.id === t.parentId) ?? t;
}

/** 회의비 인원(예산)을 바꿀 수 있는지 — 팀장(회의비 단위 조직에 바로 속함) · 관리자 */
export function isMeetingLeader({ session, teams }: Ctx): boolean {
  if (!session?.member || session.isAdmin) return true;
  const mine = teams.find(t => t.name === session.team);
  return !!mine && deptOf(teams, mine.name)?.id === mine.id;
}

/** 업무비를 쓰는 사용자인지 (관리자가 끄면 업무비 메뉴 · 집행 선택지가 숨겨짐) */
export const workEnabled = ({ session }: Pick<Ctx, 'session'>) => session?.member?.workEnabled !== false;
