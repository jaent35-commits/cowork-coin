import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChecklistItem, Project } from '@/types';
import { fmt, parseAmt } from '@/lib/format';
import { TODAY_ISO } from '@/lib/date';
import { checkDateOf, isPublicCheck } from '@/store/selectors';
import { Badge, Checkbox, DateField, EmptyState, cx } from './ui';
import { IconEyeOff, IconLock, IconUnlock } from './icons';
import './CheckRows.css';

export { checkDateOf };

const CAT_COLOR: Record<string, string> = {
  '회의비(원가)': 'var(--primary)', '업무비(원가)': 'var(--violet)', '일반교통비(원가)': 'var(--sage)', '기타(원가)': 'var(--faint)',
  // 예전 구분 (이미 등록된 항목)
  식비: 'var(--primary)', 교통비: 'var(--sage)', 자재비: 'var(--violet)', 숙박비: 'var(--clay)', 기타: 'var(--faint)',
};

type ExecPatch = Pick<ChecklistItem, 'spent' | 'spentDate'>;

/** 미체크 항목의 예정일까지 남은 날 — D-3 / D-DAY / D+2(지남) */
function dday(date: string): { text: string; late: boolean } {
  const diff = Math.round((new Date(date).getTime() - new Date(TODAY_ISO).getTime()) / 86400000);
  return diff === 0 ? { text: 'D-DAY', late: false } : diff > 0 ? { text: `D-${diff}`, late: false } : { text: `D+${-diff}`, late: true };
}

/**
 * 완료 항목의 집행 금액 입력 — 처음 값은 예산. 누르면 값이 비고 지금 금액이 placeholder 로 남아
 * 새로 입력 (비운 채 나가면 지금 금액 유지 · Enter 저장 · Esc 취소)
 */
/** live: 입력하는 대로 바로 반영 (저장 전 항목 — 칸을 벗어나지 않고 바깥을 눌러도 입력값으로 저장) */
function SpentInput({ title, value, onSpend, onEnter, live }: { title: string; value: number; onSpend: (spent: number) => void; onEnter?: () => void; live?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  const enter = useRef(false);
  const commit = () => {
    if (draft !== null && !cancel.current && draft !== '') onSpend(parseAmt(draft));
    cancel.current = false;
    setDraft(null);
    if (enter.current) { enter.current = false; onEnter?.(); }
  };
  return (
    <input className="num" inputMode="numeric" aria-label={`${title} 집행 금액`}
      value={draft ?? value.toLocaleString('ko-KR')} placeholder={value.toLocaleString('ko-KR')}
      onFocus={() => setDraft('')}
      onChange={e => {
        const d = e.target.value.replace(/\D/g, '');
        setDraft(d ? Number(d).toLocaleString('ko-KR') : '');
        if (live && d) onSpend(Number(d));
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { enter.current = true; e.currentTarget.blur(); }
        if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur(); }
      }} />
  );
}

/** 방금 체크한 항목 — 아직 저장 전 (집행 금액·집행일을 고칠 수 있는 순간) */
type Pending = { id: string; spent: number; spentDate: string };

/**
 * 경비 집행 체크리스트 줄 목록 (홈 · 코웍/My 체크리스트 · 프로젝트 상세 공용)
 * 한 줄: [☐] [항목명 ··· 금액] / [프로젝트 · 분류 · 참여·비공개 · 예정일 · D-day] — 완료는 체크 + 취소선으로만 표시
 * 완료 항목: 집행 금액을 크게, 예산은 그 아래 작게, 예정일 자리는 집행일(기본 = 체크한 날)
 *   onExec 가 있으면 잠금 버튼 — 잠금(기본)이면 체크 해제·금액·집행일 수정 불가, 풀면 수정
 *   (방금 체크한 항목은 바로 입력할 수 있게 풀린 상태로 시작)
 * - hideProject: 프로젝트 상세처럼 한 프로젝트만 보일 때 프로젝트명 생략
 * - actions: 줄 오른쪽 끝 편집 버튼 (공개 전환·삭제)
 */
export default function CheckRows({ items, projects, onToggle, onExec, empty, hideProject, actions, flashId, selectable }: {
  items: ChecklistItem[]; projects: Pick<Project, 'id' | 'name' | 'joined'>[];
  /** exec: 체크할 때 고른 집행 금액·집행일 (체크 해제는 없음) */
  onToggle: (id: string, exec?: ExecPatch) => void;
  onExec?: (id: string, patch: ExecPatch) => void;
  empty: { icon: string; message: string; sub?: string } | ReactNode;
  hideProject?: boolean; actions?: (item: ChecklistItem) => ReactNode;
  /** 검색 이동으로 잠시 강조할 항목 */
  flashId?: string | null;
  /** 누른 줄을 표 선택 색(--primary-50 + 왼쪽 앰버 막대)으로 표시 — 한 번 더 누르면 해제 */
  selectable?: boolean;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(() => new Set());
  // 잠긴 항목의 체크박스를 누르면 잠금 버튼을 잠깐 흔들어 알려 줌
  const [nudgeId, setNudgeId] = useState<string | null>(null);
  useEffect(() => {
    if (!nudgeId) return;
    const t = window.setTimeout(() => setNudgeId(null), 650);
    return () => window.clearTimeout(t);
  }, [nudgeId]);
  const setLock = (id: string, open: boolean) => setUnlocked(s => {
    const n = new Set(s);
    if (open) n.add(id); else n.delete(id);
    return n;
  });

  /*
   * 체크 → 바로 저장하지 않고 '저장 전' 상태로 집행 금액(기본 예산)·집행일(기본 오늘)을 고칠 수 있게 함
   * 줄 바깥을 누르거나(달력 팝업은 줄 안으로 봄) Enter → 그 값으로 완료 저장 · Esc / 체크 다시 누르기 → 취소
   * 화면을 벗어나도 저장. 입력 중인 값까지 담으려고 ref 로도 들고 있음
   */
  const [pending, setPendingState] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const setPending = (p: Pending | null) => { pendingRef.current = p; setPendingState(p); };
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const commitPending = () => {
    const p = pendingRef.current;
    if (!p) return;
    setPending(null);
    toggleRef.current(p.id, { spent: p.spent, spentDate: p.spentDate });
  };
  useEffect(() => {
    if (!pending) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(`[data-check="${pending.id}"]`) || t?.closest('.popover')) return;
      // 입력 중이던 금액을 먼저 반영(blur) → 그 값으로 저장
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(`[data-check="${pending.id}"]`)) active.blur();
      commitPending();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof Element && e.target.closest('input'))) setPending(null); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 저장 전에 화면을 벗어나면 그대로 완료 저장
  useEffect(() => () => commitPending(), []); // eslint-disable-line react-hooks/exhaustive-deps

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
        const isPending = pending?.id === item.id;
        // 저장 전에는 고른 값으로 미리 보여 줌
        const shown = isPending ? { ...item, checked: true, spent: pending.spent, spentDate: pending.spentDate } : item;
        const lockable = item.checked && !!onExec;
        const editing = isPending || (lockable && unlocked.has(item.id));
        const locked = lockable && !editing;
        const execDate = checkDateOf(shown);
        return (
          <li key={item.id} data-check={item.id} className={cx('check-row', shown.checked && 'is-done', isPending && 'is-pending', actions && 'has-actions', flashId === item.id && 'is-flash', selectable && selId === item.id && 'is-selected', editing && 'is-editing')}
            onClick={selectable ? e => {
              // 체크박스·편집 버튼을 누르면 그 줄을 선택(해제하지 않음), 나머지 영역은 선택 ↔ 해제
              const onControl = (e.target as HTMLElement).closest('input, button');
              setSelId(s => (s === item.id && !onControl ? null : item.id));
            } : undefined}>
            <Checkbox tone="success" checked={shown.checked} aria-label={`${item.title} 완료 표시`}
              aria-disabled={locked || undefined} title={locked ? '잠금을 풀면 체크를 해제할 수 있습니다' : undefined}
              onClick={e => { if (locked) { e.preventDefault(); setNudgeId(item.id); } }}
              onChange={() => {
                if (locked) return;
                if (isPending) { setPending(null); return; }   // 저장 전 체크를 다시 누름 → 취소
                if (!item.checked && onExec) {
                  // 다른 줄이 저장 전이면 먼저 저장하고, 이 줄을 저장 전 상태로
                  commitPending();
                  setPending({ id: item.id, spent: item.amount, spentDate: TODAY_ISO });
                  return;
                }
                setLock(item.id, false);
                onToggle(item.id);
              }} />
            <div className="check-row__body">
              <div className="check-row__head">
                <span className="check-row__title">{item.title}</span>
                {shown.checked
                  ? <span className="check-row__money">
                      <span className="check-row__spentline">
                        {lockable && !isPending && (
                          <button type="button" className={cx('check-row__lock', editing && 'is-open', nudgeId === item.id && 'is-nudge')}
                            aria-pressed={editing} aria-label={editing ? `${item.title} 잠그기` : `${item.title} 잠금 풀고 수정`}
                            title={editing ? '잠그기' : '잠금 풀고 수정'} onClick={() => setLock(item.id, !editing)}>
                            {editing ? <IconUnlock size={14} /> : <IconLock size={14} />}
                          </button>
                        )}
                        <span className="check-row__spent num">
                          {editing
                            ? <SpentInput title={item.title} value={shown.spent ?? item.amount} live={isPending} onEnter={isPending ? commitPending : undefined}
                                onSpend={spent => (isPending ? setPending({ ...pendingRef.current!, spent }) : onExec!(item.id, { spent }))} />
                            : (item.spent ?? item.amount).toLocaleString('ko-KR')}
                          <span aria-hidden={editing || undefined}>원</span>
                        </span>
                      </span>
                      <span className="check-row__budget">예산 <b className="num">{fmt(item.amount)}</b></span>
                    </span>
                  : <span className="check-row__amt num">{fmt(item.amount)}</span>}
              </div>
              <div className="check-row__meta">
                {!hideProject && proj?.joined && <Badge variant="outline" size="sm" title="배분받은 참여 프로젝트 (공개 항목)">참여</Badge>}
                {!hideProject && <span className="check-row__proj">{proj?.name}</span>}
                {item.category && <Badge variant="tint" size="sm" color={color}>{item.category}</Badge>}
                {!isPublicCheck(item) && !actions && (
                  <span className="check-row__vis" title="비공개: 주관 팀만 볼 수 있음" aria-label="비공개" role="img"><IconEyeOff size={12} /></span>
                )}
                {shown.checked
                  ? <span className="check-row__date is-exec">
                      <span className="check-row__datelabel">집행</span>
                      {editing
                        ? <span className="check-row__datefield">
                            <DateField aria-label={`${item.title} 집행일`} value={execDate ?? TODAY_ISO}
                              onChange={v => (isPending ? setPending({ ...pendingRef.current!, spentDate: v || TODAY_ISO }) : onExec!(item.id, { spentDate: v }))} />
                          </span>
                        : execDate ?? '날짜 없음'}
                    </span>
                  : item.date
                    ? <span className="check-row__date">{item.date}{d && <b className={cx('check-row__dday', d.late && 'is-late')}>{d.text}</b>}</span>
                    : <span className="check-row__date is-none">예정일 없음</span>}
              </div>
              {isPending && (
                <p className="check-row__pending" role="status">
                  집행 금액·집행일을 확인하세요. <b>다른 곳을 누르면 완료로 저장</b>돼요
                  <button type="button" className="check-row__pending-done" onClick={commitPending}>완료</button>
                </p>
              )}
            </div>
            {actions && <div className="check-row__actions">{actions(item)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** 날짜 오름차순 — 완료는 집행일, 미완료는 예정일 (날짜 없는 항목은 맨 뒤) */
export const byCheckDate = (a: ChecklistItem, b: ChecklistItem) =>
  (checkDateOf(a) ?? '9999').localeCompare(checkDateOf(b) ?? '9999');
