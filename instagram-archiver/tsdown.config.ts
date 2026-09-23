import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  // Bundle ALL dependencies into the output so the runtime image needs no
  // node_modules and no tsx — just `node dist/index.mjs`. Keeps memory low on
  // the RPi (no runtime transpilation, minimal resident footprint).
  deps: {
    alwaysBundle: [/.*/],
  },
  platform: 'node',
  target: 'node22',
  dts: false,
  sourcemap: false,
  minify: true,
  clean: true,
});
