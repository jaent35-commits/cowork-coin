// 관리자: 팀 삭제 — 집행·배분·주관 프로젝트·체크리스트 이력이 있으면 삭제하지 않고 휴면 안내 (ERD §5-6)
//   body: { teamId }  →  { ok: true }  |  409 { error: 'has_history' }
//   순서: teams 행 → Auth 사용자 (teams_auth_user_fk 가 ON DELETE RESTRICT)
import { HttpError, admin, adminCaller, json, serve, teamById } from '../_shared/mod.ts';

const HISTORY: [table: string, column: string][] = [
  ['exec_records', 'team_id'], ['project_allocations', 'team_id'], ['projects', 'owner_team_id'],
  ['checklist_items', 'created_by_team_id'], ['checklist_items', 'checked_by_team_id'],
];

serve(async (req, body) => {
  const me = await adminCaller(req);
  const team = await teamById(body.teamId);
  if (team.id === me.id) throw new HttpError(400, 'self_target', '로그인한 팀은 삭제할 수 없습니다');

  for (const [table, column] of HISTORY) {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, team.id);
    if (error) throw new HttpError(500, 'server', '이력을 확인하지 못했습니다');
    if (count) throw new HttpError(409, 'has_history', `${team.name}은(는) 이력이 있어 삭제할 수 없습니다. 휴면 처리하세요`);
  }

  const { error } = await admin.from('teams').delete().eq('id', team.id);
  if (error) {
    // 마지막 활성 관리자 팀(teams_keep_admin) 또는 이 사이 생긴 이력(외래키)
    if (/관리자/.test(error.message)) throw new HttpError(409, 'last_admin', '활성 관리자 팀이 하나는 있어야 합니다');
    if (error.code === '23503') throw new HttpError(409, 'has_history', `${team.name}은(는) 이력이 있어 삭제할 수 없습니다. 휴면 처리하세요`);
    throw new HttpError(500, 'server', '팀을 삭제하지 못했습니다');
  }
  const { error: ae } = await admin.auth.admin.deleteUser(team.auth_user_id);
  if (ae) console.error('auth user delete failed', ae.status); // 팀 행은 지워짐 — 남은 Auth 사용자는 로그인해도 팀이 없어 막힘
  return json({ ok: true });
});
