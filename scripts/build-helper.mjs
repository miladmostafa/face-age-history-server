import { mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

mkdirSync('public', { recursive: true });

await esbuild.build({
  entryPoints: ['src/helper/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'FaceAgeHistory',
  outfile: 'public/face-age-history.js',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
});
