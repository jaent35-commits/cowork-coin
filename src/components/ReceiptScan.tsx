import { useEffect, useRef, useState } from 'react';
import type { ReceiptResult } from '@/lib/receiptOcr';
import CameraSheet, { canInAppCamera } from './CameraSheet';
import { scanReceipt, type ScanStage } from '@/lib/receiptPipeline';
import { cx } from './ui';

type Phase = { kind: 'idle' } | { kind: 'reading'; progress: number; stage: ScanStage } | { kind: 'error'; msg: string };

/**
 * 모바일 전용: 영수증 찍어서 바로 올리기
 * - 버튼 → [카메라로 찍기] / [사진첩에서 고르기] 선택 → 사진 글자 인식 → onResult 로 날짜·상호명·합계 전달
 * - 선택은 앱에서 직접 받음: capture 없는 입력은 최근 안드로이드 크롬이 선택창 없이 사진첩(사진 선택기)을 바로 열어서
 *   카메라 = capture="environment"(후면 카메라 바로 실행), 사진첩 = capture 없는 입력으로 나눔
 * - 카메라: 휴대폰 기본 카메라 앱 (자동 초점·고화질 — 앱 안 카메라는 초점을 못 맞춰 작은 글씨·날짜를 놓침)
 *   단, 카메라 앱이 열린 사이 메모리 부족으로 브라우저 탭이 닫혀 사진이 사라지는 기기가 있음
 *   → 카메라를 열 때 표시를 남기고, 사진을 받기 전에 페이지가 새로 열리면(표시가 남아 있으면) 그 기기는 다음부터 앱 안 카메라(CameraSheet)로
 * - 파일 입력은 고를 때마다 새로 만들고, change 이벤트를 놓쳐도 화면으로 돌아왔을 때 고른 파일을 확인함
 */
const CAMERA_PENDING = 'cowork-coin-camera-pending'; // sessionStorage: 기본 카메라를 연 시각
const CAMERA_INAPP = 'cowork-coin-camera-inapp'; // localStorage: 이 기기는 앱 안 카메라 사용
const store = {
  get: (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } },
  set: (s: Storage, k: string, v: string) => { try { s.setItem(k, v); } catch { /* 저장 불가 — 기본 동작 */ } },
  del: (s: Storage, k: string) => { try { s.removeItem(k); } catch { /* noop */ } },
};
/** 기본 카메라를 연 뒤 사진을 받기 전에 페이지가 새로 열렸는지 (10분 이내) — 확인하면 표시를 지움 */
function cameraWasLost(): boolean {
  const at = Number(store.get(sessionStorage, CAMERA_PENDING));
  store.del(sessionStorage, CAMERA_PENDING);
  return !!at && Date.now() - at < 10 * 60_000;
}
export default function ReceiptScan({ onResult, className }: { onResult: (r: ReceiptResult) => void; className?: string }) {
  const [cam, setCam] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // 기본 카메라 사용 중 탭이 닫혔다가 다시 열림 → 이 기기는 앱 안 카메라로 바꾸고 안내
  const [phase, setPhase] = useState<Phase>(() => {
    if (!cameraWasLost()) return { kind: 'idle' };
    if (!canInAppCamera()) return { kind: 'error', msg: '카메라를 쓰는 사이 화면이 다시 열려 사진을 받지 못했어요. 휴대폰 카메라로 찍은 뒤 [사진첩에서 고르기]로 올려주세요.' };
    store.set(localStorage, CAMERA_INAPP, '1');
    return { kind: 'error', msg: '카메라를 쓰는 사이 화면이 다시 열려 사진을 받지 못했어요. 이 휴대폰은 다음부터 앱 안 카메라로 찍어요. (또는 휴대폰 카메라로 찍은 뒤 [사진첩에서 고르기])' };
  });
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
  const picker = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => picker.current?.(), []);
  /** 파일 입력을 새로 만들어 엶 — change 를 놓쳐도 돌아왔을 때(focus·visibilitychange) 파일이 있으면 처리 */
  const openInput = (capture: boolean) => {
    picker.current?.();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false, timer: number | undefined;
    const take = () => {
      const f = input.files?.[0];
      if (done || !f) return false;
      done = true; cleanup(); void onFile(f);
      return true;
    };
    // 파일이 늦게 채워지는 기기 — 돌아온 뒤 잠깐(3초) 더 확인, 그래도 없으면 취소로 보고 카메라 표시를 지움
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      let n = 0;
      const poll = () => {
        if (take()) return;
        if (++n < 10) timer = window.setTimeout(poll, 300);
        else store.del(sessionStorage, CAMERA_PENDING);
      };
      timer = window.setTimeout(poll, 300);
    };
    const cleanup = () => {
      store.del(sessionStorage, CAMERA_PENDING);
      window.clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      input.remove();
      picker.current = undefined;
    };
    input.addEventListener('change', take);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    picker.current = cleanup;
    if (capture) store.set(sessionStorage, CAMERA_PENDING, String(Date.now()));
    input.click();
  };
  const pick = (which: 'camera' | 'album') => {
    setChoosing(false);
    if (phase.kind === 'error') setPhase({ kind: 'idle' });
    // 기본은 휴대폰 카메라 앱 — 이 기기에서 탭이 닫힌 적이 있을 때만 앱 안 카메라
    if (which === 'camera' && store.get(localStorage, CAMERA_INAPP) === '1' && canInAppCamera()) setCam(true);
    else openInput(which === 'camera');
  };

  return (
    <div className={cx('receipt-scan', className)}>
      {cam && <CameraSheet onShot={f => { setCam(false); void onFile(f); }} onClose={() => setCam(false)}
        onFail={() => { setCam(false); openInput(true); }} />}
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
