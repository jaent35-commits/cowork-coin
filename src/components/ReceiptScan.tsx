import { useRef, useState, type ChangeEvent } from 'react';
import type { ReceiptResult } from '@/lib/receiptOcr';
import { scanReceipt, type ScanStage } from '@/lib/receiptPipeline';
import { cx } from './ui';

type Phase = { kind: 'idle' } | { kind: 'reading'; progress: number; stage: ScanStage } | { kind: 'error'; msg: string };

/**
 * 모바일 전용: 영수증 찍어서 바로 올리기
 * - 버튼 → [카메라로 찍기] / [사진첩에서 고르기] 선택 → 사진 글자 인식 → onResult 로 날짜·상호명·합계 전달
 * - 선택은 앱에서 직접 받음: capture 없는 입력은 최근 안드로이드 크롬이 선택창 없이 사진첩(사진 선택기)을 바로 열어서
 *   카메라 = capture="environment"(후면 카메라 바로 실행), 사진첩 = capture 없는 입력으로 나눔
 */
export default function ReceiptScan({ onResult, className }: { onResult: (r: ReceiptResult) => void; className?: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [thumb, setThumb] = useState<string | null>(null);
  const reading = phase.kind === 'reading';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setThumb(t => { if (t) URL.revokeObjectURL(t); return URL.createObjectURL(file); });
    setPhase({ kind: 'reading', progress: 0, stage: 'server' });
    try {
      const r = await scanReceipt(file,
        p => setPhase(s => ({ kind: 'reading', progress: p, stage: s.kind === 'reading' ? s.stage : 'device' })),
        stage => setPhase({ kind: 'reading', progress: 0, stage }));
      if (!r.date && !r.store && !r.total) throw new Error('empty');
      setPhase({ kind: 'idle' });
      onResult(r);
    } catch {
      setPhase({ kind: 'error', msg: '영수증 글자를 읽지 못했어요. 밝은 곳에서 영수증 전체가 보이게 다시 찍어주세요.' });
    }
  };
  const pick = (which: 'camera' | 'album') => { setChoosing(false); (which === 'camera' ? camera : album).current?.click(); };
  const change = (e: ChangeEvent<HTMLInputElement>) => { void onFile(e.target.files?.[0]); e.target.value = ''; };

  return (
    <div className={cx('receipt-scan', className)}>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={change} />
      <input ref={album} type="file" accept="image/*" hidden onChange={change} />
      <button type="button" className={cx('receipt-scan__btn', reading && 'is-reading', choosing && 'is-open')} disabled={reading}
        aria-expanded={choosing} aria-controls="receipt-scan-choice" onClick={() => setChoosing(v => !v)}>
        {thumb && reading ? <img src={thumb} alt="" className="receipt-scan__thumb" /> : <span className="receipt-scan__icon" aria-hidden="true">📷</span>}
        <span className="receipt-scan__text">
          <strong>{reading ? '영수증 읽는 중…' : '영수증 찍어서 바로 올리기'}</strong>
          <small>{phase.kind === 'reading'
            ? phase.stage === 'server' ? '서버에서 읽는 중 · 잠시만 기다려주세요'
              : phase.progress > 0 ? `휴대폰에서 읽는 중 ${Math.round(phase.progress * 100)}%` : '휴대폰에서 읽을 준비 중 (처음 한 번은 인식 모델을 내려받아요)'
            : '카메라·사진첩 선택 → 사용일자·상호명·금액 자동 입력'}</small>
        </span>
      </button>
      {choosing && !reading && (
        <div id="receipt-scan-choice" className="receipt-scan__choice" role="group" aria-label="영수증 사진 가져오기">
          <button type="button" onClick={() => pick('camera')}><span aria-hidden="true">📸</span>카메라로 찍기</button>
          <button type="button" onClick={() => pick('album')}><span aria-hidden="true">🖼️</span>사진첩에서 고르기</button>
        </div>
      )}
      {reading && (
        <div className="receipt-scan__bar" role="progressbar" aria-label="영수증 인식 진행률"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.progress * 100)}>
          <i style={{ width: `${phase.stage === 'server' ? 30 : Math.max(4, phase.progress * 100)}%` }} />
        </div>
      )}
      {phase.kind === 'error' && <p className="receipt-scan__err" role="alert">{phase.msg}</p>}
    </div>
  );
}
