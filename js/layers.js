// Capas superpuestas (orden e intercambio) y «Sustituir» el contenido de un clip
import { state, bus, commit } from './state.js';

const isVisual = (c) => c.type === 'video' || c.type === 'image';
const overlaps = (a, t) => t >= a.start - 1e-3 && t < a.start + a.dur - 1e-3;

// Orden de dibujo: pista principal abajo, luego superposiciones por capa (z) y, a igual capa, por inicio
export function drawOrder(a, b) {
  const la = a.lane === 'overlay' ? 1 : 0, lb = b.lane === 'overlay' ? 1 : 0;
  return la - lb || (a.z || 0) - (b.z || 0) || a.start - b.start;
}

// Momento de referencia para buscar qué hay debajo/encima: el cabezal si está dentro del clip, si no su mitad
function refTime(c) {
  return overlaps(c, state.time) ? state.time : c.start + c.dur / 2;
}

// Clips visuales que se ven en el instante t, de abajo arriba
function stackAt(t) {
  return state.project.clips.filter((k) => isVisual(k) && overlaps(k, t)).sort(drawOrder);
}

export function layerInfo(c) {
  const t = refTime(c);
  const st = stackAt(t);
  const i = st.indexOf(c);
  return { below: i > 0 ? st[i - 1] : null, above: i >= 0 && i < st.length - 1 ? st[i + 1] : null, pos: i + 1, total: st.length };
}

// Sube o baja un clip superpuesto una capa respecto a los que coinciden con él
export function moveLayer(c, dir) {
  if (c.lane !== 'overlay') return false;
  const ov = state.project.clips.filter((k) => k.lane === 'overlay' && isVisual(k) && k !== c && k.start < c.start + c.dur && k.start + k.dur > c.start);
  if (!ov.length) return false;
  const all = [...ov, c].sort(drawOrder);
  all.forEach((k, i) => { k.z = i; });
  const i = all.indexOf(c), j = i + dir;
  if (j < 0 || j >= all.length) return false;
  const o = all[j];
  [c.z, o.z] = [o.z, c.z];
  if (c.z === o.z) c.z += dir;
  commit();
  bus.emit('change', { structural: true, keepPanel: true });
  return true;
}

// Intercambia lo que se ve en dos clips (el de arriba pasa a verse abajo y al revés):
// cada uno conserva su sitio, tamaño, posición y efectos; se cambia el vídeo/foto que muestra,
// sincronizado con el tiempo para que el vídeo siga en el mismo momento.
export function swapContent(a, b) {
  if (!a || !b || !isVisual(a) || !isVisual(b)) return false;
  const ma = state.media.get(a.media), mb = state.media.get(b.media);
  if (!ma || !mb) return false;
  // instante de la línea de tiempo en el que empieza cada hueco, medido en el medio del otro clip
  const inFor = (slot, src) => (src.type === 'video' ? Math.max(0, src.in + (slot.start - src.start) * (src.speed || 1)) : 0);
  const na = { media: b.media, type: b.type, in: inFor(a, b), speed: b.speed || 1, volume: b.volume, muted: b.muted };
  const nb = { media: a.media, type: a.type, in: inFor(b, a), speed: a.speed || 1, volume: a.volume, muted: a.muted };
  Object.assign(a, na);
  Object.assign(b, nb);
  commit();
  bus.emit('change', { structural: true, keepPanel: true });
  bus.emit('media');
  return true;
}

// Sustituye el medio de un clip (vídeo, foto o audio) conservando su sitio y sus ajustes
export function replaceMedia(c, m) {
  if (!c || !m) return false;
  if (c.type === 'audio') {
    if (m.kind === 'image') return false;
  } else if (m.kind === 'audio') return false;
  c.media = m.id;
  c.in = 0;
  if (c.type !== 'audio') c.type = m.kind === 'video' ? 'video' : 'image';
  if (m.kind !== 'image' && m.duration) {
    const max = m.duration / (c.speed || 1);
    if (c.dur > max) c.dur = Math.max(0.1, max);
  }
  if (c.kf) for (const p of Object.keys(c.kf)) c.kf[p] = c.kf[p].filter((k) => k.t <= c.dur + 1e-3);
  commit();
  bus.emit('change', { structural: true, keepPanel: true });
  bus.emit('media');
  return true;
}
