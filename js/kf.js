// Keyframes: valores que cambian a lo largo del clip (opacidad, posición, escala, volumen, intensidad…).
// Se guardan en c.kf = { 'tf.opacity': [{ t, v }], … } con t en segundos desde el inicio del clip.

const pct = (v) => Math.round(v * 100) + '%';
const deg = (v) => Math.round(v) + '°';
const num = (v) => v.toFixed(2);

// [ruta, nombre, mín, máx, paso, formato]
export const KF_PROPS = {
  video: [
    ['tf.opacity', 'Opacidad', 0, 1, 0.01, pct],
    ['tf.scale', 'Escala', 0.1, 4, 0.01, pct],
    ['tf.x', 'Posición horizontal', -1, 1, 0.01, num],
    ['tf.y', 'Posición vertical', -1, 1, 0.01, num],
    ['tf.rot', 'Rotación', -180, 180, 1, deg],
    ['volume', 'Volumen', 0, 2, 0.01, pct],
  ],
  text: [
    ['opacity', 'Opacidad', 0, 1, 0.01, pct],
    ['size', 'Tamaño', 0.02, 0.25, 0.002, (v) => Math.round(v * 1000) / 10 + ''],
    ['x', 'Posición horizontal', -1, 1, 0.01, num],
    ['y', 'Posición vertical', -1, 1, 0.01, num],
    ['rot', 'Rotación', -180, 180, 1, deg],
  ],
  fx: [
    ['intensity', 'Intensidad', 0, 1, 0.01, pct],
    ['size', 'Tamaño', 0.3, 3, 0.05, pct],
  ],
  audio: [['volume', 'Volumen', 0, 2, 0.01, pct]],
};
KF_PROPS.image = KF_PROPS.video.filter((p) => p[0] !== 'volume');

export const propsFor = (c) => (c.type === 'fx' && c.kind !== 'particles' ? KF_PROPS.fx.slice(0, 1) : KF_PROPS[c.type] || []);
export const propDef = (c, path) => propsFor(c).find((p) => p[0] === path);

const EPS = 1 / 120;

export function getPath(o, p) {
  const ks = p.split('.');
  let v = o;
  for (const k of ks) { if (v == null) return undefined; v = v[k]; }
  if (v === undefined && p === 'opacity') return 1;
  return v;
}
export function setPath(o, p, val) {
  const ks = p.split('.');
  let t = o;
  for (let i = 0; i < ks.length - 1; i++) { if (t[ks[i]] == null) t[ks[i]] = {}; t = t[ks[i]]; }
  t[ks[ks.length - 1]] = val;
}

export const hasKf = (c, p) => !!(c.kf && c.kf[p] && c.kf[p].length);
export const anyKf = (c) => !!(c.kf && Object.values(c.kf).some((a) => a && a.length));
export const kfAt = (c, p, lt) => (c.kf && c.kf[p] ? c.kf[p].find((k) => Math.abs(k.t - lt) < EPS) : null);

const smooth = (u) => u * u * (3 - 2 * u);

export function valueAt(c, p, lt) {
  const ks = c.kf && c.kf[p];
  if (!ks || !ks.length) return getPath(c, p);
  if (lt <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (lt >= a.t && lt <= b.t) {
      const u = (lt - a.t) / Math.max(1e-6, b.t - a.t);
      const e = c.kfEase === 'linear' ? u : smooth(u);
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

export function setKf(c, p, lt, v) {
  if (!c.kf) c.kf = {};
  if (!c.kf[p]) c.kf[p] = [];
  const k = kfAt(c, p, lt);
  if (k) k.v = v;
  else { c.kf[p].push({ t: lt, v }); c.kf[p].sort((a, b) => a.t - b.t); }
}
export function removeKf(c, p, lt) {
  if (!c.kf || !c.kf[p]) return;
  const v = valueAt(c, p, lt);
  c.kf[p] = c.kf[p].filter((k) => Math.abs(k.t - lt) >= EPS);
  if (!c.kf[p].length) { delete c.kf[p]; setPath(c, p, v); }
}

// Cambia un valor desde la interfaz: si la propiedad está animada, crea/actualiza el keyframe en ese instante.
export function setValue(c, p, lt, v) {
  if (hasKf(c, p)) setKf(c, p, lt, v);
  else setPath(c, p, v);
}

// Copia del clip con los valores animados aplicados en el instante lt
export function animClip(c, lt) {
  if (!c.kf) return c;
  let o = null;
  for (const p in c.kf) {
    const ks = c.kf[p];
    if (!ks || !ks.length) continue;
    if (!o) { o = { ...c }; if (c.tf) o.tf = { ...c.tf }; }
    setPath(o, p, valueAt(c, p, lt));
  }
  return o || c;
}

export function kfTimes(c) {
  if (!c.kf) return [];
  const ts = [];
  for (const p in c.kf) for (const k of c.kf[p] || []) if (!ts.some((t) => Math.abs(t - k.t) < EPS)) ts.push(k.t);
  return ts.sort((a, b) => a - b);
}
export const anyKfAt = (c, lt) => kfTimes(c).some((t) => Math.abs(t - lt) < EPS);

// Botón ◆ general: añade un keyframe de todas las propiedades en ese instante, o los quita si ya hay
export function toggleAllKf(c, lt) {
  const props = propsFor(c);
  if (anyKfAt(c, lt)) { for (const [p] of props) if (kfAt(c, p, lt)) removeKf(c, p, lt); return false; }
  for (const [p] of props) setKf(c, p, lt, valueAt(c, p, lt));
  return true;
}

// Al dividir un clip: cada mitad se queda con sus keyframes (y un keyframe en el corte para no saltar)
export function splitKf(a, b, left) {
  if (!a.kf) return;
  const src = a.kf;
  a.kf = {}; b.kf = {};
  for (const p in src) {
    const ks = src[p] || [];
    if (!ks.length) continue;
    const v = valueAt({ ...a, kf: src }, p, left);
    a.kf[p] = [...ks.filter((k) => k.t < left - 1e-3), { t: left, v }];
    b.kf[p] = [{ t: 0, v }, ...ks.filter((k) => k.t > left + 1e-3).map((k) => ({ t: k.t - left, v: k.v }))];
  }
}

// Al recortar por la izquierda los keyframes se quedan pegados al contenido
export function shiftKf(c, dt) {
  if (!c.kf || !dt) return;
  for (const p in c.kf) for (const k of c.kf[p]) k.t -= dt;
}

// Curva de ganancia (volumen animado × fundidos) muestreada para Web Audio
export function gainAt(c, lt) {
  let g = valueAt(c, 'volume', lt);
  const fi = c.afadeIn || 0, fo = c.afadeOut || 0;
  if (fi > 0 && lt < fi) g *= Math.max(0, lt / fi);
  if (fo > 0 && lt > c.dur - fo) g *= Math.max(0, (c.dur - lt) / fo);
  return Math.max(0, g);
}
