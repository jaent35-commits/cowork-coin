import { useState } from 'react';
import { IconClose, IconDownload } from './icons';
import { Btn, IconBtn } from './ui';
import { InstallGuide } from './PwaPrompt';
import { isMobileDevice, promptInstall, useInstall } from '@/lib/install';
import kowokIcon from '@/assets/kowok-icon.png';

/** X 로 닫으면 이 기기에서 다시 보이지 않음 */
const CLOSED_KEY = 'cowork-coin-install-card-closed';
const wasClosed = () => { try { return localStorage.getItem(CLOSED_KEY) === '1'; } catch { return false; } };

/** PC 홈 화면 상단: 앱 설치 안내 카드 (모바일은 바텀 시트 PwaPrompt) */
export default function InstallCard() {
  const { canPrompt, installed } = useInstall();
  const [closed, setClosed] = useState(wasClosed);
  const [guide, setGuide] = useState(false);
  if (isMobileDevice || installed || closed) return null;

  const close = () => {
    try { localStorage.setItem(CLOSED_KEY, '1'); } catch { /* noop */ }
    setClosed(true);
  };
  const install = async () => {
    const r = await promptInstall();
    if (r === 'unavailable') setGuide(true);
  };

  return (
    <section className="install-card" aria-label="앱 설치 안내">
      <img src={kowokIcon} alt="" className="install-card__icon" />
      <div className="install-card__body">
        <strong>코웍-코인을 앱으로 설치하세요</strong>
        {guide
          ? <InstallGuide />
          : <span>바탕화면·작업 표시줄에서 바로 열고, 알림도 받을 수 있어요</span>}
      </div>
      {!guide && <Btn size="sm" onClick={() => { void install(); }}><IconDownload size={13} />{canPrompt ? '앱 설치' : '설치 방법'}</Btn>}
      <IconBtn className="icon-btn--sm install-card__close" aria-label="설치 안내 닫기" title="닫기" onClick={close}><IconClose size={14} /></IconBtn>
    </section>
  );
}
