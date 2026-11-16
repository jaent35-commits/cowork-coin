import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AuthApiError, ocrQuota, ocrUsageByMember, setOcrLimit, type OcrMemberUsage, type OcrQuota } from '@/lib/authApi';
import { useToast } from '@/hooks/useToast';
import { Alert, Btn, Card, EmptyState, FilterChip, Input, PageHead, ProgressBar, TableWrap, Toast, cx } from '@/components/ui';
import './Pages.css';

/** 월 한도 상한 — Google Cloud Vision 무료 사용량(월 1,000건)을 넘지 않게 */
export const OCR_LIMIT_MAX = 1000;
const PRESETS = [100, 300, 500, 1000];

const nf = (n: number) => n.toLocaleString('ko-KR');
/** 이번 달(한국 시간) 기간 — 예: 2026.11.01 ~ 11.30 */
function monthRange() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return `${y}.${mm}.01 ~ ${mm}.${last}`;
}
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 관리자 > 영수증 인식 (관리자만) — Google Cloud Vision 서버 인식 월 한도 · 사용량
 *   · 한도 = 한 달 동안 서비스 전체에서 서버로 읽을 수 있는 영수증 수 (0 ~ 1,000건, 0 이면 서버 인식 끔)
 *   · 한도를 다 쓰면 그 달은 휴대폰 안 인식(Tesseract)으로 읽음
 *   · 서버(DB 함수 set_ocr_limit)가 관리자 · 범위를 다시 확인
 */
export default function AdminOcr() {
  const [toast, showToast] = useToast(3500);
  const [quota, setQuota] = useState<OcrQuota | null>(null);
  const [usage, setUsage] = useState<OcrMemberUsage[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [q, u] = await Promise.all([ocrQuota(), ocrUsageByMember()]);
      setQuota(q);
      setUsage(u);
      setDraft(String(q.limit));
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof AuthApiError ? e.message : '영수증 인식 정보를 불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const value = draft.trim() === '' ? NaN : Number(draft);
  const error = draft.trim() === '' ? '월 한도를 입력하세요'
    : !Number.isInteger(value) ? '숫자(건)로 입력하세요'
    : value < 0 || value > OCR_LIMIT_MAX ? `0 ~ ${nf(OCR_LIMIT_MAX)}건 사이로 입력하세요`
    : '';
  const changed = !!quota && !error && value !== quota.limit;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    try {
      await setOcrLimit(value);
      await reload();
      showToast(value === 0 ? '서버 인식을 껐어요. 영수증은 휴대폰에서 읽어요.' : `월 한도를 ${nf(value)}건으로 바꿨어요.`);
    } catch (err) {
      showToast(err instanceof AuthApiError ? err.message : '저장하지 못했습니다. 잠시 후 다시 시도하세요.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const used = quota?.used ?? 0;
  const limit = quota?.limit ?? 0;
  const left = Math.max(0, limit - used);
  const pct = limit ? (used / limit) * 100 : 100;
  const below = !!quota && changed && value < used; // 이미 쓴 것보다 적게 → 이번 달은 바로 휴대폰 인식

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead title="영수증 인식" />

      <div className="mb-14">
        <Alert variant="info">
          영수증 사진은 <b>Google Cloud Vision</b>으로 읽어요. 한 달 동안 서비스 전체에서 서버로 읽을 수 있는 횟수를 정하세요.
          한도를 다 쓰면 그 달 남은 기간은 휴대폰에서 읽어요(조금 느리고 정확도가 낮을 수 있어요).
        </Alert>
      </div>
      {loadError && <div className="mb-14"><Alert variant="danger">{loadError} <button type="button" className="text-link" onClick={() => { void reload(); }}>다시 시도</button></Alert></div>}

      <div className="ocr-grid">
        {/* 이번 달 사용량 */}
        <Card pad className="ocr-usage">
          <h2 className="card-title">이번 달 사용량 <small className="ocr-usage__period">{monthRange()}</small></h2>
          {!quota ? (
            <EmptyState message={loadError ? '불러오지 못했어요' : '불러오는 중...'} />
          ) : (
            <>
              <p className="ocr-usage__big">
                <b className="num">{nf(used)}</b><span>/ {nf(limit)}건</span>
              </p>
              <ProgressBar value={pct} height={9} variant={limit === 0 || pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'green'} label="이번 달 사용률" />
              <p className={cx('ocr-usage__left', (limit === 0 || left === 0) && 'is-out')}>
                {limit === 0 ? '서버 인식이 꺼져 있어요 · 영수증은 휴대폰에서 읽어요'
                  : left === 0 ? '이번 달 한도를 다 썼어요 · 다음 달 1일에 다시 채워져요'
                  : <>남은 횟수 <b className="num">{nf(left)}건</b> · 매달 1일에 다시 채워져요</>}
              </p>
            </>
          )}
        </Card>

        {/* 월 한도 설정 */}
        <Card pad className="ocr-limit">
          <h2 className="card-title">월 한도</h2>
          <form onSubmit={e => { void save(e); }} noValidate>
            <div className="ocr-limit__row">
              <div className="ocr-limit__input">
                <Input value={draft} inputMode="numeric" aria-label="월 한도 (건)" aria-invalid={!!error || undefined} disabled={!quota}
                  onChange={e => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
                <span aria-hidden="true">건</span>
              </div>
              <Btn type="submit" disabled={!changed || busy}>{busy ? '저장 중...' : '저장'}</Btn>
            </div>
            <div className="chip-row ocr-limit__presets" role="group" aria-label="자주 쓰는 한도">
              {PRESETS.map(n => (
                <FilterChip key={n} label={`${nf(n)}건`} active={value === n} onClick={() => setDraft(String(n))} />
              ))}
              <FilterChip label="끄기 (0)" active={value === 0} onClick={() => setDraft('0')} />
            </div>
            {error && quota ? <small className="ocr-limit__err" role="alert">{error}</small>
              : below ? <small className="ocr-limit__warn">이번 달 이미 {nf(used)}건을 써서, 저장하면 이번 달은 바로 휴대폰에서 읽어요.</small>
              : <small className="ocr-limit__hint">0 ~ {nf(OCR_LIMIT_MAX)}건 · Vision 무료 사용량이 월 {nf(OCR_LIMIT_MAX)}건이라 최대 {nf(OCR_LIMIT_MAX)}건까지 정할 수 있어요. 0 이면 서버 인식을 쓰지 않아요.</small>}
          </form>
        </Card>
      </div>

      {/* 사용자별 사용 */}
      <Card className="card--clip">
        <div className="ocr-members__head"><h2 className="card-title">사용자별 사용 <small>이번 달 · 많이 쓴 순</small></h2></div>
        {usage === null ? (
          <EmptyState message={loadError ? '불러오지 못했어요' : '불러오는 중...'} />
        ) : !usage.length ? (
          <EmptyState icon="🧾" message="이번 달 서버로 읽은 영수증이 없어요" />
        ) : (
          <TableWrap>
            <table className="table ocr-members">
              <thead><tr><th>성명</th><th className="t-right">사용</th><th className="t-right">마지막 사용</th></tr></thead>
              <tbody>
                {usage.map(u => (
                  <tr key={u.memberId ?? 'deleted'}>
                    <td className="t-strong">{u.name ?? <span className="t-muted">삭제된 사용자</span>}</td>
                    <td className="t-right num">{nf(u.used)}건</td>
                    <td className="t-right t-muted num">{fmtTime(u.lastUsed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
