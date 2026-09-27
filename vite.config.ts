import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5183,
    strictPort: true,
    // The dev server is reached through whatever hostname forwards to this
    // machine, so host checking is relaxed here and only here. The packaged
    // app loads from file:// and never starts this server.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.DENTIVA_API_URL ?? 'http://127.0.0.1:5184',
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5185,
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome124',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        // Stable, predictable file names keep the Electron load path simple.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
