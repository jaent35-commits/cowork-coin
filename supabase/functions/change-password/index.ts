// 비밀번호 변경 — 팀 본인 (초기 비밀번호 강제 변경 · 마이페이지)
//   body: { current, next }  →  { ok: true }
//   현재 비밀번호 확인 → 새 비밀번호 저장 → must_change_password 해제 → 다른 기기 세션 끊기 → 알림
import { HttpError, admin, anonClient, assertPassword, bearer, caller, json, notifySetting, serve } from '../_shared/mod.ts';

serve(async (req, body) => {
  const team = await caller(req);
  const current = typeof body.current === 'string' ? body.current : '';
  if (!current) throw new HttpError(400, 'bad_request', '현재 비밀번호를 입력하세요');
  const next = assertPassword(body.next, current);

  const check = await anonClient().auth.signInWithPassword({ email: team.login_email, password: current });
  if (check.error) throw new HttpError(400, 'wrong_password', '현재 비밀번호가 일치하지 않습니다');

  const { error } = await admin.auth.admin.updateUserById(team.auth_user_id, { password: next });
  if (error) throw new HttpError(400, 'weak_password', '새 비밀번호를 쓸 수 없습니다. 다른 비밀번호를 입력하세요');
  const { error: se } = await admin.rpc('set_password_state', { p_team_id: team.id, p_initial: false });
  if (se) throw new HttpError(500, 'server', '비밀번호 상태를 저장하지 못했습니다');

  // 지금 기기는 유지, 같은 팀 계정의 다른 기기 로그인은 끊음 (ERD §5-7)
  await admin.auth.admin.signOut(bearer(req), 'others').catch(() => undefined);
  await notifySetting(team.id, '비밀번호 변경 완료', `${team.name} 계정의 비밀번호가 성공적으로 변경되었습니다.`);
  return json({ ok: true });
});
