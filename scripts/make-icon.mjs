#!/usr/bin/env node
// Draws the eclipse of the masthead's O through headless Edge and writes naos.ico and icon-512.png to packages/ui/public. Each size
// is drawn for itself, because a 16 px icon needs a limb one whole pixel wide, and a scaled-down 256 would lose it.
//   node scripts/make-icon.mjs [--out <dir>]   also writes one PNG per size to <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(repo, 'packages/ui/public');
const { values: o } = parseArgs({ options: { out: { type: 'string' } } });

const ICO_SIZES = [16, 24, 32, 48, 256];
const PAPER = '244, 236, 223';
const VOID = '#060504';

/** Runs in the page. The bead sits where the wordmark's does, 60 degrees up the limb. */
function draw({ size, paper, ground }) {
  const scale = 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const c = canvas.getContext('2d');
  c.scale(scale, scale);

  const mid = size / 2;
  const small = size <= 32;
  const disc = size * (small ? 0.325 : 0.3);
  const limb = Math.max(1.4, size * 0.013);
  const corner = size * 0.14;

  c.beginPath();
  c.roundRect(0, 0, size, size, corner);
  c.fillStyle = ground;
  c.fill();
  c.save();
  c.clip();

  const glow = c.createRadialGradient(mid, mid, disc * 0.9, mid, mid, size * (small ? 0.56 : 0.5));
  glow.addColorStop(0, `rgba(${paper}, ${small ? 0.42 : 0.3})`);
  glow.addColorStop(0.35, `rgba(${paper}, ${small ? 0.16 : 0.1})`);
  glow.addColorStop(1, `rgba(${paper}, 0)`);
  c.fillStyle = glow;
  c.fillRect(0, 0, size, size);

  const angle = -Math.PI / 3;
  const x = mid + disc * Math.cos(angle);
  const y = mid + disc * Math.sin(angle);
  const bead = Math.max(1.5, size * 0.04);
  const halo = c.createRadialGradient(x, y, 0, x, y, bead * 3.5);
  halo.addColorStop(0, `rgba(${paper}, 0.5)`);
  halo.addColorStop(1, `rgba(${paper}, 0)`);
  c.fillStyle = halo;
  c.fillRect(0, 0, size, size);

  // After the halo, so the moon stays black right up to its limb.
  c.beginPath();
  c.arc(mid, mid, disc, 0, Math.PI * 2);
  c.fillStyle = '#000';
  c.fill();
  c.lineWidth = limb;
  c.strokeStyle = `rgb(${paper})`;
  c.stroke();

  c.beginPath();
  c.arc(x, y, bead, 0, Math.PI * 2);
  c.fillStyle = `rgb(${paper})`;
  c.fill();
  c.restore();

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const shrink = out.getContext('2d');
  shrink.imageSmoothingQuality = 'high';
  shrink.drawImage(canvas, 0, 0, size, size);
  return out.toDataURL('image/png').split(',')[1];
}

/** PNG frames inside an ICO are valid since Vista, and they keep the alpha of the corners exactly. */
function ico(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const row = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, row);
    header.writeUInt8(size === 256 ? 0 : size, row + 1);
    header.writeUInt16LE(1, row + 4);
    header.writeUInt16LE(32, row + 6);
    header.writeUInt32LE(png.length, row + 8);
    header.writeUInt32LE(offset, row + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map((frame) => frame.png)]);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const frames = [];
  for (const size of [...ICO_SIZES, 512]) {
    const png = Buffer.from(await page.evaluate(draw, { size, paper: PAPER, ground: VOID }), 'base64');
    frames.push({ size, png });
    if (o.out) {
      mkdirSync(o.out, { recursive: true });
      writeFileSync(path.join(o.out, `naos-${size}.png`), png);
    }
  }
  mkdirSync(pub, { recursive: true });
  writeFileSync(path.join(pub, 'naos.ico'), ico(frames.filter((frame) => ICO_SIZES.includes(frame.size))));
  writeFileSync(path.join(pub, 'icon-512.png'), frames.find((frame) => frame.size === 512).png);
} finally {
  await browser.close();
}
