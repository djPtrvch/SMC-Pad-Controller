// PROFILES: four sets of settings on the device; pick, rename, copy, reset, export, import.
import { NAME_LEN, PROFILES, cloneProfile, defaultProfile, deserializeProfile, serializeProfile } from '../protocol';
import { app, changed, profileEdited, report, run, side } from '../state';
import { download, h, pickFile } from './dom';

async function pushAll(indexes: number[]) {
  for (const i of indexes) await app.dev?.setProfile(i, app.profiles[i]);
  app.unsaved = true;
}

export function profilesPage(): HTMLElement {
  const active = app.hello?.active ?? 0;
  const cards = app.profiles.map((p, i) => h('section', { class: 'card profile' + (i === app.editing ? ' editing' : '') },
    h('div', { class: 'row' },
      h('b', {}, `PROFILE ${i + 1}`),
      i === active ? h('span', { class: 'badge' }, 'ACTIVE') : h('button', {
        disabled: !app.dev,
        onclick: () => run('select', async () => {
          await app.dev!.select(i);
          app.hello!.active = i;
        }),
      }, 'MAKE ACTIVE'),
      h('button', { class: i === app.editing ? 'on' : '', onclick: () => { app.editing = i; changed(); } }, i === app.editing ? 'EDITING' : 'EDIT'),
    ),
    h('input', {
      value: p.name, maxlength: NAME_LEN, placeholder: 'name',
      onchange: (e: Event) => {
        p.name = (e.target as HTMLInputElement).value.replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN);
        const was = app.editing;
        app.editing = i;
        profileEdited();
        app.editing = was;
      },
    }),
    h('div', { class: 'row' },
      h('select', {
        onchange: (e: Event) => {
          const to = Number((e.target as HTMLSelectElement).value);
          if (to < 0) return;
          app.profiles[to] = cloneProfile(p);
          run('copy', () => pushAll([to]));
        },
      }, h('option', { value: -1 }, 'COPY TO…'), ...Array.from({ length: PROFILES }, (_, k) => k).filter((k) => k !== i).map((k) => h('option', { value: k }, `PROFILE ${k + 1}`))),
      h('button', {
        onclick: () => {
          if (!confirm(`Reset profile ${i + 1} to the JAMbo layout?`)) return;
          app.profiles[i] = defaultProfile(side());
          run('reset', () => pushAll([i]));
        },
      }, 'RESET'),
      h('button', { onclick: () => download(`jambopad-${p.name || i + 1}.json`, JSON.stringify({ jambopad: 1, profile: Array.from(serializeProfile(p)) })) }, 'EXPORT'),
      h('button', {
        onclick: async () => {
          const f = await pickFile('.json,application/json');
          if (!f) return;
          try {
            const j = JSON.parse(await f.text());
            const q = deserializeProfile(Uint8Array.from(j.profile ?? []));
            if (!q) throw new Error('not a JamboPad profile');
            app.profiles[i] = q;
            await run('import', () => pushAll([i]));
          } catch (e) {
            report(e);
          }
        },
      }, 'IMPORT'),
    ),
  ));
  return h('div', { class: 'page' },
    h('p', { class: 'hint' }, 'On the device: hold PAD BANK + KNOB BANK and tap a pad of the top row to switch profiles 1–4.'),
    ...cards);
}
