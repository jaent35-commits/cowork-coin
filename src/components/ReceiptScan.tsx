import { useRef, useState } from 'react';
import type { ReceiptResult } from '@/lib/receiptOcr';
import { scanReceipt } from '@/lib/receiptPipeline';
import { cx } from './ui';

type Phase = { kind: 'idle' } | { kind: 'reading'; progress: number } | { kind: 'error'; msg: string };

/**
 * 모바일 전용: 영수증 찍어서 바로 올리기
 * - 버튼 → 휴대폰 시스템 선택창(카메라로 찍기 / 사진 보관함에서 고르기) → 사진 글자 인식 → onResult 로 날짜·상호명·합계 전달
 */
export default function ReceiptScan({ onResult, className }: { onResult: (r: ReceiptResult) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [thumb, setThumb] = useState<string | null>(null);
  const reading = phase.kind === 'reading';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setThumb(t => { if (t) URL.revokeObjectURL(t); return URL.createObjectURL(file); });
    setPhase({ kind: 'reading', progress: 0 });
    try {
      const r = await scanReceipt(file, p => setPhase({ kind: 'reading', progress: p }));
      if (!r.date && !r.store && !r.total) throw new Error('empty');
      setPhase({ kind: 'idle' });
      onResult(r);
    } catch {
      setPhase({ kind: 'error', msg: '영수증 글자를 읽지 못했어요. 밝은 곳에서 영수증 전체가 보이게 다시 찍어주세요.' });
    }
  };

  return (
    <div className={cx('receipt-scan', className)}>
      {/* capture 를 주지 않아야 iOS·Android 가 카메라/사진첩 선택창을 띄움 */}
      <input ref={input} type="file" accept="image/*" hidden
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className={cx('receipt-scan__btn', reading && 'is-reading')} disabled={reading}
        onClick={() => input.current?.click()}>
        {thumb && reading ? <img src={thumb} alt="" className="receipt-scan__thumb" /> : <span className="receipt-scan__icon" aria-hidden="true">📷</span>}
        <span className="receipt-scan__text">
          <strong>{reading ? '영수증 읽는 중…' : '영수증 찍어서 바로 올리기'}</strong>
          <small>{reading ? `${Math.round(phase.progress * 100)}% · 잠시만 기다려주세요` : '카메라·사진첩 선택 → 사용일자·상호명·금액 자동 입력'}</small>
        </span>
      </button>
      {reading && (
        <div className="receipt-scan__bar" role="progressbar" aria-label="영수증 인식 진행률"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.progress * 100)}>
          <i style={{ width: `${Math.max(4, phase.progress * 100)}%` }} />
        </div>
      )}
      {phase.kind === 'error' && <p className="receipt-scan__err" role="alert">{phase.msg}</p>}
    </div>
  );
}
