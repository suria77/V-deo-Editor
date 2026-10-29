// Miniaturas de efectos y filtros: se renderizan una vez con el motor real sobre una escena de muestra y se guardan en memoria.
import { Renderer } from './renderer.js';
import { Overlay } from './overlay.js';
import { makeVisualClip, makeFxClip } from './state.js';

const TW = 120, TH = 168;
const cache = new Map();
const waiting = new Map();
let rd = null, scene = null, ov = null, busy = false;
const queue = [];

function makeScene() {
  // atardecer con montañas: colores variados para que se note cada filtro
  const c = document.createElement('canvas'); c.width = 240; c.height = 336;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 336);
  sky.addColorStop(0, '#2a3b7a'); sky.addColorStop(0.45, '#b4639a'); sky.addColorStop(0.7, '#f2a65a'); sky.addColorStop(1, '#3b2a4a');
  g.fillStyle = sky; g.fillRect(0, 0, 240, 336);
  const sun = g.createRadialGradient(120, 190, 4, 120, 190, 70);
  sun.addColorStop(0, 'rgba(255,240,200,1)'); sun.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = sun; g.fillRect(0, 100, 240, 200);
  g.fillStyle = '#1d1a33';
  g.beginPath(); g.moveTo(0, 336); g.lineTo(0, 230); g.lineTo(60, 190); g.lineTo(110, 235); g.lineTo(170, 180); g.lineTo(240, 240); g.lineTo(240, 336); g.closePath(); g.fill();
  g.fillStyle = '#6fd1c2'; g.beginPath(); g.arc(190, 70, 16, 0, 7); g.fill();
  return c;
}

function init() {
  if (rd) return true;
  try {
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    rd = new Renderer(cv);
    ov = new Overlay();
    scene = makeScene();
    return true;
  } catch (e) { rd = null; return false; }
}

function renderOne(kind, id) {
  const media = { id: 'th', kind: 'image', el: scene, w: 240, h: 336, name: 'muestra', duration: 0 };
  const vis = makeVisualClip(media, 0, 'video');
  vis.dur = 4;
  const clips = [vis];
  if (kind === 'filter') vis.filter = id;
  else clips.push(Object.assign(makeFxClip(id, 0, kind), { dur: 4, start: 0 }));
  const project = { w: TW, h: TH, bg: '#000000', fps: 30, clips };
  rd.render({ project, t: 1.6, media: new Map([['th', media]]), videoFor: () => null, overlay: ov });
  return rd.gl.canvas.toDataURL('image/jpeg', 0.8);
}

function pump() {
  if (busy) return;
  busy = true;
  const step = () => {
    const job = queue.shift();
    if (!job) { busy = false; return; }
    const [kind, id] = job, key = kind + ':' + id;
    try {
      if (init()) cache.set(key, renderOne(kind, id));
    } catch (e) { cache.set(key, ''); }
    const cbs = waiting.get(key) || []; waiting.delete(key);
    for (const f of cbs) f(cache.get(key));
    setTimeout(step, 30);
  };
  setTimeout(step, 0);
}

// Pide la miniatura de un efecto (kind: 'particles' | 'post' | 'filter'); cb se llama cuando está lista
export function thumb(kind, id, cb) {
  const key = kind + ':' + id;
  if (cache.has(key)) { cb(cache.get(key)); return; }
  if (!waiting.has(key)) { waiting.set(key, []); queue.push([kind, id]); }
  waiting.get(key).push(cb);
  pump();
}
