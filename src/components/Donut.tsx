import { pct } from '@/lib/format';
import { cx } from './ui';
import './Donut.css';

/** 집행률 원형 그래프 + % (프로젝트 목록 · 모바일 팀 회의비 분기표) */
export default function Donut({ used, budget }: { used: number; budget: number }) {
  const rate = Math.round(pct(used, budget));
  const R = 17, C = 2 * Math.PI * R;
  return (
    <div className={cx('donut', used > budget && 'is-over')} role="img" aria-label={`집행률 ${rate}%`}>
      <svg viewBox="0 0 42 42" width="42" height="42" aria-hidden="true">
        <circle className="donut__track" cx="21" cy="21" r={R} />
        <circle className="donut__bar" cx="21" cy="21" r={R}
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(rate, 100) / 100)} />
      </svg>
      <span className="donut__pct num">{rate}<small>%</small></span>
    </div>
  );
}
