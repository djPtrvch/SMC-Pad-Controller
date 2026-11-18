// DEVICE: connect the pads (Web MIDI) or virtual ones, each unit's side and MIDI OUT, firmware.
import { Device, DeviceError, midiLink, midiPorts, midiSupported, usbSupported } from '../device';
import { DfuDevice } from '../dfu';
import { PROFILES, Side, THRU_MODES } from '../protocol';
import { SimDevice } from '../sim';
import { Unit, app, attach, changed, detach, run, swapSides } from '../state';
import { field, h, pickFile, segmented } from './dom';
import { installSection } from './install';

const ui = {
  ports: [] as string[],
  scanned: false,
  dfuStep: 0 as 0 | 1 | 2,        // 1: the pad restarts into the bootloader, 2: writing
  progress: 0,
  fwInfo: '',
  image: null as Uint8Array | null,
};

const connectedNames = () => app.units.filter((u) => u.dev).map((u) => u.dev!.link.name);

async function scan() {
  ui.ports = (await midiPorts()).map((p) => p.name);
  ui.scanned = true;
}

async function connect(name: string) {
  const pair = (await midiPorts()).find((p) => p.name === name);
  if (!pair) throw new Error('the port is gone');
  const dev = new Device(midiLink(pair));
  try {
    await attach(dev, null);
  } catch (e) {
    dev.close();
    if (e instanceof DeviceError && e.message.startsWith('the pad has')) throw e;
    throw new Error(`${name} does not answer: it probably runs the stock firmware. Install the JamboPad firmware first (FIRST INSTALL below).`);
  }
}

async function bundledFirmware(): Promise<Uint8Array> {
  const r = await fetch('firmware/jambopad.bin', { cache: 'no-cache' });
  if (!r.ok) throw new Error('no firmware in this build of the page');
  return new Uint8Array(await r.arrayBuffer());
}

// requestDevice() first: Chrome allows it only right after the tap
async function flash(image: Uint8Array) {
  const dfu = await DfuDevice.request();
  ui.dfuStep = 2;
  ui.progress = 0;
  changed();
  try {
    await dfu.download(image, (f) => { ui.progress = f; changed(); });
  } finally {
    await dfu.close();
  }
  ui.dfuStep = 0;
  ui.fwInfo = 'Done: the pad restarts with the new firmware. Connect it again in a few seconds.';
}

async function toBootloader(u: Unit | null, image: Uint8Array) {
  ui.image = image;
  ui.fwInfo = '';
  if (u?.dev && !u.sim) {
    await u.dev.bootloader().catch(() => undefined);
    detach(u);
  }
  ui.dfuStep = 1;
}

function support(): HTMLElement | null {
  const missing = [!midiSupported() && 'Web MIDI', !usbSupported() && 'WebUSB'].filter(Boolean);
  if (!missing.length) return null;
  return h('p', { class: 'warn' }, `This browser has no ${missing.join(' and ')}. Use Chrome on Android (or on a computer). Safari and every browser on iPad cannot talk to the pads; the virtual pads work everywhere.`);
}

function unitCard(u: Unit): HTMLElement {
  const name = u.side === Side.LEFT ? 'LEFT UNIT' : 'RIGHT UNIT';
  if (!u.dev || !u.hello) {
    return h('section', { class: 'card' }, h('h2', {}, name), h('p', { class: 'hint' }, 'Not connected. Its profiles can still be edited and exported (PROFILES).'));
  }
  const hello = u.hello;
  return h('section', { class: 'card' },
    h('h2', {}, name),
    h('p', {}, `${u.dev.link.name} · firmware ${hello.fw} · profile ${hello.active + 1} active`),
    field('SIDE', segmented(['RIGHT', 'LEFT'], hello.side, (v) => run('side', async () => {
      if (v === hello.side) return;
      await u.dev!.setSide(v as Side);
      hello.side = v as Side;
      if (u.sim) u.sim.side = v as Side;
      swapSides(u);
      const moved = app.units[v as Side];
      if (confirm('Load the JAMbo layout for this side into all 4 profiles of this unit? (Its profiles are replaced.)')) {
        await moved.dev!.factoryReset();
        for (let i = 0; i < PROFILES; i++) moved.profiles[i] = await moved.dev!.getProfile(i);
        moved.hello!.active = 0;
        moved.editing = 0;
        moved.layer = moved.profiles[0].startLayer;
        moved.unsaved = false;
      }
    })), 'LEFT: turned by 180°, to the left of the other unit'),
    h('h3', {}, 'MIDI OUT (3.5 mm)'),
    field('FROM THE APP', segmented(THRU_MODES, hello.thru, (v) => run('midi out', async () => {
      await u.dev!.setMidiOut(v, hello.controlsOut);
      hello.thru = v;
    })), 'CLOCK: clock, start and stop from JAMbo (SYNC → MIDI CLOCK → SEND, CLOCK OUTPUT: ALL OUTPUTS); ALL: everything the app sends to this pad'),
    field('PAD MESSAGES', segmented(['OFF', 'ON'], hello.controlsOut, (v) => run('midi out', async () => {
      await u.dev!.setMidiOut(hello.thru, v);
      hello.controlsOut = v;
    })), 'the pads, buttons and knobs also play a synth on MIDI OUT'),
    h('div', { class: 'row' },
      h('button', { onclick: () => detach(u) }, 'DISCONNECT'),
      h('button', {
        disabled: !usbSupported() || !!u.sim,
        onclick: () => run('update', async () => toBootloader(u, await bundledFirmware())),
      }, 'UPDATE FIRMWARE'),
    ),
  );
}

export function devicePage(): HTMLElement {
  const used = new Set(connectedNames());
  const free = ui.ports.filter((n) => !used.has(n));
  const connection = h('section', { class: 'card' },
    h('h2', {}, 'CONNECT'),
    h('div', { class: 'row' },
      h('button', { disabled: !midiSupported(), onclick: () => run('scan', scan) }, 'FIND PADS'),
      h('button', {
        onclick: () => run('virtual', async () => {
          for (const side of [Side.LEFT, Side.RIGHT]) {
            if (app.units[side].dev) continue;
            const sim = new SimDevice(side);
            await attach(new Device(sim), sim);
          }
        }),
      }, 'VIRTUAL PADS'),
    ),
    h('p', { class: 'hint' }, 'Both pads at once: a USB-C hub with power between the phone and the pads.'),
    ui.scanned && !free.length ? h('p', { class: 'hint' }, 'No other MIDI devices. Plug a pad in and tap FIND PADS again.') : null,
    ...free.map((n) => h('button', { class: 'port', onclick: () => run('connect', () => connect(n)) }, n)),
  );

  const fw = h('section', { class: 'card' },
    h('h2', {}, 'FIRMWARE'),
    ui.dfuStep === 1
      ? h('div', {},
        h('p', {}, 'The pad restarts into its bootloader (the SHIFT light blinks). Tap CONNECT BOOTLOADER and pick “SMC-PAD bootloader”.'),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => run('flash', () => flash(ui.image!)) }, 'CONNECT BOOTLOADER'),
          h('button', { onclick: () => { ui.dfuStep = 0; changed(); } }, 'CANCEL')))
      : ui.dfuStep === 2
        ? h('div', {}, h('p', {}, `Writing… ${Math.round(ui.progress * 100)}% — do not unplug the pad.`), h('progress', { value: ui.progress, max: 1 }))
        : h('div', {},
          h('div', { class: 'row' },
            h('button', { disabled: !usbSupported(), onclick: () => run('update', async () => toBootloader(null, await bundledFirmware())) }, 'PAD IN BOOTLOADER: WRITE FIRMWARE'),
            h('button', {
              disabled: !usbSupported(),
              onclick: async () => {
                const f = await pickFile('.bin');
                if (f) run('update', async () => toBootloader(null, new Uint8Array(await f.arrayBuffer())));
              },
            }, 'FROM FILE…'),
          ),
          h('p', { class: 'hint' }, 'A connected pad: UPDATE FIRMWARE in its card. A pad that does not start: hold SHIFT + PLAY while switching it on (bootloader), then WRITE FIRMWARE.'),
          ui.fwInfo ? h('p', {}, ui.fwInfo) : null),
    installSection(() => run('update', async () => toBootloader(null, await bundledFirmware()))),
  );

  return h('div', { class: 'page' }, support(), connection, unitCard(app.units[Side.LEFT]), unitCard(app.units[Side.RIGHT]), fw);
}
