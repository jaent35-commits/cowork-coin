import { useEffect } from 'react';
import { Toast } from './ui';
import { useToast } from '@/hooks/useToast';
import { useTheme } from '@/lib/theme';

/** 이번 접속에서 이미 안내했는지 — 새로고침·화면 이동마다 반복하지 않음 */
const NOTICED_KEY = 'cowork-coin-theme-noticed';
const MSG = '시스템 설정에 따라 다크 모드로 전환되었어요. 마이페이지 › 화면 설정에서 바꿀 수 있어요.';

const noticed = () => { try { return sessionStorage.getItem(NOTICED_KEY) === '1'; } catch { return false; } };
const markNoticed = () => { try { sessionStorage.setItem(NOTICED_KEY, '1'); } catch { /* noop */ } };

/**
 * 화면 모드가 '시스템'(기본값)이고 기기가 다크 모드라 다크로 보일 때, 이번 접속에서 한 번 안내.
 * - 로그인 화면은 라이트로 고정이라 로그인 후 첫 화면에서, 스플래시가 끝난 뒤 띄움
 * - 사용자가 직접 라이트·다크를 고른 경우에는 안내하지 않음
 */
export default function ThemeNotice() {
  const { pref, shown } = useTheme();
  const [toast, show] = useToast(4500);

  useEffect(() => {
    if (pref !== 'system' || shown !== 'dark' || noticed()) return;
    const t = window.setInterval(() => {
      if (document.querySelector('.splash')) return;
      window.clearInterval(t);
      markNoticed();
      show(MSG);
    }, 300);
    return () => window.clearInterval(t);
  }, [pref, shown, show]);

  return <Toast msg={toast} />;
}
