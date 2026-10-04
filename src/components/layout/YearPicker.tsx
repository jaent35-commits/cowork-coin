import { useAppState } from '@/store/StoreContext';
import { YEARLY_HISTORY } from '@/data/seed';
import { CUR_MONTH, CUR_YEAR } from '@/lib/date';
import { useViewYear } from '@/lib/viewYear';
import type { ReactNode } from 'react';
import { Badge, StepNav, YearGrid } from '../ui';

/** 9월(4분기 준비)부터 다음 해 예산을 미리 볼 수 있음 */
export const NEXT_YEAR_OPEN = CUR_MONTH >= 8;

/**
 * 조회 연도 선택 ‹ 2026년 › — 데이터가 있는 연도 범위 안에서 이동
 * allowNextYear: 팀 운영(회의비·업무비) — 9월부터 다음 해까지 고를 수 있음
 */
export default function YearPicker({ className, allowNextYear }: { className?: string; allowNextYear?: boolean }) {
  const { records, projects } = useAppState();
  const [year, setYear] = useViewYear();
  const years = [
    CUR_YEAR,
    ...YEARLY_HISTORY.map(y => y.year),
    ...records.map(r => Number(r.month.slice(0, 4))),
    ...projects.flatMap(p => [Number(p.startDate.slice(0, 4)), Number((p.endDate || p.startDate).slice(0, 4))]),
    ...(allowNextYear && NEXT_YEAR_OPEN ? [CUR_YEAR + 1] : []),
  ].filter(Number.isFinite);
  const min = Math.min(...years);
  const max = Math.max(...years);

  return (
    <StepNav label="조회 연도" className={className} prevLabel="이전 연도" nextLabel="다음 연도"
      onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} prevDisabled={year <= min} nextDisabled={year >= max}
      picker={close => <YearGrid value={year} min={min} max={max} onPick={y => { setYear(y); close(); }} />}>
      {year}년{year === CUR_YEAR && <Badge variant="amber" size="sm">올해</Badge>}{year === CUR_YEAR + 1 && <Badge variant="blue" size="sm">내년</Badge>}
    </StepNav>
  );
}

/** 모바일 전용 조회 연도 바 — 화면 탭 바로 아래 (PC 는 페이지 제목 옆 YearPicker) */
export function YearBar({ actions, allowNextYear }: { actions?: ReactNode; allowNextYear?: boolean }) {
  return (
    <div className="app-main__year">
      <YearPicker allowNextYear={allowNextYear} />
      {actions && <div className="app-main__year-actions">{actions}</div>}
    </div>
  );
}
