// Pequeños ayudantes para construir controles grandes y táctiles.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

const fmtNum = (v, step) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return Number(v).toFixed(d);
};

// slider: onInput(v) en vivo, onCommit() al soltar
export function slider(label, value, min, max, step, onInput, onCommit, fmt) {
  const out = h('output', {}, fmt ? fmt(value) : fmtNum(value, step));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt ? fmt(v) : fmtNum(v, step); onInput(v); });
  inp.addEventListener('change', () => onCommit && onCommit());
  // doble toque = valor por defecto (0 o 1)
  inp.addEventListener('dblclick', () => {
    const def = min < 0 ? 0 : (min <= 1 && max >= 1 && label.match(/Escala|Opacidad|Velocidad|Volumen|Intensidad|Tamaño/) ? 1 : min);
    inp.value = def; inp.dispatchEvent(new Event('input')); onCommit && onCommit();
  });
  return h('div', { class: 'field' }, h('label', {}, label, out), inp);
}

export function select(label, options, value, onChange) {
  const s = h('select', {}, ...options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.n)));
  s.addEventListener('change', () => onChange(s.value));
  return h('div', { class: 'field' }, label ? h('label', {}, label) : null, s);
}

export function toggle(label, value, onChange) {
  const inp = h('input', { type: 'checkbox' });
  inp.checked = !!value;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('div', { class: 'toggle' }, h('span', {}, label), h('label', { class: 'switch' }, inp, h('i')));
}

export function color(label, value, onInput, onCommit) {
  const inp = h('input', { type: 'color', value });
  inp.addEventListener('input', () => onInput(inp.value));
  inp.addEventListener('change', () => onCommit && onCommit());
  return h('div', { class: 'toggle' }, h('span', {}, label), inp);
}

export function chips(options, value, onPick) {
  const wrap = h('div', { class: 'chips' });
  for (const o of options) {
    const b = h('button', { class: o.id === value ? 'on' : '' }, o.i ? h('i', {}, o.i) : null, h('span', {}, o.n));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(o.id);
    });
    wrap.append(b);
  }
  return wrap;
}

export function section(title, icon, open, ...kids) {
  const d = h('details', { class: 'sec' }, h('summary', {}, icon ? h('span', {}, icon) : null, title), h('div', { class: 'body' }, ...kids));
  if (open) d.open = true;
  return d;
}

export function fmtTime(t, tenths = true) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function openModal(content, { dismissable = true } = {}) {
  const m = document.getElementById('modal');
  m.innerHTML = '';
  const sheet = h('div', { class: 'sheet' }, content);
  m.append(sheet);
  m.hidden = false;
  m.onclick = (e) => { if (dismissable && e.target === m) closeModal(); };
  return sheet;
}
export function closeModal() {
  const m = document.getElementById('modal');
  m.hidden = true;
  m.innerHTML = '';
}
