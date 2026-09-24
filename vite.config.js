import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/*
 * LOCK IN! no longer depends on base44 at all — the backend is src/api/db.js
 * and runs in the browser. The base44 plugin was also what provided the
 * "@/" import alias every file uses, so that is declared here now.
 *
 * LOCKIN_BASE sets the folder it is served from, e.g. "/lockin/" when it
 * lives inside the Code A Difference site. The AI features call /api/ai.php
 * on the same origin; in development that is proxied to the local PHP
 * preview of the site (tools/serve-php.ps1, port 4173).
 */
export default defineConfig({
  base: process.env.LOCKIN_BASE || '/',
  logLevel: 'error',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.LOCKIN_API || 'http://localhost:4173',
        changeOrigin: true,
        // In production LOCK IN! is same-origin with /api/ai.php. In dev the
        // page is on :5174 and the proxy forwards the browser's Origin, which
        // ai.php rightly refuses. This hop never leaves the machine, so drop
        // the header and let it look like the same-origin call it will be.
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
    },
  },
});
