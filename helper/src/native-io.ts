import { packMessages } from '../../shared/chunking';

const MAX_FRAME = 1024 * 1024;

export function frameMessage(message: unknown): Buffer {
  const parts = packMessages(message);
  const frames: Buffer[] = [];
  for (const part of parts) {
    const body = Buffer.from(JSON.stringify(part));
    if (body.length >= MAX_FRAME) {
      throw new Error('Native message still exceeds 1 MB after chunking');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    frames.push(header, body);
  }
  return Buffer.concat(frames);
}

export function createParser(onMessage: (message: unknown) => void): (chunk: Buffer | Uint8Array | string) => void {
  let buf = Buffer.alloc(0);
  return function push(chunk) {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (len <= 0 || len > 64 * 1024 * 1024) {
        throw new Error('Invalid native message length');
      }
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      onMessage(JSON.parse(body) as unknown);
    }
  };
}

export { MAX_FRAME };
