'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function blend(dst, src) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA === 0) return [0, 0, 0, 0];
  return [
    Math.round((src[0] * sa + dst[0] * da * (1 - sa)) / outA),
    Math.round((src[1] * sa + dst[1] * da * (1 - sa)) / outA),
    Math.round((src[2] * sa + dst[2] * da * (1 - sa)) / outA),
    Math.round(outA * 255),
  ];
}

function sample(size, x, y) {
  const radius = size * 0.22;
  const insideCorner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  let inside = true;
  if (x < radius && y < radius) inside = insideCorner(radius, radius);
  else if (x > size - radius && y < radius) inside = insideCorner(size - radius, radius);
  else if (x < radius && y > size - radius) inside = insideCorner(radius, size - radius);
  else if (x > size - radius && y > size - radius) inside = insideCorner(size - radius, size - radius);
  const bg = inside ? [16, 14, 12, 255] : [0, 0, 0, 0];
  const cy = size / 2;
  const r = size * 0.172;
  const left = size * 0.375;
  const right = size * 0.625;
  const dotAlpha = (cx) => {
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (d <= r - 0.6) return 255;
    if (d >= r + 0.6) return 0;
    return Math.round(255 * (r + 0.6 - d) / 1.2);
  };
  const a = Math.max(dotAlpha(left), dotAlpha(right));
  return blend(bg, [227, 155, 74, a]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const color = sample(size, x + 0.5, y + 0.5);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(dir, 'favicon-32.png'), png(32));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), png(180));
