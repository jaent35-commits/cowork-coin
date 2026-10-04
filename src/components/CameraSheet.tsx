import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

/** 앱 안에서 카메라를 띄울 수 있는지 — https(또는 localhost)에서만 브라우저가 카메라를 열어 줌 */
export const canInAppCamera = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

type ImageCaptureLike = {
  takePhoto: (settings?: { imageWidth?: number; imageHeight?: number }) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<{ imageWidth?: { max?: number }; imageHeight?: { max?: number } }>;
};
const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;

/**
 * 앱 안 카메라 (영수증 촬영)
 * - 휴대폰 카메라 앱으로 넘어가지 않으므로, 메모리가 부족한 기기(갤럭시 등)에서 브라우저 탭이 닫혀 사진이 사라지는 문제가 없음
 * - 셔터: ImageCapture.takePhoto()(원본 해상도, 크롬) → 안 되면 화면 프레임을 캡처
 * - 카메라를 못 열면 onFail → 기존 방식(카메라 앱)으로 넘김
 */
export default function CameraSheet({ onShot, onClose, onFail }: {
  onShot: (file: File) => void; onClose: () => void; onFail: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number; k: number } | null>(null);

  /**
   * 초점 — 영수증은 화면 가운데 가까이 있으므로 배경이 아니라 가운데(가까운 곳)에 맞춤
   * - 지원 기기(안드로이드 크롬): 초점 기준점을 가운데로 + 연속 자동 초점
   * - 화면을 누르면 그 지점에 다시 초점 (single-shot)
   */
  const focusAt = async (x: number, y: number, once: boolean) => {
    const track = stream.current?.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[]; pointsOfInterest?: unknown; };
    if (!track || !caps.focusMode) return;
    const mode = once && caps.focusMode.includes('single-shot') ? 'single-shot' : caps.focusMode.includes('continuous') ? 'continuous' : caps.focusMode[0];
    const adv: Record<string, unknown> = { focusMode: mode, pointsOfInterest: [{ x, y }] };
    try {
      await track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
    } catch {
      try { await track.applyConstraints({ advanced: [{ focusMode: mode } as MediaTrackConstraintSet] }); } catch { /* 초점 조정 미지원 */ }
    }
  };
  const tapFocus = (e: PointerEvent<HTMLVideoElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    setRing({ x: e.clientX, y: e.clientY, k: Date.now() });
    void focusAt(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), true);
  };

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    }).then(s => {
      if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      void v.play().then(() => setReady(true)).catch(() => setReady(true));
      void focusAt(0.5, 0.5, false);
    }).catch(() => { if (alive) onFail(); });
    return () => { alive = false; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = () => new Promise<Blob | null>(resolve => {
    const v = video.current!;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(resolve, 'image/jpeg', 0.92);
  });

  const shoot = async () => {
    if (!ready || busy) return;
    setBusy(true);
    let blob: Blob | null = null;
    const track = stream.current?.getVideoTracks()[0];
    if (track && ImageCaptureCtor) {
      try {
        // 화면(미리보기)보다 큰 사진 해상도로 — 기기가 지원하는 최대 크기 (기본값이 낮게 잡히는 기기가 있음)
        const ic = new ImageCaptureCtor(track);
        const caps = await ic.getPhotoCapabilities?.().catch(() => undefined);
        const w = caps?.imageWidth?.max, h = caps?.imageHeight?.max;
        blob = await ic.takePhoto(w && h ? { imageWidth: w, imageHeight: h } : undefined);
      } catch { /* 프레임 캡처로 */ }
    }
    blob = blob ?? await frame();
    setBusy(false);
    if (!blob) return;
    onShot(new File([blob], `receipt-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
  };

  return createPortal(
    <div className="camera-sheet" role="dialog" aria-modal="true" aria-label="영수증 촬영">
      <video ref={video} className="camera-sheet__video" playsInline muted autoPlay onPointerDown={tapFocus} />
      <div className="camera-sheet__guide" aria-hidden="true" />
      {ring && <span key={ring.k} className="camera-sheet__ring" style={{ left: ring.x, top: ring.y }} aria-hidden="true" />}
      <p className="camera-sheet__hint">{ready ? '영수증을 가까이 · 흐리면 영수증 부분을 눌러 초점을 맞춰 주세요' : '카메라를 여는 중…'}</p>
      <div className="camera-sheet__bar">
        <button type="button" className="camera-sheet__close" onClick={onClose}>취소</button>
        <button type="button" className="camera-sheet__shutter" aria-label="촬영" disabled={!ready || busy} onClick={() => { void shoot(); }} />
        <span className="camera-sheet__spacer" />
      </div>
    </div>,
    document.body,
  );
}
