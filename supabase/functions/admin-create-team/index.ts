// 관리자: 팀 추가 — 임시 비밀번호를 만들어 응답으로 한 번만 돌려줌 (저장·로그 안 함)
//   body: { name }  →  { team: { id, name }, tempPassword }
import { adminCaller, assertNameFree, createTeamAccount, json, makeTempPassword, serve, teamName } from '../_shared/mod.ts';

serve(async (req, body) => {
  await adminCaller(req);
  const name = teamName(body.name);
  await assertNameFree(name);
  const tempPassword = makeTempPassword();
  const team = await createTeamAccount(name, tempPassword, { isAdmin: false, mustChange: true });
  return json({ team: { id: team.id, name: team.name }, tempPassword });
});
