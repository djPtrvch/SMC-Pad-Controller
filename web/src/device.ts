// Talking to a JamboPad: over Web MIDI (Chrome on Android or a computer) or to the virtual device.
import {
  CMD, EV, FORMAT_VERSION, Hello, PROFILE_BYTES, Profile, REPLY, Side, deserializeProfile, pack7, packedSize, parseSysex, serializeProfile, sysex, unpack7,
} from './protocol';

export interface Link {
  name: string;
  send(bytes: Uint8Array): void;
  onMessage: ((bytes: Uint8Array) => void) | null;
  close(): void;
}

export type DeviceEvent =
  | { kind: 'pressure'; raw: number[] }
  | { kind: 'hit'; pad: number; peak: number; linear: number; velocity: number }
  | { kind: 'identify'; control: 'pad' | 'button' | 'knob'; index: number; value: number }
  | { kind: 'profile'; index: number }
  | { kind: 'layer'; index: number }
  | { kind: 'bluetooth'; on: boolean }
  | { kind: 'midi'; bytes: Uint8Array };

export class DeviceError extends Error {}

const STATUS = ['OK', 'bad arguments', 'storage error'];

export class Device {
  private waiting = new Map<number, { resolve: (d: Uint8Array) => void; reject: (e: Error) => void; timer: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  listeners = new Set<(e: DeviceEvent) => void>();

  constructor(readonly link: Link) {
    link.onMessage = (b) => this.receive(b);
  }

  private receive(b: Uint8Array) {
    const m = parseSysex(b);
    if (!m) {
      this.emit({ kind: 'midi', bytes: b });
      return;
    }
    const d = m.data;
    switch (m.cmd) {
      case EV.PRESSURE: {
        const raw: number[] = [];
        for (let i = 0; i + 1 < d.length; i += 2) raw.push(d[i] | (d[i + 1] << 7));
        this.emit({ kind: 'pressure', raw });
        return;
      }
      case EV.HIT:
        this.emit({ kind: 'hit', pad: d[0], peak: d[1] | (d[2] << 7), linear: d[3], velocity: d[4] });
        return;
      case EV.IDENTIFY:
        this.emit({ kind: 'identify', control: (['pad', 'button', 'knob'] as const)[d[0]] ?? 'pad', index: d[1], value: d[2] });
        return;
      case EV.PROFILE:
        this.emit({ kind: 'profile', index: d[0] });
        return;
      case EV.LAYER:
        this.emit({ kind: 'layer', index: d[0] });
        return;
      case EV.BLUETOOTH:
        this.emit({ kind: 'bluetooth', on: d[0] !== 0 });
        return;
    }
    if (m.cmd & REPLY) {
      const w = this.waiting.get(m.cmd & ~REPLY);
      if (!w) return;
      this.waiting.delete(m.cmd & ~REPLY);
      clearTimeout(w.timer);
      if (d[0] !== 0) w.reject(new DeviceError(`device: ${STATUS[d[0]] ?? 'error ' + d[0]}`));
      else w.resolve(d.slice(1));
    }
  }

  private emit(e: DeviceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  // one request at a time: replies are matched by command
  request(cmd: number, data: ArrayLike<number> = [], timeoutMs = 1500): Promise<Uint8Array> {
    const run = () =>
      new Promise<Uint8Array>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          this.waiting.delete(cmd);
          reject(new DeviceError('no answer from the device'));
        }, timeoutMs);
        this.waiting.set(cmd, { resolve, reject, timer });
        this.link.send(sysex(cmd, data));
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async hello(): Promise<Hello> {
    const d = await this.request(CMD.HELLO, [], 800);
    if (d[3] !== FORMAT_VERSION) throw new DeviceError(`the pad has firmware ${d[0]}.${d[1]}.${d[2]} (format ${d[3]}): update it (DEVICE → FIRMWARE)`);
    return { fw: `${d[0]}.${d[1]}.${d[2]}`, format: d[3], side: d[4] as Side, active: d[5], profiles: d[6], thru: d[7], controlsOut: d[8], layer: d[9], ble: d[10] ?? 0 };
  }

  async getProfile(i: number): Promise<Profile> {
    const d = await this.request(CMD.GET_PROFILE, [i]);
    const p = deserializeProfile(unpack7(d.slice(1)));
    if (!p) throw new DeviceError('unknown profile format');
    return p;
  }

  async setProfile(i: number, p: Profile): Promise<void> {
    const packed = pack7(serializeProfile(p));
    if (packed.length !== packedSize(PROFILE_BYTES)) throw new Error('profile size');
    await this.request(CMD.SET_PROFILE, [i, ...packed]);
  }

  save = () => this.request(CMD.SAVE, [], 3000).then(() => undefined);
  select = (i: number) => this.request(CMD.SELECT, [i]).then(() => undefined);
  setSide = (s: Side) => this.request(CMD.SET_SIDE, [s]).then(() => undefined);
  monitor = (on: boolean) => this.request(CMD.MONITOR, [on ? 1 : 0]).then(() => undefined);
  identify = (on: boolean) => this.request(CMD.IDENTIFY, [on ? 1 : 0]).then(() => undefined);
  factoryReset = () => this.request(CMD.FACTORY_RESET, [], 4000).then(() => undefined);
  bootloader = () => this.request(CMD.BOOTLOADER, [], 1500).then(() => undefined);
  setMidiOut = (thru: number, controlsOut: number) => this.request(CMD.SET_MIDI_OUT, [thru, controlsOut]).then(() => undefined);
  setBluetooth = (on: boolean) => this.request(CMD.SET_BLUETOOTH, [on ? 1 : 0]).then(() => undefined);
  setLayer = (l: number) => this.request(CMD.SET_LAYER, [l]).then(() => undefined);
  setScale(root: number, mask: number, octave: number) {
    this.link.send(sysex(CMD.SET_SCALE, [root, mask & 127, (mask >> 7) & 31, octave]));
  }
  setRgb(pad: number, rgb: number) {
    this.link.send(sysex(CMD.SET_RGB, [pad, (rgb >> 17) & 127, (rgb >> 9) & 127, (rgb >> 1) & 127]));
  }

  close() {
    this.link.close();
  }
}

// ------------------------------------------------------------------ Web MIDI

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
export const usbSupported = () => typeof navigator !== 'undefined' && 'usb' in navigator;

let access: MIDIAccess | null = null;

export async function midiAccess(): Promise<MIDIAccess> {
  if (!access) access = await navigator.requestMIDIAccess({ sysex: true });
  return access;
}

export interface PortPair { name: string; input: MIDIInput; output: MIDIOutput }

// inputs and outputs paired by name (an SMC-PAD shows up as one of each)
export async function midiPorts(): Promise<PortPair[]> {
  const a = await midiAccess();
  const outs = Array.from(a.outputs.values());
  const pairs: PortPair[] = [];
  const used = new Set<MIDIOutput>();
  a.inputs.forEach((input) => {
    const output = outs.find((o) => !used.has(o) && o.name === input.name) ?? outs.find((o) => !used.has(o) && o.manufacturer === input.manufacturer);
    if (output) {
      used.add(output);
      pairs.push({ name: input.name ?? 'MIDI device', input, output });
    }
  });
  return pairs;
}

export function midiLink(pair: PortPair): Link {
  const link: Link = {
    name: pair.name,
    onMessage: null,
    send: (b) => pair.output.send(b),
    close: () => {
      pair.input.onmidimessage = null;
    },
  };
  pair.input.onmidimessage = (e: MIDIMessageEvent) => {
    if (e.data && link.onMessage) link.onMessage(new Uint8Array(e.data));
  };
  return link;
}

// ------------------------------------------------------------------ Bluetooth (Web Bluetooth)
// The pad's settings service carries the same SysEx as USB, in 20-byte pieces (firmware: JamboPad.ino).

export const BLE_SERVICE = '4a50c0f1-0b1e-4d1a-9a7d-7d4a50000001';
export const BLE_CHAR = '4a50c0f1-0b1e-4d1a-9a7d-7d4a50000002';
export const bluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export async function bluetoothLink(): Promise<Link> {
  const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'JAMboPAD' }], optionalServices: [BLE_SERVICE] });
  const server = await dev.gatt!.connect();
  const ch = await (await server.getPrimaryService(BLE_SERVICE)).getCharacteristic(BLE_CHAR);
  let buf: number[] = [];
  const link: Link = {
    name: dev.name ?? 'JAMboPAD (Bluetooth)',
    onMessage: null,
    send: (b) => {
      // one write at a time, in order
      for (let i = 0; i < b.length; i += 20) {
        const piece = b.slice(i, i + 20);
        queue = queue.then(() => ch.writeValueWithoutResponse(piece)).catch(() => undefined);
      }
    },
    close: () => { try { dev.gatt?.disconnect(); } catch { /* gone */ } },
  };
  let queue: Promise<unknown> = Promise.resolve();
  ch.addEventListener('characteristicvaluechanged', () => {
    const v = ch.value!;
    for (let i = 0; i < v.byteLength; i++) {
      const x = v.getUint8(i);
      if (x === 0xf0) buf = [];
      buf.push(x);
      if (x === 0xf7) {
        if (buf[0] === 0xf0) link.onMessage?.(Uint8Array.from(buf));
        buf = [];
      }
    }
  });
  await ch.startNotifications();
  return link;
}
