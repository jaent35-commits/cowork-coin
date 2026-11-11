// 비밀번호 변경 — 본인 (첫 로그인 강제 변경 · 마이페이지)
//   body: { current, next }  →  { ok: true }
//   현재 비밀번호 확인 → 새 비밀번호 저장 → 초기 비밀번호 상태 해제 → 내 다른 기기 로그인 끊기 → 변경 안내 DM
import { HttpError, admin, anonClient, assertPassword, bearer, caller, dmMember, json, serve } from '../_shared/mod.ts';

serve(async (req, body) => {
  const me = await caller(req);
  if (!me.is_active) throw new HttpError(403, 'forbidden', '사용할 수 없는 계정입니다');
  const current = typeof body.current === 'string' ? body.current : '';
  if (!current) throw new HttpError(400, 'bad_request', '현재 비밀번호를 입력하세요');
  const next = assertPassword(body.next, current);

  const check = await anonClient().auth.signInWithPassword({ email: me.login_email, password: current });
  if (check.error) throw new HttpError(400, 'wrong_password', '현재 비밀번호가 일치하지 않습니다');

  const { error } = await admin.auth.admin.updateUserById(me.auth_user_id, { password: next });
  if (error) throw new HttpError(400, 'weak_password', '새 비밀번호를 쓸 수 없습니다. 다른 비밀번호를 입력하세요');
  const { error: se } = await admin.rpc('set_password_state', { p_member_id: me.id, p_initial: false });
  if (se) throw new HttpError(500, 'server', '비밀번호 상태를 저장하지 못했습니다');

  // 지금 기기는 유지, 내 계정의 다른 기기 로그인은 끊음
  await admin.auth.admin.signOut(bearer(req), 'others').catch(() => undefined);
  // 본인이 바꾼 게 아니면 알아챌 수 있게 (실패해도 변경은 완료)
  await dmMember(me, '비밀번호가 변경되었습니다. 본인이 바꾸지 않았다면 관리자에게 알려 주세요.', '코웍-코인 비밀번호 변경').catch(() => false);
  return json({ ok: true });
});
