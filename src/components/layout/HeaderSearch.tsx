import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { View } from '@/types';
import { useAppState } from '@/store/StoreContext';
import { GROUPS, requestFocus, scrollToAnchor, searchAll, setSearchQuery, type FocusKind, type SearchHit } from '@/lib/search';
import { CUR_YEAR } from '@/lib/date';
import { setViewYear } from '@/lib/viewYear';
import { IconClose, IconSearch } from '../icons';
import { cx } from '../ui';

/** 검색어와 일치하는 부분 강조 */
export function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** 결과 종류 아이콘 (헤더 목록 · 검색 결과 페이지 공용) */
const ICON: Record<SearchHit['kind'], string> = { menu: '🧭', project: '📁', joined: '🤝', check: '📋', quarter: '👥', work: '💼', exec: '🧾' };
export const hitIcon = (h: SearchHit) =>
  h.kind === 'exec' ? (h.title.includes('팀 회의비') ? '👥' : h.title.includes('팀 업무비') ? '💼' : '🧾') : ICON[h.kind];

/** 검색 결과로 이동 — 대상 화면이 해당 항목을 선택·강조 (헤더 목록 · 검색 결과 페이지 공용) */
export function goToHit(hit: SearchHit, onNavigate: (v: View) => void) {
  // 탭 먼저 → 항목 (이미 열린 화면은 탭 전환 뒤 새로 그려진 목록이 항목을 가져감)
  if (hit.tab) requestFocus('tab', hit.tab);
  // 팀 회의비 분기·팀 업무비 월은 올해 기준
  if (hit.kind === 'quarter') setViewYear(CUR_YEAR);
  if (hit.kind === 'work') setViewYear(Number(hit.id.slice(0, 4)));
  // 메뉴는 화면만, 종료된 참여 프로젝트(리포트로 이동)는 강조할 목록이 없음
  if (hit.kind !== 'menu' && !(hit.kind === 'joined' && hit.view === 'report')) requestFocus(hit.kind as FocusKind, hit.id);
  onNavigate(hit.view);
  if (hit.anchor) scrollToAnchor(hit.anchor);
}

/** 헤더 검색 — 전체 메뉴(메뉴 바로가기·프로젝트·체크리스트·팀 운영·집행 내역) 대상, 묶음별 최대 4건 (전체는 검색 결과 페이지). 데스크탑은 입력창, ≤1024 는 아이콘 → 헤더 아래 검색바 */
export default function HeaderSearch({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);       // 결과 패널
  const [mobileOpen, setMobileOpen] = useState(false); // 모바일 검색바
  const [active, setActive] = useState(0);
  // 화살표로 항목을 골랐는지 — 고른 상태의 Enter 는 그 항목으로, 아니면 검색 결과 페이지로
  const [picked, setPicked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const res = useMemo(() => searchAll(q.trim(), state, 4), [q, state]);
  const flat = GROUPS.flatMap(g => res[g.key]);
  const totalCount = GROUPS.reduce((s, g) => s + res.count[g.key], 0);
  const showPanel = open && q.trim().length > 0;

  useEffect(() => { setActive(0); setPicked(false); }, [q]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); setMobileOpen(false); }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => { if (mobileOpen) inputRef.current?.focus(); }, [mobileOpen]);

  const go = (hit: SearchHit) => {
    goToHit(hit, onNavigate);
    setOpen(false);
    setMobileOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  /** 검색 결과 페이지 — 프로젝트 운영 · 집행 내역 전체 목록 */
  const showAll = () => {
    const query = q.trim();
    if (!query) return;
    setSearchQuery(query);
    onNavigate('search');
    setOpen(false);
    setMobileOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); setMobileOpen(false); inputRef.current?.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (picked && flat[active]) go(flat[active]); else showAll(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setPicked(true); setActive(i => (picked ? (i + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPicked(true); setActive(i => (i - 1 + flat.length) % flat.length); }
  };

  const group = (title: string, hits: SearchHit[], offset: number, count: number) => hits.length > 0 && (
    <div className="hsearch__group" role="group" aria-label={title}>
      <div className="hsearch__group-title">{title} <span>{count}</span>{count > hits.length && <em> · {hits.length}건 표시</em>}</div>
      {hits.map((h, i) => (
        <button key={h.key} id={`${listId}-${offset + i}`} type="button" role="option" aria-selected={active === offset + i}
          className={cx('hsearch__item', picked && active === offset + i && 'is-active')}
          onMouseEnter={() => { setActive(offset + i); setPicked(true); }} onClick={() => go(h)}>
          <span className="hsearch__ico" aria-hidden="true">{hitIcon(h)}</span>
          <span className="hsearch__text">
            <strong><Mark text={h.title} q={q.trim()} /></strong>
            <small><Mark text={h.sub} q={q.trim()} /></small>
          </span>
          {h.meta && <span className="hsearch__meta">{h.meta}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={cx('hsearch', mobileOpen && 'is-mobile-open')}>
      <button type="button" className="icon-btn hsearch__toggle" aria-label="검색" aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(v => !v)}>
        <IconSearch size={17} />
      </button>

      <div className="hsearch__bar">
        <div className="hsearch__field">
          <IconSearch size={16} className="hsearch__icon" aria-hidden="true" />
          <input ref={inputRef} type="search" value={q} placeholder="메뉴·프로젝트·집행 내역 검색"
            role="combobox" aria-expanded={showPanel} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={showPanel && picked && flat.length ? `${listId}-${active}` : undefined}
            aria-label="메뉴·프로젝트·집행 내역 검색"
            onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
          {q && (
            <button type="button" className="hsearch__clear" aria-label="검색어 지우기" onClick={() => { setQ(''); inputRef.current?.focus(); }}>
              <IconClose size={13} />
            </button>
          )}
        </div>

        {showPanel && (
          <div id={listId} className="hsearch__panel" role="listbox" aria-label="검색 결과">
            {flat.length === 0 ? (
              <div className="hsearch__empty">‘{q.trim()}’에 대한 결과가 없습니다<small>메뉴 이름, 프로젝트명·발주처·팀, 체크리스트 항목, 분기·월, 집행 항목명으로 검색할 수 있어요</small></div>
            ) : (
              <>
                {GROUPS.map((g, gi) => (
                  <Fragment key={g.key}>{group(g.title, res[g.key], GROUPS.slice(0, gi).reduce((s, x) => s + res[x.key].length, 0), res.count[g.key])}</Fragment>
                ))}
              </>
            )}
            <button type="button" className="hsearch__all" onClick={showAll}>
              <IconSearch size={14} aria-hidden="true" />‘{q.trim()}’ 검색 결과 전체 보기 ({totalCount}건)<span className="hsearch__all-key" aria-hidden="true">Enter</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
