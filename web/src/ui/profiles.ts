import { t } from '../i18n';
// PROFILES: four sets of settings on the device; pick, rename, copy, reset, export, import.
import { NAME_LEN, PROFILES, cloneProfile, defaultProfile, deserializeProfile, serializeProfile } from '../protocol';
import { changed, profileEdited, report, run, unit } from '../state';
import { download, h, pickFile } from './dom';
import { unitSwitch } from './unitswitch';

async function pushAll(indexes: number[]) {
  const u = unit();
  for (const i of indexes) await u.dev?.setProfile(i, u.profiles[i]);
  if (u.dev) u.unsaved = true;
}

export function profilesPage(): HTMLElement {
  const u = unit();
  const active = u.hello?.active ?? 0;
  const cards = u.profiles.map((p, i) => h('section', { class: 'card profile' + (i === u.editing ? ' editing' : '') },
    h('div', { class: 'row' },
      h('b', {}, `PROFILE ${i + 1}`),
      i === active ? h('span', { class: 'badge' }, 'ACTIVE') : h('button', {
        disabled: !u.dev,
        onclick: () => run('select', async () => {
          await u.dev!.select(i);
          u.hello!.active = i;
          u.layer = u.profiles[i].startLayer;
        }),
      }, 'MAKE ACTIVE'),
      h('button', { class: i === u.editing ? 'on' : '', onclick: () => { u.editing = i; changed(); } }, i === u.editing ? 'EDITING' : 'EDIT'),
    ),
    h('input', {
      value: p.name, maxlength: NAME_LEN, placeholder: 'name',
      onchange: (e: Event) => {
        p.name = (e.target as HTMLInputElement).value.replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN);
        const was = u.editing;
        u.editing = i;
        profileEdited(u);
        u.editing = was;
      },
    }),
    h('div', { class: 'row' },
      h('select', {
        onchange: (e: Event) => {
          const to = Number((e.target as HTMLSelectElement).value);
          if (to < 0) return;
          u.profiles[to] = cloneProfile(p);
          run('copy', () => pushAll([to]));
        },
      }, h('option', { value: -1 }, 'COPY TO…'), ...Array.from({ length: PROFILES }, (_, k) => k).filter((k) => k !== i).map((k) => h('option', { value: k }, `PROFILE ${k + 1}`))),
      h('button', {
        onclick: () => {
          if (!confirm(t(`Reset profile ${i + 1} to the JAMbo layout?`))) return;
          u.profiles[i] = defaultProfile(u.side);
          run('reset', () => pushAll([i]));
        },
      }, 'RESET'),
      h('button', { onclick: () => download(`jambopad-${u.side ? 'L' : 'R'}-${p.name || i + 1}.json`, JSON.stringify({ jambopad: 1, profile: Array.from(serializeProfile(p)) })) }, 'EXPORT'),
      h('button', {
        onclick: async () => {
          const f = await pickFile('.json,application/json');
          if (!f) return;
          try {
            const j = JSON.parse(await f.text());
            const q = deserializeProfile(Uint8Array.from(j.profile ?? []));
            if (!q) throw new Error('not a JAMboPAD profile');
            u.profiles[i] = q;
            await run('import', () => pushAll([i]));
          } catch (e) {
            report(e);
          }
        },
      }, 'IMPORT'),
    ),
  ));
  return h('div', { class: 'page' },
    unitSwitch(),
    h('p', { class: 'hint' }, 'On the device: hold PAD BANK + KNOB BANK and tap a pad of the top row to switch profiles 1–4.'),
    ...cards);
}
