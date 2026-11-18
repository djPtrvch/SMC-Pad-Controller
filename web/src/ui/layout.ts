// LAYOUT: the unit drawn as it sits on the desk; tap a control to edit what it sends.
import {
  BUTTONS, BUTTON_MODES, BUTTON_NAMES, CONTROLS, KNOB_MODES, LED_MODES, MSG_TYPES, PADS, PALETTE_NAMES, Side,
  cssColor, isButton, isKnob, knobPosition, padAt, padPosition, paletteRgb,
} from '../protocol';
import { app, changed, editingProfile, profileEdited, run, side } from '../state';
import { field, h, noteName, num, segmented, select } from './dom';

// Geometry of a unit in the RIGHT orientation (as it comes): knobs | pads | buttons.
// LEFT is the same turned by 180 degrees. Check against the device with IDENTIFY.
const W = 780, H = 480;
interface Rect { x: number; y: number; w: number; h: number }

function rectRight(ctl: number): Rect {
  if (ctl < PADS) {
    const [row, col] = padPosition(Side.RIGHT, ctl);
    return { x: 240 + col * 110, y: 20 + row * 110, w: 100, h: 100 };
  }
  if (isButton(ctl)) return { x: 700, y: 20 + (ctl - PADS) * 44, w: 62, h: 38 };
  const [row, col] = knobPosition(Side.RIGHT, ctl - PADS - BUTTONS);
  return { x: 30 + col * 100, y: 30 + row * 110, w: 80, h: 80 };
}

export function controlRect(s: Side, ctl: number): Rect {
  const r = rectRight(ctl);
  return s === Side.LEFT ? { x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h } : r;
}

export function controlName(ctl: number): string {
  if (ctl < PADS) {
    const [row, col] = padPosition(side(), ctl);
    return `PAD · row ${row + 1}, column ${col + 1}`;
  }
  if (isButton(ctl)) return `BUTTON ${BUTTON_NAMES[ctl - PADS]}`;
  const [row, col] = knobPosition(side(), ctl - PADS - BUTTONS);
  return `KNOB · row ${row + 1}, column ${col + 1}`;
}

function shortMsg(ctl: number): string {
  const x = editingProfile().ctl[ctl];
  if (x.type === 0) return '—';
  const t = ['', 'N', 'CC', 'PC'][x.type];
  return `${t} ${x.number}`;
}

const SVG = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

export function drawUnit(onTap: (ctl: number, e: PointerEvent) => void): SVGSVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'unit' });
  svg.append(s('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: 28, class: 'case' }));
  const p = editingProfile();
  const sd = side();
  const now = performance.now();
  for (let c = 0; c < CONTROLS; c++) {
    const r = controlRect(sd, c);
    const g = s('g', { class: 'ctl' + (app.selected === c ? ' sel' : ''), 'data-ctl': c });
    const flash = now - (app.flash.get(c) ?? -1e9) < 600;
    const x = p.ctl[c];
    if (c < PADS) {
      const fill = x.a ? cssColor(paletteRgb(x.a, 50)) : 'var(--pad)';
      g.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 10, class: 'pad' + (flash ? ' flash' : ''), fill }));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 - 4, class: 't1' }, shortMsg(c)));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 + 18, class: 't2' }, x.type ? `ch ${x.channel + 1}${x.mode ? ' · T' : ''}` : ''));
      g.append(s('rect', { x: r.x + 8, y: r.y + r.h - 14, width: 22, height: 6, rx: 3, fill: cssColor(paletteRgb(x.c || 0, 127)), class: 'chip' }));
    } else if (isButton(c)) {
      g.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: 'btn' + (flash ? ' flash' : '') }));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + 15, class: 't3' }, BUTTON_NAMES[c - PADS]));
      g.append(s('text', { x: r.x + r.w / 2, y: r.y + 31, class: 't3 dim' }, shortMsg(c)));
    } else {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      g.append(s('circle', { cx, cy, r: r.w / 2, class: 'knob' + (flash ? ' flash' : '') }));
      g.append(s('text', { x: cx, y: cy - 2, class: 't1' }, shortMsg(c)));
      g.append(s('text', { x: cx, y: cy + 18, class: 't2' }, x.type ? (x.mode ? 'REL' : 'ABS') : ''));
    }
    g.addEventListener('pointerdown', (e) => onTap(c, e));
    svg.append(g);
  }
  return svg;
}

function colorSelect(value: number, onChange: (v: number) => void) {
  const sel = select(PALETTE_NAMES, value, onChange, { class: 'color' });
  sel.style.borderLeft = `14px solid ${cssColor(paletteRgb(value, 127))}`;
  return sel;
}

function editor(ctl: number): HTMLElement {
  const p = editingProfile();
  const x = p.ctl[ctl];
  const edit = (fn: () => void) => { fn(); profileEdited(); };
  const knob = isKnob(ctl), pad = ctl < PADS;
  const types = knob ? ['OFF', 'CC'] : [...MSG_TYPES];
  const typeIndex = knob ? (x.type ? 1 : 0) : x.type;
  const kids: (Node | null)[] = [
    field('MESSAGE', segmented(types, typeIndex, (v) => edit(() => { x.type = knob ? (v ? 2 : 0) : v; }))),
  ];
  if (x.type) {
    kids.push(field('CHANNEL', select(Array.from({ length: 16 }, (_, i) => String(i + 1)), x.channel, (v) => edit(() => { x.channel = v; }))));
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
    kids.push(field('IDLE COLOR', colorSelect(x.a, (v) => edit(() => { x.a = v; }))));
    kids.push(field('PRESSED COLOR', colorSelect(x.b, (v) => edit(() => { x.b = v; }))));
    kids.push(field('HOST COLOR', colorSelect(x.c, (v) => edit(() => { x.c = v; })), 'when the app lights it'));
    kids.push(h('div', { class: 'row' },
      h('button', {
        onclick: () => edit(() => {
          for (let q = 0; q < PADS; q++) Object.assign(p.ctl[q], { type: x.type, channel: x.channel, mode: x.mode, a: x.a, b: x.b, c: x.c });
        }),
      }, 'APPLY TO ALL PADS'),
      h('button', {
        onclick: () => edit(() => {
          // numbers upwards from this pad's: bottom row first, left to right, as the unit sits
          const sd = side();
          let n = x.number;
          for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) {
            const q = padAt(sd, row, col);
            p.ctl[q].number = Math.min(127, n++);
          }
        }),
      }, 'NUMBER PADS FROM HERE'),
    ));
  }
  return h('div', { class: 'editor' }, h('div', { class: 'title' }, controlName(ctl)), ...kids);
}

export function layoutPage(): HTMLElement {
  const p = editingProfile();
  const unitBox = h('div', { class: 'unit-box' });
  const redraw = () => {
    unitBox.replaceChildren(drawUnit((c, e) => {
      if (app.sim && e.shiftKey) app.sim.hit(c, 0.7);
      app.selected = c;
      changed();
    }));
  };
  redraw();

  const tools = h('div', { class: 'row' },
    app.dev ? h('button', {
      class: app.identify ? 'on' : '',
      onclick: () => run('identify', async () => {
        app.identify = !app.identify;
        await app.dev!.identify(app.identify);
      }),
    }, 'IDENTIFY') : null,
    field('LED MODE', segmented(LED_MODES, p.ledMode, (v) => { p.ledMode = v; profileEdited(); })),
  );
  const help = app.identify
    ? h('p', { class: 'hint' }, 'IDENTIFY: touch a control on the device — it lights up here. Check that the drawing matches the device.')
    : h('p', { class: 'hint' }, 'Tap a control to edit it. Changes go to the device at once; SAVE writes them to its memory.');

  const simRow = app.sim ? h('div', { class: 'row' },
    h('span', { class: 'hint' }, 'Virtual device:'),
    h('button', { onclick: () => { if (app.selected !== null && app.selected < PADS) app.sim!.hit(app.selected, Math.random()); } }, 'HIT SELECTED PAD'),
    h('button', { onclick: () => { if (app.selected !== null && isKnob(app.selected)) app.sim!.knob(app.selected - PADS - BUTTONS, 1); } }, 'TURN SELECTED KNOB'),
  ) : null;

  return h('div', { class: 'page layout' }, tools, help, unitBox, simRow, app.selected !== null ? editor(app.selected) : null);
}

