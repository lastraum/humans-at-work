/** Minimal RFC4 Chat packet — same wire as DCL Explorer / ThreejsClient. */

const RFC4_PROTOCOL_VERSION = 100;
const OLE_UNIX_EPOCH_DAYS = 25569;

export function oleTimestampNow() {
  return Date.now() / 1000 / 86400 + OLE_UNIX_EPOCH_DAYS;
}

function encodeVarint(n: number): number[] {
  const out: number[] = [];
  let x = n >>> 0;
  while (x > 0x7f) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return out;
}

function encodeKey(field: number, wire: number) {
  return encodeVarint((field << 3) | wire);
}

function encodeString(field: number, value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [...encodeKey(field, 2), ...encodeVarint(bytes.length), ...bytes];
}

function encodeDouble(field: number, value: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return [...encodeKey(field, 1), ...new Uint8Array(buf)];
}

function encodeBytes(field: number, value: number[]): number[] {
  return [...encodeKey(field, 2), ...encodeVarint(value.length), ...value];
}

export function encodeRfc4ChatPacket(text: string): Uint8Array {
  const chat = [...encodeString(1, text), ...encodeDouble(2, oleTimestampNow())];
  const packet = [...encodeBytes(1, chat), ...encodeKey(11, 0), ...encodeVarint(RFC4_PROTOCOL_VERSION)];
  return Uint8Array.from(packet);
}

function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const b = buf[i++]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: value >>> 0, next: i };
}

export function tryDecodeRfc4Chat(buf: Uint8Array): string | null {
  try {
    let i = 0;
    while (i < buf.length) {
      const key = readVarint(buf, i);
      i = key.next;
      const field = key.value >>> 3;
      const wire = key.value & 7;
      if (wire === 0) {
        i = readVarint(buf, i).next;
        continue;
      }
      if (wire === 1) {
        i += 8;
        continue;
      }
      if (wire === 5) {
        i += 4;
        continue;
      }
      if (wire !== 2) return null;
      const len = readVarint(buf, i);
      i = len.next;
      const slice = buf.subarray(i, i + len.value);
      i += len.value;
      if (field === 1) {
        const inner = decodeChatMessage(slice);
        if (inner) return inner;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function decodeChatMessage(buf: Uint8Array): string | null {
  let i = 0;
  let text: string | null = null;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    i = key.next;
    const field = key.value >>> 3;
    const wire = key.value & 7;
    if (wire === 2) {
      const len = readVarint(buf, i);
      i = len.next;
      const slice = buf.subarray(i, i + len.value);
      i += len.value;
      if (field === 1) text = new TextDecoder().decode(slice);
      continue;
    }
    if (wire === 1) {
      i += 8;
      continue;
    }
    if (wire === 0) {
      i = readVarint(buf, i).next;
      continue;
    }
    if (wire === 5) {
      i += 4;
      continue;
    }
    return text;
  }
  return text;
}
