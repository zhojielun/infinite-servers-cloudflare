import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Backend origin used by the dev server to proxy API calls.
// Default points to the Worker dev server proxy; override via API_TARGET env var.
const API_TARGET = process.env.API_TARGET || 'http://localhost:8000'
const API_PATHS = ['/servers', '/status', '/history', '/availability', '/push', '/set-expiry', '/set-purchase-date', '/login', '/logout', '/doodle', '/geo']

export default defineConfig(({ command }) => ({
  root: 'web',
  // Assets are CDN-prefixed at build time via VITE_ASSET_BASE; default to the
  // origin-served /dist/ folder. Dev server always serves from root.
  base: command === 'build' ? (process.env.VITE_ASSET_BASE || '/dist/') : '/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // CDN builds upload assets to the bucket root, so drop the `assets/` dir.
    assetsDir: process.env.VITE_ASSET_BASE ? '' : 'assets',
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'web/index.html'),
        detail: resolve(__dirname, 'web/detail.html'),
      },
    },
  },
  server: {
    proxy: Object.fromEntries(API_PATHS.map((p) => [p, { target: API_TARGET, changeOrigin: true }])),
  },
}))
