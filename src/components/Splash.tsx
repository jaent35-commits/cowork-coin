import { useEffect, useRef, useState } from 'react';
import './Splash.css';

const KEY = 'cowork-coin-splash';
const INTRO: [number, number] = [0, 96];  // kowok-loading.json 마커 intro
const IDLE: [number, number] = [96, 156]; // 반복 대기 구간

/** 첫 실행(탭 세션당 1회) 로딩 애니메이션. `?splash` 를 붙이면 항상 재생 */
function shouldShow(): boolean {
  try {
    if (new URLSearchParams(location.search).has('splash')) return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem(KEY) !== '1';
  } catch { return false; }
}

export default function Splash() {
  const [show, setShow] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* 무시 */ }
    let disposed = false;
    let destroy = () => {};
    const leave = () => { if (!disposed) setLeaving(true); };
    const safety = window.setTimeout(leave, 6000); // 로딩이 늦어도 화면을 막지 않도록

    Promise.all([
      import('lottie-web/build/player/lottie_light'),
      import('@/assets/lottie/kowok-loading.json'),
    ]).then(([{ default: lottie }, { default: data }]) => {
      if (disposed || !boxRef.current) return;
      const anim = lottie.loadAnimation({
        container: boxRef.current, renderer: 'svg', loop: false, autoplay: false,
        animationData: data, rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      });
      let intro = true;
      anim.addEventListener('complete', () => {
        if (intro) {
          // 인트로가 끝나면 잠깐 대기 동작을 보여주고 퇴장
          intro = false;
          anim.loop = true;
          anim.playSegments(IDLE, true);
          window.setTimeout(leave, 500);
        }
      });
      anim.playSegments(INTRO, true);
      destroy = () => anim.destroy();
    }).catch(leave);

    return () => { disposed = true; window.clearTimeout(safety); destroy(); };
  }, [show]);

  if (!show) return null;
  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}`} role="status" aria-label="코웍-코인을 불러오는 중"
      onClick={() => setLeaving(true)} onAnimationEnd={e => { if (e.animationName === 'splash-out') setShow(false); }}>
      <div ref={boxRef} className="splash__anim" aria-hidden="true" />
      <p className="splash__name">코웍-코인</p>
    </div>
  );
}
