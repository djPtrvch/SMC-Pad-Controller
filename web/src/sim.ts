// A virtual JamboPad: answers the same SysEx as the firmware, so the configurator can be tried
// without a device. Taps on the drawing play hits on it.
import { Link } from './device';
import {
  CMD, EV, FORMAT_VERSION, PROFILES, PROFILE_BYTES, Profile, REPLY, Side, defaultProfile, deserializeProfile, linearVelocity,
  pack7, packedSize, parseSysex, serializeProfile, sysex, unpack7, velocityLut,
} from './protocol';

export class SimDevice implements Link {
  name = 'VIRTUAL SMC-PAD';
  onMessage: ((bytes: Uint8Array) => void) | null = null;
  side: Side;
  active = 0;
  profiles: Profile[];
  private monitorOn = false;
  private identifyOn = false;
  private pressure = new Array(16).fill(0);
  private timer = 0;

  constructor(side: Side = Side.RIGHT) {
    this.side = side;
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

  send(bytes: Uint8Array) {
    const m = parseSysex(bytes);
    if (!m) return;
    const d = m.data;
    const ok = (extra: number[] = []) => this.out(m.cmd | REPLY, [0, ...extra]);
    const bad = () => this.out(m.cmd | REPLY, [1]);
    switch (m.cmd) {
      case CMD.HELLO: ok([0, 1, 0, FORMAT_VERSION, this.side, this.active, PROFILES]); break;
      case CMD.GET_PROFILE:
        if (d[0] >= PROFILES) return bad();
        ok([d[0], ...pack7(serializeProfile(this.profiles[d[0]]))]);
        break;
      case CMD.SET_PROFILE: {
        if (d[0] >= PROFILES || d.length - 1 !== packedSize(PROFILE_BYTES)) return bad();
        const p = deserializeProfile(unpack7(d.slice(1)));
        if (!p) return bad();
        this.profiles[d[0]] = p;
        ok([d[0]]);
        break;
      }
      case CMD.SAVE: ok(); break;
      case CMD.SELECT:
        if (d[0] >= PROFILES) return bad();
        this.active = d[0];
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
    const x = p.ctl[pad];
    if (x.type === 1) {
      setTimeout(() => this.onMessage?.(Uint8Array.from([0x90 | x.channel, x.number, vel])), 6);
      setTimeout(() => this.onMessage?.(Uint8Array.from([0x80 | x.channel, x.number, 0])), 200);
    }
  }

  button(b: number) {
    if (this.identifyOn) this.out(EV.IDENTIFY, [1, b, 127]);
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
