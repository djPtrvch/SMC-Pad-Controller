// The configurator's state: the connected device and the profiles being edited.
import { Device, DeviceEvent } from './device';
import { Hello, PROFILES, Profile, Side, defaultProfile } from './protocol';
import { SimDevice } from './sim';

export type Tab = 'device' | 'layout' | 'sensitivity' | 'profiles';

export const app = {
  dev: null as Device | null,
  sim: null as SimDevice | null,
  hello: null as Hello | null,
  profiles: Array.from({ length: PROFILES }, () => defaultProfile(Side.RIGHT)) as Profile[],
  editing: 0,                     // the profile shown and edited
  selected: 26 as number | null,  // control index
  tab: 'device' as Tab,
  unsaved: false,                 // sent to the device, not yet written to its flash
  busy: '',
  error: '',
  identify: false,
  flash: new Map<number, number>(),   // control -> time it was touched (IDENTIFY)
};

export const side = (): Side => app.hello?.side ?? Side.RIGHT;
export const editingProfile = () => app.profiles[app.editing];

type Listener = () => void;
const listeners = new Set<Listener>();
export const onChange = (l: Listener) => listeners.add(l);
export function changed() {
  listeners.forEach((l) => l());
}

export const deviceListeners = new Set<(e: DeviceEvent) => void>();

// edits reach the device after a short pause (one SET_PROFILE for a burst of changes)
let pushTimer = 0;
export function profileEdited() {
  app.unsaved = true;
  clearTimeout(pushTimer);
  const i = app.editing;
  pushTimer = window.setTimeout(() => {
    app.dev?.setProfile(i, app.profiles[i]).catch((e) => report(e));
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

export async function attach(dev: Device, sim: SimDevice | null) {
  app.dev?.close();
  app.dev = dev;
  app.sim = sim;
  dev.listeners.add((e) => {
    if (e.kind === 'identify') {
      const base = e.control === 'pad' ? 0 : e.control === 'button' ? 16 : 26;
      app.flash.set(base + e.index, performance.now());
      if (e.value) app.selected = base + e.index;
      changed();
    }
    if (e.kind === 'profile' && app.hello) {
      app.hello.active = e.index;
      changed();
    }
    deviceListeners.forEach((l) => l(e));
  });
  app.hello = await dev.hello();
  for (let i = 0; i < PROFILES; i++) app.profiles[i] = await dev.getProfile(i);
  app.editing = app.hello.active;
  app.unsaved = false;
  app.identify = false;
}

export function detach() {
  app.dev?.close();
  app.dev = null;
  app.sim = null;
  app.hello = null;
  app.unsaved = false;
  changed();
}
