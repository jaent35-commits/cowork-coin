import { useMemo, useState } from 'react';
import type { View } from '@/types';
import { useAppState } from '@/store/StoreContext';
import { GROUPS, searchAll, useSearchQuery, type HitGroup, type SearchHit } from '@/lib/search';
import { IconChevron } from '@/components/icons';
import { Mark, goToHit, hitIcon } from '@/components/layout/HeaderSearch';
import { Card, EmptyState, PageHead } from '@/components/ui';
import './Pages.css';

/** 메뉴별 먼저 보여 줄 건수 */
const PREVIEW = 5;

/**
 * 검색 결과 페이지 — 헤더 검색에서 Enter / '검색 결과 전체 보기'
 * 결과가 있는 메뉴(메뉴 바로가기 · 프로젝트 운영 · 체크리스트 · 팀 운영 · 집행 내역)만 카드로, 각 5건 요약 → [더보기]
 * 맨 위 메뉴별 건수 칩을 누르면 그 카드로 이동, 항목을 누르면 헤더 검색 목록과 똑같이 해당 화면으로 이동해 선택·강조
 */
export default function Search({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const q = useSearchQuery();
  const res = useMemo(() => searchAll(q, state, Infinity), [q, state]);
  const groups = GROUPS.filter(g => res[g.key].length > 0);
  const total = groups.reduce((s, g) => s + res[g.key].length, 0);
  // 더보기로 펼친 메뉴 — 검색어가 바뀌면 다시 요약(5건)부터
  const [open, setOpen] = useState<{ q: string; secs: HitGroup[] }>({ q, secs: [] });
  const isOpen = (k: HitGroup) => open.q === q && open.secs.includes(k);
  const toggle = (k: HitGroup) => setOpen(o => {
    const secs = o.q === q ? o.secs : [];
    return { q, secs: secs.includes(k) ? secs.filter(x => x !== k) : [...secs, k] };
  });
  const jump = (k: HitGroup) => document.getElementById(`search-sec-${k}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const section = (key: HitGroup, title: string, hits: SearchHit[]) => {
    const expanded = isOpen(key);
    const shown = expanded ? hits : hits.slice(0, PREVIEW);
    const rest = hits.length - PREVIEW;
    return (
      <Card key={key} className="card--clip search-sec">
        <h2 className="search-sec__title" id={`search-sec-${key}`}>
          {title} <span>{hits.length}건</span>
          {rest > 0 && <small>{expanded ? '전체 표시' : `${PREVIEW}건 요약`}</small>}
        </h2>
        <ul className="search-list" id={`search-list-${key}`}>
          {shown.map(h => (
            <li key={h.key}>
              <button type="button" className="search-item" onClick={() => goToHit(h, onNavigate)}>
                <span className="search-item__ico" aria-hidden="true">{hitIcon(h)}</span>
                <span className="search-item__text">
                  <strong><Mark text={h.title} q={q} /></strong>
                  <small><Mark text={h.sub} q={q} /></small>
                </span>
                {h.meta && <span className="search-item__meta">{h.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
        {rest > 0 && (
          <button type="button" className={`search-more${expanded ? ' is-open' : ''}`} aria-expanded={expanded} aria-controls={`search-list-${key}`}
            onClick={() => toggle(key)}>
            {expanded ? '접기' : <>더보기 <b>{rest}건</b></>}<IconChevron size={14} aria-hidden="true" />
          </button>
        )}
      </Card>
    );
  };

  return (
    <div className="view-enter">
      <PageHead title="검색 결과" />
      {!q ? (
        <Card><EmptyState icon="🔍" message="검색어를 입력하세요" sub="위쪽 검색창에서 메뉴·프로젝트·체크리스트·집행 내역을 찾을 수 있어요" /></Card>
      ) : total === 0 ? (
        <Card><EmptyState icon="🔍" message={`‘${q}’에 대한 결과가 없습니다`} sub="메뉴 이름, 프로젝트명·발주처·팀, 체크리스트 항목, 분기·월, 집행 항목명으로 검색할 수 있어요" /></Card>
      ) : (
        <>
          <div className="search-top">
            <p className="search-summary"><b>‘{q}’</b> 검색 결과 <b>{total}건</b></p>
            {/* 메뉴별 건수 — 누르면 그 카드로 */}
            <div className="chip-row search-jump" role="navigation" aria-label="메뉴별 결과로 이동">
              {groups.map(g => (
                <button key={g.key} type="button" className="chip" onClick={() => jump(g.key)}>
                  {g.title}<span className="chip__count">{res[g.key].length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="search-secs">
            {groups.map(g => section(g.key, g.title, res[g.key]))}
          </div>
        </>
      )}
    </div>
  );
}
