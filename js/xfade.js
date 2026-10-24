// Transiciones entre dos clips seguidos de la misma pista (como el botón entre clips de CapCut).
// Se guardan en el clip que sale: c.xfade = { type, dur }. La transición se centra en el corte:
// el clip que sale se alarga dur/2 y el que entra empieza dur/2 antes (congelando su primer fotograma).

export const XFADES = [
  { id: 'none', n: 'Ninguna', i: '✂️' },
  { id: 'fade', n: 'Fundido', i: '🌫️' },
  { id: 'black', n: 'Por negro', i: '⚫' },
  { id: 'white', n: 'Por blanco', i: '⚪' },
  { id: 'flash', n: 'Destello de luz', i: '✨' },
  { id: 'velo', n: 'Velo de luz', i: '🌅', dur: 1.4 },
  { id: 'polvo', n: 'Polvo mágico', i: '✨', dur: 1.6 },
  { id: 'rafaga', n: 'Ráfaga de color', i: '🌈', dur: 1.5 },
  { id: 'blancoSuave', n: 'Fundido a blanco', i: '🤍', dur: 0.75 },
  { id: 'zoomIn', n: 'Zoom adentro', i: '🔍' },
  { id: 'zoomOut', n: 'Zoom afuera', i: '🔎' },
  { id: 'slideL', n: 'Empujar ←', i: '⬅️' },
  { id: 'slideR', n: 'Empujar →', i: '➡️' },
  { id: 'slideUp', n: 'Empujar ↑', i: '⬆️' },
  { id: 'slideDown', n: 'Empujar ↓', i: '⬇️' },
  { id: 'spin', n: 'Giro', i: '🌀' },
  { id: 'blur', n: 'Desenfoque', i: '💨' },
  { id: 'wipeL', n: 'Cortinilla ←', i: '◀️' },
  { id: 'wipeUp', n: 'Cortinilla ↑', i: '🔼' },
  { id: 'glitch', n: 'Glitch', i: '📺' },
];

const isVisual = (c) => c.type === 'video' || c.type === 'image';

// Parejas (sale → entra) con transición activa
export function xfadePairs(project) {
  const out = [];
  const byLane = {};
  for (const c of project.clips) if (isVisual(c)) (byLane[c.lane] = byLane[c.lane] || []).push(c);
  for (const lane in byLane) {
    const list = byLane[lane].sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (!a.xfade || a.xfade.type === 'none') continue;
      const cut = a.start + a.dur;
      if (Math.abs(b.start - cut) > 0.08) continue;
      const half = Math.min(a.xfade.dur / 2, a.dur / 2, b.dur / 2);
      if (half < 0.02) continue;
      out.push({ a, b, cut, half, type: a.xfade.type });
    }
  }
  return out;
}

// Siguiente clip pegado (para el botón entre clips)
export function nextAdjacent(project, a) {
  let best = null;
  for (const c of project.clips) {
    if (c === a || !isVisual(c) || c.lane !== a.lane) continue;
    if (Math.abs(c.start - (a.start + a.dur)) <= 0.08 && (!best || c.start < best.start)) best = c;
  }
  return best;
}

// Qué clips extra hay que dibujar en el instante t y con qué progreso
export function xfadeAt(project, t) {
  const res = new Map(); // id -> { role, p, type }
  for (const x of xfadePairs(project)) {
    if (t >= x.cut - x.half && t < x.cut + x.half) {
      const p = (t - (x.cut - x.half)) / (2 * x.half);
      res.set(x.a.id, { role: 'out', p, type: x.type, partner: x.b.id });
      res.set(x.b.id, { role: 'in', p, type: x.type, partner: x.a.id });
    }
  }
  return res;
}
