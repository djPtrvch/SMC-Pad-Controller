// FIRST INSTALL: the open-smc-pad bootloader over the stock firmware (placeholder until the port is done).
import { h } from './dom';

export function installSection(): HTMLElement {
  return h('div', {},
    h('h3', {}, 'FIRST INSTALL (STOCK FIRMWARE)'),
    h('p', { class: 'hint' }, 'Coming next.'));
}
