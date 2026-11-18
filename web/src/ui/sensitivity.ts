import { t } from '../i18n';
// SENSITIVITY: velocity curve, thresholds, aftertouch, per-pad gain with live pressure.
import { DeviceEvent } from '../device';
import { AT_MODES, CURVES, CURVE_CUSTOM, CURVE_FIXED, PADS, padAt, velocityLut } from '../protocol';
import { Unit, app, deviceListeners, profileEdited, profileOf, unit } from '../state';
import { field, h, num, segmented } from './dom';
import { unitSwitch } from './unitswitch';

const live = {
  raw: new Array(PADS).fill(0) as number[],
  hits: [] as { pad: number; peak: number; linear: number; velocity: number }[],
  gainPad: 0,
  calibrating: false,
  calPeaks: new Array(PADS).fill(0) as number[],
};

let redrawLive: (() => void) | null = null;

deviceListeners.add((u: Unit, e: DeviceEvent) => {
  if (u.side !== app.cur) return;
  if (e.kind === 'pressure') live.raw = e.raw;
  if (e.kind === 'hit') {
    live.hits.unshift(e);
    live.hits.length = Math.min(live.hits.length, 8);
    if (live.calibrating) live.calPeaks[e.pad] = Math.max(live.calPeaks[e.pad], e.peak);
  }
  if (e.kind === 'pressure' || e.kind === 'hit') redrawLive?.();
});

// the curve: input = linear velocity from the peak, output = the velocity sent
function curveCanvas(): HTMLCanvasElement {
  const p = profileOf(unit());
  const cv = h('canvas', { class: 'curve', width: 600, height: 600 });
  const pad = 40, size = 600 - 2 * pad;
  const X = (v: number) => pad + ((v - 1) / 126) * size;
  const Y = (v: number) => pad + size - (v / 127) * size;
  const draw = () => {
    const g = cv.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--fg'), dim = css.getPropertyValue('--dim'), acc = css.getPropertyValue('--accent');
    g.clearRect(0, 0, 600, 600);
    g.strokeStyle = dim; g.lineWidth = 1; g.globalAlpha = 0.35;
    for (let k = 0; k <= 4; k++) {
      const v = 1 + (126 * k) / 4;
      g.beginPath(); g.moveTo(X(v), pad); g.lineTo(X(v), pad + size); g.stroke();
      g.beginPath(); g.moveTo(pad, Y((127 * k) / 4)); g.lineTo(pad + size, Y((127 * k) / 4)); g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = dim; g.font = '22px system-ui';
    g.fillText(t('hit strength →'), pad, 600 - 8);
    g.save(); g.translate(26, pad + size); g.rotate(-Math.PI / 2); g.fillText(t('velocity →'), 0, 0); g.restore();
    const lut = velocityLut(p.sens);
    g.strokeStyle = fg; g.lineWidth = 4;
    g.beginPath();
    for (let x = 1; x < 128; x++) (x === 1 ? g.moveTo : g.lineTo).call(g, X(x), Y(lut[x]));
    g.stroke();
    if (p.sens.curve === CURVE_CUSTOM) {
      g.fillStyle = acc;
      p.sens.custom.forEach((v, k) => { g.beginPath(); g.arc(X(1 + (126 * k) / 4), Y(v), 14, 0, 7); g.fill(); });
    }
    const last = live.hits[0];
    if (last) {
      g.fillStyle = acc;
      g.beginPath(); g.arc(X(last.linear), Y(last.velocity), 9, 0, 7); g.fill();
    }
  };
  draw();
  // CUSTOM: drag a point up and down
  let dragging = -1;
  const toLocal = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 600, y: ((e.clientY - r.top) / r.height) * 600 };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (p.sens.curve !== CURVE_CUSTOM) return;
    const { x } = toLocal(e);
    dragging = Math.round(((x - pad) / size) * 4);
    if (dragging < 0 || dragging > 4) dragging = -1;
    else cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (dragging < 0) return;
    const { y } = toLocal(e);
    p.sens.custom[dragging] = Math.max(0, Math.min(127, Math.round(((pad + size - y) / size) * 127)));
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (dragging >= 0) { dragging = -1; profileEdited(unit()); }
  });
  redrawCurve = draw;
  return cv;
}
let redrawCurve: (() => void) | null = null;

function meters(): HTMLElement {
  const p = profileOf(unit());
  const box = h('div', { class: 'meters' });
  const draw = () => {
    box.replaceChildren();
    const sd = app.cur;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const pad = padAt(sd, row, col);
      const raw = live.raw[pad] ?? 0;
      const cell = h('button', { class: 'meter' + (pad === live.gainPad ? ' sel' : ''), onclick: () => { live.gainPad = pad; draw(); gainBox.replaceChildren(gainField()); } },
        h('div', { class: 'bar', style: `height:${(raw / 1023) * 100}%` }),
        h('div', { class: 'thr', style: `bottom:${(p.sens.onThreshold / 1023) * 100}%` }),
        h('span', {}, `${p.sens.padGain[pad]}%`));
      box.append(cell);
    }
  };
  draw();
  redrawLive = () => { draw(); redrawCurve?.(); hitsBox.replaceChildren(...hitRows()); };
  return box;
}

const hitsBox = h('div', { class: 'hits' });
function hitRows() {
  return live.hits.map((x) => h('div', {}, `pad ${x.pad + 1}: peak ${x.peak} → ${x.linear} → velocity ${x.velocity}`));
}

const gainBox = h('div');
function gainField() {
  const p = profileOf(unit());
  return field(`GAIN · PAD ${live.gainPad + 1}`, h('input', {
    type: 'range', min: 50, max: 200, value: p.sens.padGain[live.gainPad],
    onchange: (e: Event) => { p.sens.padGain[live.gainPad] = Number((e.target as HTMLInputElement).value); profileEdited(unit()); },
  }), 'tap a pad above to pick it');
}

function calibration(): HTMLElement {
  const p = profileOf(unit());
  if (!live.calibrating) {
    return h('button', {
      disabled: !unit().dev,
      onclick: () => { live.calibrating = true; live.calPeaks.fill(0); profileEdited(unit()); },
    }, 'AUTO CALIBRATE');
  }
  return h('div', { class: 'row' },
    h('span', { class: 'hint' }, `Hit every pad as hard as you can (${live.calPeaks.filter((v) => v > 0).length}/16), then FINISH.`),
    h('button', {
      onclick: () => {
        live.calibrating = false;
        const hitPads = live.calPeaks.map((v, i) => [v, i]).filter(([v]) => v > 0);
        if (hitPads.length) {
          // every pad's hardest hit reaches the full scale
          for (const [peak, i] of hitPads) p.sens.padGain[i] = Math.max(50, Math.min(200, Math.round((p.sens.fullScale * 100) / peak)));
        }
        profileEdited(unit());
      },
    }, 'FINISH'),
    h('button', { onclick: () => { live.calibrating = false; profileEdited(unit()); } }, 'CANCEL'));
}

export function sensitivityPage(): HTMLElement {
  const p = profileOf(unit());
  const s = p.sens;
  const edit = (fn: () => void) => { fn(); profileEdited(unit()); };

  gainBox.replaceChildren(gainField());
  hitsBox.replaceChildren(...hitRows());

  const curve = h('section', { class: 'card' },
    h('h2', {}, 'VELOCITY CURVE'),
    segmented(CURVES, s.curve, (v) => edit(() => { s.curve = v; })),
    curveCanvas(),
    s.curve === CURVE_CUSTOM ? h('p', { class: 'hint' }, 'Drag the yellow points up and down.') : null,
    s.curve === CURVE_FIXED
      ? field('FIXED VELOCITY', num(s.fixedVelocity, 1, 127, (v) => edit(() => { s.fixedVelocity = v; })))
      : h('div', { class: 'row' },
        field('VELOCITY MIN', num(s.velMin, 1, 127, (v) => edit(() => { s.velMin = v; }))),
        field('VELOCITY MAX', num(s.velMax, 1, 127, (v) => edit(() => { s.velMax = v; })))),
  );

  const detection = h('section', { class: 'card' },
    h('h2', {}, 'PADS'),
    h('div', { class: 'row' },
      field('ON THRESHOLD', num(s.onThreshold, 20, 1000, (v) => edit(() => { s.onThreshold = v; })), 'lower = more sensitive'),
      field('OFF THRESHOLD', num(s.offThreshold, 10, 995, (v) => edit(() => { s.offThreshold = v; }))),
      field('FULL SCALE', num(s.fullScale, 40, 1023, (v) => edit(() => { s.fullScale = v; })), 'peak for velocity 127'),
      field('ATTACK', num(s.attackMs, 1, 40, (v) => edit(() => { s.attackMs = v; })), 'ms to find the peak'),
    ),
    unit().dev ? meters() : h('p', { class: 'hint' }, 'Connect a device to see live pressure.'),
    gainBox,
    calibration(),
    hitsBox,
  );

  const at = h('section', { class: 'card' },
    h('h2', {}, 'AFTERTOUCH'),
    segmented(AT_MODES, s.atMode, (v) => edit(() => { s.atMode = v; })),
    s.atMode ? h('div', { class: 'row' },
      field('THRESHOLD', num(s.atThreshold, 20, 1013, (v) => edit(() => { s.atThreshold = v; }))),
      field('INTERVAL', num(s.atIntervalMs, 2, 100, (v) => edit(() => { s.atIntervalMs = v; })), 'ms between messages'),
    ) : null,
  );

  return h('div', { class: 'page' }, unitSwitch(), curve, detection, at);
}

export function enterSensitivity(on: boolean) {
  if (!on) { redrawLive = null; redrawCurve = null; }
  for (const u of app.units) u.dev?.monitor(on).catch(() => undefined);
}
