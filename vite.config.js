import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const dataVersion = createHash('sha256').update(readFileSync(new URL('./public/phones.json', import.meta.url))).digest('hex').slice(0, 8);

// Relative paths work at /, /nordgate/, and on a custom domain.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version), __DATA_VERSION__: JSON.stringify(dataVersion) },
  build: { target: 'es2020', sourcemap: false },
  server: { strictPort: true },
  preview: { strictPort: true },
});
