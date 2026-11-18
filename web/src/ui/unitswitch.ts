// LEFT / RIGHT: the unit SENSITIVITY and PROFILES work on.
import { Side } from '../protocol';
import { app, changed } from '../state';
import { h, segmented } from './dom';

export function unitSwitch(): HTMLElement {
  const order = [Side.LEFT, Side.RIGHT];
  const label = (s: Side) => `${s === Side.LEFT ? 'LEFT' : 'RIGHT'}${app.units[s].dev ? '' : ' (offline)'}`;
  return h('div', { class: 'unit-switch' },
    segmented(order.map(label), order.indexOf(app.cur), (v) => { app.cur = order[v]; changed(); }));
}
