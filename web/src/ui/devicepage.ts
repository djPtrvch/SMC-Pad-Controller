// DEVICE: connect (Web MIDI or the virtual device), the unit's side, firmware update over USB.
import { Device, midiLink, midiPorts, midiSupported, usbSupported } from '../device';
import { DfuDevice } from '../dfu';
import { Side } from '../protocol';
import { SimDevice } from '../sim';
import { app, attach, changed, detach, run } from '../state';
import { h, pickFile, segmented } from './dom';

const ui = {
  ports: [] as string[],
  scanned: false,
  dfuStep: 0 as 0 | 1 | 2,        // 1: the pad restarts into the bootloader, 2: writing
  progress: 0,
  fwInfo: '',
  image: null as Uint8Array | null,
};

async function scan() {
  const ports = await midiPorts();
  ui.ports = ports.map((p) => p.name);
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
    app.dev = null;
    throw new Error(`${name} does not answer: it probably runs the stock firmware. Install the JamboPad firmware first.`);
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

async function toBootloader(image: Uint8Array) {
  ui.image = image;
  ui.fwInfo = '';
  if (app.dev && !app.sim) {
    await app.dev.bootloader().catch(() => undefined);
    detach();
  }
  ui.dfuStep = 1;
}

function support(): HTMLElement | null {
  const missing = [!midiSupported() && 'Web MIDI', !usbSupported() && 'WebUSB'].filter(Boolean);
  if (!missing.length) return null;
  return h('p', { class: 'warn' }, `This browser has no ${missing.join(' and ')}. Use Chrome on Android (or on a computer). Safari on iPad cannot talk to the pad; the virtual device works everywhere.`);
}

export function devicePage(): HTMLElement {
  const connected = h('section', { class: 'card' },
    h('h2', {}, 'CONNECTION'),
    app.dev
      ? h('div', {},
        h('p', {}, `${app.dev.link.name} · firmware ${app.hello?.fw} · profile ${(app.hello?.active ?? 0) + 1} active`),
        h('button', { onclick: () => detach() }, 'DISCONNECT'))
      : h('div', {},
        h('div', { class: 'row' },
          h('button', { disabled: !midiSupported(), onclick: () => run('scan', scan) }, 'FIND DEVICES'),
          h('button', { onclick: () => run('virtual', () => { const sim = new SimDevice(Side.RIGHT); return attach(new Device(sim), sim); }) }, 'VIRTUAL DEVICE'),
        ),
        ui.scanned && !ui.ports.length ? h('p', { class: 'hint' }, 'No MIDI devices. Plug the pad in with a USB-C cable and tap FIND DEVICES again.') : null,
        ...ui.ports.map((n) => h('button', { class: 'port', onclick: () => run('connect', () => connect(n)) }, n)),
      ),
  );

  const unit = app.dev && app.hello ? h('section', { class: 'card' },
    h('h2', {}, 'THIS UNIT'),
    h('p', { class: 'hint' }, 'LEFT: the unit turned by 180°, to the left of the other one (buttons on the outer edge). Pads, knobs and buttons are numbered as the unit sits.'),
    segmented(['RIGHT', 'LEFT'], app.hello.side, (v) => run('side', async () => {
      await app.dev!.setSide(v as Side);
      app.hello!.side = v as Side;
      if (app.sim) app.sim.side = v as Side;
      if (confirm('Load the JAMbo layout for this side into all 4 profiles? (Your profiles on this unit are replaced.)')) {
        await app.dev!.factoryReset();
        for (let i = 0; i < 4; i++) app.profiles[i] = await app.dev!.getProfile(i);
        app.hello!.active = 0;
        app.editing = 0;
        app.unsaved = false;
      }
    })),
  ) : null;

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
            h('button', {
              disabled: !usbSupported(),
              onclick: () => run('update', async () => toBootloader(await bundledFirmware())),
            }, 'UPDATE FIRMWARE'),
            h('button', {
              disabled: !usbSupported(),
              onclick: async () => {
                const f = await pickFile('.bin');
                if (f) run('update', async () => toBootloader(new Uint8Array(await f.arrayBuffer())));
              },
            }, 'FROM FILE…'),
          ),
          h('p', { class: 'hint' }, 'Needs the open-smc-pad bootloader on the pad. Without a connection: hold SHIFT + PLAY while switching the pad on, then UPDATE FIRMWARE.'),
          ui.fwInfo ? h('p', {}, ui.fwInfo) : null),
    h('h3', {}, 'FIRST INSTALL (STOCK FIRMWARE)'),
    h('p', { class: 'hint' }, 'Installing the bootloader over the stock firmware from this page is the next step of the project — not available yet.'),
  );

  return h('div', { class: 'page' }, support(), connected, unit, fw);
}

