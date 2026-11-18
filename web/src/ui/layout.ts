// LAYOUT: both units as they sit side by side (the left one turned by 180°), pad layers,
// and the editors of a control, a layer and the KEYS scale.
import {
  ACTIONS, BUTTONS, BUTTON_MODES, BUTTON_NAMES, CTL_BUTTON0, CTL_KNOB0, KEYS_LAYOUTS, KNOB_MODES, LAYERS, LAYER_KEYS, LAYER_OFF,
  LAYER_TYPES, LED_MODES, MSG_ACTION, MSG_TYPES, NOTE_NAMES, PADS, PALETTE_NAMES, Profile, SCALES, Side, cssColor, isButton, isKnob,
  isPad, keysNote, knobPosition, noteName, padAt, padPosition, paletteRgb,
} from '../protocol';
import { Unit, app, changed, profileEdited, profileOf, run } from '../state';
import { field, h, num, segmented, select, toggle } from './dom';

// A unit in the RIGHT orientation (as it comes, checked on the photo): knobs | pads | buttons.
const W = 780, H = 480;
export const WIDE = '(min-width: 900px) and (orientation: landscape)';     // the same as .units.two in style.css
interface Rect { x: number; y: number; w: number; h: number }

function rectRight(kind: 'pad' | 'button' | 'knob', i: number): Rect {
  if (kind === 'pad') {
    const [row, col] = padPosition(Side.RIGHT, i);
    return { x: 240 + col * 110, y: 20 + row * 110, w: 100, h: 100 };
  }
  if (kind === 'button') return { x: 700, y: 20 + i * 44, w: 62, h: 38 };
  const [row, col] = knobPosition(Side.RIGHT, i);
  return { x: 30 + col * 100, y: 30 + row * 110, w: 80, h: 80 };
}

function rectOf(side: Side, kind: 'pad' | 'button' | 'knob', i: number): Rect {
  const r = rectRight(kind, i);
  return side === Side.LEFT ? { x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h } : r;
}

function keysState(p: Profile) {
  return { root: p.keys.root, mask: SCALES[p.keys.scale].mask, octave: p.keys.octave };
}

export function controlName(u: Unit, ctl: number): string {
  const unitName = u.side === Side.LEFT ? 'LEFT' : 'RIGHT';
  if (isPad(ctl)) {
    const [row, col] = padPosition(u.side, ctl % PADS);
    return `${unitName} · LAYER ${Math.floor(ctl / PADS) + 1} · PAD row ${row + 1}, column ${col + 1}`;
  }
  if (isButton(ctl)) return `${unitName} · BUTTON ${BUTTON_NAMES[ctl - CTL_BUTTON0]}`;
  const [row, col] = knobPosition(u.side, ctl - CTL_KNOB0);
  return `${unitName} · KNOB row ${row + 1}, column ${col + 1}`;
}

function shortMsg(p: Profile, ctl: number): string {
  const x = p.ctl[ctl];
  if (x.type === MSG_ACTION) return [`LAYER ${x.a + 1}`, 'OCTAVE +', 'OCTAVE −', 'KEY NOTE', 'BLUETOOTH', `PROFILE ${x.a + 1}`, 'SCALE'][x.number] ?? '?';
  if (x.type === 0) return '—';
  return `${['', 'N', 'CC', 'PC'][x.type]} ${x.number}`;
}

const SVG = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function drawUnit(svg: SVGSVGElement, u: Unit, ox: number, onTap: (u: Unit, ctl: number) => void) {
  const p = profileOf(u);
  const L = u.layer;
  const layer = p.layer[L];
  const now = performance.now();
  const root = s('g', { transform: `translate(${ox} 0)` });
  root.append(s('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: 28, class: 'case' + (app.cur === u.side ? ' cur' : '') }));
  const mk = (ctl: number, r: Rect, draw: (g: SVGGElement, flash: boolean) => void) => {
    const sel = app.selected?.side === u.side && app.selected.ctl === ctl;
    const g = s('g', { class: 'ctl' + (sel ? ' sel' : '') });
    draw(g, now - (app.flash.get(`${u.side}:${ctl}`) ?? -1e9) < 600);
    g.addEventListener('pointerdown', () => onTap(u, ctl));
    root.append(g);
    void r;
  };
  const ks = keysState(p);
  for (let pad = 0; pad < PADS; pad++) {
    const r = rectOf(u.side, 'pad', pad);
    const ctl = L * PADS + pad;
    mk(ctl, r, (g, flash) => {
      // a pad as its LED shows it: dark when off, its colour (brightness = level) when lit
      let color = 0, level = 0, t1 = '', t2 = '';
      if (layer.type === LAYER_KEYS) {
        const [row, col] = padPosition(u.side, pad);
        const { note, kind } = keysNote(layer, ks.root, ks.mask, ks.octave, row, col);
        if (note >= 0) {
          color = kind === 2 ? layer.rootColor : kind === 1 ? layer.scaleColor : layer.outColor;
          level = kind === 2 ? 127 : kind === 1 ? 60 : 25;
        }
        t1 = note >= 0 ? noteName(note) : '';
        t2 = kind === 2 ? 'root' : '';
      } else {
        const x = p.ctl[ctl];
        color = x.a;
        level = 40;
        t1 = shortMsg(p, ctl);
        t2 = x.type ? `ch ${x.channel + 1}${x.mode ? ' · TOGGLE' : ''}` : '';
      }
      g.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 10, class: 'pad' + (flash ? ' flash' : '') }));
      const rgb = color ? paletteRgb(color, 127) : 0;
      const alpha = color ? 0.2 + 0.8 * (level / 127) : 0;
      if (color) g.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 10, fill: cssColor(rgb), 'fill-opacity': alpha.toFixed(2), class: 'led' }));
      const lum = (((rgb >> 16) & 255) * 0.3 + ((rgb >> 8) & 255) * 0.59 + (rgb & 255) * 0.11) * alpha;
      const ink = lum > 140 ? ' ink-dark' : '';
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 - 4, class: 't1 on-pad' + ink }, t1));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 + 18, class: 't2 on-pad' + ink }, t2));
      if (layer.type !== LAYER_KEYS && p.ctl[ctl].type) {
        g.append(s('rect', { x: r.x + 8, y: r.y + r.h - 14, width: 22, height: 6, rx: 3, fill: cssColor(paletteRgb(p.ctl[ctl].c, 127)) }));
      }
    });
  }
  for (let b = 0; b < BUTTONS; b++) {
    const r = rectOf(u.side, 'button', b);
    const ctl = CTL_BUTTON0 + b;
    const x = p.ctl[ctl];
    const lit = x.type === MSG_ACTION && x.number === 0 && x.a === L;
    mk(ctl, r, (g, flash) => {
      g.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: 'btn' + (flash ? ' flash' : '') + (lit ? ' lit' : '') }));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + 15, class: 't3' }, BUTTON_NAMES[b]));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + 31, class: 't3 dim' }, shortMsg(p, ctl)));
    });
  }
  for (let k = 0; k < 8; k++) {
    const r = rectOf(u.side, 'knob', k);
    const ctl = CTL_KNOB0 + k;
    const x = p.ctl[ctl];
    mk(ctl, r, (g, flash) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      g.append(s('circle', { cx, cy, r: r.w / 2, class: 'knob' + (flash ? ' flash' : '') }));
      g.append(s('text', { x: cx, y: cy - 2, class: 't1 light' }, shortMsg(p, ctl)));
      g.append(s('text', { x: cx, y: cy + 18, class: 't2 small' }, x.type ? (x.mode ? 'RELATIVE' : 'ABSOLUTE') : ''));
    });
  }
  svg.append(root);
}

function shownUnits(): Unit[] {
  const [right, left] = app.units;
  return app.view === 1 ? [left] : app.view === 2 ? [right] : [left, right];
}

// one unit: its name and layer tabs above its drawing; on a phone the units stand one above the
// other (full width), on a wide screen side by side (CSS .units)
function unitCard(u: Unit): HTMLElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'unit' });
  drawUnit(svg, u, 0, (uu, ctl) => {
    app.selected = { side: uu.side, ctl };
    app.cur = uu.side;
    changed();
  });
  return h('div', { class: 'unit-card' + (app.cur === u.side ? ' cur' : '') }, layerTabs(u), svg);
}

// the 16 colours a pad can show, as swatches (0 = off)
function colorSelect(value: number, onChange: (v: number) => void) {
  return h('div', { class: 'swatches' }, ...PALETTE_NAMES.map((name, i) => {
    const b = h('button', { class: 'swatch' + (i === value ? ' on' : '') + (i === 0 ? ' off' : ''), title: name, 'aria-label': name, onclick: () => onChange(i) });
    if (i) b.style.background = cssColor(paletteRgb(i, 127));
    return b;
  }));
}

const channelSelect = (v: number, on: (v: number) => void) => select(Array.from({ length: 16 }, (_, i) => String(i + 1)), v, on);

function controlEditor(u: Unit, ctl: number): HTMLElement {
  const p = profileOf(u);
  const x = p.ctl[ctl];
  const edit = (fn: () => void) => { fn(); profileEdited(u); };
  const knob = isKnob(ctl), pad = isPad(ctl), button = isButton(ctl);
  const types = knob ? ['OFF', 'CC'] : button ? [...MSG_TYPES, 'ACTION'] : [...MSG_TYPES];
  const typeIndex = knob ? (x.type ? 1 : 0) : x.type;
  const kids: (Node | null)[] = [
    field('MESSAGE', segmented(types, typeIndex, (v) => edit(() => {
      x.type = knob ? (v ? 2 : 0) : v;
      if (x.type === MSG_ACTION) { x.number = 0; x.a = 0; }
    }))),
  ];
  if (x.type === MSG_ACTION) {
    kids.push(field('ACTION', select(ACTIONS, x.number, (v) => edit(() => { x.number = v; }))));
    if (x.number === 0) kids.push(field('LAYER', select(['1', '2', '3', '4'], x.a, (v) => edit(() => { x.a = v; })), 'switches the pads to this layer'));
    if (x.number === 3) kids.push(h('p', { class: 'hint' }, 'Hold the button: the three lower rows of pads are C … B, the key note is lit; tap a pad to pick it. The pad tells the app.'));
    if (x.number === 6) kids.push(h('p', { class: 'hint' }, 'Hold the button: the 11 lowest pads are the scales (Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harm Minor, Pent Major, Pent Minor, Chromatic — from the bottom-left), the current one is lit; tap a pad to pick it. The pad tells the app.'));
    if (x.number === 4) kids.push(h('p', { class: 'hint' }, 'Switches Bluetooth on and off; the button is lit while it is on.'));
    if (x.number === 5) kids.push(field('PROFILE', select(['1', '2', '3', '4'], x.a, (v) => edit(() => { x.a = v; })), 'a bank of settings: layout, sensitivity, layers'));
  } else if (x.type) {
    kids.push(field('CHANNEL', channelSelect(x.channel, (v) => edit(() => { x.channel = v; }))));
    kids.push(field(x.type === 1 ? 'NOTE' : x.type === 2 ? 'CC NUMBER' : 'PROGRAM', num(x.number, 0, 127, (v) => edit(() => { x.number = v; })),
      x.type === 1 ? noteName(x.number) : undefined));
    if (knob) {
      kids.push(field('MODE', select(KNOB_MODES, x.mode, (v) => edit(() => { x.mode = v; }))));
      kids.push(field('MIN', num(x.a, 0, 127, (v) => edit(() => { x.a = v; }))));
      kids.push(field('MAX', num(x.b, 0, 127, (v) => edit(() => { x.b = v; })), 'min > max: inverted'));
      kids.push(field('SPEED', num(x.c, 1, 16, (v) => edit(() => { x.c = v; })), 'steps per click'));
    } else {
      kids.push(field('MODE', segmented(BUTTON_MODES, x.mode, (v) => edit(() => { x.mode = v; }))));
    }
  }
  if (pad) {
    const L = Math.floor(ctl / PADS);
    kids.push(field('IDLE COLOR', colorSelect(x.a, (v) => edit(() => { x.a = v; }))));
    kids.push(field('PRESSED COLOR', colorSelect(x.b, (v) => edit(() => { x.b = v; }))));
    kids.push(field('HOST COLOR', colorSelect(x.c, (v) => edit(() => { x.c = v; })), 'when the app lights it'));
    kids.push(h('div', { class: 'row' },
      h('button', {
        onclick: () => edit(() => {
          for (let q = 0; q < PADS; q++) Object.assign(p.ctl[L * PADS + q], { type: x.type, channel: x.channel, mode: x.mode, a: x.a, b: x.b, c: x.c });
        }),
      }, 'APPLY TO LAYER'),
      h('button', {
        onclick: () => edit(() => {
          // numbers upwards from this pad's: bottom row first, left to right, as the unit sits
          let n = x.number;
          for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) p.ctl[L * PADS + padAt(u.side, row, col)].number = Math.min(127, n++);
        }),
      }, 'NUMBER PADS FROM HERE'),
    ));
  }
  return h('div', { class: 'editor' }, h('div', { class: 'title' }, controlName(u, ctl)), ...kids);
}

function layerEditor(u: Unit): HTMLElement {
  const p = profileOf(u);
  const L = u.layer;
  const l = p.layer[L];
  const edit = (fn: () => void) => { fn(); profileEdited(u); };
  const pickers = p.ctl.slice(CTL_BUTTON0, CTL_KNOB0).map((x, b) => (x.type === MSG_ACTION && x.number === 0 && x.a === L ? BUTTON_NAMES[b] : '')).filter(Boolean);
  const kids: (Node | null)[] = [
    field('TYPE', segmented(LAYER_TYPES, l.type, (v) => edit(() => {
      if (L === 0 && v === LAYER_OFF) return;   // layer 1 always exists
      l.type = v;
    })), L === 0 ? 'layer 1 is always there' : pickers.length ? `picked by ${pickers.join(', ')}` : 'set a button to ACTION → LAYER to pick it'),
    toggle('START LAYER', p.startLayer === L, (v) => edit(() => { if (v) p.startLayer = L; }), 'the pads show it after power-up and profile change'),
  ];
  if (l.type === LAYER_KEYS) {
    const k = p.keys;
    kids.push(
      field('CHANNEL', channelSelect(l.channel, (v) => edit(() => { l.channel = v; })), 'JAMbo: MIDI → NOTES'),
      field('LAYOUT', segmented(KEYS_LAYOUTS, l.layout, (v) => edit(() => { l.layout = v; l.rowStep = v ? 3 : 4; })),
        l.layout ? 'only the notes of the scale' : 'all notes, the scale lit (as MPC)'),
      field('ROW STEP', num(l.rowStep, 1, 12, (v) => edit(() => { l.rowStep = v; })), l.layout ? 'scale degrees per row' : 'semitones per row (4 = MPC, 5 = fourths)'),
      field('ROOT COLOR', colorSelect(l.rootColor, (v) => edit(() => { l.rootColor = v; }))),
      field('SCALE COLOR', colorSelect(l.scaleColor, (v) => edit(() => { l.scaleColor = v; }))),
      field('OUT OF SCALE', colorSelect(l.outColor, (v) => edit(() => { l.outColor = v; }))),
      field('PRESSED COLOR', colorSelect(l.pressedColor, (v) => edit(() => { l.pressedColor = v; }))),
      h('div', { class: 'title' }, 'SCALE'),
      toggle('FOLLOW JAMbo', !!k.followHost, (v) => edit(() => { k.followHost = v ? 1 : 0; }), 'the app sends its scale, key note and octave'),
      field('KEY NOTE', select(NOTE_NAMES, k.root, (v) => edit(() => { k.root = v; }))),
      field('SCALE', select(SCALES.map((x) => x.name), k.scale, (v) => edit(() => { k.scale = v; }))),
      field('OCTAVE', num(k.octave, 0, 7, (v) => edit(() => { k.octave = v; })), `lowest note ${noteName(12 * (k.octave + 1) + k.root)}`),
      u.dev ? h('button', { onclick: () => u.dev!.setScale(k.root, SCALES[k.scale].mask, k.octave) }, 'SEND THIS SCALE TO THE PAD') : null,
    );
  }
  return h('div', { class: 'editor' }, h('div', { class: 'title' }, `${u.side === Side.LEFT ? 'LEFT' : 'RIGHT'} · LAYER ${L + 1}`), ...kids);
}

function layerTabs(u: Unit): HTMLElement {
  const p = profileOf(u);
  return h('div', { class: 'layer-tabs' },
    h('span', { class: 'unit-name' }, u.side === Side.LEFT ? 'LEFT' : 'RIGHT', u.dev ? null : h('span', { class: 'hint' }, 'offline')),
    ...Array.from({ length: LAYERS }, (_, L) => {
      const t = p.layer[L].type;
      return h('button', {
        class: (u.layer === L ? 'on' : '') + (t === LAYER_OFF ? ' off' : ''),
        onclick: () => {
          u.layer = L;
          app.cur = u.side;
          if (app.selected && app.selected.side === u.side && isPad(app.selected.ctl)) app.selected = null;
          if (u.dev && t !== LAYER_OFF) u.dev.setLayer(L).catch(() => undefined);
          changed();
        },
      }, `LAYER ${L + 1}${t === LAYER_KEYS ? ' KEYS' : ''}`);
    }));
}

export function layoutPage(): HTMLElement {
  const units = shownUnits();
  const sel = app.selected;
  const selUnit = sel ? app.units[sel.side] : null;
  const showLayer = sel && selUnit && isPad(sel.ctl) && profileOf(selUnit).layer[selUnit.layer].type === LAYER_KEYS;
  const cur = app.units[app.cur];
  const anyDev = app.units.some((u) => u.dev);

  const tools = h('div', { class: 'row' },
    field('SHOW', segmented(['BOTH', 'LEFT', 'RIGHT'], app.view, (v) => { app.view = v; changed(); })),
    anyDev ? h('button', {
      class: app.units.some((u) => u.identify) ? 'on' : '',
      onclick: () => run('identify', async () => {
        const on = !app.units.some((u) => u.identify);
        for (const u of app.units) if (u.dev) { u.identify = on; await u.dev.identify(on); }
      }),
    }, 'IDENTIFY') : null,
  );
  const help = app.units.some((u) => u.identify)
    ? h('p', { class: 'hint' }, 'IDENTIFY: touch a control on a pad — it lights up here. Check that the drawing matches the device.')
    : h('p', { class: 'hint' }, 'Tap a control to edit it. Changes go to the pads at once; SAVE writes them to their memory.');

  const sim = selUnit?.sim;
  const simRow = sim && sel ? h('div', { class: 'row' },
    h('span', { class: 'hint' }, 'Virtual pad:'),
    isPad(sel.ctl) ? h('button', { onclick: () => sim.hit(sel.ctl % PADS, Math.random()) }, 'HIT') : null,
    isKnob(sel.ctl) ? h('button', { onclick: () => sim.knob(sel.ctl - CTL_KNOB0, 1) }, 'TURN') : null,
    isButton(sel.ctl) ? h('button', { onclick: () => sim.button(sel.ctl - CTL_BUTTON0) }, 'PRESS') : null,
  ) : null;

  const edited = selUnit ?? cur;
  const editors = [
    simRow,
    sel && selUnit && !showLayer ? controlEditor(selUnit, sel.ctl) : null,
    layerEditor(edited),
    field(`LED MODE · ${cur.side === Side.LEFT ? 'LEFT' : 'RIGHT'}`, segmented(LED_MODES, profileOf(cur).ledMode, (v) => { profileOf(cur).ledMode = v; profileEdited(cur); })),
  ];
  // units side by side (wide landscape): the editors below both; stacked (phone): right under the unit edited
  const sideBySide = units.length > 1 && matchMedia(WIDE).matches;
  const placed = sideBySide
    ? [h('div', { class: 'units two' }, ...units.map(unitCard)), ...editors]
    : units.flatMap((u) => [h('div', { class: 'units' }, unitCard(u)), ...(u === edited || units.length === 1 ? editors : [])]);
  return h('div', { class: 'page layout' },
    tools, help,
    ...placed,
  );
}
