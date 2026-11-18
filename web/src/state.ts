// The configurator's state: two units (LEFT and RIGHT), each with its device (if connected) and profiles.
import { Device, DeviceEvent } from './device';
import { CTL_BUTTON0, CTL_KNOB0, Hello, PROFILES, Profile, Side, defaultProfile } from './protocol';
import { SimDevice } from './sim';

export type Tab = 'device' | 'layout' | 'sensitivity' | 'profiles';

export interface Unit {
  side: Side;
  dev: Device | null;
  sim: SimDevice | null;
  hello: Hello | null;
  profiles: Profile[];
  editing: number;        // the profile shown and edited
  layer: number;          // the pad layer shown in LAYOUT
  unsaved: boolean;       // sent to the device, not yet written to its flash
  identify: boolean;
}

const newUnit = (side: Side): Unit => ({
  side, dev: null, sim: null, hello: null, editing: 0, layer: 0, unsaved: false, identify: false,
  profiles: Array.from({ length: PROFILES }, () => defaultProfile(side)),
});

export const app = {
  units: [newUnit(Side.RIGHT), newUnit(Side.LEFT)] as Unit[],    // indexed by Side
  cur: Side.LEFT as Side,             // the unit SENSITIVITY and PROFILES show
  view: 0,                            // LAYOUT: 0 both, 1 LEFT, 2 RIGHT
  selected: null as { side: Side; ctl: number } | null,
  tab: 'device' as Tab,
  busy: '',
  error: '',
  flash: new Map<string, number>(),   // "side:ctl" -> time it was touched (IDENTIFY)
};

export const unit = (s: Side = app.cur) => app.units[s];
export const profileOf = (u: Unit) => u.profiles[u.editing];
export const anyUnsaved = () => app.units.some((u) => u.unsaved);
export const connectedUnits = () => app.units.filter((u) => u.dev);

type Listener = () => void;
const listeners = new Set<Listener>();
export const onChange = (l: Listener) => listeners.add(l);
export function changed() {
  listeners.forEach((l) => l());
}

export const deviceListeners = new Set<(u: Unit, e: DeviceEvent) => void>();

// edits reach the device after a short pause (one SET_PROFILE for a burst of changes)
const pushTimers = [0, 0];
export function profileEdited(u: Unit = unit()) {
  if (u.dev) u.unsaved = true;
  clearTimeout(pushTimers[u.side]);
  const i = u.editing;
  pushTimers[u.side] = window.setTimeout(() => {
    u.dev?.setProfile(i, u.profiles[i]).catch((e) => report(e));
  }, 250);
  changed();
}

export function report(e: unknown) {
  app.error = e instanceof Error ? e.message : String(e);
  app.busy = '';
  changed();
}

export async function run(label: string, fn: () => Promise<void>) {
  app.busy = label;
  app.error = '';
  changed();
  try {
    await fn();
    app.busy = '';
  } catch (e) {
    report(e);
    return;
  }
  changed();
}

const ctlBase = (kind: 'pad' | 'button' | 'knob', u: Unit) => (kind === 'pad' ? u.layer * 16 : kind === 'button' ? CTL_BUTTON0 : CTL_KNOB0);

// a connected device goes to the slot of its side; if that one is taken, to the other
export async function attach(dev: Device, sim: SimDevice | null) {
  const hello = await dev.hello();
  let side = hello.side;
  if (app.units[side].dev && !app.units[1 - side].dev) {
    side = (1 - side) as Side;
    app.error = `Both units are set to ${hello.side === Side.LEFT ? 'LEFT' : 'RIGHT'}: change the side of one of them (DEVICE).`;
  }
  const u = app.units[side];
  u.dev?.close();
  u.dev = dev;
  u.sim = sim;
  u.hello = hello;
  for (let i = 0; i < PROFILES; i++) u.profiles[i] = await dev.getProfile(i);
  u.editing = hello.active;
  u.layer = hello.layer;
  u.unsaved = false;
  u.identify = false;
  app.cur = side;
  dev.listeners.add((e) => {
    if (e.kind === 'identify') {
      const ctl = ctlBase(e.control, u) + e.index;
      app.flash.set(`${u.side}:${ctl}`, performance.now());
      if (e.value) app.selected = { side: u.side, ctl };
      changed();
    }
    if (e.kind === 'profile' && u.hello) {
      u.hello.active = e.index;
      changed();
    }
    if (e.kind === 'layer') {
      u.layer = e.index;
      changed();
    }
    if (e.kind === 'bluetooth' && u.hello) {
      u.hello.ble = e.on ? 1 : 0;
      changed();
    }
    deviceListeners.forEach((l) => l(u, e));
  });
}

export function detach(u: Unit) {
  u.dev?.close();
  u.dev = null;
  u.sim = null;
  u.hello = null;
  u.unsaved = false;
  changed();
}

// the device was switched to the other side: the slots trade places
export function swapSides(u: Unit) {
  const other = app.units[1 - u.side];
  const a = { ...u }, b = { ...other };
  Object.assign(app.units[u.side], b, { side: u.side });
  Object.assign(app.units[other.side], a, { side: other.side });
  app.cur = other.side;
}
