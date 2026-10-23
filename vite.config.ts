import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfAssetsPlugin } from './src/features/pdf-annotations/vite-assets.ts';

export default defineConfig({
  plugins: [react(), ...(process.env.ENABLE_PDF_ANNOTATIONS === 'true' ? [pdfAssetsPlugin()] : [])],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
