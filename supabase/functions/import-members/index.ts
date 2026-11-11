// 사용자 일괄 등록 (엑셀 행) — 조직(본부 > 부서 > 파트)을 만들거나 찾고 사용자 계정을 만든 뒤 가입 안내 DM
//   body: { rows: [{ employeeNo, name, position?, email?, hq, dept?, part?, isAdmin? }] }
//     · 소속 = 본부 · 부서 · 파트 중 가장 아래 칸 (본부장은 본부만, 부서장은 본부 · 부서, 파트 소속은 셋 다)
//   누가: ① 첫 설치(사용자 0명) — 로그인 없이, 관리자(isAdmin) 행이 1명 이상 있어야 함
//         ② 관리자 — 모든 조직 · 관리자 지정 가능
//         ③ 부서장 이상 — 내 관리 범위 안에서만, 본부 · 부서는 이미 있어야 함(파트만 새로 만듦), 관리자 지정 불가
//   응답: { results: [{ employeeNo, name, status: 'created' | 'exists' | 'error', message?, dm?, tempPassword? }] }
//     · 초기 비밀번호는 슬랙 DM 으로만 보냄 — DM 을 못 보낸 사람만 응답에 한 번 담아 화면에 보여 줌
import {
  HttpError, admin, caller, companyEmail, createMemberAccount, dmWelcome, employeeNo, json, makeTempPassword,
  optionalText, personName, serve, TEAM_COLS, type TeamRow,
} from '../_shared/mod.ts';

type Level = '본부' | '부서' | '파트';
type Row = { employeeNo: string; name: string; position: string | null; email: string | null; path: string[]; isAdmin: boolean };
const LEVELS: Level[] = ['본부', '부서', '파트'];
const MAX_ROWS = 300;

serve(async (req, body) => {
  const raw = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
  if (!raw.length) throw new HttpError(400, 'bad_request', '등록할 사용자가 없습니다');
  if (raw.length > MAX_ROWS) throw new HttpError(400, 'bad_request', `한 번에 ${MAX_ROWS}명까지 등록할 수 있습니다`);

  // ── 누가 부르는지 ──
  const { count: memberCount, error: ce } = await admin.from('members').select('id', { count: 'exact', head: true });
  if (ce) throw new HttpError(500, 'server', '사용자 수를 확인하지 못했습니다');
  const bootstrap = memberCount === 0;
  let isAdmin = bootstrap;
  let scope: Set<number> | null = null; // null = 전체
  if (!bootstrap) {
    const me = await caller(req);
    if (!me.is_active || me.must_change_password) throw new HttpError(403, 'forbidden', '사용할 수 없는 계정입니다');
    isAdmin = me.is_admin;
    if (!isAdmin) {
      const { data } = await admin.rpc('manageable_team_ids_of', { p_member_id: me.id });
      scope = new Set(((data ?? []) as unknown[]).map(v => Number(typeof v === 'object' && v ? Object.values(v)[0] : v)));
      if (!scope.size) throw new HttpError(403, 'forbidden', '사용자 등록은 관리자 또는 부서장 이상만 할 수 있습니다');
    }
  }

  // ── 행 검사 (형식 오류가 하나라도 있으면 아무것도 만들지 않음) ──
  const rows: Row[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const at = `${i + 2}행`; // 엑셀 1행 = 머리글
    try {
      const no = employeeNo(r.employeeNo);
      if (seen.has(no)) throw new HttpError(400, 'bad_request', `사번 ${no} 이 두 번 있습니다`);
      seen.add(no);
      const path = [r.hq, r.dept, r.part].map(v => String(v ?? '').trim());
      if (!path[0]) throw new HttpError(400, 'bad_request', '본부를 입력하세요');
      if (!path[1] && path[2]) throw new HttpError(400, 'bad_request', '파트가 있으면 부서도 입력하세요');
      const want = /^(y|yes|o|true|1|관리자)$/i.test(String(r.isAdmin ?? '').trim());
      rows.push({ employeeNo: no, name: personName(r.name), position: optionalText(r.position, 30), email: companyEmail(r.email), path: path.filter(Boolean), isAdmin: want });
    } catch (e) {
      throw new HttpError(400, 'bad_request', `${at}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  if (bootstrap && !rows.some(r => r.isAdmin)) throw new HttpError(400, 'bad_request', '처음 등록할 때는 관리자를 1명 이상 지정하세요 (관리자 열)');

  // ── 조직: 이름으로 찾고 없으면 만듦 (구분 · 상위 조직이 다르면 오류) ──
  const { data: teamData } = await admin.from('teams').select(TEAM_COLS);
  const byName = new Map(((teamData ?? []) as TeamRow[]).map(t => [t.name, t]));
  async function ensureTeam(path: string[]): Promise<number> {
    let parent: TeamRow | null = null;
    for (let d = 0; d < path.length; d++) {
      const name = path[d], level = LEVELS[d];
      let t = byName.get(name) ?? null;
      if (t) {
        if (t.unit_level !== level || (t.parent_id ?? null) !== (parent?.id ?? null)) {
          throw new HttpError(409, 'duplicate', `'${name}' 은(는) 이미 다른 위치(${t.unit_level})에 있는 조직입니다`);
        }
      } else {
        // 부서장 이상: 내 범위의 부서 아래 파트만 새로 만들 수 있음 (본부 · 부서는 고정)
        if (!isAdmin && (level !== '파트' || !parent || !scope!.has(parent.id))) {
          throw new HttpError(403, 'forbidden', `'${name}' ${level}이(가) 없습니다. 본부 · 부서는 관리자에게 요청하세요`);
        }
        const { data, error } = await admin.from('teams').insert({ name, unit_level: level, parent_id: parent?.id ?? null }).select(TEAM_COLS).single();
        if (error || !data) throw new HttpError(500, 'server', `조직 '${name}' 을(를) 만들지 못했습니다`);
        t = data as TeamRow;
        byName.set(name, t);
        if (scope && parent && scope.has(parent.id)) scope.add(t.id);
      }
      parent = t;
    }
    if (scope && !scope.has(parent!.id)) throw new HttpError(403, 'forbidden', `'${parent!.name}' 은(는) 내 관리 범위가 아닙니다`);
    return parent!.id;
  }

  // ── 사용자 ──
  const { data: existing } = await admin.from('members').select('employee_no').in('employee_no', rows.map(r => r.employeeNo));
  const exists = new Set((existing ?? []).map(m => m.employee_no as string));
  const results: Record<string, unknown>[] = [];
  for (const r of rows) {
    const base = { employeeNo: r.employeeNo, name: r.name };
    if (exists.has(r.employeeNo)) { results.push({ ...base, status: 'exists', message: '이미 등록된 사번' }); continue; }
    try {
      const teamId = await ensureTeam(r.path);
      const temp = makeTempPassword();
      const m = await createMemberAccount({ employeeNo: r.employeeNo, name: r.name, position: r.position, email: r.email, teamId, isAdmin: isAdmin && r.isAdmin }, temp);
      const dm = await dmWelcome(m, temp);
      results.push({
        ...base, status: 'created', dm,
        ...(r.isAdmin && !isAdmin ? { message: '관리자 지정은 관리자만 할 수 있어 일반 사용자로 등록' } : {}),
        ...(dm ? {} : { tempPassword: temp }),
      });
    } catch (e) {
      results.push({ ...base, status: 'error', message: e instanceof HttpError ? e.message : '등록하지 못했습니다' });
    }
  }
  return json({ bootstrap, results });
});
