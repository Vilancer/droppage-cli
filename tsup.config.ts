import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outDir: 'dist',
});
