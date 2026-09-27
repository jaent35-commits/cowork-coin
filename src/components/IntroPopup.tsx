import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from './icons';
import { Btn } from './ui';
import { InstallGuide } from './PwaPrompt';
import { promptInstall, useInstall } from '@/lib/install';
import { hideIntro, setIntroState, shouldShowIntro } from '@/lib/intro';
import pc1 from '@/assets/intro/popup_pc_01.webp';
import pc2 from '@/assets/intro/popup_pc_02.webp';
import pc3 from '@/assets/intro/popup_pc_03.webp';
import pc4 from '@/assets/intro/popup_pc_04.webp';
import pc5 from '@/assets/intro/popup_pc_05.webp';
import pc6 from '@/assets/intro/popup_pc_06.webp';
import m1 from '@/assets/intro/sheet_mobile_01.webp';
import m2 from '@/assets/intro/sheet_mobile_02.webp';
import m3 from '@/assets/intro/sheet_mobile_03.webp';
import m4 from '@/assets/intro/sheet_mobile_04.webp';
import m5 from '@/assets/intro/sheet_mobile_05.webp';
import m6 from '@/assets/intro/sheet_mobile_06.webp';
import './IntroPopup.css';

/**
 * 홈 화면 소개 팝업 — 카드 이미지(글자·버튼까지 그려진 그림) 위의 버튼 자리에 투명한 실제 버튼을 얹는다.
 * PC(> 640px)는 가운데 팝업, 모바일은 바텀 시트. 넘기기: 버튼 · 스와이프 · ← → 키, Esc 닫기.
 */
type Box = [x: number, y: number, w: number, h: number]; // 원본 이미지 픽셀 기준
interface Layout { w: number; h: number; slides: string[]; close: Box; next: Box; prev?: Box; download: Box; today: Box; check: Box; closeText: Box }

const PC: Layout = {
  w: 720, h: 1200, slides: [pc1, pc2, pc3, pc4, pc5, pc6],
  close: [616, 32, 72, 72], next: [592, 1078, 88, 88], prev: [40, 1078, 88, 88],
  download: [48, 820, 624, 108], today: [48, 956, 280, 56], check: [56, 964, 40, 40], closeText: [600, 956, 76, 56],
};
const SHEET: Layout = {
  w: 780, h: 1064, slides: [m1, m2, m3, m4, m5, m6],
  close: [664, 16, 96, 96], next: [32, 912, 716, 108], // X 는 손가락 터치 영역 46px 이상
  download: [32, 840, 716, 108], today: [36, 972, 280, 56], check: [44, 980, 40, 40], closeText: [668, 972, 80, 56],
};

/** 화면 낭독용 — 카드에 그려진 문구 */
const ALT = [
  '캬아! 코웍-코인 4가지 맛. 기록은 쉽게, 예산은 끝까지, 협업은 맛있게! 네컷 만화로 알아보기.',
  '1/5 기억 말고 기록. 월말 마감, "이거 언제 썼더라?"는 이제 그만! 쓴 자리에서 바로 기록, 모든 팀이 같은 숫자를 봐요.',
  '2/5 더 일한 팀이 더 배부르게. 몰라서 못 쓰는 예산, 이제 없어요. 사라지기 전에 알려 드려요.',
  '3/5 찍으면 끝. 영수증을 찰칵 한 번 찍으면 날짜·금액 자동 입력! 두 번 확인해 정확하게, 원본은 남기지 않아요.',
  '4/5 눈이 편한 큰 글씨. \'가\' 버튼 하나면 글씨가 1.4배 커져서 누구나 편하게 읽혀요.',
  '5/5 지금 코웍-코인을 시작해 보세요! 바탕화면·홈 화면에 설치하면 예산 알림도 바로 받을 수 있어요.',
];
const LAST = ALT.length - 1;
const SWIPE_PX = 50;

const pos = (l: Layout, [x, y, w, h]: Box): CSSProperties =>
  ({ left: `${(x / l.w) * 100}%`, top: `${(y / l.h) * 100}%`, width: `${(w / l.w) * 100}%`, height: `${(h / l.h) * 100}%` });

const SHEET_MQ = '(max-width: 640px)';
function useSheet() {
  const [sheet, setSheet] = useState(() => window.matchMedia(SHEET_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(SHEET_MQ);
    const on = () => setSheet(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return sheet;
}

export default function IntroPopup() {
  const [open, setOpen] = useState(shouldShowIntro);
  const [idx, setIdx] = useState(0);
  const [hideToday, setHideToday] = useState(false);
  const [guide, setGuide] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);
  const swiped = useRef(false);
  const firstBtn = useRef<HTMLButtonElement>(null);
  const { installed } = useInstall();
  const sheet = useSheet();
  const l = sheet ? SHEET : PC;

  useEffect(() => { setIntroState({ open }); return () => setIntroState({ open: false }); }, [open]);
  useEffect(() => { if (idx === LAST) setIntroState({ sawInstall: true }); }, [idx]);
  // 열릴 때 · 마지막 카드로 바뀔 때(다음 버튼이 사라짐) 주 버튼에 포커스
  const onLast = idx === LAST;
  useEffect(() => { if (open) firstBtn.current?.focus({ preventScroll: true }); }, [open, onLast]);

  const close = () => { hideIntro(hideToday); setOpen(false); };
  const go = (n: number) => { setGuide(false); setIdx(Math.max(0, Math.min(LAST, n))); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { hideIntro(false); setOpen(false); }
      else if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const install = async () => {
    if (installed) return close();
    const r = await promptInstall();
    if (r === 'unavailable') setGuide(true);
    else if (r === 'accepted') close();
  };

  // 스와이프 — 버튼 위에서 시작해도 넘어가도록 카드 전체에서 받음 (움직임이 작으면 클릭으로 처리)
  const onDown = (e: RPointerEvent) => { if (e.button === 0) { start.current = { x: e.clientX, id: e.pointerId }; swiped.current = false; } };
  const onMove = (e: RPointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    if (Math.abs(dx) > 8) setDrag((idx === 0 && dx > 0) || (idx === LAST && dx < 0) ? dx / 3 : dx);
  };
  const onUp = (e: RPointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    start.current = null;
    swiped.current = Math.abs(dx) > 8;
    setDrag(0);
    if (dx <= -SWIPE_PX) go(idx + 1);
    else if (dx >= SWIPE_PX) go(idx - 1);
  };
  // 스와이프로 끝난 포인터는 버튼 클릭으로 이어지지 않게
  const onClickCapture = (e: RMouseEvent) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); } };

  return createPortal(
    <div className={`intro${sheet ? ' intro--sheet' : ''}`} role="presentation">
      <div className="install-sheet__dim" onClick={() => { hideIntro(false); setOpen(false); }} aria-hidden="true" />
      <div className="intro__card" role="dialog" aria-modal="true" aria-roledescription="소개 슬라이드" aria-label="코웍-코인 소개"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(0); }}
        onClickCapture={onClickCapture}>
        {/* 버튼 위치(%)는 이미지와 비율이 같은 이 영역 기준 */}
        <div className="intro__stage" style={{ aspectRatio: `${l.w} / ${l.h}` }}>
          <div className="intro__track" style={{ transform: `translateX(calc(${-idx * 100}% + ${drag}px))`, transition: drag ? 'none' : undefined }}>
            {l.slides.map((src, k) => (
              <img key={src} src={src} className="intro__slide" draggable={false} decoding="async"
                alt={k === idx ? ALT[k] : ''} aria-hidden={k !== idx} />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">{`${idx + 1} / ${ALT.length}`}</p>

          <button type="button" className="intro__hit intro__hit--round" style={pos(l, l.close)} aria-label="소개 닫기" onClick={() => { hideIntro(false); setOpen(false); }} />
          {idx < LAST && (
            <button ref={firstBtn} type="button" className={`intro__hit${sheet ? '' : ' intro__hit--round'}`} style={pos(l, l.next)} onClick={() => go(idx + 1)}
              aria-label={idx === 0 ? (sheet ? '시작하기' : '다음 카드') : sheet ? '다음' : '다음 카드'} />
          )}
          {l.prev && idx > 0 && (
            <button type="button" className="intro__hit intro__hit--round" style={pos(l, l.prev)} aria-label="이전 카드" onClick={() => go(idx - 1)} />
          )}
          {idx === LAST && (
            <>
              <button ref={firstBtn} type="button" className="intro__hit" style={pos(l, l.download)} onClick={() => { void install(); }}
                aria-label={installed ? '앱이 이미 설치되어 있어요 — 닫기' : '앱 다운로드 받기'} />
              <button type="button" role="checkbox" aria-checked={hideToday} className="intro__hit" style={pos(l, l.today)}
                aria-label="오늘 하루 안 보기" onClick={() => setHideToday(v => !v)} />
              {hideToday && <span className="intro__check" style={pos(l, l.check)} aria-hidden="true"><IconCheck size={14} /></span>}
              <button type="button" className="intro__hit" style={pos(l, l.closeText)} aria-label="닫기" onClick={close} />
            </>
          )}

          {guide && (
            <div className="intro__guide" role="dialog" aria-label="앱 설치 방법">
              <strong>이 브라우저에서는 이렇게 설치해요</strong>
              <InstallGuide />
              <Btn variant="secondary" block size="sm" autoFocus onClick={() => setGuide(false)}>확인</Btn>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
