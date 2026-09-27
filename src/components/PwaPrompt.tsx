import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { IconClose, IconDownload } from './icons';
import { Btn } from './ui';
import { INSTALL_GUIDE, isMobileDevice, promptInstall, useInstall } from '@/lib/install';
import { useIntroState } from '@/lib/intro';
import kowokIcon from '@/assets/kowok-icon.png';

/** 닫으면 이번 접속(세션) 동안만 숨김 — 다음 접속 때 미설치면 다시 안내 */
const DISMISS_KEY = 'cowork-coin-install-dismissed';
/** 스플래시가 끝난 뒤 보이도록 지연 */
const SHOW_DELAY = 1800;

const wasDismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

/** 설치 방법 단계 (설치 창을 못 띄우는 브라우저용) */
export function InstallGuide() {
  return (
    <ol className="install-guide">
      {INSTALL_GUIDE.map((t, i) => <li key={t}><span aria-hidden="true">{i + 1}</span>{t}</li>)}
    </ol>
  );
}

/** 서비스워커 등록 + 새 버전/오프라인 준비 + 모바일 앱 설치 바텀 시트 (PC 설치 안내는 홈 화면 카드 InstallCard) */
export default function PwaPrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 1시간마다 새 버전 확인
      if (reg) setInterval(() => { void reg.update(); }, 60 * 60 * 1000);
    },
  });
  const { installed } = useInstall();
  // 홈 소개 팝업이 열려 있거나, 그 마지막 카드(앱 다운로드)를 이번 접속에서 이미 봤으면 설치 시트는 띄우지 않음
  const intro = useIntroState();
  // 모바일 + 미설치 + 이번 접속에서 닫지 않음 → 설치 바텀 시트
  const [showInstall, setShowInstall] = useState(false);
  // 설치 창을 못 띄우는 브라우저: [앱 설치하기] 를 누르면 방법 안내로 전환
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    if (!isMobileDevice || installed || wasDismissed()) return;
    const t = setTimeout(() => setShowInstall(true), SHOW_DELAY);
    return () => clearTimeout(t);
  }, [installed]);

  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  const dismissInstall = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setShowInstall(false);
  };
  const install = async () => {
    const r = await promptInstall();
    if (r === 'unavailable') setGuide(true);
    else if (r === 'accepted') setShowInstall(false);
  };

  if (needRefresh) {
    return (
      <div className="pwa-prompt" role="alertdialog" aria-label="새 버전 안내">
        <span className="pwa-prompt__text">새 버전이 준비되었어요.</span>
        <Btn size="sm" onClick={() => updateServiceWorker(true)}>새로고침</Btn>
        <button type="button" className="pwa-prompt__close" onClick={() => setNeedRefresh(false)} aria-label="닫기"><IconClose size={14} /></button>
      </div>
    );
  }
  if (showInstall && !installed && !intro.open && !intro.sawInstall) {
    return createPortal(
      <div className="install-sheet" role="presentation">
        <div className="install-sheet__dim" onClick={dismissInstall} aria-hidden="true" />
        <div className="install-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title">
          <span className="install-sheet__handle" aria-hidden="true" />
          <button type="button" className="install-sheet__close" onClick={dismissInstall} aria-label="닫기"><IconClose size={16} /></button>
          <div className="install-sheet__head">
            <img src={kowokIcon} alt="" className="install-sheet__icon" />
            <div>
              <strong id="install-sheet-title">코웍-코인 앱 설치</strong>
              <span>홈 화면에서 바로 열고, 알림도 받을 수 있어요</span>
            </div>
          </div>
          {guide && <InstallGuide />}
          {guide
            ? <Btn variant="secondary" block onClick={dismissInstall}>확인</Btn>
            : <Btn block autoFocus onClick={() => { void install(); }}><IconDownload size={15} />앱 설치하기</Btn>}
          {!guide && <Btn variant="ghost" block size="sm" onClick={dismissInstall}>다음에 할게요</Btn>}
        </div>
      </div>, document.body,
    );
  }
  if (offlineReady) {
    return <div className="pwa-prompt" role="status"><span className="pwa-prompt__text">✅ 오프라인에서도 사용할 수 있어요.</span></div>;
  }
  return null;
}
