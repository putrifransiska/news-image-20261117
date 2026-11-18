// news-image-20261117: writes the world's news of Tuesday 17 November 2026 as one picture.
// The picture (entry.png) is drawn ahead of time from build/page.html (build/render.mjs, then build/pack.mjs)
// and kept in this repository, so the run needs no network: it only copies the bytes to the output folder.
// Locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
copyFileSync(new URL('./entry.png', import.meta.url), join(outDir, 'entry.png'));
