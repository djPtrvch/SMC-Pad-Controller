// Small DOM helpers.
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

export function select(options: readonly string[], value: number, onChange: (v: number) => void, attrs: Attrs = {}) {
  return h('select', { ...attrs, onchange: (e: Event) => onChange(Number((e.target as HTMLSelectElement).value)) },
    ...options.map((o, i) => h('option', { value: i, selected: i === value }, o)));
}

export function num(value: number, min: number, max: number, onChange: (v: number) => void, attrs: Attrs = {}) {
  return h('input', {
    type: 'number', inputmode: 'numeric', min, max, value, ...attrs,
    onchange: (e: Event) => {
      const el = e.target as HTMLInputElement;
      let v = Math.round(Number(el.value));
      if (!Number.isFinite(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      el.value = String(v);
      onChange(v);
    },
  });
}

export function field(label: string, control: Node, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function segmented(options: readonly string[], value: number, onChange: (v: number) => void) {
  return h('div', { class: 'seg' }, ...options.map((o, i) => h('button', { class: i === value ? 'on' : '', onclick: () => onChange(i) }, o)));
}


export function download(name: string, data: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, onchange: () => resolve(input.files?.[0] ?? null) });
    input.click();
  });
}
