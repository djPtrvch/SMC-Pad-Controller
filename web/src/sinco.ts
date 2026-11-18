// First install over the stock firmware: open-smc-pad's host/install_from_stock.py, in the browser.
// The stock firmware's SINCO service (on its "…Private" MIDI port) erases, writes and reads flash.
// The installer and staging images come prebuilt from CI (tools/make_install.py, the same bytes as
// the Python tool); this file does the talking, the sector 0 change and every check.
// sinco.test.ts checks the helpers against vectors made with open-smc-pad's own Python.

// ------------------------------------------------------------------ JieLi helpers (host/jlimage.py)

export function crc16(data: ArrayLike<number>, crc = 0): number {
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

// JieLi "ENC" stream cipher (LFSR keyed XOR), in place
export function encCipher(buf: Uint8Array, off: number, size: number, key = 0xffff) {
  for (let i = 0; i < size; i++) {
    buf[off + i] ^= key & 0xff;
    key = ((key << 1) ^ (key & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
}

export const SECTOR = 0x1000;

// sector 0 as the stock firmware reads it = physical XOR this (key 0xFFFF, restarting every 256 bytes)
export function sector0Keystream(): Uint8Array {
  const k = new Uint8Array(SECTOR);
  for (let off = 0; off < SECTOR; off += 256) encCipher(k, off, 256);
  return k;
}

const xor = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v ^ b[i]);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const putU32 = (b: Uint8Array, o: number, v: number) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const ascii = (b: Uint8Array) => String.fromCharCode(...b);

// sector 0's file list: (offset, decrypted entry)
export function entries(phys: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  for (let off = 0x20; off < 0x200; off += 32) {
    const e = phys.slice(off, off + 32);
    encCipher(e, 0, 32);
    if (crc16(e.subarray(2)) !== u16(e, 0)) break;
    out.push([off, e]);
  }
  return out;
}

export function appDirHead(phys: Uint8Array): [number, number] {
  for (const [off, e] of entries(phys)) if (ascii(e.subarray(16, 28)) === 'app_dir_head') return [off, u32(e, 4)];
  throw new Error('no app_dir_head in sector 0: not the layout this installer knows');
}

export function withBootDir(phys: Uint8Array, target: number): Uint8Array {
  const [off] = appDirHead(phys);
  const e = phys.slice(off, off + 32);
  encCipher(e, 0, 32);
  putU32(e, 4, target);
  const c = crc16(e.subarray(2));
  e[0] = c & 255; e[1] = c >> 8;
  encCipher(e, 0, 32);
  const out = phys.slice();
  out.set(e, off);
  return out;
}

// ------------------------------------------------------------------ SINCO packets (host/sinco_proto.py)

export function makePacket(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const n = payload.length;
  let sum = 0;
  for (const b of payload) sum += b;
  return Uint8Array.from([0x00, 0x59, cmd, n & 255, (n >> 8) & 255, (n >> 16) & 255, ...payload, ~sum & 255]);
}

// 8-bit packet bit-packed LSB first into 7-bit bytes, in F0 .. F7 (no manufacturer ID)
export function sincoSysex(pkt: Uint8Array): Uint8Array {
  const out = [0xf0];
  let acc = 0, bits = 0;
  for (const b of pkt) {
    acc |= b << bits;
    bits += 8;
    while (bits >= 7) { out.push(acc & 0x7f); acc >>= 7; bits -= 7; }
  }
  if (bits) out.push(acc & 0x7f);
  out.push(0xf7);
  return Uint8Array.from(out);
}

export function sincoUnpack(sx: Uint8Array): Uint8Array {
  const body = sx[0] === 0xf0 ? sx.subarray(1, sx.length - 1) : sx;
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const b of body) {
    acc |= (b & 0x7f) << bits;
    bits += 7;
    while (bits >= 8) { out.push(acc & 0xff); acc >>= 8; bits -= 8; }
  }
  return Uint8Array.from(out);
}

export function parsePacket(p: Uint8Array): { cmd: number; body: Uint8Array; ok: boolean } | null {
  if (p.length < 7 || p[0] !== 0x00 || p[1] !== 0x59) return null;
  const n = p[3] | (p[4] << 8) | (p[5] << 16);
  const body = p.slice(6, 6 + n);
  let sum = 0;
  for (const b of body) sum += b;
  return { cmd: p[2], body, ok: p.length > 6 + n && p[6 + n] === (~sum & 255) };
}

// ------------------------------------------------------------------ the link

export class SincoLink {
  private waiting: ((p: { cmd: number; body: Uint8Array; ok: boolean } | null) => void) | null = null;

  constructor(readonly input: MIDIInput, readonly output: MIDIOutput) {
    input.onmidimessage = (e: MIDIMessageEvent) => {
      if (!e.data || e.data[0] !== 0xf0 || !this.waiting) return;
      const w = this.waiting;
      this.waiting = null;
      w(parsePacket(sincoUnpack(new Uint8Array(e.data))));
    };
  }

  close() {
    this.input.onmidimessage = null;
  }

  request(cmd: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = 2000) {
    return new Promise<{ cmd: number; body: Uint8Array; ok: boolean } | null>((resolve) => {
      const timer = setTimeout(() => { this.waiting = null; resolve(null); }, timeoutMs);
      this.waiting = (p) => { clearTimeout(timer); resolve(p); };
      this.output.send(sincoSysex(makePacket(cmd, payload)));
    });
  }

  async name(): Promise<string> {
    const r = await this.request(0x11, undefined, 1000);
    if (!r || r.cmd !== 0x11) throw new Error('the stock firmware does not answer on its Private MIDI port');
    return ascii(r.body).replace(/\0.*$/, '');
  }

  // 0x23: type 0, addr u32, len u24 -> type, addr, len, data
  async read(addr: number, n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    for (let done = 0; done < n;) {
      const k = Math.min(256, n - done), a = addr + done;
      let got: Uint8Array | null = null;
      for (let tries = 0; tries < 3 && !got; tries++) {
        const r = await this.request(0x23, Uint8Array.from([0, a & 255, (a >> 8) & 255, (a >> 16) & 255, a >>> 24, k & 255, k >> 8, 0]), 1000);
        if (!r) continue;
        if (r.cmd !== 0x23) throw new Error(`the pad refused to read ${a.toString(16)}`);
        const b = r.body;
        if (r.ok && b[0] === 0 && u32(b, 1) === a && (b[5] | (b[6] << 8) | (b[7] << 16)) === k && b.length === 8 + k) got = b.slice(8);
      }
      if (!got) throw new Error(`no valid reply reading ${a.toString(16)}`);
      out.set(got, done);
      done += k;
    }
    return out;
  }

  private async ack(cmd: number, payload: Uint8Array, what: string) {
    const r = await this.request(cmd, payload);
    // fw 004 answers erase and write with cmd 0x00, status 0x00
    if (!r || !r.ok || (r.cmd !== 0 && r.cmd !== cmd) || (r.body[0] ?? 0) !== 0) throw new Error(`${what} failed`);
  }

  // erases the sectors, then writes in 1 KB pieces (the stock firmware's limit); addr sector-aligned
  async write(addr: number, data: Uint8Array, progress?: (f: number) => void) {
    if (addr % SECTOR) throw new Error('unaligned write');
    for (let a = addr; a < addr + data.length; a += SECTOR) {
      await this.ack(0x21, Uint8Array.from([0, a & 255, (a >> 8) & 255, (a >> 16) & 255, a >>> 24]), `erase ${a.toString(16)}`);
    }
    for (let o = 0; o < data.length; o += 1024) {
      const chunk = data.subarray(o, o + 1024), a = addr + o, k = chunk.length;
      await this.ack(0x22, Uint8Array.from([0, a & 255, (a >> 8) & 255, (a >> 16) & 255, a >>> 24, k & 255, k >> 8, 0, ...chunk]), `write ${a.toString(16)}`);
      progress?.((o + k) / data.length);
    }
  }
}

// ------------------------------------------------------------------ the install

export interface InstallFiles {
  manifest: { installDir: number; stage: number; stageEnd: number; dest: number; template: string[]; cfgTool: string };
  installer: Uint8Array;
  stage: Uint8Array;
}

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));

// The pad's own directory (read at DEST) must match the one the images were built from:
// names, attributes and the special areas; offsets, sizes and CRCs of app.bin / cfg_tool.bin vary.
export function checkDirectory(dir: Uint8Array, template: string[]): string | null {
  for (let i = 0; i < 9; i++) {
    const got = dir.subarray(i * 32, i * 32 + 32), want = hex(template[i]);
    const same = (from: number, to: number) => eq(got.subarray(from, to), want.subarray(from, to));
    // entry: hdr_crc 0-1, data_crc 2-3, offset 4-7, size 8-11, attr 12, resvd 13, index 14-15, name+tag 16-31
    if (!same(12, 32)) return `directory entry ${i} differs`;
    if (i >= 5 && !same(4, 12)) return `directory entry ${i} differs`;       // BTIF, EXIF, USRFLASH, USRTRIM
    if (i === 4 && !same(4, 8)) return 'the PRCT entry differs';
  }
  return null;
}

export type Say = (line: string) => void;

// Steps 1-2 of install_from_stock.py. Returns when the pad must be power-cycled.
export async function installFromStock(link: SincoLink, files: InstallFiles, dryRun: boolean, say: Say, progress: (f: number) => void) {
  const m = files.manifest;
  const name = await link.name();
  say(`stock firmware ${name}`);
  if (!name.startsWith('SMC-PAD')) throw new Error('not an SMC-PAD');

  const K = sector0Keystream();
  const phys = xor(await link.read(0, SECTOR), K);
  const [off, bootDir] = appDirHead(phys);
  say(`sector 0: ${entries(phys).length} entries, app_dir_head at +${off.toString(16)} → ${bootDir.toString(16)}`);
  if (bootDir !== m.dest && bootDir !== m.installDir) throw new Error(`sector 0 boots ${bootDir.toString(16)}, expected ${m.dest.toString(16)}`);

  const dir = await link.read(m.dest, 0x120);
  const bad = checkDirectory(dir, m.template);
  if (bad) throw new Error(`${bad}: this pad's firmware is not the one the installer was built for. Nothing was written.`);
  const cfgOff = u32(dir, 0x40 + 4), cfgSize = u32(dir, 0x40 + 8);
  const cfg = await link.read(m.dest + cfgOff, cfgSize);
  if (!eq(cfg, hex(m.cfgTool))) throw new Error('cfg_tool.bin differs from the one the installer was built with. Nothing was written.');
  say('directory and cfg_tool.bin as expected');

  say(`installer ${files.installer.length} bytes at ${m.installDir.toString(16)}, staging ${files.stage.length} bytes at ${m.stage.toString(16)}`);
  if (dryRun) {
    say('check only: nothing was written');
    return false;
  }
  say('writing the installer and the staging area…');
  await link.write(m.installDir, files.installer, (f) => progress(f * 0.45));
  await link.write(m.stage, files.stage, (f) => progress(0.45 + f * 0.45));
  // above the stock firmware's VM start the read path is raw: compare directly
  if (!eq(await link.read(m.installDir, files.installer.length), files.installer) || !eq(await link.read(m.stage, files.stage.length), files.stage)) {
    throw new Error('read-back mismatch in free flash (sector 0 untouched, nothing to undo)');
  }
  say('read back OK');

  const next = withBootDir(phys, m.installDir);
  say(`pointing sector 0 at the installer (${next.filter((v, i) => v !== phys[i]).length} bytes change)`);
  if (bootDir !== m.installDir) {
    await link.write(0, next);
    const back = xor(await link.read(0, SECTOR), K);
    if (!eq(back, next)) {
      say('sector 0 did not read back as written: putting the original back');
      await link.write(0, phys);
      const again = xor(await link.read(0, SECTOR), K);
      throw new Error(eq(again, phys) ? 'restored the original sector 0' : 'COULD NOT RESTORE SECTOR 0 — do not switch the pad off; keep this page open and ask');
    }
  }
  progress(1);
  say('sector 0 OK');
  return true;
}
