import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const watch = process.argv.includes('--watch');
const watchOpt = watch ? {} : null;

const popup: InlineConfig = {
  configFile: false,
  root: resolve(root, 'src/ui'),
  publicDir: resolve(root, 'public'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    watch: watchOpt,
    rollupOptions: { input: { popup: resolve(root, 'src/ui/popup/index.html') } },
  },
};

function lib(
  entry: string,
  file: string,
  format: 'es' | 'iife',
  name: string,
  define?: Record<string, string>,
): InlineConfig {
  return {
    configFile: false,
    publicDir: false,
    define,
    build: {
      outDir: resolve(root, 'dist'),
      emptyOutDir: false,
      minify: false,
      watch: watchOpt,
      lib: { entry: resolve(root, entry), formats: [format], name, fileName: () => file },
    },
  };
}

const configs: InlineConfig[] = [
  popup,
  lib('src/background/index.ts', 'background.js', 'es', 'DarkExtBackground'),
  lib('src/content/index.ts', 'content.js', 'iife', 'DarkExtContent'),
  lib('src/main-world/hook.ts', 'main-world.js', 'iife', 'DarkExtMainWorld'),
  lib('src/placeholder/placeholder.ts', 'placeholder.js', 'iife', 'DarkExtPlaceholder', { __SYS__: 'false' }),
  lib('src/placeholder/placeholder.ts', 'placeholder-sys.js', 'iife', 'DarkExtPlaceholderSys', { __SYS__: 'true' }),
];

for (const c of configs) await build(c);
