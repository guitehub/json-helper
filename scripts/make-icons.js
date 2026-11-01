#!/usr/bin/env node
/*
 * Génère icons/icon{16,48,128}.png (accolades blanches sur fond bleu arrondi).
 * Zéro dépendance : rasterisation maison + encodage PNG via zlib (Node).
 * Usage : node scripts/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [37, 99, 235]; // #2563eb
const FG = [255, 255, 255];
const SUPERSAMPLE = 4;

// Accolade gauche en coordonnées normalisées (0..1) ; la droite est le miroir.
const LEFT_BRACE = [
  [0.43, 0.24], [0.36, 0.28], [0.36, 0.44], [0.27, 0.5],
  [0.36, 0.56], [0.36, 0.72], [0.43, 0.76],
];
const RIGHT_BRACE = LEFT_BRACE.map(([x, y]) => [1 - x, y]);
const STROKE = 0.075;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onBrace(x, y) {
  for (const brace of [LEFT_BRACE, RIGHT_BRACE]) {
    for (let k = 0; k < brace.length - 1; k++) {
      if (distToSegment(x, y, brace[k], brace[k + 1]) <= STROKE / 2) return true;
    }
  }
  return false;
}

function inRoundedSquare(x, y) {
  const r = 0.2;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!inRoundedSquare(x, y)) continue;
          if (onBrace(x, y)) fg++;
          else bg++;
        }
      }
      const alpha = (bg + fg) / n;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[o + c] = bg + fg === 0 ? 0 : Math.round((BG[c] * bg + FG[c] * fg) / (bg + fg));
      }
      rgba[o + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre « none »
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log('écrit', path.relative(process.cwd(), file));
}
