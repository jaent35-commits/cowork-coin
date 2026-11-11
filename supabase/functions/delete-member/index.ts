// 사용자 삭제 — 관리자 · 부서장 이상(내 관리 범위 사용자만, 관리자 계정은 관리자만)
//   body: { memberId }  →  { ok: true }
//   집행 · 체크리스트의 등록자 기록은 비워지고(이름이 사라짐) 데이터는 조직에 그대로 남음
//   — 기록을 남기려면 삭제 대신 비활성(update_member)
import { HttpError, admin, json, managerCaller, memberById, serve } from '../_shared/mod.ts';

serve(async (req, body) => {
  const { me, scope } = await managerCaller(req);
  const target = await memberById(body.memberId);
  if (target.id === me.id) throw new HttpError(400, 'self_target', '내 계정은 지울 수 없습니다');
  if (!scope.has(target.team_id)) throw new HttpError(403, 'forbidden', '내 관리 범위의 사용자만 지울 수 있습니다');
  if (target.is_admin && !me.is_admin) throw new HttpError(403, 'forbidden', '관리자 계정은 관리자만 지울 수 있습니다');

  const { error } = await admin.from('members').delete().eq('id', target.id);
  if (error) {
    if (/관리자/.test(error.message)) throw new HttpError(409, 'last_admin', '활성 관리자가 한 명은 있어야 합니다');
    throw new HttpError(500, 'server', '사용자를 지우지 못했습니다');
  }
  const { error: ae } = await admin.auth.admin.deleteUser(target.auth_user_id);
  if (ae) console.error('auth user delete failed', ae.status);
  return json({ ok: true });
});
