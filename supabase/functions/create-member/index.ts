// 사용자 1명 등록 — 관리자 · 부서장 이상(내 관리 범위 조직에만) → 가입 안내 DM
//   body: { employeeNo, name, position?, email?, teamId, isAdmin? }  →  { member: { id, employeeNo, name }, dm, tempPassword? }
//   · 관리자 지정(isAdmin)은 관리자만
//   · 초기 비밀번호는 슬랙 DM 으로만 — DM 을 못 보냈을 때만 응답에 한 번 담아 화면에 보여 줌
import {
  HttpError, companyEmail, createMemberAccount, dmWelcome, employeeNo, json, makeTempPassword, managerCaller,
  optionalText, personName, serve, teamById,
} from '../_shared/mod.ts';

serve(async (req, body) => {
  const { me, scope } = await managerCaller(req);
  const team = await teamById(body.teamId);
  if (!scope.has(team.id)) throw new HttpError(403, 'forbidden', '내 관리 범위의 조직에만 사용자를 등록할 수 있습니다');
  if (!team.is_active) throw new HttpError(400, 'bad_request', '비활성 조직에는 등록할 수 없습니다');
  const wantAdmin = body.isAdmin === true;
  if (wantAdmin && !me.is_admin) throw new HttpError(403, 'forbidden', '관리자 지정은 관리자만 할 수 있습니다');

  const temp = makeTempPassword();
  const m = await createMemberAccount({
    employeeNo: employeeNo(body.employeeNo), name: personName(body.name), position: optionalText(body.position, 30),
    email: companyEmail(body.email), teamId: team.id, isAdmin: wantAdmin,
  }, temp);
  const dm = await dmWelcome(m, temp);
  return json({ member: { id: m.id, employeeNo: m.employee_no, name: m.name }, dm, ...(dm ? {} : { tempPassword: temp }) });
});
