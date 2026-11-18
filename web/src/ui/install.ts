// FIRST INSTALL: the open-smc-pad bootloader over the stock firmware, then the JamboPad firmware over DFU.
import { midiAccess, midiSupported } from '../device';
import { InstallFiles, SincoLink, installFromStock } from '../sinco';
import { changed, run } from '../state';
import { h } from './dom';

const st = {
  log: [] as string[],
  progress: 0,
  step: 0 as 0 | 1 | 2,           // 1: written, power-cycle the pad; 2: done
  ports: [] as string[],
};

async function loadFiles(): Promise<InstallFiles> {
  const get = async (name: string) => {
    const r = await fetch(`install/${name}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('the installer images are not in this build of the page');
    return r;
  };
  const manifest = await (await get('install.json')).json();
  const installer = new Uint8Array(await (await get('installer.bin')).arrayBuffer());
  const stage = new Uint8Array(await (await get('stage.bin')).arrayBuffer());
  if (installer.length !== manifest.installerBytes || stage.length !== manifest.stageBytes) throw new Error('the installer images are damaged');
  return { manifest, installer, stage };
}

// the stock firmware's service port is named "… SMC-PAD-Private"
async function openStock(): Promise<SincoLink> {
  const a = await midiAccess();
  const ins = Array.from(a.inputs.values()), outs = Array.from(a.outputs.values());
  st.ports = ins.map((p) => p.name ?? '?');
  const input = ins.find((p) => /private/i.test(p.name ?? ''));
  const output = outs.find((p) => /private/i.test(p.name ?? ''));
  if (!input || !output) throw new Error('no “SMC-PAD-Private” MIDI port: is the pad with the stock firmware plugged in?');
  return new SincoLink(input, output);
}

async function go(dryRun: boolean) {
  st.log = [];
  st.progress = 0;
  const say = (l: string) => { st.log.push(l); changed(); };
  const files = await loadFiles();
  const link = await openStock();
  try {
    const written = await installFromStock(link, files, dryRun, say, (f) => { st.progress = f; changed(); });
    if (written) {
      st.step = 1;
      say('Now switch the pad OFF and ON again. The installer replaces the stock firmware (a few seconds), then the SHIFT light blinks: the bootloader is waiting.');
    }
  } finally {
    link.close();
  }
}

export function installSection(writeFirmware: () => void): HTMLElement {
  const busy = st.progress > 0 && st.progress < 1;
  return h('div', {},
    h('h3', {}, 'FIRST INSTALL (STOCK FIRMWARE)'),
    h('p', { class: 'hint' }, 'Once per pad. Replaces the stock firmware with the open-smc-pad bootloader, then writes JamboPad. Pad charged or on USB power, do not unplug it while writing. CHECK reads the pad and writes nothing.'),
    st.step === 1
      ? h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { st.step = 2; writeFirmware(); } }, 'PAD RESTARTED: WRITE FIRMWARE'))
      : h('div', { class: 'row' },
        h('button', { disabled: !midiSupported() || busy, onclick: () => run('check', () => go(true)) }, 'CHECK'),
        h('button', {
          disabled: !midiSupported() || busy,
          onclick: () => {
            if (!confirm('Install the bootloader over the stock firmware? Going back to the stock firmware later needs extra hardware (a Raspberry Pi Pico).')) return;
            run('install', () => go(false));
          },
        }, 'INSTALL')),
    busy ? h('progress', { value: st.progress, max: 1 }) : null,
    st.log.length ? h('pre', { class: 'log' }, st.log.join('\n')) : null,
    st.ports.length && !st.log.length ? h('p', { class: 'hint' }, `MIDI ports: ${st.ports.join(', ')}`) : null,
  );
}
