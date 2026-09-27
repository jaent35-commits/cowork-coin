/** 1234567 → "1,234,567원" */
export function fmt(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

/** 1234567 → "1,234,567" (0 이면 빈 문자열) */
export function fmtAmt(n: number): string {
  return n ? n.toLocaleString('ko-KR') : '';
}

/** "1,234,567" / "1234567원" → 1234567 */
export function parseAmt(s: string): number {
  return parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0;
}

/** 1234567 → "123만" */
export function fmtMan(n: number): string {
  return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
}

export function pct(used: number, budget: number): number {
  return budget > 0 ? (used / budget) * 100 : 0;
}

export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 125000000 → "1억2천5백만원" (숫자 + 한글 단위, 0 이면 빈 문자열) */
export function hangulWon(n: number): string {
  n = Math.floor(Math.abs(n));
  if (!n) return '';
  const small = (g: number) =>
    [[1000, '천'], [100, '백'], [10, '십'], [1, '']].map(([u, name]) => {
      const d = Math.floor(g / (u as number)) % 10;
      return d ? `${d}${name}` : '';
    }).join('');
  const units = ['', '만', '억', '조', '경'];
  let out = '';
  for (let i = 0; n > 0 && i < units.length; i++, n = Math.floor(n / 10000)) {
    const g = n % 10000;
    if (g) out = small(g) + units[i] + out;
  }
  return `${out}원`;
}
