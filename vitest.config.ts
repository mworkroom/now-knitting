import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { NOTION_TOKEN: 'test-only-token' } } })],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000, fileParallelism: false },
});
