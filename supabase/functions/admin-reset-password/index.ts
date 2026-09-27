// 관리자: 비밀번호 초기화 — 새 임시 비밀번호 + 다음 로그인 때 변경 필수
//   body: { teamId }  →  { tempPassword }
//   기존 기기 세션은 must_change_password 로 곧바로 데이터가 막힘(current_team_id() NULL),
//   변경하려면 새 임시 비밀번호가 필요하므로 옛 비밀번호로는 다시 쓸 수 없음
import { HttpError, admin, adminCaller, json, makeTempPassword, notifySetting, serve, teamById } from '../_shared/mod.ts';

serve(async (req, body) => {
  await adminCaller(req);
  const team = await teamById(body.teamId);
  const tempPassword = makeTempPassword();
  const { error } = await admin.auth.admin.updateUserById(team.auth_user_id, { password: tempPassword });
  if (error) throw new HttpError(500, 'server', '비밀번호를 초기화하지 못했습니다');
  const { error: se } = await admin.rpc('set_password_state', { p_team_id: team.id, p_initial: true });
  if (se) throw new HttpError(500, 'server', '비밀번호 상태를 저장하지 못했습니다');
  await notifySetting(team.id, '비밀번호 초기화',
    `관리자가 ${team.name} 계정의 비밀번호를 초기화했습니다. 관리자에게 받은 임시 비밀번호로 로그인하면 새 비밀번호로 변경한 뒤 시작합니다.`);
  return json({ tempPassword });
});
