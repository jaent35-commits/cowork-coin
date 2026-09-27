import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { STORAGE_KEY, TEST_TEAMS, buildDevSeed } from './scripts/dev-seed.ts';

/**
 * 개발 서버 전용 테스트 데이터 (운영 빌드에는 없음 — apply: 'serve')
 *   /__dev/seed  → 테스트 데이터로 저장본을 덮어쓰고 로그인 화면으로 (scripts/dev-seed.ts)
 *   /__dev/clear → 저장본을 지워 첫 실행('관리자 팀 만들기') 화면으로
 */
function devSeed(): Plugin {
  const page = (title: string, script: string, body: string) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222;background:#faf8f4}
table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f1ede6}
code{background:#eee;padding:1px 5px;border-radius:4px}a.btn{display:inline-block;margin-top:8px;padding:10px 18px;background:#222;color:#fff;border-radius:8px;text-decoration:none}</style>
<script>${script}</script></head><body>${body}</body></html>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const clearLogin = `['cowork-coin-remember','cowork-coin-last-team'].forEach(function(k){localStorage.removeItem(k)});sessionStorage.removeItem('cowork-coin-alive');`;
  return {
    name: 'dev-seed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/seed', (_req, res) => {
        const state = JSON.stringify(buildDevSeed()).replace(/</g, '\\u003c');
        const rows = TEST_TEAMS.map(t => `<tr><td>${esc(t.name)}</td><td><code>${esc(t.password)}</code></td><td>${esc(t.note)}</td></tr>`).join('');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(page('테스트 데이터 적용',
          `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(state)});${clearLogin}`,
          `<h1>테스트 데이터를 넣었습니다</h1><p>이 브라우저의 앱 저장본을 테스트 데이터로 바꿨습니다. 다시 열면 처음 상태로 돌아갑니다.</p>
<table><tr><th>팀</th><th>비밀번호 (테스트용)</th><th>상태</th></tr>${rows}</table>
<a class="btn" href="/">앱 열기</a><p><small>첫 실행 화면을 보려면 <a href="/__dev/clear">/__dev/clear</a></small></p>`));
      });
      server.middlewares.use('/__dev/clear', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(page('저장본 지움', `localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});${clearLogin}`,
          `<h1>앱 저장본을 지웠습니다</h1><p>앱을 열면 첫 실행(관리자 팀 만들기) 화면이 나옵니다.</p><a class="btn" href="/">앱 열기</a> <a href="/__dev/seed">테스트 데이터 다시 넣기</a>`));
      });
    },
  };
}

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
    devSeed(),
    react(),
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
