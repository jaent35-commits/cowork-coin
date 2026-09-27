import { cx } from '.';
import { monthsUntil } from '@/lib/date';

/** 종료월까지 남은 개월 수 기준 표기 — M-3(3개월 남음), M-0(이번 달 종료), M+1(1개월 지남) */
export function mLabel(m: number): string {
  return m >= 0 ? `M-${m}` : `M+${Math.abs(m)}`;
}

export function MTag({ endDate, active = true, size = 'sm' }: { endDate: string; active?: boolean; size?: 'sm' | 'lg' }) {
  if (!active) return <span className={cx('mtag', 'is-end', size === 'lg' && 'mtag--lg')}>종료</span>;
  const m = monthsUntil(endDate);
  const tone = m <= 1 ? 'is-red' : m <= 3 ? 'is-amber' : 'is-blue';
  const desc = m > 0 ? `종료까지 ${m}개월` : m === 0 ? '이번 달 종료' : `종료 ${Math.abs(m)}개월 경과`;
  return (
    <span className={cx('mtag', tone, size === 'lg' && 'mtag--lg')} title={`${desc} (${endDate})`} aria-label={desc}>
      {mLabel(m)}
    </span>
  );
}
