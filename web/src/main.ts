// JamboPad configurator: tabs, header with SAVE, status line.
import { Tab, anyUnsaved, app, changed, onChange, run } from './state';
import { fitText, h } from './ui/dom';
import { devicePage } from './ui/devicepage';
import { layoutPage } from './ui/layout';
import { profilesPage } from './ui/profiles';
import { enterSensitivity, sensitivityPage } from './ui/sensitivity';

const TABS: [Tab, string][] = [['device', 'DEVICE'], ['layout', 'LAYOUT'], ['sensitivity', 'SENSITIVITY'], ['profiles', 'PROFILES']];
const root = document.getElementById('app')!;

function setTab(t: Tab) {
  if (app.tab === 'sensitivity' && t !== 'sensitivity') enterSensitivity(false);
  if (t === 'sensitivity' && app.tab !== 'sensitivity') enterSensitivity(true);
  app.tab = t;
  changed();
}

function header(): HTMLElement {
  const status = app.units.slice().reverse().map((u) => `${u.side ? 'L' : 'R'}: ${u.dev ? `P${u.editing + 1} “${u.profiles[u.editing].name}”` : 'offline'}`).join(' · ');
  const unsaved = anyUnsaved();
  return h('header', {},
    h('div', { class: 'brand' }, 'JAMboPAD'),
    h('div', { class: 'status' }, status),
    app.units.some((u) => u.dev) ? h('button', {
      class: unsaved ? 'primary' : '',
      disabled: !unsaved,
      onclick: () => run('save', async () => {
        for (const u of app.units) if (u.dev && u.unsaved) { await u.dev.save(); u.unsaved = false; }
      }),
    }, unsaved ? 'SAVE' : 'SAVED') : null,
  );
}

function render() {
  const scroll = window.scrollY;
  const page = app.tab === 'device' ? devicePage()
    : app.tab === 'layout' ? layoutPage()
      : app.tab === 'sensitivity' ? sensitivityPage()
        : profilesPage();
  root.replaceChildren(
    header(),
    h('nav', {}, ...TABS.map(([t, label]) => h('button', { class: app.tab === t ? 'on' : '', onclick: () => setTab(t) }, label))),
    ...[
      app.error ? h('div', { class: 'error', onclick: () => { app.error = ''; changed(); } }, app.error + '  ✕') : null,
      app.busy ? h('div', { class: 'busy' }, '…') : null,
      page,
    ].filter((x): x is HTMLElement => x !== null),
  );
  fitText(root);
  window.scrollTo(0, scroll);
}

let queued = false;
onChange(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
});

// IDENTIFY flashes fade out
setInterval(() => {
  if (app.flash.size && app.tab === 'layout') {
    const now = performance.now();
    for (const [k, t] of app.flash) if (now - t > 700) app.flash.delete(k);
    changed();
  }
}, 250);

window.addEventListener('resize', () => changed());

window.addEventListener('beforeunload', (e) => {
  if (anyUnsaved()) e.preventDefault();
});

render();
