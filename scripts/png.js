'use strict';

const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
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

function pngSize(buf) {
  if (buf.length < 26 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a png');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

function pngChunks(buf) {
  const chunks = [];
  let cursor = 8;
  while (cursor + 12 <= buf.length) {
    const len = buf.readUInt32BE(cursor);
    const type = buf.toString('ascii', cursor + 4, cursor + 8);
    const data = buf.subarray(cursor + 8, cursor + 8 + len);
    chunks.push({ type, data });
    cursor += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDelta = Math.abs(estimate - left);
  const upDelta = Math.abs(estimate - up);
  const upLeftDelta = Math.abs(estimate - upLeft);
  if (leftDelta <= upDelta && leftDelta <= upLeftDelta) return left;
  if (upDelta <= upLeftDelta) return up;
  return upLeft;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[row - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[row - stride + x - bpp] : 0;
      const value = raw[src];
      src += 1;
      let byte = value;
      if (filter === 1) byte = (value + left) & 255;
      else if (filter === 2) byte = (value + up) & 255;
      else if (filter === 3) byte = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) byte = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error('unsupported png filter ' + filter);
      out[row + x] = byte;
    }
  }
  if (src !== raw.length) throw new Error('png image data length does not match the header');
  return out;
}

function encodeRgbPng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (stride + 1);
    raw[dest] = 0;
    rgb.copy(raw, dest + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Store screenshots and promo tiles must be 24-bit PNG with no alpha channel.
function toOpaquePng(buf, background = [16, 14, 12]) {
  const info = pngSize(buf);
  if (info.bitDepth !== 8) throw new Error('png bit depth ' + info.bitDepth + ' is not 8');
  if (info.colorType === 2) return buf;
  if (info.colorType !== 6) throw new Error('png color type ' + info.colorType + ' cannot be flattened');
  const idat = Buffer.concat(pngChunks(buf).filter((item) => item.type === 'IDAT').map((item) => item.data));
  const raw = zlib.inflateSync(idat);
  const rgba = unfilter(raw, info.width, info.height, 4);
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const alpha = rgba[i + 3] / 255;
    rgb[j] = Math.round(rgba[i] * alpha + background[0] * (1 - alpha));
    rgb[j + 1] = Math.round(rgba[i + 1] * alpha + background[1] * (1 - alpha));
    rgb[j + 2] = Math.round(rgba[i + 2] * alpha + background[2] * (1 - alpha));
  }
  return encodeRgbPng(info.width, info.height, rgb);
}

module.exports = { pngSize, toOpaquePng };
