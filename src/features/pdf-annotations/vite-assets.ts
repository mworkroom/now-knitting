import type { Plugin } from 'vite';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function pdfAssetsPlugin(): Plugin {
  return {
    name: 'local-pdf-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pdf-assets\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec((request.url ?? '').split('?')[0]);
        if (!match) return next();
        const file = resolve('node_modules/pdfjs-dist', match[1], match[2]);
        if (!existsSync(file)) return next();
        response.setHeader('Content-Type', match[2].endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(file));
      });
    },
    closeBundle() {
      for (const folder of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve('node_modules/pdfjs-dist', folder), resolve('dist/pdf-assets', folder), { recursive: true });
    },
  };
}
