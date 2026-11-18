// news-image-20261117: writes the world's news of Tuesday 17 November 2026 as one picture.
// The picture (entry.png) is drawn ahead of time from build/page.html (build/render.mjs, then build/pack.mjs)
// and kept in this repository, so the run needs no network: it only copies the bytes to the output folder.
// Locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('./entry.png', import.meta.url);
const MAX_BYTES = 1024 * 1024; // the gate's limit: 1 MiB
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

let bytes;
try {
  bytes = readFileSync(src);
} catch (err) {
  fail(`cannot read entry.png beside main.ts (${err.message})`);
}
if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
  fail('entry.png does not start with the PNG signature (89 50 4E 47 0D 0A 1A 0A); refusing to copy it');
}
if (bytes.length > MAX_BYTES) {
  fail(`entry.png is ${bytes.length} bytes, over the 1 MiB limit (${MAX_BYTES} bytes); refusing to copy it`);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'entry.png'));
