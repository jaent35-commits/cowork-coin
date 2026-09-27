import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';
import { EASTER_EGGS } from '@/data/easterEggs';

const MOBILE = '(max-width: 1024px)';
const START = 10;      // 이 거리 이상 아래로 끌어야 시작
const MAX = 150;       // 최대로 늘어나는 높이
const OPEN = 110;      // 놓았을 때 머무는 높이
const THRESHOLD = 64;  // 이만큼 끌면 문구가 '뿅'
const HOLD_MS = 1800;  // 문구가 보이는 시간
const POP_OUT_MS = 180; // 문구가 사라진 뒤 헤더가 원복되기까지
const BOING_MS = 460;

/**
 * 모바일 헤더 끌어내리기 이스터에그
 * 헤더가 늘어나고 → 임계점에서 문구가 '뿅' → 잠시 후 문구가 쏙 들어가며 헤더가 튕기듯 원복
 */
export function usePullEgg() {
  const [height, setHeightState] = useState(0);
  const heightRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [popped, setPoppedState] = useState(false);
  const poppedRef = useRef(false);
  const [boing, setBoing] = useState(false);
  const [msg, setMsg] = useState('');
  const moved = useRef(false);
  const lastIdx = useRef(-1);
  const timers = useRef<number[]>([]);
  const cleanup = useRef<(() => void) | null>(null);

  const setHeight = (h: number) => { heightRef.current = h; setHeightState(h); };
  const setPopped = (v: boolean) => { poppedRef.current = v; setPoppedState(v); };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = []; };

  const pick = () => {
    let i = Math.floor(Math.random() * EASTER_EGGS.length);
    if (i === lastIdx.current) i = (i + 1) % EASTER_EGGS.length;
    lastIdx.current = i;
    setMsg(EASTER_EGGS[i]);
  };

  /** 문구 쏙 → 헤더 원복 → 살짝 튕김 */
  const retract = useCallback(() => {
    clearTimers();
    if (poppedRef.current) setPopped(false);
    later(() => {
      setHeight(0);
      setBoing(true);
      later(() => setBoing(false), BOING_MS);
    }, poppedRef.current ? POP_OUT_MS : 0);
  }, []);

  useEffect(() => () => { clearTimers(); cleanup.current?.(); }, []);

  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    moved.current = false;
    if (e.button !== 0 || !window.matchMedia(MOBILE).matches) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    cleanup.current?.();
    const sx = e.clientX, sy = e.clientY, id = e.pointerId;
    let active = false;

    // 손가락·마우스가 헤더를 벗어나도 따라가도록 window 에서 추적
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dy = ev.clientY - sy;
      if (!active) {
        if (Math.abs(ev.clientX - sx) > 24 || dy < -START) { end(); return; }
        if (dy < START) return;
        active = true;
        moved.current = true;
        clearTimers();
        setBoing(false);
        setPopped(false);
        pick();
        setDragging(true);
      }
      // 고무줄처럼 갈수록 덜 늘어남
      const h = Math.min(MAX, MAX * (1 - Math.exp(-(dy - START) / 120)));
      setHeight(h);
      if (h >= THRESHOLD && !poppedRef.current) {
        setPopped(true);
        navigator.vibrate?.(12); // 지원 기기에서 '톡'
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      end();
      if (!active) return;
      // 놓는 순간의 click 만 막고 곧바로 해제
      window.setTimeout(() => { moved.current = false; }, 60);
      setDragging(false);
      if (!poppedRef.current) { retract(); return; }
      setHeight(OPEN);
      later(retract, HOLD_MS);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cleanup.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    cleanup.current = end;
  };

  /** 끌어내린 직후의 click 은 버튼 동작으로 이어지지 않게 막음 */
  const onClickCapture = (e: RMouseEvent) => {
    if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; }
  };

  return {
    height, dragging, popped, boing, msg,
    close: retract,
    /** 끌어내린 정도(0~1) — 아이콘 등장에 사용 */
    reveal: Math.min(1, height / THRESHOLD),
    handlers: { onPointerDown, onClickCapture },
  };
}
