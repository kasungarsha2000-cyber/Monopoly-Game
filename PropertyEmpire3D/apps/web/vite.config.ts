import { defineConfig } from 'vite';

const serverPort = Number(process.env.PE_PORT ?? 3001);
const webPort = Number(process.env.PE_WEB_PORT ?? 5173);
const lan = process.env.PE_LAN === '1';

export default defineConfig(({ mode }) => ({
  root: __dirname,
  // "standalone" builds one self-contained page (used for the claude.ai artifact).
  base: mode === 'standalone' ? './' : '/',
  publicDir: 'public',
  server: {
    host: lan ? '0.0.0.0' : '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      '/health': { target: `http://127.0.0.1:${serverPort}` },
      '/api': { target: `http://127.0.0.1:${serverPort}` }
    }
  },
  preview: {
    host: lan ? '0.0.0.0' : '127.0.0.1',
    port: 4173
  },
  build: {
    outDir: mode === 'standalone' ? 'dist-standalone' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    copyPublicDir: mode !== 'standalone',
    rollupOptions: {
      output: mode === 'standalone' ? { inlineDynamicImports: true } : { manualChunks: { three: ['three'] } }
    }
  }
}));
