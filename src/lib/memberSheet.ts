import type { ImportRow } from './authApi';
import { readXlsx } from './xlsx';

/**
 * 사용자 엑셀 → 등록할 행 (deploy/MEMBERS.md '사용자 엑셀 형식')
 * 머리글: 본부 · 부서 · 파트 · 사원번호(사번) · 성명(이름) · 직위 · 이메일 · 관리자 여부(관리자) — 순서는 자유
 * 소속 = 본부 · 부서 · 파트 중 가장 아래 칸. 형식 검사는 서버(import-members)도 다시 함
 */
const HEADERS: Record<keyof Omit<ImportRow, 'isAdmin'> | 'isAdmin', RegExp> = {
  hq: /^본부(명)?$/,
  dept: /^(부서|센터)(명)?$/,
  part: /^(파트|유닛)(명)?$/,
  employeeNo: /^(사원\s*번호|사번)$/,
  name: /^(성명|이름)$/,
  position: /^(직위|직급|직책)$/,
  email: /^(이메일|e-?mail|메일)$/i,
  isAdmin: /^관리자(\s*여부)?$/,
};

export interface SheetResult { rows: ImportRow[]; problems: string[] }

export async function readMemberSheet(file: File): Promise<SheetResult> {
  const table = await readXlsx(file);
  const headerAt = table.findIndex(r => r.some(c => HEADERS.employeeNo.test(c.trim())));
  if (headerAt < 0) throw new Error('머리글에 사원번호(사번) 열이 없습니다');
  const head = table[headerAt].map(c => c.trim());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, re]) => [k, head.findIndex(h => re.test(h))])) as Record<keyof typeof HEADERS, number>;
  const missing = (['hq', 'employeeNo', 'name'] as const).filter(k => col[k] < 0).map(k => ({ hq: '본부', employeeNo: '사원번호', name: '성명' })[k]);
  if (missing.length) throw new Error(`머리글에 ${missing.join(' · ')} 열이 없습니다`);

  const cell = (r: string[], k: keyof typeof HEADERS) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
  const rows: ImportRow[] = [];
  const problems: string[] = [];
  table.slice(headerAt + 1).forEach((r, i) => {
    if (!r.some(c => c.trim())) return; // 빈 줄
    const at = `${headerAt + i + 2}행`;
    const row: ImportRow = {
      employeeNo: cell(r, 'employeeNo').replace(/\.0+$/, ''), name: cell(r, 'name'), position: cell(r, 'position') || undefined,
      email: cell(r, 'email') || undefined, hq: cell(r, 'hq'), dept: cell(r, 'dept') || undefined, part: cell(r, 'part') || undefined,
      isAdmin: /^(y|yes|o|true|1|관리자)$/i.test(cell(r, 'isAdmin')),
    };
    if (!row.employeeNo) problems.push(`${at}: 사원번호가 없습니다`);
    else if (!row.name) problems.push(`${at}: 성명이 없습니다`);
    else if (!row.hq) problems.push(`${at}: 본부가 없습니다`);
    else if (row.part && !row.dept) problems.push(`${at}: 파트가 있으면 부서도 입력하세요`);
    else rows.push(row);
  });
  return { rows, problems };
}

/** 소속 표시 — 본부 › 부서 › 파트 */
export const unitPath = (r: Pick<ImportRow, 'hq' | 'dept' | 'part'>) => [r.hq, r.dept, r.part].filter(Boolean).join(' › ');
