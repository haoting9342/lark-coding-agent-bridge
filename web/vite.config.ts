import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Builds the management console into ONE self-contained index.html (JS+CSS+
// icons inlined) written to ../src/ui/generated/, which tsup then inlines into
// the CLI bundle as a string — the bridge serves it with zero runtime file/CDN
// deps (works offline).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // 发布包测试由 Vitest 发起，此时 NODE_ENV=test。无论调用方环境如何，
  // 都禁止把 JSX 调试信息和构建机绝对路径写入内联控制台。
  oxc: {
    jsx: {
      development: false,
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('../src/ui/generated', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
});
