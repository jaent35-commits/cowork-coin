// 비밀번호 초기화 — 관리자 · 부서장 이상(내 관리 범위 사용자만, 관리자 계정은 관리자만) → 초기화 안내 DM
//   body: { memberId }  →  { dm, tempPassword? }
//   새 초기 비밀번호 → 초기 비밀번호 상태(첫 로그인 때 변경 필수) → 그 사람의 모든 기기 로그인 끊김
import { HttpError, admin, dmReset, json, makeTempPassword, managerCaller, memberById, serve } from '../_shared/mod.ts';

serve(async (req, body) => {
  const { me, scope } = await managerCaller(req);
  const target = await memberById(body.memberId);
  if (target.id === me.id) throw new HttpError(400, 'self_target', '내 비밀번호는 마이페이지에서 바꾸세요');
  if (!scope.has(target.team_id)) throw new HttpError(403, 'forbidden', '내 관리 범위의 사용자만 초기화할 수 있습니다');
  if (target.is_admin && !me.is_admin) throw new HttpError(403, 'forbidden', '관리자 계정은 관리자만 초기화할 수 있습니다');

  const temp = makeTempPassword();
  const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password: temp });
  if (error) throw new HttpError(500, 'server', '비밀번호를 바꾸지 못했습니다');
  const { error: se } = await admin.rpc('set_password_state', { p_member_id: target.id, p_initial: true });
  if (se) throw new HttpError(500, 'server', '비밀번호 상태를 저장하지 못했습니다');
  // 기존 기기 로그인은 곧바로 데이터가 막힘(current_member_id() NULL) — 새 초기 비밀번호로만 다시 시작

  const dm = await dmReset(target, temp);
  return json({ dm, ...(dm ? {} : { tempPassword: temp }) });
});
