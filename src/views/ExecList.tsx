import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ExecRecord, View } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { fmt } from '@/lib/format';
import { CUR_YEAR, CUR_YYYYMM, PREV_MONTH_DEADLINE, execMinDate, parseYm, quarterOf, spentDateOf, shortMd, shortYmd } from '@/lib/date';
import {
  PROJECT_GROUP, TEAM_GROUP, bucketOf, budgetName, groupOf, parseTypeKey, recordTypeKey, typeIcon, workBudgetOf, workUsedOf,
} from '@/lib/budget';
import { budgetTypeOptions } from '@/components/budgetTypeOptions';
import { execProjects } from '@/store/selectors';
import { useToast } from '@/hooks/useToast';
import { onFocusRequest, takeFocus } from '@/lib/search';
import { AmountInput, Btn, Card, Checkbox, ConfirmLayer, DateField, EmptyState, FilterChip, Input, PageHead, Select, TableWrap, Toast, cx } from '@/components/ui';
import { IconChecklist, IconChevron, IconPlus, IconTrash } from '@/components/icons';
import MonthRange, { shiftYm } from '@/components/layout/MonthRange';
import './Exec.css';

/** 대메뉴 기준: 전체 / 팀 운영(회의비·업무비) / 프로젝트 운영 — 하위 선택은 옆 목록 */
type Filter = 'all' | 'team' | 'project';
const FILTERS: [Filter, string][] = [['all', '전체'], ['team', TEAM_GROUP], ['project', '프로젝트']];

interface SumLine { key: string; group: 'team' | 'project'; icon: string; name: string; sub: string; spent: number; remain: number | null; budget: number; used: number; ended?: boolean }

const SUM_GROUPS = [{ key: 'team', name: TEAM_GROUP, icon: '👥' }, { key: 'project', name: PROJECT_GROUP, icon: '📁' }] as const;

/** 요약 칸 금액 — 접힘: 한 줄 [집행 등록 · 잔여 예산] / 펼침: 3줄 집행 가능 · 집행 등록 · 잔여 예산 */
function SumFigures({ avail, spent, remain, full }: { avail: number; spent: number; remain: number; full: boolean }) {
  if (!full) {
    return (
      <dl className="exec-sum__line">
        <div><dt>집행 등록</dt><dd className="num">{fmt(spent)}</dd></div>
        <div className="exec-sum__line-remain"><dt>잔여 예산</dt><dd className={cx('num', remain < 0 && 'text-danger')}>{fmt(remain)}</dd></div>
      </dl>
    );
  }
  return (
    <dl className="exec-sum__fig">
      <div><dt>집행 가능</dt><dd className="num">{fmt(avail)}</dd></div>
      <div><dt>집행 등록</dt><dd className="num">{fmt(spent)}</dd></div>
      <div className="exec-sum__fig-remain"><dt>잔여 예산</dt><dd className={cx('num', remain < 0 && 'text-danger')}>{fmt(remain)}</dd></div>
    </dl>
  );
}

/**
 * 상단 요약 — 기본은 한 줄: [팀 운영 소계] [프로젝트 운영 소계] [조회 합계] [상세 ▾]
 * 상세를 펼치면 바로 아래로 예산 항목별 조회 기간 집행 · 잔액 내역이 열림
 */
function ExecSummary({ period, total, count, lines }: { period: string; total: number; count: number; lines: SumLine[] }) {
  // 메뉴로 다시 들어오면 항상 접힌 상태 (펼침은 이번 화면에서만)
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(v => !v);
  const toGroup = (g: { key: string; name: string; icon: string }, ls: SumLine[]) => {
    const sum = (f: (l: SumLine) => number) => ls.reduce((t, l) => t + f(l), 0);
    // 집행률 막대: 예산을 아는 항목(잔액 null 제외)의 예산 대비 사용액
    const known = ls.filter(l => l.remain != null);
    return {
      ...g, lines: ls, spent: sum(l => l.spent), remain: sum(l => l.remain ?? 0),
      budget: known.reduce((t, l) => t + l.budget, 0), used: known.reduce((t, l) => t + l.used, 0),
    };
  };
  const byGroup = SUM_GROUPS.map(g => toGroup(g, lines.filter(l => l.group === g.key))).filter(g => g.lines.length > 0);
  // 주관·참여 프로젝트가 없으면(모두 종료되고 조회 기간 집행도 없음) 팀 운영 소계 대신 [팀 회의비] [팀 업무비] 로 나눠 표시
  const split = !byGroup.some(g => g.key === 'project');
  const groups = !split
    ? byGroup
    : lines.filter(l => l.group === 'team').map(l => toGroup({ key: l.key, name: l.name, icon: l.icon }, [l]));
  const remainAll = groups.reduce((t, g) => t + g.remain, 0);

  return (
    <Card className={cx('exec-sum', open && 'is-open')}>
      {/* 모바일: 한 줄씩 — [잔여 예산 합계 ··· 상세] / 항목별 [아이콘 이름 ··· (집행 등록) 잔여 예산] / (펼침) [집행 가능 · 집행 등록] */}
      <div className="exec-sum-m show-mobile">
        <div className="exec-sum-m__top">
          <span className="exec-sum-m__label">잔여 예산 <small>{period} · {count}건</small></span>
          <b className={cx('exec-sum-m__total num', remainAll < 0 && 'text-danger')}>{fmt(remainAll)}</b>
          <button type="button" className="exec-sum__toggle" aria-expanded={open} aria-controls="exec-sum-detail-m" onClick={toggle}>
            {open ? '접기' : '상세'}<IconChevron size={14} aria-hidden="true" />
          </button>
        </div>
        <ul id="exec-sum-detail-m" className={cx('exec-sum-m__list', open && 'is-open')} aria-label="팀 운영 · 프로젝트 운영 잔여 예산">
          {open && <li className="exec-sum-m__li exec-sum-m__li--head" aria-hidden="true"><span>항목</span><span>집행 등록</span><span>잔여 예산</span></li>}
          {groups.map(g => [
            // 소계 줄: 팀 운영 / 프로젝트 운영
            <li key={g.key} className="exec-sum-m__li exec-sum-m__li--group">
              <span className="exec-sum-m__name"><span aria-hidden="true">{g.icon}</span><span className="exec-sum-m__text">{g.name}</span></span>
              {open && <span className="exec-sum-m__spent num" aria-label={`${g.name} 집행 등록 ${fmt(g.spent)}`}>{fmt(g.spent)}</span>}
              <span className={cx('exec-sum-m__remain num', g.remain < 0 && 'text-danger')} aria-label={`${g.name} 잔여 예산 ${fmt(g.remain)}`}>{fmt(g.remain)}</span>
            </li>,
            // 펼침: 소계 아래 항목별 줄
            // 팀 회의비·업무비로 나눈 경우 소계 줄 = 항목 줄이라 반복하지 않음
            ...(open && !(g.lines.length === 1 && g.lines[0].key === g.key) ? g.lines.map(l => (
              <li key={l.key} className={cx('exec-sum-m__li exec-sum-m__li--item', l.ended && 'is-ended')}>
                <span className="exec-sum-m__name" title={`${l.name} · ${l.sub}`}><span aria-hidden="true">{l.icon}</span><span className="exec-sum-m__text">{l.name}</span></span>
                <span className="exec-sum-m__spent num" aria-label={`집행 등록 ${fmt(l.spent)}`}>{fmt(l.spent)}</span>
                <span className={cx('exec-sum-m__remain num', l.remain != null && l.remain < 0 && 'text-danger')} aria-label={`잔여 예산 ${l.remain == null ? '없음' : fmt(l.remain)}`}>
                  {l.remain == null ? '—' : fmt(l.remain)}
                </span>
              </li>
            )) : []),
          ])}
        </ul>
        {open && (
          <div className="exec-sum-m__foot">
            <span>집행 가능 <b className="num">{fmt(remainAll + total)}</b></span>
            <span>집행 등록 <b className="num">{fmt(total)}</b></span>
          </div>
        )}
      </div>

      {/* 3칸 (3.5 : 3.5 : 3): 팀 운영 · 프로젝트 운영 · 합계 — 칸마다 집행 가능 / 집행 등록 / 잔여 예산 (가능 = 잔여 + 등록) */}
      <div className="exec-sum__cards hide-mobile">
        {groups.map(g => (
          <div key={g.key} className={cx('exec-sum__card', `exec-sum__card--${g.key}`)}>
            <span className="exec-sum__card-name"><span className="exec-sum__card-ico" aria-hidden="true">{g.icon}</span>{g.name}</span>
            <SumFigures full={open} avail={g.remain + g.spent} spent={g.spent} remain={g.remain} />
          </div>
        ))}
        <div className="exec-sum__card exec-sum__card--total">
          <div className="exec-sum__card-top">
            <span className="exec-sum__card-name">합계 <small>{period} · {count}건</small></span>
            <button type="button" className="exec-sum__toggle" aria-expanded={open} aria-controls="exec-sum-detail" onClick={toggle}>
              {open ? '접기' : '상세'}<IconChevron size={14} aria-hidden="true" />
            </button>
          </div>
          <SumFigures full={open} avail={remainAll + total} spent={total} remain={remainAll} />
        </div>
      </div>

      {/* 항목별 상세: 위 카드와 같은 칸 아래에 한 줄씩 [항목명 ··· 집행 · 잔액] (세부 기준은 이름에 마우스를 올리면) */}
      {/* 팀 회의비·업무비로 나눈 경우엔 위 칸과 같은 내용이라 생략 */}
      {open && !split && (
        <div id="exec-sum-detail" className="exec-sum__detail hide-mobile">
          {groups.length === 0 && <div className="exec-sum__empty">표시할 예산 항목이 없습니다</div>}
          {groups.map(g => (
            <ul key={g.key} className="exec-sum__list" aria-label={`${g.name} 항목별 내역`}>
              <li className="exec-sum__li exec-sum__li--head" aria-hidden="true"><span>항목</span><span className="exec-sum__li-spent">집행 등록</span><span className="exec-sum__li-remain">잔여 예산</span></li>
              {g.lines.map(l => (
                <li key={l.key} className={cx('exec-sum__li', l.ended && 'is-ended')}>
                  <span className="exec-sum__li-name" title={`${l.name} · ${l.sub}`}><span aria-hidden="true">{l.icon}</span><span className="exec-sum__li-text">{l.name}</span></span>
                  <span className="exec-sum__li-spent num" aria-label={`집행 등록 ${fmt(l.spent)}`}>{fmt(l.spent)}</span>
                  <span className={cx('exec-sum__li-remain num', l.remain != null && l.remain < 0 && 'text-danger')} aria-label={`잔여 예산 ${l.remain == null ? '없음' : fmt(l.remain)}`}>
                    {l.remain == null ? '—' : fmt(l.remain)}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 표 제목행 정렬 — 같은 열을 다시 누르면 오름/내림 전환 */
type SortKey = 'useDate' | 'type' | 'name' | 'amount' | 'reg';
/** mLabel: 모바일 머리글 2줄 [집행일자 · 항목] / [예산 유형 ··· 금액] */
const SORT_COLS: { key: SortKey; label: string; mLabel?: string; right?: boolean; className?: string }[] = [
  { key: 'useDate', label: '사용일자', mLabel: '날짜' }, { key: 'type', label: '예산 유형', mLabel: '예산 항목' }, { key: 'name', label: '항목명', mLabel: '항목' },
  { key: 'amount', label: '금액', right: true }, { key: 'reg', label: '등록일', className: 'exec-table__date' },
];

/** 표 안에서 바로 수정하는 칸 */
type Field = 'useDate' | 'type' | 'name' | 'amount';
interface EditCell { id: string; field: Field; value: string | number }

const periodText = (s: string, e: string) => {
  const t = (v: string) => `${v.slice(0, 4)}.${v.slice(5, 7)}`;
  return s === e ? t(s) : `${t(s)} ~ ${t(e)}`;
};

/** 집행 등록 저장 후 집행 현황으로 돌아올 때 띄울 완료 안내 (한 번만) */
let pendingToast: string | null = null;
export const toastOnExecList = (msg: string) => { pendingToast = msg; };

export default function ExecList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const { records, projects } = state;
  const dispatch = useDispatch();
  const [toast, showToast] = useToast();
  const [arrivalMsg] = useState(() => pendingToast);
  useEffect(() => { pendingToast = null; if (arrivalMsg) showToast(arrivalMsg); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<Filter>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [flashId, setFlashId] = useState<string | null>(() => takeFocus('exec'));
  // 행 선택 → 선택된 행의 칸을 한 번 더 누르면 그 칸만 바로 수정
  const [selectedId, setSelectedId] = useState<string | null>(flashId);
  const [edit, setEdit] = useState<EditCell | null>(null);
  const editRef = useRef<EditCell | null>(null);
  editRef.current = edit;
  // 체크한 행 → [선택 삭제]
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 정렬: 기본은 사용일자 최신순
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'useDate', dir: -1 });
  const sortBy = (key: SortKey) => setSort(cur => (cur.key === key
    ? { key, dir: cur.dir === 1 ? -1 : 1 }
    : { key, dir: key === 'type' || key === 'name' ? 1 : -1 }));

  // 조회 기간 (사용월 기준) — 기본: 이번 달 ~ 이번 달. 검색에서 넘어오면 그 기록의 달
  const focusRec = flashId ? records.find(r => r.id === flashId) : undefined;
  const [start, setStart] = useState(focusRec?.month ?? CUR_YYYYMM);
  const [end, setEnd] = useState(focusRec?.month ?? CUR_YYYYMM);
  const allMonths = [...records.map(r => r.month), ...projects.map(p => p.startDate.slice(0, 7)).filter(Boolean)];
  const minMonth = allMonths.reduce((a, b) => (b < a ? b : a), CUR_YYYYMM);
  const maxMonth = records.map(r => r.month).reduce((a, b) => (b > a ? b : a), CUR_YYYYMM);
  // 조회 조건이 바뀌면 선택·체크·수정 초기화 (안 보이는 행이 지워지지 않도록)
  const resetMarks = () => { setChecked(new Set()); setConfirmDelete(false); setEdit(null); setSelectedId(null); };
  const setRange = (s: string, e: string) => { setStart(s); setEnd(e); resetMarks(); };

  const projName = (id?: string) => projects.find(p => p.id === id)?.name ?? '삭제된 프로젝트';
  const usedProjectIds = Array.from(new Set(records.filter(r => r.type === 'project').map(r => r.projectId!)));
  const filtered = records
    .filter(r => r.month >= start && r.month <= end)
    .filter(r => {
      if (filter === 'team') return r.type !== 'project' && (projectFilter === 'all' || r.type === projectFilter);
      if (filter === 'project') return r.type === 'project' && (projectFilter === 'all' || r.projectId === projectFilter);
      return true;
    })
    .sort((a, b) => {
      const v = (r: ExecRecord): string | number => sort.key === 'useDate' ? spentDateOf(r) : sort.key === 'reg' ? r.date
        : sort.key === 'amount' ? r.total : sort.key === 'name' ? r.items[0]?.name ?? '' : `${groupOf(r.type)} ${budgetName(state, r)}`;
      const x = v(a), y = v(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      // 같으면 사용일자 → 등록일 최신순
      return c * sort.dir || spentDateOf(b).localeCompare(spentDateOf(a)) || b.date.localeCompare(a.date);
    });

  // 필터 칩 건수: 조회 기간 안의 전체 / 팀 운영 / 프로젝트 운영
  const inPeriod = records.filter(r => r.month >= start && r.month <= end);
  const periodCounts: Record<Filter, number> = {
    all: inPeriod.length,
    team: inPeriod.filter(r => r.type !== 'project').length,
    project: inPeriod.filter(r => r.type === 'project').length,
  };

  // ── 상단 요약 ──
  // 팀 회의비는 조회 기간에 걸친 올해 분기들의 예산·사용액 합
  const qs = new Set<number>();
  for (let m = start; m <= end; m = shiftYm(m, 1)) {
    const { year, month } = parseYm(m);
    if (year === CUR_YEAR) qs.add(quarterOf(month));
  }
  const qList = [...qs].sort().map(i => state.quarters[i]);
  // 요약은 조회 기간에만 따름 (표의 전체/팀 운영/프로젝트 필터와 무관) — 표에서 수정·삭제하면 금액만 바로 반영
  const spentOf = (pred: (r: ExecRecord) => boolean) => inPeriod.filter(pred).reduce((s, r) => s + r.total, 0);
  const sumLines: SumLine[] = [];
  {
    const budget = qList.reduce((s, q) => s + q.budget, 0), used = qList.reduce((s, q) => s + q.used, 0);
    const qLabel = qList.length > 1 ? `${qList[0].label.replace('분기', '')}~${qList[qList.length - 1].label}` : qList[0]?.label;
    sumLines.push({
      key: 'meeting', group: 'team', icon: '👥', name: '팀 회의비',
      sub: qList.length ? `${qLabel} 예산 ${fmt(budget)}` : '올해가 아닌 기간 (분기 예산 없음)',
      spent: spentOf(r => r.type === 'meeting'),
      remain: qList.length ? budget - used : null, budget, used,
    });
  }
  // 팀 업무비는 조회 기간의 달마다 월 예산·사용액 합 (이월 없음)
  {
    let budget = 0, used = 0;
    for (let m = start; m <= end; m = shiftYm(m, 1)) { budget += workBudgetOf(state, m).amount; used += workUsedOf(state, m); }
    sumLines.push({
      key: 'work', group: 'team', icon: '💼', name: '팀 업무비', sub: `${periodText(start, end)} 월 예산 ${fmt(budget)}`,
      spent: spentOf(r => r.type === 'work'), remain: budget - used, budget, used,
    });
  }
  {
    // 주관 프로젝트 = 프로젝트 배분 경비 전체 / 배분받은 코웍 프로젝트 = 우리 팀 배분액 기준
    const team = state.session?.team;
    projects
      .filter(p => ((p.isMine || p.joined) && p.active) || inPeriod.some(r => r.projectId === p.id))
      .forEach(p => {
        const mine = !p.isMine ? state.allocs[p.id]?.find(a => a.teamName === team) : undefined;
        const budget = mine ? mine.amount : p.allocPool, used = mine ? mine.used ?? 0 : p.used;
        sumLines.push({
          key: p.id, group: 'project', icon: '📁', name: p.name,
          sub: `${mine ? '우리 팀 배분' : '배분 경비'} ${fmt(budget)}${p.active ? '' : ' · 종료'}`,
          spent: spentOf(r => r.projectId === p.id && (!mine || r.team === team)), remain: budget - used, budget, used, ended: !p.active,
        });
      });
  }

  // ── 예산 유형 목록 (진행 중인 내 프로젝트 + 팀 회의비) ──
  /** 이 집행의 사용일자에 쓸 수 있는 프로젝트 (사용 종료일 이내 · 주관 또는 배분받은 팀) */
  const typeProjectsOf = (r: ExecRecord) => execProjects(state, spentDateOf(r));
  const typeName = (r: ExecRecord) => budgetName(state, r);

  /** r 을 key·사용월·금액으로 바꿀 때 예산이 모자라면 안내 문구 (같은 예산이면 기존 금액은 되돌려 계산) */
  const shortage = (r: ExecRecord, key: string, month: string, amount: number): string | null => {
    const to = bucketOf(state, key, month);
    if (!to || to.remain == null) return null;
    const from = bucketOf(state, recordTypeKey(r), r.month);
    const avail = to.remain + (from?.id === to.id ? r.total : 0);
    return amount > avail ? `${to.name} 잔액(${fmt(avail)})이 부족합니다.` : null;
  };

  /** 수정한 칸 1개 저장 — 값이 그대로면 아무것도 안 함 */
  const commit = (r: ExecRecord, field: Field, value: string | number) => {
    // 이미 저장·취소된 칸이면 무시 (Enter 뒤 blur 등)
    if (editRef.current?.id !== r.id || editRef.current.field !== field) return;
    editRef.current = null;
    setEdit(null);
    let next: ExecRecord = r;
    if (field === 'useDate') {
      const v = String(value);
      if (!v || v === spentDateOf(r)) return;
      // 지난달 사용 건은 이번 달 15일까지만 (집행 등록과 같은 규칙)
      if (v < execMinDate()) { showToast(`사용일자는 ${execMinDate()}부터 고를 수 있습니다 (지난달 사용 건은 매월 ${PREV_MONTH_DEADLINE}일까지).`, 'warn'); return; }
      next = { ...r, useDate: v, month: v.slice(0, 7) };
      // 프로젝트 경비는 사용 종료일이 지난 날짜로 옮길 수 없음
      if (r.type === 'project' && r.projectId && !execProjects(state, v).some(p => p.id === r.projectId)) {
        showToast(`${typeName(r)} 경비는 ${v} 사용 건으로 등록할 수 없습니다 (사용 종료일 이후).`, 'warn');
        return;
      }
    } else if (field === 'type') {
      const key = String(value);
      if (key === recordTypeKey(r)) return;
      const { type, projectId } = parseTypeKey(key);
      next = { ...r, type, projectId, team: r.team ?? state.session?.team };
    } else if (field === 'name') {
      const v = String(value).trim() || '기타 경비';
      if (v === r.items[0]?.name) return;
      next = { ...r, items: [{ name: v, amount: r.total }] };
    } else {
      const v = Number(value);
      if (!v || v === r.total) return;
      next = { ...r, items: [{ name: r.items[0]?.name ?? '기타 경비', amount: v }] };
    }
    const msg = shortage(r, recordTypeKey(next), next.month, next.items[0].amount);
    if (msg) { showToast(`${msg} 수정할 수 없습니다.`, 'warn'); return; }
    dispatch({ type: 'UPDATE_RECORD', record: next });
    showToast(field === 'type' ? `예산 유형을 '${typeName(next)}'(으)로 변경했습니다.` : '집행 이력이 수정되었습니다.');
  };

  // 행 클릭: 처음 = 선택, 선택된 행에서 한 번 더 = 그 칸 수정
  const onCell = (r: ExecRecord, field?: Field) => {
    if (edit?.id === r.id && edit.field === field) return; // 수정 중인 칸(팝업 포함) 안의 클릭
    if (selectedId !== r.id) { setSelectedId(r.id); setEdit(null); return; }
    if (!field) return;
    const value = field === 'useDate' ? spentDateOf(r) : field === 'type' ? recordTypeKey(r) : field === 'name' ? r.items[0]?.name ?? '' : r.total;
    setEdit({ id: r.id, field, value });
  };
  const textKeys = (r: ExecRecord) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(r, edit!.field, edit!.value); }
    else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
  };

  // ── 체크 삭제 ──
  const visibleChecked = filtered.filter(r => checked.has(r.id));
  const allChecked = filtered.length > 0 && visibleChecked.length === filtered.length;
  const toggleCheck = (id: string) => setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // 모바일(체크박스 숨김): 행을 꾹 누르면(0.5초) 삭제 선택 토글 — 손을 떼며 생기는 클릭은 무시
  const press = useRef<{ id: string; x: number; y: number; timer: number; fired: boolean } | null>(null);
  const isMobile = () => window.matchMedia('(max-width: 1024px)').matches;
  const pressStart = (id: string) => (e: ReactPointerEvent) => {
    if (!isMobile() || edit?.id === id) return;
    const timer = window.setTimeout(() => {
      if (!press.current) return;
      press.current.fired = true;
      toggleCheck(id);
      setSelectedId(null); setEdit(null);
      setConfirmDelete(false);
      navigator.vibrate?.(15);
    }, 500);
    press.current = { id, x: e.clientX, y: e.clientY, timer, fired: false };
  };
  const pressMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { window.clearTimeout(p.timer); press.current = null; }
  };
  const pressEnd = () => { const p = press.current; if (p && !p.fired) { window.clearTimeout(p.timer); press.current = null; } };
  // 선택 모드(모바일): 꾹 눌러 하나라도 선택되면 시작 → 이후 탭 = 선택/해제, 선택이 0건이 되거나 [완료]를 누르면 끝
  const [mobile, setMobile] = useState(isMobile);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const selectMode = mobile && visibleChecked.length > 0;
  const pressClick = (id: string) => (e: ReactMouseEvent) => {
    if (press.current?.fired) { e.stopPropagation(); e.preventDefault(); press.current = null; return; }
    if (selectMode) { e.stopPropagation(); e.preventDefault(); toggleCheck(id); setConfirmDelete(false); }
  };
  const exitSelect = () => { setChecked(new Set()); setConfirmDelete(false); };
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map(r => r.id)));
  const deleteChecked = () => {
    const ids = visibleChecked.map(r => r.id);
    if (!ids.length) return;
    dispatch({ type: 'DELETE_RECORDS', ids });
    resetMarks();
    showToast(`집행 이력 ${ids.length}건이 삭제되었습니다.`);
  };

  // 헤더 검색에서 이동 → 그 기록의 달로 기간 이동 후 강조·선택
  useEffect(() => onFocusRequest('exec', id => {
    setFilter('all'); setProjectFilter('all');
    const rec = records.find(r => r.id === id);
    if (rec) setRange(rec.month, rec.month);
    setSelectedId(id); setFlashId(id);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!flashId) return;
    document.querySelector(`[data-rec="${flashId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashId(null), 1800);
    return () => window.clearTimeout(t);
  }, [flashId]);
  // 표 바깥을 누르면 선택 해제 (수정 중 팝업 안 클릭은 제외)
  useEffect(() => {
    if (!selectedId) return;
    const off = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest('.exec-table tbody tr, .popover')) { setSelectedId(null); setEdit(null); }
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [selectedId]);

  const range = <MonthRange start={start} end={end} onChange={setRange} min={minMonth} max={maxMonth} />;

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead
        title="집행 현황" extra={<span className="hide-mobile">{range}</span>}
        actions={<>
          {/* 모바일: 하단 탭 대신 여기서 코웍 체크리스트로 진입 */}
          <Btn variant="secondary" className="exec-cowork-m" onClick={() => onNavigate('cowork')}><IconChecklist size={15} />코웍 체크리스트 보기</Btn>
          <Btn className="exec-cta" onClick={() => onNavigate('exec-new')}><IconPlus size={14} />집행 등록</Btn>
        </>}
      />
      {/* 모바일: 페이지 제목이 헤더에 있으므로 기간 선택만 상단에 */}
      <div className="exec-period-m">{range}</div>

      <ExecSummary period={periodText(start, end)} total={inPeriod.reduce((s, r) => s + r.total, 0)} count={inPeriod.length} lines={sumLines} />

      <div className="exec-filter">
        <div className="chip-row">
          {FILTERS.map(([v, label]) => (
            <FilterChip key={v} label={label} count={periodCounts[v]} active={filter === v} onClick={() => { setFilter(v); setProjectFilter('all'); resetMarks(); }} />
          ))}
        </div>
        {filter === 'team' && (
          <Select size="sm" value={projectFilter} onChange={e => { setProjectFilter(e.target.value); resetMarks(); }} aria-label="팀 운영 항목 필터">
            <option value="all">전체 항목</option>
            <option value="meeting">팀 회의비</option>
            <option value="work">팀 업무비</option>
          </Select>
        )}
        {filter === 'project' && (
          <Select size="sm" value={projectFilter} onChange={e => { setProjectFilter(e.target.value); resetMarks(); }} aria-label="사업 필터">
            <option value="all">전체 사업</option>
            {usedProjectIds.map(id => <option key={id} value={id}>{projName(id)}</option>)}
          </Select>
        )}
        <Btn variant="danger" size="sm" className={cx('exec-filter__del', mobile && 'hide-mobile')} disabled={!visibleChecked.length} onClick={() => setConfirmDelete(true)}>
          <IconTrash size={13} />선택 삭제{visibleChecked.length > 0 && ` (${visibleChecked.length})`}
        </Btn>
      </div>

      {confirmDelete && visibleChecked.length > 0 && (
        <ConfirmLayer tone="danger" title="집행 이력 삭제" confirmLabel="삭제" onConfirm={deleteChecked} onCancel={() => setConfirmDelete(false)}>
          체크한 집행 이력 <b>{visibleChecked.length}건</b>(합계 <b>{fmt(visibleChecked.reduce((s, r) => s + r.total, 0))}</b>)을 삭제할까요? 예산 사용액도 함께 복원됩니다.
        </ConfirmLayer>
      )}

      <p className="exec-hint">
        <span className="hide-mobile">목록에서 수정할 리스트를 선택하고, 수정 항목을 한 번 더 누르면 쉽고 빠른 수정이 가능합니다.</span>
        <span className="show-mobile">{selectMode
          ? '선택 모드: 행을 누를 때마다 선택·해제됩니다. [완료]로 끝냅니다.'
          : <>수정 : 목록 선택 후 수정 항목을 클릭<br />삭제 : 목록을 꾹- 눌러 선택 후 삭제</>}</span>
      </p>

      {/* 모바일 선택 모드 바 — 화면 위쪽에 붙어 따라옴 */}
      {selectMode && (
        <div className="exec-selbar" role="toolbar" aria-label="선택 모드">
          <span className="exec-selbar__count"><b>{visibleChecked.length}건</b> 선택 · {fmt(visibleChecked.reduce((t, r) => t + r.total, 0))}</span>
          <Btn size="sm" variant="ghost" onClick={toggleAll}>{allChecked ? '전체 해제' : '전체 선택'}</Btn>
          <Btn size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><IconTrash size={13} />삭제</Btn>
          <Btn size="sm" variant="inverse" onClick={exitSelect} aria-label="선택 모드 끝내기">완료</Btn>
        </div>
      )}
      <Card className={cx('card--clip', selectMode && 'is-select-mode')}>
        <TableWrap>
          {/* 1줄 = 1건(1항목) · 열 너비 고정 (긴 사업명은 … 처리) */}
          <table className="table exec-table">
            <colgroup>
              <col className="exec-col--check" /><col className="exec-col--date" /><col className="exec-col--type" />
              <col className="exec-col--name" /><col className="exec-col--amt" /><col className="exec-col--reg" />
            </colgroup>
            <thead>
              <tr>
                <th className="exec-table__check">
                  <Checkbox checked={allChecked} disabled={!filtered.length}
                    ref={el => { if (el) el.indeterminate = visibleChecked.length > 0 && !allChecked; }}
                    onChange={toggleAll} aria-label="전체 선택" />
                </th>
                {SORT_COLS.map(c => {
                  const on = sort.key === c.key;
                  return (
                    <th key={c.key} className={cx(c.right && 't-right', c.className)} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className={cx('exec-sort', on && 'is-on')} onClick={() => sortBy(c.key)}
                        title={`${c.label} 기준 정렬`}>
                        {c.mLabel ? <><span className="hide-mobile">{c.label}</span><span className="show-mobile-inline">{c.mLabel}</span></> : c.label}<span className="exec-sort__ico" aria-hidden="true">{on ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6}><EmptyState icon="📋" message={`${periodText(start, end)} 집행 이력이 없습니다`} /></td></tr>
              )}
              {filtered.map(r => {
                const sel = selectedId === r.id;
                const cell = edit?.id === r.id ? edit : null;
                const on = (f: Field) => cell?.field === f;
                const setVal = (value: string | number) => setEdit(e => (e ? { ...e, value } : e));
                return (
                  <tr key={r.id} data-rec={r.id} tabIndex={0} aria-selected={sel}
                    className={cx('is-clickable', sel && 'is-selected', checked.has(r.id) && 'is-checked', flashId === r.id && 'is-flash', !spentDateOf(r).startsWith(`${CUR_YEAR}-`) && 'is-past-year')}
                    onClick={() => onCell(r)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onCell(r); }}
                    onPointerDown={pressStart(r.id)} onPointerMove={pressMove} onPointerUp={pressEnd} onPointerCancel={pressEnd} onPointerLeave={pressEnd}
                    onClickCapture={pressClick(r.id)} onContextMenu={e => { if (isMobile()) e.preventDefault(); }}>
                    <td className="exec-table__check" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={checked.has(r.id)} onChange={() => toggleCheck(r.id)}
                        aria-label={`${spentDateOf(r)} ${r.items[0]?.name ?? ''} 선택`} />
                    </td>
                    <td className="exec-table__use t-nowrap" onClick={e => { e.stopPropagation(); onCell(r, 'useDate'); }}>
                      {on('useDate')
                        ? <DateField defaultOpen min={execMinDate()} value={String(cell!.value)} aria-label="사용일자"
                            onChange={v => commit(r, 'useDate', v)} onClose={() => setEdit(null)} />
                        : <span className="exec-table__month">
                            {/* 모바일: 올해 기록은 월-일만 (조회 기간이 화면 위에 있어 연도 생략) */}
                            {/* PC 큰 글씨: 26/9/5 형식으로 줄여 표 가로 스크롤 방지 */}
                            {spentDateOf(r).startsWith(`${CUR_YEAR}-`)
                              ? <><span className="hide-mobile"><span className="dt-full">{spentDateOf(r)}</span><span className="dt-short">{shortYmd(spentDateOf(r))}</span></span><span className="show-mobile-inline">{spentDateOf(r).slice(5)}</span></>
                              : <><span className="dt-full">{spentDateOf(r)}</span><span className="dt-short">{shortYmd(spentDateOf(r))}</span></>}
                          </span>}
                    </td>
                    <td className="exec-table__typecol" onClick={e => { e.stopPropagation(); onCell(r, 'type'); }}>
                      <div className="exec-table__type-cell">
                        <span className={cx('type-ico', r.type === 'project' && 'is-project', r.type === 'work' && 'is-work')} aria-hidden="true">{typeIcon(r.type)}</span>
                        {on('type') ? (
                          <Select bare defaultOpen className="exec-type-pick" popClassName="exec-type-pop" aria-label="예산 유형 변경"
                            value={recordTypeKey(r)} onChange={e => commit(r, 'type', e.target.value)} onClose={() => setEdit(null)}>
                            {budgetTypeOptions(typeProjectsOf(r), {
                              extra: r.type === 'project' && !typeProjectsOf(r).some(p => p.id === r.projectId) && (
                                <option value={recordTypeKey(r)} disabled>{projName(r.projectId)} (종료)</option>
                              ),
                            })}
                          </Select>
                        ) : (
                          <span className="exec-table__type-name" title={typeName(r)}>{typeName(r)}</span>
                        )}
                      </div>
                    </td>
                    <td className="exec-table__name" onClick={e => { e.stopPropagation(); onCell(r, 'name'); }}>
                      {on('name')
                        ? <Input autoFocus value={String(cell!.value)} aria-label="항목명" onChange={e => setVal(e.target.value)}
                            onBlur={() => commit(r, 'name', cell!.value)} onKeyDown={textKeys(r)} />
                        : <span>{r.items[0]?.name || '기타 경비'}</span>}
                    </td>
                    <td className="exec-table__amtcol t-right t-nowrap" onClick={e => { e.stopPropagation(); onCell(r, 'amount'); }}>
                      {on('amount')
                        ? <AmountInput autoFocus value={Number(cell!.value)} aria-label="금액" onChange={v => setVal(v)}
                            onBlur={() => commit(r, 'amount', cell!.value)} onKeyDown={textKeys(r)} />
                        : <span className="num exec-table__amt">{fmt(r.total)}</span>}
                    </td>
                    <td className="t-nowrap t-muted exec-table__date"><span className="dt-full">{r.date}</span><span className="dt-short">{shortMd(r.date)}</span></td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="exec-table__total">
                  <td />
                  <td colSpan={3}>합계 <small>{filtered.length}건</small></td>
                  <td className="t-right t-nowrap"><span className="num">{fmt(filtered.reduce((s, r) => s + r.total, 0))}</span></td>
                  <td className="exec-table__date" />
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
