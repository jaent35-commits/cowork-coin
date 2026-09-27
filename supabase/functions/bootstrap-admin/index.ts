// 첫 실행 — 팀이 하나도 없을 때만 첫 관리자 팀을 만듦 (로그인 전 호출, verify_jwt 끔)
//   body: { name, password }  →  { team: { id, name, login_email } }  (앱은 이어서 같은 비밀번호로 로그인)
import { HttpError, admin, assertPassword, createTeamAccount, json, serve, teamName } from '../_shared/mod.ts';

const hasTeams = async () => {
  const { count, error } = await admin.from('teams').select('id', { count: 'exact', head: true });
  if (error) throw new HttpError(500, 'server', '팀 목록을 확인하지 못했습니다');
  return (count ?? 0) > 0;
};

serve(async (_req, body) => {
  if (await hasTeams()) throw new HttpError(409, 'already_setup', '이미 시작된 서비스입니다. 로그인하세요');
  const name = teamName(body.name);
  const password = assertPassword(body.password);
  const team = await createTeamAccount(name, password, { isAdmin: true, mustChange: false });
  // 동시에 두 번 눌린 경우: 먼저 만들어진 팀만 남김
  const { data: first } = await admin.from('teams').select('id').order('id').limit(1).single();
  if (first && first.id !== team.id) {
    await admin.from('teams').delete().eq('id', team.id);
    await admin.auth.admin.deleteUser(team.auth_user_id);
    throw new HttpError(409, 'already_setup', '이미 시작된 서비스입니다. 로그인하세요');
  }
  return json({ team: { id: team.id, name: team.name, login_email: team.login_email } });
});
