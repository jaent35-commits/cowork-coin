import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store/StoreContext';
import App from './App';
import Splash from './components/Splash';
import ThemeNotice from './components/ThemeNotice';
import { initFontMode } from './lib/fontScale';
import { initInstall } from './lib/install';
import { initTheme } from './lib/theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

initFontMode();
initTheme();
initInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
      <Splash />
      <ThemeNotice />
    </StoreProvider>
  </StrictMode>,
);
