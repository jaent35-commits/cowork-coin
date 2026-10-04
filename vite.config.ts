import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * index.html 의 __SITE_URL__ 을 배포 도메인으로 치환한다.
 * OG 크롤러(카카오톡·페이스북·슬랙 등)는 og:image 에 절대 URL 이 필요하므로
 * 배포 전 .env(.production) 에 VITE_SITE_URL=https://도메인 을 지정할 것.
 */
function siteUrl(url: string): Plugin {
  return {
    name: 'site-url',
    transformIndexHtml: html => html.replaceAll('__SITE_URL__', url.replace(/\/+$/, '')),
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    siteUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? ''),
    react(),
    // npm run dev:https — 휴대폰에서 https 로 시험 (앱 안 카메라는 https 에서만 열림, 자체 서명 인증서라 경고 후 진행)
    mode === 'https' ? basicSsl() : null,
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // src/components/PwaPrompt.tsx 에서 직접 등록
      includeAssets: ['icons/favicon-64.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '코웍-코인 : 프로젝트 예산 관리 시스템',
        short_name: '코웍-코인',
        description: '팀 회의비와 프로젝트 경비를 함께 관리하는 코웍-코인',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#FFFFFF',
        background_color: '#F8F4EE',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // /api → 영수증 OCR 백엔드(FastAPI, backend/main.py). 운영은 VITE_OCR_API_URL 로 주소 지정
  server: { port: 5176, host: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { port: 4176, host: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
}));
