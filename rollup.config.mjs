import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'node:fs';
import thirdPartyNotices from './scripts/third-party-notices.mjs';
import { applyDevPreview } from './scripts/dev-preview.mjs';

const dev = process.env.ROLLUP_WATCH === 'true';
// Pages preview only. The release build leaves this unset, so its output file and plugins stay the same.
const preview = process.env.JB_DEV_PREVIEW === '1';
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));
const banner = `/*! Jukebox Card v${version} (jukebox_kiosk) | MIT License | Copyright (c) 2026 Randy Bell | Includes Lit (BSD-3-Clause, Copyright Google LLC); see THIRD_PARTY_NOTICES.md */`;

function devPreview() {
  return {
    name: 'jb-dev-preview',
    transform(code, id) {
      if (!/[\\/]src[\\/]/.test(id)) return null;
      const next = applyDevPreview(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default {
  input: 'src/jukebox-card.ts',
  output: {
    file: preview ? 'dist-dev/jukebox-card-dev.js' : 'custom_components/jukebox_kiosk/www/jukebox-card.js',
    format: 'es',
    sourcemap: false,
    inlineDynamicImports: true,
    banner,
  },
  plugins: [
    preview && devPreview(),
    resolve(),
    typescript({ tsconfig: './tsconfig.json', outDir: undefined, noEmitOnError: true }),
    // Keep license comments (/*! ... */, @license, @preserve) from Lit and the banner in the minified bundle.
    !dev && terser({ format: { comments: 'some' } }),
    !preview && thirdPartyNotices(),
  ],
};
