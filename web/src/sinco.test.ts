import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appDirHead, crc16, encCipher, makePacket, parsePacket, sector0Keystream, sincoSysex, sincoUnpack, withBootDir } from './sinco';

// made with open-smc-pad's own host/jlimage.py, sinco_proto.py and install_from_stock.py
const v = JSON.parse(readFileSync(new URL('../../tests/vectors/sinco.json', import.meta.url), 'utf8'));

describe('the same as open-smc-pad host tools', () => {
  it('crc16', () => expect(crc16(v.data)).toBe(v.crc16));
  it('ENC cipher', () => {
    const b = Uint8Array.from(v.data);
    encCipher(b, 0, b.length, 0x1234);
    expect(Array.from(b)).toEqual(v.enc1234);
  });
  it('sector 0 keystream', () => expect(Array.from(sector0Keystream().slice(0, 256))).toEqual(v.keystream256));
  it('app_dir_head and moving it', () => {
    const phys = new Uint8Array(4096).fill(0xff);
    phys.set(v.sector0);
    expect(appDirHead(phys)).toEqual([v.appDirOff, v.appDir]);
    expect(Array.from(withBootDir(phys, 0x41000).slice(0, 0x80))).toEqual(v.moved);
  });
  it('packets', () => {
    const payload = Uint8Array.from(v.packet.slice(6, -1));
    expect(Array.from(makePacket(0x22, payload))).toEqual(v.packet);
    expect(Array.from(sincoSysex(Uint8Array.from(v.packet)))).toEqual(v.sysex);
    const back = parsePacket(sincoUnpack(Uint8Array.from(v.sysex)))!;
    expect(back.cmd).toBe(0x22);
    expect(back.ok).toBe(true);
  });
});

// ------------------------------------------------------------------ a fake stock pad

import { InstallFiles, SincoLink, installFromStock } from './sinco';

class FakeStock {
  flash = new Uint8Array(0x80000).fill(0xff);
  K = sector0Keystream();
  breakSector0 = false;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null;
  input = this as unknown as MIDIInput;
  output = { send: (b: Uint8Array) => this.handle(Uint8Array.from(b)) } as unknown as MIDIOutput;

  reply(cmd: number, payload: number[]) {
    const m = sincoSysex(makePacket(cmd, Uint8Array.from(payload)));
    queueMicrotask(() => this.onmidimessage?.({ data: m }));
  }

  handle(sx: Uint8Array) {
    const p = parsePacket(sincoUnpack(sx))!;
    const b = p.body;
    const addr = b[1] | (b[2] << 8) | (b[3] << 16) | (b[4] << 24);
    if (p.cmd === 0x11) return this.reply(0x11, [...new TextEncoder().encode('SMC-PAD_004'), 0]);
    if (p.cmd === 0x23) {
      const n = b[5] | (b[6] << 8);
      let data = this.flash.slice(addr, addr + n);
      if (addr < 0x1000) data = data.map((x, i) => x ^ this.K[addr + i]);     // sector 0 reads deciphered
      return this.reply(0x23, [...b.slice(0, 8), ...data]);
    }
    if (p.cmd === 0x21) { this.flash.fill(0xff, addr, addr + 0x1000); return this.reply(0, [0]); }
    if (p.cmd === 0x22) {
      const n = b[5] | (b[6] << 8);
      const data = b.slice(8, 8 + n);
      if (this.breakSector0 && addr < 0x1000) data[100] ^= 1;
      this.flash.set(data.map((x, i) => this.flash[addr + i] & x), addr);
      return this.reply(0, [0]);
    }
  }
}

function setup() {
  const pad = new FakeStock();
  // sector 0: the stock layout with app_dir_head -> 0x1000 (physical = as stored)
  const s0 = new Uint8Array(4096).fill(0xff);
  s0.set(v.sector0);
  pad.flash.set(s0, 0);                                      // physical; the stock read path XORs it with K
  const dir = new Uint8Array(0x120).fill(0xff);
  for (let i = 0; i < 9; i++) dir[i * 32 + 12] = i;          // some attrs
  const cfg = Uint8Array.from({ length: 0x360 }, (_, i) => i & 255);
  dir.set([0x00, 0x30, 0, 0, 0x60, 0x03, 0, 0], 0x40 + 4);   // cfg_tool at +0x3000, 0x360 bytes
  pad.flash.set(dir, 0x1000);
  pad.flash.set(cfg, 0x1000 + 0x3000);
  const files: InstallFiles = {
    manifest: {
      installDir: 0x41000, stage: 0x43000, stageEnd: 0x4d000, dest: 0x1000,
      template: Array.from({ length: 9 }, (_, i) => Array.from(dir.slice(i * 32, i * 32 + 32), (x) => x.toString(16).padStart(2, '0')).join('')),
      cfgTool: Array.from(cfg, (x) => x.toString(16).padStart(2, '0')).join(''),
    },
    installer: Uint8Array.from({ length: 0x1800 }, (_, i) => (i * 7) & 255),
    stage: Uint8Array.from({ length: 0x2100 }, (_, i) => (i * 13) & 255),
  };
  return { pad, files, link: new SincoLink(pad.input, pad.output) };
}

describe('install from stock (fake pad)', () => {
  it('writes the images and points sector 0 at the installer', async () => {
    const { pad, files, link } = setup();
    const log: string[] = [];
    expect(await installFromStock(link, files, false, (l) => log.push(l), () => undefined)).toBe(true);
    expect(Array.from(pad.flash.slice(0x41000, 0x41000 + files.installer.length))).toEqual(Array.from(files.installer));
    expect(Array.from(pad.flash.slice(0x43000, 0x43000 + files.stage.length))).toEqual(Array.from(files.stage));
    expect(appDirHead(pad.flash.slice(0, 4096))[1]).toBe(0x41000);
  });
  it('a dry run writes nothing', async () => {
    const { pad, files, link } = setup();
    const before = pad.flash.slice();
    expect(await installFromStock(link, files, true, () => undefined, () => undefined)).toBe(false);
    expect(pad.flash).toEqual(before);
  });
  it('another directory: refused before writing', async () => {
    const { pad, files, link } = setup();
    pad.flash[0x1000 + 5 * 32 + 6] ^= 1;                     // BTIF offset differs
    const before = pad.flash.slice();
    await expect(installFromStock(link, files, false, () => undefined, () => undefined)).rejects.toThrow(/Nothing was written/);
    expect(pad.flash).toEqual(before);
  });
  it('sector 0 does not read back: the original is put back', async () => {
    const { pad, files, link } = setup();
    const orig = pad.flash.slice(0, 4096);
    pad.breakSector0 = true;
    let n = 0;
    const realHandle = pad.handle.bind(pad);
    pad.handle = (sx: Uint8Array) => {                       // only the first sector-0 write is spoiled
      const p = parsePacket(sincoUnpack(sx))!;
      if (p.cmd === 0x22 && (p.body[1] | (p.body[2] << 8) | (p.body[3] << 16)) < 0x1000 && n++ >= 4) pad.breakSector0 = false;
      return realHandle(sx);
    };
    await expect(installFromStock(link, files, false, () => undefined, () => undefined)).rejects.toThrow(/restored the original/);
    expect(Array.from(pad.flash.slice(0, 4096))).toEqual(Array.from(orig));
  });
});
