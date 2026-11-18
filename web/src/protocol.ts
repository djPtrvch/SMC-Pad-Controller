// The JamboPad protocol and data, the same bytes as firmware/JamboPad/jp_config.cpp (docs/sysex.md).
// protocol.test.ts checks it against tests/vectors/vectors.json written by the firmware's host tests.

export const FORMAT_VERSION = 1;
export const PADS = 16, BUTTONS = 10, KNOBS = 8;
export const CONTROLS = PADS + BUTTONS + KNOBS;
export const PROFILES = 4;
export const NAME_LEN = 12;
export const PROFILE_BYTES = 322;

export const enum Side { RIGHT = 0, LEFT = 1 }
export const MSG_TYPES = ['OFF', 'NOTE', 'CC', 'PC'] as const;
export const BUTTON_MODES = ['MOMENTARY', 'TOGGLE'] as const;
export const KNOB_MODES = ['ABSOLUTE', 'REL OFFSET 64', "REL 2'S COMPL.", 'REL SIGNED BIT'] as const;
export const CURVES = ['LINEAR', 'SOFT', 'HARD', 'EXP', 'LOG', 'S-CURVE', 'FIXED', 'CUSTOM'] as const;
export const CURVE_FIXED = 6, CURVE_CUSTOM = 7;
export const AT_MODES = ['OFF', 'CHANNEL', 'POLY'] as const;
export const LED_MODES = ['LOCAL', 'HOST', 'BOTH'] as const;
export const BUTTON_NAMES = ['BLUETOOTH', 'PAD BANK', 'KNOB BANK', 'LEFT', 'RIGHT', 'PLAY', 'PAUSE', 'REC', 'SHIFT', 'NOTE REPEAT'];

export const PALETTE = [
  0x000000, 0xffffff, 0xff0000, 0xff4000, 0xff8000, 0xffc000, 0x80ff00, 0x00ff00,
  0x00ff80, 0x00ffff, 0x0080ff, 0x0000ff, 0x4000ff, 0x8000ff, 0xff00ff, 0xff0080,
];
export const PALETTE_NAMES = ['OFF', 'WHITE', 'RED', 'ORANGE-RED', 'ORANGE', 'YELLOW', 'LIME', 'GREEN', 'MINT', 'CYAN', 'SKY', 'BLUE', 'INDIGO', 'VIOLET', 'MAGENTA', 'PINK'];

export interface Control { type: number; channel: number; number: number; mode: number; a: number; b: number; c: number; d: number }
export interface Sensitivity {
  onThreshold: number; offThreshold: number; fullScale: number; attackMs: number;
  curve: number; velMin: number; velMax: number; fixedVelocity: number; custom: number[];
  atMode: number; atThreshold: number; atIntervalMs: number; padGain: number[];
}
export interface Profile { name: string; sens: Sensitivity; ctl: Control[]; ledMode: number }

export const ctlPad = (p: number) => p;
export const ctlButton = (b: number) => PADS + b;
export const ctlKnob = (k: number) => PADS + BUTTONS + k;
export const isKnob = (c: number) => c >= PADS + BUTTONS;
export const isButton = (c: number) => c >= PADS && c < PADS + BUTTONS;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ byte layout

export function serializeProfile(p: Profile): Uint8Array {
  const o = new Uint8Array(PROFILE_BYTES);
  let i = 0;
  const u16 = (v: number) => { o[i++] = v & 0xff; o[i++] = v >> 8; };
  o[i++] = FORMAT_VERSION;
  for (let k = 0; k < NAME_LEN; k++) o[i++] = k < p.name.length ? p.name.charCodeAt(k) & 0x7f : 0;
  const s = p.sens;
  u16(s.onThreshold); u16(s.offThreshold); u16(s.fullScale);
  o[i++] = s.attackMs; o[i++] = s.curve; o[i++] = s.velMin; o[i++] = s.velMax; o[i++] = s.fixedVelocity;
  for (let k = 0; k < 5; k++) o[i++] = s.custom[k];
  o[i++] = s.atMode; u16(s.atThreshold); o[i++] = s.atIntervalMs;
  for (let k = 0; k < PADS; k++) o[i++] = s.padGain[k];
  for (const x of p.ctl) { o[i++] = x.type; o[i++] = x.channel; o[i++] = x.number; o[i++] = x.mode; o[i++] = x.a; o[i++] = x.b; o[i++] = x.c; o[i++] = x.d; }
  o[i++] = p.ledMode;
  return o;
}

export function deserializeProfile(b: Uint8Array): Profile | null {
  if (b.length < PROFILE_BYTES || b[0] !== FORMAT_VERSION) return null;
  let i = 1;
  const u16 = () => { const v = b[i] | (b[i + 1] << 8); i += 2; return v; };
  let name = '';
  for (let k = 0; k < NAME_LEN; k++) { const c = b[i++] & 0x7f; if (c) name += String.fromCharCode(c); }
  name = name.replace(/\0.*$/, '');
  const sens: Sensitivity = {
    onThreshold: u16(), offThreshold: u16(), fullScale: u16(), attackMs: b[i++], curve: b[i++],
    velMin: b[i++], velMax: b[i++], fixedVelocity: b[i++], custom: Array.from(b.slice(i, (i += 5))),
    atMode: b[i++], atThreshold: u16(), atIntervalMs: b[i++], padGain: Array.from(b.slice(i, (i += PADS))),
  };
  const ctl: Control[] = [];
  for (let c = 0; c < CONTROLS; c++) {
    ctl.push({ type: b[i++], channel: b[i++], number: b[i++], mode: b[i++], a: b[i++], b: b[i++], c: b[i++], d: b[i++] });
  }
  const p: Profile = { name, sens, ctl, ledMode: b[i++] };
  sanitize(p);
  return p;
}

// the same ranges as jp::sanitize
export function sanitize(p: Profile): void {
  p.name = p.name.replace(/[^\x20-\x7e]/g, '_').slice(0, NAME_LEN);
  const s = p.sens;
  s.onThreshold = clamp(s.onThreshold, 20, 1000);
  s.offThreshold = clamp(s.offThreshold, 10, s.onThreshold - 5);
  s.fullScale = clamp(s.fullScale, s.onThreshold + 20, 1023);
  s.attackMs = clamp(s.attackMs, 1, 40);
  if (s.curve >= CURVES.length) s.curve = 0;
  s.velMin = clamp(s.velMin, 1, 127);
  s.velMax = clamp(s.velMax, s.velMin, 127);
  s.fixedVelocity = clamp(s.fixedVelocity, 1, 127);
  s.custom = s.custom.map((v) => clamp(v, 0, 127));
  if (s.atMode > 2) s.atMode = 0;
  s.atThreshold = clamp(s.atThreshold, s.onThreshold, s.fullScale - 10);
  s.atIntervalMs = clamp(s.atIntervalMs, 2, 100);
  s.padGain = s.padGain.map((v) => clamp(v, 50, 200));
  p.ctl.forEach((x, c) => {
    if (x.type > 3) x.type = 0;
    x.channel &= 15; x.number &= 127;
    if (isKnob(c)) {
      if (x.type === 1 || x.type === 3) x.type = 2;
      if (x.mode > 3) x.mode = 0;
      x.a &= 127; x.b &= 127; x.c = clamp(x.c, 1, 16); x.d = 0;
    } else {
      if (x.mode > 1) x.mode = 0;
      x.a &= 15; x.b &= 15; x.c &= 15; x.d = 0;
    }
  });
  if (p.ledMode > 2) p.ledMode = 2;
}

// ------------------------------------------------------------------ 8-to-7 packing

export const packedSize = (n: number) => n + Math.ceil(n / 7);

export function pack7(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i += 7) {
    const len = Math.min(7, b.length - i);
    let hi = 0;
    for (let k = 0; k < len; k++) hi |= (b[i + k] >> 7) << k;
    out.push(hi);
    for (let k = 0; k < len; k++) out.push(b[i + k] & 0x7f);
  }
  return Uint8Array.from(out);
}

export function unpack7(b: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i += 8) {
    const len = Math.min(8, b.length - i);
    if (len < 2) break;
    const hi = b[i];
    for (let k = 1; k < len; k++) out.push((b[i + k] & 0x7f) | (((hi >> (k - 1)) & 1) << 7));
  }
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------ geometry (jp_config.cpp)

export function padPosition(side: Side, pad: number): [number, number] {
  let row = 3 - Math.floor(pad / 4), col = pad % 4;
  if (side === Side.LEFT) { row = 3 - row; col = 3 - col; }
  return [row, col];
}
export function padAt(side: Side, row: number, col: number): number {
  if (side === Side.LEFT) { row = 3 - row; col = 3 - col; }
  return (3 - row) * 4 + col;
}
export function knobPosition(side: Side, knob: number): [number, number] {
  let row = 3 - Math.floor(knob / 2), col = knob % 2;
  if (side === Side.LEFT) { row = 3 - row; col = 1 - col; }
  return [row, col];
}
export function knobAt(side: Side, row: number, col: number): number {
  if (side === Side.LEFT) { row = 3 - row; col = 1 - col; }
  return (3 - row) * 2 + col;
}
export const buttonSlot = (side: Side, b: number) => (side === Side.LEFT ? BUTTONS - 1 - b : b);
export const buttonAt = (side: Side, slot: number) => (side === Side.LEFT ? BUTTONS - 1 - slot : slot);

// ------------------------------------------------------------------ defaults (jp::defaultProfile)

export function defaultProfile(side: Side): Profile {
  const sens: Sensitivity = {
    onThreshold: 150, offThreshold: 80, fullScale: 960, attackMs: 9, curve: 0, velMin: 1, velMax: 127,
    fixedVelocity: 100, custom: [0, 32, 64, 96, 127], atMode: 0, atThreshold: 300, atIntervalMs: 10,
    padGain: new Array(PADS).fill(100),
  };
  const ch = side === Side.LEFT ? 1 : 2;
  const ctl: Control[] = [];
  for (let pad = 0; pad < PADS; pad++) {
    const [row, col] = padPosition(side, pad);
    ctl.push({ type: 1, channel: ch, number: 36 + (3 - row) * 4 + col, mode: 0, a: 0, b: 1, c: 5, d: 0 });
  }
  for (let b = 0; b < BUTTONS; b++) ctl.push({ type: 1, channel: ch, number: buttonSlot(side, b), mode: 0, a: 0, b: 0, c: 0, d: 0 });
  for (let k = 0; k < KNOBS; k++) {
    const [row, col] = knobPosition(side, k);
    const gridCol = (side === Side.LEFT ? 0 : 2) + col;
    ctl.push({ type: 2, channel: 0, number: row * 4 + gridCol, mode: 0, a: 0, b: 127, c: 1, d: 0 });
  }
  return { name: side === Side.LEFT ? 'JAMbo L' : 'JAMbo R', sens, ctl, ledMode: 2 };
}

export const cloneProfile = (p: Profile): Profile => deserializeProfile(serializeProfile(p))!;

// ------------------------------------------------------------------ velocity (jp::buildVelocityLut)

function curveValue(s: Sensitivity, u: number): number {
  switch (s.curve) {
    case 1: return Math.sqrt(u);
    case 2: return u * u;
    case 3: return (Math.exp(3 * u) - 1) / (Math.exp(3) - 1);
    case 4: return Math.log(1 + 9 * u) / Math.log(10);
    case 5: return u * u * (3 - 2 * u);
    case 7: {
      const x = u * 4, k = Math.floor(x);
      if (k >= 4) return s.custom[4] / 127;
      const f = x - k;
      return (s.custom[k] + (s.custom[k + 1] - s.custom[k]) * f) / 127;
    }
    default: return u;
  }
}

export function velocityLut(s: Sensitivity): number[] {
  const lut = [0];
  for (let x = 1; x < 128; x++) {
    let v: number;
    if (s.curve === CURVE_FIXED) v = s.fixedVelocity;
    else v = Math.floor(s.velMin + curveValue(s, (x - 1) / 126) * (s.velMax - s.velMin) + 0.5);
    lut.push(clamp(v, 1, 127));
  }
  return lut;
}

export function linearVelocity(s: Sensitivity, pad: number, peak: number): number {
  const p = Math.trunc((peak * s.padGain[pad]) / 100);
  return clamp(Math.trunc(((p - s.onThreshold) * 127) / (s.fullScale - s.onThreshold)), 1, 127);
}

export function paletteRgb(index: number, level: number): number {
  const c = PALETTE[index & 15];
  level = Math.min(127, level);
  const r = Math.trunc((((c >> 16) & 255) * level) / 127), g = Math.trunc((((c >> 8) & 255) * level) / 127), b = Math.trunc(((c & 255) * level) / 127);
  return (r << 16) | (g << 8) | b;
}

export const cssColor = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ SysEx

export const SYSEX_ID = [0xf0, 0x7d, 0x4a, 0x50];
export const CMD = {
  HELLO: 0x01, GET_PROFILE: 0x02, SET_PROFILE: 0x03, SAVE: 0x04, SELECT: 0x05, SET_SIDE: 0x06,
  MONITOR: 0x07, SET_RGB: 0x08, BOOTLOADER: 0x09, FACTORY_RESET: 0x0a, IDENTIFY: 0x0b,
} as const;
export const REPLY = 0x40;
export const EV = { PRESSURE: 0x60, HIT: 0x61, IDENTIFY: 0x62, PROFILE: 0x63 } as const;

export const sysex = (cmd: number, data: ArrayLike<number> = []) => Uint8Array.from([...SYSEX_ID, cmd, ...Array.from(data), 0xf7]);

export function parseSysex(m: Uint8Array): { cmd: number; data: Uint8Array } | null {
  if (m.length < 6 || m[0] !== 0xf0 || m[m.length - 1] !== 0xf7) return null;
  for (let i = 1; i < 4; i++) if (m[i] !== SYSEX_ID[i]) return null;
  return { cmd: m[4], data: m.slice(5, m.length - 1) };
}

export interface Hello { fw: string; format: number; side: Side; active: number; profiles: number }
