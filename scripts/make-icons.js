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

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const bg = [22, 19, 15, 255];
  const dot = [227, 155, 74, 255];
  const cy = size / 2;
  const r = size * 0.16;
  const left = size * 0.38;
  const right = size * 0.62;
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const inset = Math.min(x, y, size - 1 - x, size - 1 - y);
      let inside = true;
      if (x < radius && y < radius) inside = (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2;
      else if (x > size - radius && y < radius) inside = (x - (size - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2;
      else if (x < radius && y > size - radius) inside = (x - radius) ** 2 + (y - (size - radius)) ** 2 <= radius ** 2;
      else if (x > size - radius && y > size - radius) {
        inside = (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 <= radius ** 2;
      }
      const onDot = (x - left) ** 2 + (y - cy) ** 2 <= r ** 2 || (x - right) ** 2 + (y - cy) ** 2 <= r ** 2;
      const color = !inside || inset < 0 ? [0, 0, 0, 0] : onDot ? dot : bg;
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

const dir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, 'icon' + size + '.png'), png(size));
}
