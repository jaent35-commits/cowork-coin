import { useCallback, useEffect, useState } from 'react';
import type { View } from '@/types';

const VIEWS: readonly View[] = ['home', 'meeting', 'project', 'exec', 'exec-new', 'project-new', 'project-detail', 'cowork', 'report', 'mypage', 'settings', 'notification', 'admin', 'search'];

function readHash(): View {
  const v = window.location.hash.replace(/^#\/?/, '') as View;
  return VIEWS.includes(v) ? v : 'home';
}

/** #/view 해시 라우팅 — 브라우저/안드로이드 뒤로가기와 PWA 딥링크 지원 */
export function useHashView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(readHash);

  useEffect(() => {
    const onHash = () => {
      setView(readHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((v: View) => {
    if (readHash() === v) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.hash = `/${v}`;
  }, []);

  return [view, navigate];
}
