// A virtual JamboPad: answers the same SysEx as the firmware, so the configurator can be tried
// without a device. HIT and TURN on the LAYOUT page play on it.
import { Link } from './device';
import {
  CMD, CTL_BUTTON0, EV, FORMAT_VERSION, LAYERS, LAYER_KEYS, LAYER_OFF, MSG_ACTION, PROFILES, PROFILE_BYTES, Profile, REPLY, SCALES,
  Side, defaultProfile, deserializeProfile, keysNote, linearVelocity, pack7, packedSize, padPosition, parseSysex, serializeProfile,
  sysex, unpack7, velocityLut,
} from './protocol';

export class SimDevice implements Link {
  name: string;
  onMessage: ((bytes: Uint8Array) => void) | null = null;
  side: Side;
  active = 0;
  layer = 0;
  thru = 1;
  controlsOut = 0;
  ble = 1;
  profiles: Profile[];
  host: { root: number; mask: number; octave: number } | null = null;
  private monitorOn = false;
  private identifyOn = false;
  private pressure = new Array(16).fill(0);
  private timer = 0;

  constructor(side: Side) {
    this.side = side;
    this.name = `VIRTUAL ${side === Side.LEFT ? 'LEFT' : 'RIGHT'}`;
    this.profiles = Array.from({ length: PROFILES }, () => defaultProfile(side));
    this.timer = window.setInterval(() => this.tick(), 33);
  }

  close() {
    clearInterval(this.timer);
  }

  private out(cmd: number, data: ArrayLike<number>) {
    const m = sysex(cmd, data);
    setTimeout(() => this.onMessage?.(m), 5);
  }

  private midi(bytes: number[], delay: number) {
    setTimeout(() => this.onMessage?.(Uint8Array.from(bytes)), delay);
  }

  send(bytes: Uint8Array) {
    const m = parseSysex(bytes);
    if (!m) return;
    const d = m.data;
    const ok = (extra: number[] = []) => this.out(m.cmd | REPLY, [0, ...extra]);
    const bad = () => this.out(m.cmd | REPLY, [1]);
    switch (m.cmd) {
      case CMD.HELLO: ok([0, 5, 0, FORMAT_VERSION, this.side, this.active, PROFILES, this.thru, this.controlsOut, this.layer, this.ble]); break;
      case CMD.GET_PROFILE:
        if (d[0] >= PROFILES) return bad();
        ok([d[0], ...pack7(serializeProfile(this.profiles[d[0]]))]);
        break;
      case CMD.SET_PROFILE: {
        if (d[0] >= PROFILES || d.length - 1 !== packedSize(PROFILE_BYTES)) return bad();
        const p = deserializeProfile(unpack7(d.slice(1)));
        if (!p) return bad();
        this.profiles[d[0]] = p;
        if (p.layer[this.layer].type === LAYER_OFF) this.layer = 0;
        ok([d[0]]);
        break;
      }
      case CMD.SAVE: ok(); break;
      case CMD.SELECT:
        if (d[0] >= PROFILES) return bad();
        this.active = d[0];
        this.layer = this.profiles[d[0]].startLayer;
        ok([d[0]]);
        break;
      case CMD.SET_SIDE: this.side = d[0] as Side; ok([d[0]]); break;
      case CMD.MONITOR: this.monitorOn = d[0] !== 0; ok(); break;
      case CMD.IDENTIFY: this.identifyOn = d[0] !== 0; ok(); break;
      case CMD.FACTORY_RESET:
        this.profiles = Array.from({ length: PROFILES }, () => defaultProfile(this.side));
        this.active = 0;
        ok();
        break;
      case CMD.BOOTLOADER: ok(); break;
      case CMD.SET_SCALE: this.host = { root: d[0] % 12, mask: d[1] | (d[2] << 7), octave: d[3] }; break;
      case CMD.SET_MIDI_OUT: this.thru = d[0]; this.controlsOut = d[1]; ok(); break;
      case CMD.SET_BLUETOOTH: this.ble = d[0] ? 1 : 0; ok(); break;
      case CMD.SET_LAYER:
        if (d[0] >= LAYERS || this.profiles[this.active].layer[d[0]].type === LAYER_OFF) return bad();
        this.layer = d[0];
        ok();
        break;
    }
  }

  // a hit of strength 0..1 on a physical pad
  hit(pad: number, strength: number) {
    const peak = Math.round(160 + strength * 860);
    this.pressure[pad] = peak;
    if (this.identifyOn) {
      this.out(EV.IDENTIFY, [0, pad, 100]);
      return;
    }
    const p = this.profiles[this.active];
    const lin = linearVelocity(p.sens, pad, peak);
    const vel = velocityLut(p.sens)[lin];
    if (this.monitorOn) this.out(EV.HIT, [pad, peak & 127, peak >> 7, lin, vel]);
    const l = p.layer[this.layer];
    if (l.type === LAYER_KEYS) {
      const k = p.keys.followHost && this.host ? this.host : { root: p.keys.root, mask: SCALES[p.keys.scale].mask, octave: p.keys.octave };
      const [row, col] = padPosition(this.side, pad);
      const { note } = keysNote(l, k.root, k.mask, k.octave, row, col);
      if (note >= 0) { this.midi([0x90 | l.channel, note, vel], 6); this.midi([0x80 | l.channel, note, 0], 200); }
      return;
    }
    const x = p.ctl[this.layer * 16 + pad];
    if (x.type === 1) { this.midi([0x90 | x.channel, x.number, vel], 6); this.midi([0x80 | x.channel, x.number, 0], 200); }
  }

  button(b: number) {
    if (this.identifyOn) { this.out(EV.IDENTIFY, [1, b, 127]); return; }
    const x = this.profiles[this.active].ctl[CTL_BUTTON0 + b];
    if (x.type === MSG_ACTION && x.number === 0 && this.profiles[this.active].layer[x.a].type !== LAYER_OFF) {
      this.layer = x.a;
      this.out(EV.LAYER, [x.a]);
    }
  }

  knob(k: number, delta: number) {
    if (this.identifyOn) this.out(EV.IDENTIFY, [2, k, 64 + delta]);
  }

  private tick() {
    let any = false;
    for (let i = 0; i < 16; i++) {
      if (this.pressure[i] > 0) {
        this.pressure[i] = Math.max(0, Math.round(this.pressure[i] * 0.8 - 10));
        any = true;
      }
    }
    if (this.monitorOn && any) this.out(EV.PRESSURE, this.pressure.flatMap((v) => [v & 127, v >> 7]));
  }
}
