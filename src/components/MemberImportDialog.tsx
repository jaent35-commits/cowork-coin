import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImportRow } from '@/lib/authApi';
import { unitPath } from '@/lib/memberSheet';
import { Alert, Badge, Btn, Checkbox } from '@/components/ui';
import { IconClose } from '@/components/icons';

/**
 * 엑셀로 등록 — 팝업에서 등록할 사용자를 고른다.
 * 이미 등록된 사번은 목록에서 빼고(펼쳐 볼 수만 있음), 나머지는 기본 모두 선택 → [선택한 N명 등록]
 * 화면에 안 보이는(관리 범위 밖) 사번이 이미 있으면 서버가 '이미 있음'으로 건너뜀
 */
export default function MemberImportDialog({ file, rows, problems, existing, isAdmin, busy, onCancel, onSubmit }: {
  file: string;
  rows: ImportRow[];
  problems: string[];
  /** 이미 등록된 사번 */
  existing: Set<string>;
  isAdmin: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (rows: ImportRow[]) => void;
}) {
  const fresh = useMemo(() => rows.filter(r => !existing.has(r.employeeNo.trim())), [rows, existing]);
  const dup = useMemo(() => rows.filter(r => existing.has(r.employeeNo.trim())), [rows, existing]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(fresh.map(r => r.employeeNo)));
  const chosen = fresh.filter(r => picked.has(r.employeeNo));
  const allOn = fresh.length > 0 && chosen.length === fresh.length;

  const toggle = (no: string) => setPicked(s => { const n = new Set(s); if (n.has(no)) n.delete(no); else n.add(no); return n; });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(fresh.map(r => r.employeeNo)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div className="modal" role="presentation">
      <div className="modal__dim" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <div className="modal__head">
          <div>
            <strong id="import-dialog-title">엑셀로 등록</strong>
            <span className="modal__sub">{file}</span>
          </div>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="닫기" onClick={onCancel} disabled={busy}><IconClose size={16} /></button>
        </div>

        <p className="import-pick__summary">
          등록할 수 있는 사용자 <b>{fresh.length}명</b>
          {dup.length > 0 && <> · 이미 등록된 사번 <b>{dup.length}명</b>은 뺐어요</>}
        </p>
        {problems.length > 0 && (
          <Alert variant="danger">
            엑셀을 고친 뒤 다시 올려 주세요.
            <ul className="import-pick__problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          </Alert>
        )}

        {fresh.length === 0 ? (
          <p className="import-pick__empty">새로 등록할 사용자가 없어요. 엑셀의 사번이 모두 이미 등록되어 있어요.</p>
        ) : (
          <div className="import-pick">
            <label className="import-pick__row import-pick__row--all">
              <Checkbox checked={allOn} onChange={toggleAll} aria-label="전체 선택" />
              <span>전체 선택</span>
              <span className="t-muted import-pick__count">{chosen.length} / {fresh.length}</span>
            </label>
            <ul className="import-pick__list">
              {fresh.map(r => (
                <li key={r.employeeNo}>
                  <label className="import-pick__row">
                    <Checkbox checked={picked.has(r.employeeNo)} onChange={() => toggle(r.employeeNo)} />
                    <span className="import-pick__who"><b>{r.name}</b>{r.position && <span className="t-muted"> {r.position}</span>} <span className="t-muted">{r.employeeNo}</span></span>
                    <span className="import-pick__org">{unitPath(r)}</span>
                    {isAdmin && r.isAdmin && <Badge variant="amber" size="sm">관리자</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {dup.length > 0 && (
          <details className="import-pick__dup">
            <summary>뺀 사용자 {dup.length}명 보기</summary>
            <ul>{dup.map(r => <li key={r.employeeNo}>{r.name} ({r.employeeNo}) · {unitPath(r)}</li>)}</ul>
          </details>
        )}

        <p className="form-note">없는 조직은 새로 만들어요{isAdmin ? '' : ' (내 조직 아래 부서의 파트만)'}. 새 사용자에게는 슬랙 DM 으로 사번과 초기 비밀번호를 보내요.</p>
        <div className="row row--end">
          <Btn variant="secondary" onClick={onCancel} disabled={busy}>취소</Btn>
          <Btn onClick={() => onSubmit(chosen)} disabled={busy || !chosen.length || problems.length > 0}>
            {busy ? '등록 중...' : `선택한 ${chosen.length}명 등록`}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
