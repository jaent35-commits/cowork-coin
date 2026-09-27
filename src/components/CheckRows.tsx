import { useState, type ReactNode } from 'react';
import type { ChecklistItem, Project } from '@/types';
import { fmt } from '@/lib/format';
import { TODAY_ISO } from '@/lib/date';
import { isPublicCheck } from '@/store/selectors';
import { Badge, Checkbox, EmptyState, cx } from './ui';
import './CheckRows.css';

const CAT_COLOR: Record<string, string> = {
  식비: 'var(--primary)', 교통비: 'var(--sage)', 자재비: 'var(--violet)', 숙박비: 'var(--clay)', 기타: 'var(--faint)',
};

/** 미체크 항목의 예정일까지 남은 날 — D-3 / D-DAY / D+2(지남) */
function dday(date: string): { text: string; late: boolean } {
  const diff = Math.round((new Date(date).getTime() - new Date(TODAY_ISO).getTime()) / 86400000);
  return diff === 0 ? { text: 'D-DAY', late: false } : diff > 0 ? { text: `D-${diff}`, late: false } : { text: `D+${-diff}`, late: true };
}

/**
 * 경비 집행 체크리스트 줄 목록 (홈 · 코웍/My 체크리스트 · 프로젝트 상세 공용)
 * 한 줄: [☐] [항목명 ··· 금액] / [프로젝트 · 분류 · 참여·비공개 · 예정일 · D-day] — 완료는 체크 + 취소선으로만 표시
 * - hideProject: 프로젝트 상세처럼 한 프로젝트만 보일 때 프로젝트명 생략
 * - actions: 줄 오른쪽 끝 편집 버튼 (공개 전환·삭제)
 */
export default function CheckRows({ items, projects, onToggle, empty, hideProject, actions, flashId, selectable }: {
  items: ChecklistItem[]; projects: Pick<Project, 'id' | 'name' | 'joined'>[]; onToggle: (id: string) => void;
  empty: { icon: string; message: string; sub?: string } | ReactNode;
  hideProject?: boolean; actions?: (item: ChecklistItem) => ReactNode;
  /** 검색 이동으로 잠시 강조할 항목 */
  flashId?: string | null;
  /** 누른 줄을 표 선택 색(--primary-50 + 왼쪽 앰버 막대)으로 표시 — 한 번 더 누르면 해제 */
  selectable?: boolean;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  if (items.length === 0) {
    const e = empty as { icon?: string; message?: string };
    return e && typeof e === 'object' && 'message' in e ? <EmptyState {...(e as { icon: string; message: string; sub?: string })} /> : <>{empty}</>;
  }
  return (
    <ul className={cx('check-list', selectable && 'is-selectable')}>
      {items.map(item => {
        const proj = projects.find(p => p.id === item.projectId);
        const color = CAT_COLOR[item.category] ?? 'var(--faint)';
        const d = !item.checked && item.date ? dday(item.date) : null;
        return (
          <li key={item.id} data-check={item.id} className={cx('check-row', item.checked && 'is-done', actions && 'has-actions', flashId === item.id && 'is-flash', selectable && selId === item.id && 'is-selected')}
            onClick={selectable ? e => {
              // 체크박스·편집 버튼을 누르면 그 줄을 선택(해제하지 않음), 나머지 영역은 선택 ↔ 해제
              const onControl = (e.target as HTMLElement).closest('input, button');
              setSelId(s => (s === item.id && !onControl ? null : item.id));
            } : undefined}>
            <Checkbox tone="success" checked={item.checked} onChange={() => onToggle(item.id)} aria-label={`${item.title} 완료 표시`} />
            <div className="check-row__body">
              <div className="check-row__head">
                <span className="check-row__title">{item.title}</span>
                <span className="check-row__amt num">{fmt(item.amount)}</span>
              </div>
              <div className="check-row__meta">
                {!hideProject && proj?.joined && <Badge variant="outline" size="sm" title="배분받은 참여 프로젝트 (공개 항목)">참여</Badge>}
                {!hideProject && <span className="check-row__proj">{proj?.name}</span>}
                {item.category && <Badge variant="tint" size="sm" color={color}>{item.category}</Badge>}
                {!isPublicCheck(item) && <Badge variant="dark" size="sm" title="주관 팀만 볼 수 있음">비공개</Badge>}
                {item.date
                  ? <span className="check-row__date">{item.date}{d && <b className={cx('check-row__dday', d.late && 'is-late')}>{d.text}</b>}</span>
                  : <span className="check-row__date is-none">예정일 없음</span>}
              </div>
            </div>
            {actions && <div className="check-row__actions">{actions(item)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** 예정일 오름차순, 예정일 없는 항목은 맨 뒤 */
export const byCheckDate = (a: ChecklistItem, b: ChecklistItem) =>
  (a.date ?? '9999').localeCompare(b.date ?? '9999');
