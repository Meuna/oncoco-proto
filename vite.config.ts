import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site under /<REPO_NAME>/: update this if the repo is renamed.
const REPO_BASE = '/oncoco-proto/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  // Module worker: required for the processors' dynamic import().
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'oncoco proto',
        short_name: 'oncoco',
        description: 'Prototypage vision par ordinateur sur flux caméra',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'fr',
        start_url: '.',
        scope: '.',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // OpenCV.js (~10 MB) is fetched on demand only, like models and wasm.
        globIgnores: ['**/opencv-*.js'],
      },
    }),
  ],
}));
