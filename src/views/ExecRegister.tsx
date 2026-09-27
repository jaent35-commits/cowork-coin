import { useEffect, useState, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { openProjects } from '@/store/selectors';
import { TODAY_ISO } from '@/lib/date';
import { fmt, uid } from '@/lib/format';
import { bucketOf, parseTypeKey, type Bucket } from '@/lib/budget';
import { useToast } from '@/hooks/useToast';
import { AmountInput, Btn, Card, DateField, IconBtn, Input, PageHead, SectionHead, Select, Toast, cx } from '@/components/ui';
import { IconClose } from '@/components/icons';
import ReceiptScan from '@/components/ReceiptScan';
import { budgetTypeOptions } from '@/components/budgetTypeOptions';
import type { ReceiptResult } from '@/lib/receiptOcr';
import { releaseReceiptScan } from '@/lib/receiptPipeline';
import { toastOnExecList } from './ExecList';
import './Exec.css';

/** 1줄 = 1건 (집행 현황 표와 같은 기조: 사용일자 · 예산 유형 · 항목명 · 금액) */
interface Row { id: string; useDate: string; typeKey: string; name: string; amount: number }
const newRow = (from?: Row): Row => ({ id: uid('r'), useDate: from?.useDate || TODAY_ISO, typeKey: from?.typeKey ?? 'meeting', name: '', amount: 0 });

interface Impact extends Bucket { input: number; after: number | null; over: boolean }

export default function ExecRegister({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [toast, showToast] = useToast();
  const projects = openProjects(state).filter(p => p.isMine);
  const [rows, setRows] = useState<Row[]>([newRow()]);

  const update = (id: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const monthOf = (r: Row) => (r.useDate || TODAY_ISO).slice(0, 7);

  // 예산 항목별 영향 (팀 회의비는 사용일자가 속한 분기, 프로젝트는 배분 경비)
  const impacts: Impact[] = [];
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const b = bucketOf(state, r.typeKey, monthOf(r));
    if (!b) continue;
    const hit = impacts.find(i => i.id === b.id);
    if (hit) hit.input += r.amount;
    else impacts.push({ ...b, input: r.amount, after: null, over: false });
  }
  for (const i of impacts) {
    i.after = i.remain == null ? null : i.remain - i.input;
    i.over = i.after != null && i.after < 0;
  }
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const anyOver = impacts.some(i => i.over);
  const noProject = rows.some(r => r.amount > 0 && r.typeKey.startsWith('p:') && !projects.some(p => `p:${p.id}` === r.typeKey));
  const canSave = sum > 0 && !anyOver && !noProject;

  // 입력 전 요약(PC): 첫 줄 예산의 현재 잔액
  const firstBucket = bucketOf(state, rows[0]?.typeKey ?? 'meeting', monthOf(rows[0] ?? newRow()));

  // 영수증 인식 worker 는 이 화면 안에서만 재사용 — 화면을 벗어나면 서버 요청 취소 + 즉시 해제
  useEffect(() => releaseReceiptScan, []);

  // 모바일: 입력칸에 들어가면 키보드가 올라온 뒤 그 항목 카드 전체가 보이도록 스크롤
  // 키보드가 열려도 하단 취소/저장 버튼이 키보드 바로 위에 보이도록
  // (iOS 는 키보드가 화면을 줄이지 않고 덮으므로 visualViewport 로 가려진 높이만큼 올림)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb-offset', `${Math.round(covered)}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); root.style.removeProperty('--kb-offset'); };
  }, []);

  const keepRowInView = (e: FocusEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    const card = e.currentTarget;
    window.setTimeout(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 320);
  };

  // 영수증 인식 결과 → 빈 줄(없으면 새 줄)에 사용일자 · 항목명(상호명만) · 금액
  const applyReceipt = (r: ReceiptResult) => {
    const name = r.store ?? '';
    setRows(rs => {
      const blank = rs.find(x => !x.name.trim() && !x.amount);
      const base = blank ?? newRow(rs[0]);
      const filled = { ...base, name, amount: r.total ?? 0, ...(r.date ? { useDate: r.date } : {}) };
      return blank ? rs.map(x => (x.id === blank.id ? filled : x)) : [filled, ...rs];
    });
    // 못 읽은 항목 안내 — 날짜를 못 읽으면 사용일자는 기존 값(기본 오늘) 그대로
    const miss = [!r.date && '날짜', !r.store && '상호명', !r.total && '금액'].filter(Boolean);
    showToast(miss.length
      ? `영수증에서 ${miss.join('·')}을(를) 읽지 못했어요.${!r.date ? ' 사용일자를 확인해 주세요.' : ' 직접 입력해 주세요.'}`
      : '영수증 내용이 자동 입력되었습니다. 확인 후 저장하세요.', miss.length ? 'warn' : 'ok');
  };

  const save = () => {
    if (!canSave) return;
    const records = rows.filter(r => r.amount > 0).map(r => {
      const { type, projectId } = parseTypeKey(r.typeKey);
      return {
        month: monthOf(r), useDate: r.useDate || TODAY_ISO, date: TODAY_ISO, type, projectId, team: state.session?.team,
        items: [{ name: r.name.trim() || '기타 경비', amount: r.amount }],
      };
    });
    dispatch({ type: 'ADD_RECORDS', records });
    // 저장 후 집행 현황으로 이동 — 완료 안내는 집행 현황에서
    toastOnExecList(`집행 ${records.length}건이 등록되었습니다!`);
    onBack();
  };

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      {/* 모바일은 헤더에 제목·뒤로 버튼이 있어 숨김 */}
      <PageHead className="hide-mobile" title="집행 등록" back={{ label: '집행 현황으로', onClick: onBack }} />

      <div className="exec-form">
        <Card pad="lg" className="reg-card">
          <ReceiptScan onResult={applyReceipt} />

          <div className="reg-head">
            <SectionHead title="집행 항목" sub={`한 항목에 한 건씩 입력합니다 · ${rows.length}개 항목`} />
          </div>
          <button type="button" className="btn-dashed reg-add" onClick={() => setRows(rs => [newRow(rs[0]), ...rs])}>+ 항목 추가</button>
          <div className="reg-rows">
            <div className="reg-row reg-row--head" aria-hidden="true">
              <span className="reg-row__no">#</span>
              <span>사용일자</span><span>예산 유형</span><span>항목명</span><span className="t-right">금액</span>
            </div>
            {rows.map((row, i) => {
              // 새 항목은 맨 위에 생기지만 번호는 만든 순서 (맨 위 = 가장 큰 번호)
              const idx = rows.length - 1 - i;
              const bid = row.amount > 0 ? bucketOf(state, row.typeKey, monthOf(row))?.id : undefined;
              const imp = bid ? impacts.find(i => i.id === bid) : undefined;
              const over = !!imp?.over;
              return (
                <div key={row.id} className={cx('reg-row', over && 'is-over')} onFocus={keepRowInView}>
                  {/* 넓은 화면(한 줄 표)에서는 display: contents 로 번호·삭제가 양 끝 칸이 됨 */}
                  <div className="reg-row__top">
                    <span className="reg-row__no"><span className="reg-row__no-label">항목</span>{idx + 1}</span>
                    {rows.length > 1 && (
                      <IconBtn className="icon-btn--remove reg-row__del" aria-label={`${idx + 1}번 항목 삭제`} title="항목 삭제"
                        onClick={() => setRows(rs => rs.filter(r => r.id !== row.id))}><IconClose size={13} /></IconBtn>
                    )}
                  </div>
                  <div className="reg-field reg-row__date">
                    <span className="reg-field__label" aria-hidden="true">사용일자</span>
                    <DateField value={row.useDate} onChange={v => update(row.id, { useDate: v })} aria-label={`${idx + 1}번 사용일자`} />
                  </div>
                  <div className="reg-field reg-row__type">
                    <span className="reg-field__label" aria-hidden="true">예산 유형</span>
                    <Select value={row.typeKey} aria-label={`${idx + 1}번 예산 유형`} onChange={e => update(row.id, { typeKey: e.target.value })}>
                      {budgetTypeOptions(projects, { icons: true })}
                    </Select>
                  </div>
                  <div className="reg-field reg-row__name">
                    <span className="reg-field__label" aria-hidden="true">항목명</span>
                    <Input placeholder="예: 9월 팀 회식" aria-label={`${idx + 1}번 항목명`}
                      value={row.name} onChange={e => update(row.id, { name: e.target.value })} onClear={() => update(row.id, { name: '' })} />
                  </div>
                  <div className="reg-field reg-row__amt">
                    <span className="reg-field__label" aria-hidden="true">금액</span>
                    <AmountInput value={row.amount} aria-label={`${idx + 1}번 금액`} onChange={v => update(row.id, { amount: v })} />
                  </div>
                  {/* 모바일: 이 예산의 집행 후 잔액 (같은 예산 항목끼리는 입력 합계를 뺀 같은 잔액) */}
                  {imp && imp.after != null && (
                    <p className={cx('reg-row__bal', over && 'is-over')} aria-live="polite">
                      {imp.name} 집행 후 잔액 <b>{over ? `−${fmt(-imp.after)} (초과)` : fmt(imp.after)}</b>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {noProject && <p className="reg-note">진행 중인 내 프로젝트만 선택할 수 있습니다.</p>}
        </Card>

        {/* PC 전용 — 모바일은 하단 고정 바 */}
        <Card pad="lg" className="exec-summary hide-mobile">
          <SectionHead title="집행 요약" sub={`${rows.filter(r => r.amount > 0).length}건 · 합계 ${fmt(sum)}`} />
          {impacts.length === 0 ? (
            <div className="reg-sum__empty">
              <span>금액을 입력하면 예산 항목별 집행 후 잔액이 표시됩니다.</span>
              {firstBucket && (
                <span>현재 {firstBucket.name}({firstBucket.sub}) 잔액 <b>{firstBucket.remain == null ? '—' : fmt(firstBucket.remain)}</b></span>
              )}
            </div>
          ) : (
            <div className="reg-sum">
              {impacts.map(i => (
                <div key={i.id} className={cx('reg-sum__item', i.over && 'is-over')}>
                  <div className="reg-sum__name"><b>{i.name}</b><small>{i.sub}</small></div>
                  <dl>
                    <div><dt>현재 잔액</dt><dd>{i.remain == null ? '—' : fmt(i.remain)}</dd></div>
                    <div><dt>이번 입력</dt><dd>−{fmt(i.input)}</dd></div>
                    <div className="reg-sum__after">
                      <dt>집행 후 잔액</dt>
                      <dd className={cx(i.over && 'text-danger')}>{i.after == null ? '—' : i.over ? `−${fmt(-i.after)}` : fmt(i.after)}</dd>
                    </div>
                  </dl>
                  {i.over && <p className="reg-sum__warn">🔴 잔액을 넘었습니다. 금액을 줄여주세요.</p>}
                </div>
              ))}
            </div>
          )}
          <div className="row exec-summary__actions">
            <Btn variant="secondary" block onClick={onBack}>취소</Btn>
            <Btn block onClick={save} disabled={!canSave}>저장 · 예산 차감</Btn>
          </div>
        </Card>
      </div>

      {/* 모바일 전용: 하단 고정 — 취소/저장 (집행 후 잔액은 항목마다 금액 아래에 표시)
          (화면 등장 애니메이션의 transform 이 fixed 를 가두므로 body 로 portal) */}
      {createPortal(<div className="exec-bar" role="region" aria-label="집행 저장">
        <div className="exec-bar__btns">
          <Btn variant="secondary" onClick={onBack}>취소</Btn>
          <Btn onClick={save} disabled={!canSave}>저장 · 예산 차감</Btn>
        </div>
      </div>, document.body)}
    </div>
  );
}
