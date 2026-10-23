// Paneles laterales: Medios, Texto, Efectos y Ajustes (inspector del clip seleccionado).
import { state, bus, commit, selectedClip, removeClip, duplicateClip, splitClip } from './state.js';
import { h, slider, select, toggle, color, chips, section, fmtTime, toast } from './ui.js';
import {
  ADJ_CONTROLS, ADJ_DEFAULT, FILTERS, MOTIONS, TRANSITIONS, BLENDS, MASKS, FONTS,
  TEXT_IN, TEXT_OUT, TEXT_LOOP, TEXT_STYLES, PARTICLES, POSTFX,
} from './presets.js';

export class Panels {
  constructor(app) {
    this.app = app;
    this.tab = 'media';
    this.body = document.getElementById('tabBody');
    this.fxSeg = 'particles';
    this.openSecs = new Set(['pos', 'txt', 'fxp', 'aud']);
    document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.tab)));
    bus.on('select', () => { if (state.selection) this.show('inspect'); else if (this.tab === 'inspect') this.render(); });
    bus.on('change', (e) => { if (e && (e.structural || e.timing) && this.tab === 'inspect') this.render(); else if (e && e.structural && this.tab === 'media') this.render(); });
    bus.on('media', () => { if (this.tab === 'media') this.render(); });
    this.render();
  }

  show(tab) {
    this.tab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.render();
  }

  render() {
    const st = this.body.scrollTop;
    this.body.innerHTML = '';
    const f = { media: this.mediaTab, text: this.textTab, fx: this.fxTab, inspect: this.inspectTab }[this.tab];
    f.call(this);
    if (this.tab === 'inspect') this.body.scrollTop = st;
  }

  // ---------------- MEDIOS ----------------
  mediaTab() {
    const b = this.body;
    b.append(h('h3', {}, 'Tus medios'));
    b.append(h('div', { class: 'row-btns' },
      h('button', { class: 'btn gold', onclick: () => this.app.pickFiles() }, '+ Importar'),
      h('button', { class: 'btn', onclick: () => this.app.recordVoice() }, '🎙️ Grabar voz')));
    const list = [...state.media.values()];
    if (!list.length) {
      b.append(h('p', { class: 'hint' }, 'Importa vídeos, fotos o música desde tu iPad o tu ordenador. Toca una miniatura para añadirla a la línea de tiempo.'));
      return;
    }
    b.append(h('p', { class: 'hint' }, 'Toca para añadir a la línea de tiempo (los vídeos y fotos se ponen al final de la pista principal; el audio, donde está el cabezal).'));
    const g = h('div', { class: 'grid' });
    for (const m of list) {
      const th = h('div', { class: 'th', style: m.thumb ? `background-image:url(${m.thumb})` : 'background:linear-gradient(135deg,#3f7cc4,#7a5cc4)' }, m.thumb ? '' : (m.kind === 'audio' ? '🎵' : '🎞️'));
      const card = h('button', { class: 'card media-card', onclick: () => this.app.addMediaToTimeline(m) },
        th, h('div', { class: 'nm' }, m.name), h('span', { class: 'add' }, '+'),
        m.duration ? h('span', { class: 'dur' }, fmtTime(m.duration, false)) : null);
      g.append(card);
    }
    b.append(g);
    b.append(h('p', { class: 'hint', style: 'margin-top:14px' }, '💡 Para poner un vídeo encima de otro (pantalla verde, imagen en imagen, efectos de fuego reales…) añádelo y en Ajustes cambia su capa a «Superpuesto».'));
  }

  // ---------------- TEXTO ----------------
  textTab() {
    const b = this.body;
    b.append(h('h3', {}, 'Texto'));
    b.append(h('button', { class: 'btn gold block', onclick: () => this.app.addText({}) }, '+ Añadir texto'));
    b.append(h('p', { class: 'hint', style: 'margin-top:14px' }, 'O elige un estilo ya preparado (con su animación):'));
    const g = h('div', { class: 'grid' });
    for (const s of TEXT_STYLES) {
      g.append(h('button', { class: 'card style-card', onclick: () => this.app.addText(s.p) }, h('span', { style: s.css }, 'Aa'), h('small', {}, s.n)));
    }
    b.append(g);
  }

  // ---------------- EFECTOS ----------------
  fxTab() {
    const b = this.body;
    b.append(h('h3', {}, 'Efectos'));
    const seg = h('div', { class: 'seg' });
    const mk = (id, n) => h('button', { class: this.fxSeg === id ? 'on' : '', onclick: () => { this.fxSeg = id; this.render(); } }, n);
    seg.append(mk('particles', '🔥 Ambiente'), mk('post', '🎬 Imagen'));
    b.append(seg);
    const isP = this.fxSeg === 'particles';
    b.append(h('p', { class: 'hint' }, isP
      ? 'Fuego, niebla, partículas y luz que se dibujan encima del vídeo. Se añaden donde está el cabezal; luego puedes alargarlos y ajustarlos.'
      : 'Efectos que transforman toda la imagen durante un tramo: glitch, VHS, temblor, flashes…'));
    const g = h('div', { class: 'grid' });
    for (const d of isP ? PARTICLES : POSTFX) {
      g.append(h('button', { class: 'card', onclick: () => this.app.addFx(d.id, isP ? 'particles' : 'post') }, h('span', { class: 'em' }, d.i), d.n));
    }
    b.append(g);
  }

  // ---------------- AJUSTES (inspector) ----------------
  inspectTab() {
    const b = this.body;
    const c = selectedClip();
    if (!c) {
      b.append(h('h3', {}, 'Ajustes'));
      b.append(h('p', { class: 'hint' }, 'Toca un clip en la línea de tiempo (o sobre la imagen) para ver aquí todas sus opciones: color, movimiento, transiciones, máscara, velocidad, animaciones…'));
      this.projectFields(b);
      return;
    }
    const app = this.app;
    const live = () => app.changed();
    const done = () => commit();
    const sec = (key, title, icon, ...kids) => {
      const d = section(title, icon, this.openSecs.has(key), ...kids);
      d.addEventListener('toggle', () => { if (d.open) this.openSecs.add(key); else this.openSecs.delete(key); });
      return d;
    };
    const S = (label, obj, key, min, max, step, fmt) => slider(label, obj[key], min, max, step, (v) => { obj[key] = v; live(); }, done, fmt);
    const pct = (v) => Math.round(v * 100) + '%';
    const secs = (v) => v.toFixed(1) + ' s';

    // cabecera
    const meta = {
      video: ['🎬', 'var(--clip-video)', 'Vídeo'], image: ['🖼️', 'var(--clip-video)', 'Imagen'],
      text: ['T', 'var(--clip-text)', 'Texto'], fx: ['✨', 'var(--clip-fx)', 'Efecto'], audio: ['🎵', 'var(--clip-audio)', 'Audio'],
    }[c.type];
    const m = c.media ? state.media.get(c.media) : null;
    let title = meta[2];
    if (m) title = m.name;
    if (c.type === 'fx') { const d = (c.kind === 'particles' ? PARTICLES : POSTFX).find((p) => p.id === c.fx); if (d) title = d.n; }
    if (c.type === 'text') title = c.text.split('\n')[0] || 'Texto';
    b.append(h('div', { class: 'clip-head' }, h('span', { class: 'badge', style: `background:${c.lane === 'overlay' ? 'var(--clip-over)' : meta[1]}` }, meta[0]), h('b', {}, title)));
    b.append(h('div', { class: 'mini-btns' },
      h('button', { class: 'btn', onclick: () => { if (!splitClip(c.id, state.time)) toast('Coloca el cabezal dentro del clip para dividirlo'); } }, '✂ Dividir'),
      h('button', { class: 'btn', onclick: () => duplicateClip(c.id) }, '⧉ Duplicar'),
      h('button', { class: 'btn danger', onclick: () => removeClip(c.id) }, '🗑')));

    // tiempos
    const timing = [
      slider('Empieza en', c.start, 0, Math.max(60, c.start + 30), 0.1, (v) => { c.start = v; live(); }, () => { bus.emit('change', { structural: true }); done(); }, secs),
      slider('Duración', c.dur, 0.2, this.maxDur(c), 0.1, (v) => { c.dur = v; live(); }, () => { bus.emit('change', { structural: true }); done(); }, secs),
    ];

    if (c.type === 'video' || c.type === 'image') {
      const tf = c.tf;
      b.append(sec('pos', 'Posición y tamaño', '📐',
        h('div', { class: 'field' }, h('label', {}, 'Encaje'), chips([{ id: 'cover', n: 'Llenar', i: '⬛' }, { id: 'contain', n: 'Ajustar', i: '🔲' }], tf.fit, (v) => { tf.fit = v; live(); done(); })),
        tf.fit === 'contain' ? toggle('Fondo desenfocado', tf.bgBlur, (v) => { tf.bgBlur = v; live(); done(); }) : null,
        S('Escala', tf, 'scale', 0.1, 4, 0.01, pct),
        S('Posición horizontal', tf, 'x', -1, 1, 0.01),
        S('Posición vertical', tf, 'y', -1, 1, 0.01),
        S('Rotación', tf, 'rot', -180, 180, 1, (v) => v + '°'),
        S('Opacidad', tf, 'opacity', 0, 1, 0.01, pct),
        h('div', { class: 'two' }, toggle('Espejo ↔', tf.flipX, (v) => { tf.flipX = v; live(); done(); }), toggle('Voltear ↕', tf.flipY, (v) => { tf.flipY = v; live(); done(); })),
        select('Capa', [{ id: 'video', n: 'Vídeo principal' }, { id: 'overlay', n: 'Superpuesto (encima)' }], c.lane, (v) => { c.lane = v; bus.emit('change', { structural: true }); done(); }),
        ...timing,
        h('p', { class: 'hint' }, '💡 También puedes arrastrar la imagen con el dedo para moverla y pellizcar para cambiar el tamaño.')));

      const adjBox = h('div');
      const buildAdj = () => {
        adjBox.innerHTML = '';
        for (const a of ADJ_CONTROLS) adjBox.append(S(a.n, c.adj, a.k, a.min, a.max, a.step || 0.01, a.step === 1 ? (v) => v + '°' : null));
      };
      buildAdj();
      b.append(sec('color', 'Color y filtros', '🎨',
        h('div', { class: 'field' }, h('label', {}, 'Filtro')),
        chips(Object.entries(FILTERS).map(([id, f]) => ({ id, n: f.n })), c.filter, (v) => { c.filter = v; live(); done(); }),
        S('Intensidad del filtro', c, 'filterAmt', 0, 1, 0.01, pct),
        adjBox,
        h('button', { class: 'btn block', style: 'margin-top:12px', onclick: () => { c.adj = { ...ADJ_DEFAULT }; c.filter = 'none'; live(); done(); this.render(); } }, '↺ Restablecer color')));

      b.append(sec('motion', 'Movimiento', '🎥',
        chips(MOTIONS, c.motion.type, (v) => { c.motion.type = v; live(); done(); }),
        S('Intensidad', c.motion, 'amount', 0, 1, 0.01, pct)));

      b.append(sec('trans', 'Transiciones', '🔀',
        h('div', { class: 'field' }, h('label', {}, 'Al entrar')),
        chips(TRANSITIONS, c.transIn.type, (v) => { c.transIn.type = v; live(); done(); app.preview(c.start, Math.min(c.dur, c.transIn.dur + 0.4)); }),
        S('Duración de entrada', c.transIn, 'dur', 0.1, 2, 0.05, secs),
        h('div', { class: 'field' }, h('label', {}, 'Al salir')),
        chips(TRANSITIONS, c.transOut.type, (v) => { c.transOut.type = v; live(); done(); app.preview(Math.max(c.start, c.start + c.dur - c.transOut.dur - 0.4), c.transOut.dur + 0.4); }),
        S('Duración de salida', c.transOut, 'dur', 0.1, 2, 0.05, secs),
        h('p', { class: 'hint' }, '💡 Para un fundido encadenado entre dos clips, superpón un poco el segundo sobre el primero (en otra capa) y ponle «Fundido» al entrar.')));

      b.append(sec('mask', 'Recorte y máscara', '✂️',
        S('Recortar izquierda', c.crop, 'l', 0, 0.45, 0.01, pct),
        S('Recortar derecha', c.crop, 'r', 0, 0.45, 0.01, pct),
        S('Recortar arriba', c.crop, 't', 0, 0.45, 0.01, pct),
        S('Recortar abajo', c.crop, 'b', 0, 0.45, 0.01, pct),
        select('Máscara', MASKS, c.mask.type, (v) => { c.mask.type = v; live(); done(); }),
        S('Tamaño de máscara', c.mask, 'size', 0.2, 1.5, 0.01, pct),
        S('Suavizado del borde', c.mask, 'feather', 0, 1, 0.01, pct)));

      b.append(sec('key', 'Pantalla verde (chroma)', '🟩',
        toggle('Quitar fondo de color', c.chroma.on, (v) => { c.chroma.on = v; if (v && c.lane === 'video') toast('Consejo: pon este clip en la capa «Superpuesto» para ver lo que hay detrás'); live(); done(); }),
        color('Color a quitar', c.chroma.color, (v) => { c.chroma.color = v; live(); }, done),
        h('button', { class: 'btn plum block', style: 'margin:6px 0 10px', onclick: () => app.pickColor(c, () => this.render()) }, '🎯 Tocar el color en la imagen'),
        h('div', { class: 'two' },
          h('button', { class: 'btn', onclick: () => { c.chroma.color = '#00ff00'; live(); done(); this.render(); } }, '🟩 Verde'),
          h('button', { class: 'btn', onclick: () => { c.chroma.color = '#0047ff'; live(); done(); this.render(); } }, '🟦 Azul')),
        S('Tolerancia', c.chroma, 'sim', 0, 1, 0.01, pct),
        S('Suavizado', c.chroma, 'smooth', 0, 1, 0.01, pct)));

      b.append(sec('blend', 'Fusión', '🌗',
        select('Modo de fusión', BLENDS, c.blend, (v) => { c.blend = v; live(); done(); }),
        h('p', { class: 'hint' }, '«Pantalla» quita el negro: perfecto para vídeos de fuego, chispas o luces sobre fondo negro.')));

      if (c.type === 'video') {
        b.append(sec('aud', 'Velocidad y sonido', '🔊',
          slider('Velocidad', c.speed, 0.25, 4, 0.05, (v) => {
            const src = c.dur * c.speed; c.speed = v; c.dur = Math.max(0.1, src / v);
            if (m && m.duration) c.dur = Math.min(c.dur, (m.duration - c.in) / v);
            live();
          }, () => { bus.emit('change', { structural: true }); done(); }, (v) => v.toFixed(2) + '×'),
          toggle('Silenciar', c.muted, (v) => { c.muted = v; app.audioChanged(); done(); }),
          slider('Volumen', c.volume, 0, 2, 0.01, (v) => { c.volume = v; }, () => { app.audioChanged(); done(); }, pct),
          slider('Fundido de entrada (audio)', c.afadeIn, 0, 5, 0.1, (v) => { c.afadeIn = v; }, () => { app.audioChanged(); done(); }, secs),
          slider('Fundido de salida (audio)', c.afadeOut, 0, 5, 0.1, (v) => { c.afadeOut = v; }, () => { app.audioChanged(); done(); }, secs),
          m && !m.buffer ? h('p', { class: 'hint' }, 'Este vídeo no tiene sonido (o el navegador no ha podido leerlo).') : null));
      }
    } else if (c.type === 'text') {
      const ta = h('textarea', {}, c.text);
      ta.addEventListener('input', () => { c.text = ta.value; live(); });
      ta.addEventListener('change', () => { bus.emit('change', { structural: true, keepPanel: true }); done(); });
      b.append(sec('txt', 'Texto', '✏️',
        ta,
        h('div', { class: 'field' }, h('label', {}, 'Estilos rápidos')),
        h('div', { class: 'grid' }, ...TEXT_STYLES.map((s) => h('button', { class: 'card style-card', onclick: () => { Object.assign(c, structuredClone(s.p)); live(); done(); this.render(); } }, h('span', { style: s.css }, 'Aa'), h('small', {}, s.n)))),
        select('Tipo de letra', FONTS.map((f) => ({ id: f.f, n: f.n })), c.font, (v) => { c.font = v; live(); done(); }),
        S('Tamaño', c, 'size', 0.02, 0.25, 0.002, (v) => Math.round(v * 1000) / 10 + ''),
        h('div', { class: 'field' }, h('label', {}, 'Grosor'), chips([{ id: 400, n: 'Normal' }, { id: 700, n: 'Negrita' }, { id: 900, n: 'Extra' }], c.weight, (v) => { c.weight = v; live(); done(); })),
        h('div', { class: 'two' }, toggle('Cursiva', c.italic, (v) => { c.italic = v; live(); done(); }), toggle('MAYÚSCULAS', c.upper, (v) => { c.upper = v; live(); done(); })),
        h('div', { class: 'field' }, h('label', {}, 'Alineación'), chips([{ id: 'left', n: 'Izquierda' }, { id: 'center', n: 'Centro' }, { id: 'right', n: 'Derecha' }], c.align, (v) => { c.align = v; live(); done(); })),
        ...timing));

      b.append(sec('tstyle', 'Color, borde y sombra', '🎨',
        color('Color', c.color, (v) => { c.color = v; live(); }, done),
        toggle('Degradado de color', !!c.color2, (v) => { c.color2 = v ? '#c8921a' : ''; live(); done(); this.render(); }),
        c.color2 ? color('Segundo color', c.color2, (v) => { c.color2 = v; live(); }, done) : null,
        S('Borde', c.stroke, 'w', 0, 0.03, 0.001, (v) => Math.round(v * 1000) + ''),
        color('Color del borde', c.stroke.color, (v) => { c.stroke.color = v; live(); }, done),
        S('Sombra / brillo', c.shadow, 'blur', 0, 1.5, 0.01, pct),
        color('Color de sombra', c.shadow.color, (v) => { c.shadow.color = v; live(); }, done),
        toggle('Fondo detrás del texto', c.bg.on, (v) => { c.bg.on = v; live(); done(); }),
        color('Color del fondo', c.bg.color, (v) => { c.bg.color = v; live(); }, done),
        S('Opacidad del fondo', c.bg, 'alpha', 0, 1, 0.01, pct),
        S('Espacio entre letras', c, 'spacing', -0.1, 0.5, 0.005),
        S('Interlineado', c, 'lineHeight', 0.8, 2, 0.01)));

      b.append(sec('tpos', 'Posición', '📐',
        S('Horizontal', c, 'x', -1, 1, 0.01),
        S('Vertical', c, 'y', -1, 1, 0.01),
        S('Ancho máximo', c, 'width', 0.2, 1, 0.01, pct),
        S('Rotación', c, 'rot', -180, 180, 1, (v) => v + '°'),
        h('p', { class: 'hint' }, '💡 Arrastra el texto sobre la imagen para colocarlo, y pellizca para cambiar su tamaño.')));

      b.append(sec('tanim', 'Animación', '✨',
        h('div', { class: 'field' }, h('label', {}, 'Aparición')),
        chips(TEXT_IN, c.inAnim.type, (v) => { c.inAnim.type = v; live(); done(); app.preview(c.start, Math.min(c.dur, c.inAnim.dur + 0.5)); }),
        S('Duración de aparición', c.inAnim, 'dur', 0.1, 3, 0.05, secs),
        h('div', { class: 'field' }, h('label', {}, 'Desaparición')),
        chips(TEXT_OUT, c.outAnim.type, (v) => { c.outAnim.type = v; live(); done(); app.preview(Math.max(c.start, c.start + c.dur - c.outAnim.dur - 0.3), c.outAnim.dur + 0.3); }),
        S('Duración de desaparición', c.outAnim, 'dur', 0.1, 3, 0.05, secs),
        h('div', { class: 'field' }, h('label', {}, 'Mientras está en pantalla')),
        chips(TEXT_LOOP, c.loop.type, (v) => { c.loop.type = v; live(); done(); }),
        S('Intensidad', c.loop, 'amount', 0, 1, 0.01, pct)));
    } else if (c.type === 'fx') {
      const isP = c.kind === 'particles';
      const list = isP ? PARTICLES : POSTFX;
      b.append(sec('fxp', 'Efecto', '✨',
        chips(list.map((d) => ({ id: d.id, n: d.n, i: d.i })), c.fx, (v) => { c.fx = v; const d = list.find((x) => x.id === v); if (isP && d.color) c.color = d.color; bus.emit('change', { structural: true }); done(); }),
        S('Intensidad', c, 'intensity', 0, 1, 0.01, pct),
        S('Velocidad', c, 'speed', 0.1, 3, 0.05, (v) => v.toFixed(2) + '×'),
        isP ? S('Tamaño', c, 'size', 0.3, 3, 0.05, pct) : null,
        isP ? color('Color', c.color, (v) => { c.color = v; live(); }, done) : null,
        S('Fundido entrada/salida', c, 'fade', 0, 3, 0.05, secs),
        isP ? h('button', { class: 'btn block', style: 'margin-top:10px', onclick: () => { c.seed = Math.floor(Math.random() * 1000); live(); done(); } }, '🎲 Otra variación') : null,
        ...timing));
    } else if (c.type === 'audio') {
      b.append(sec('aud', 'Audio', '🔊',
        slider('Volumen', c.volume, 0, 2, 0.01, (v) => { c.volume = v; }, () => { app.audioChanged(); done(); }, pct),
        slider('Fundido de entrada', c.afadeIn, 0, 8, 0.1, (v) => { c.afadeIn = v; }, () => { app.audioChanged(); done(); }, secs),
        slider('Fundido de salida', c.afadeOut, 0, 8, 0.1, (v) => { c.afadeOut = v; }, () => { app.audioChanged(); done(); }, secs),
        slider('Velocidad', c.speed, 0.5, 2, 0.05, (v) => { const src = c.dur * c.speed; c.speed = v; c.dur = Math.max(0.1, src / v); if (m && m.duration) c.dur = Math.min(c.dur, (m.duration - c.in) / v); }, () => { bus.emit('change', { structural: true }); app.audioChanged(); done(); }, (v) => v.toFixed(2) + '×'),
        ...timing,
        h('p', { class: 'hint' }, '💡 Arrastra los bordes del clip en la línea de tiempo para recortar la música.')));
    }
  }

  maxDur(c) {
    const m = c.media ? state.media.get(c.media) : null;
    if ((c.type === 'video' || c.type === 'audio') && m && m.duration) return Math.max(0.2, (m.duration - c.in) / c.speed);
    return Math.max(30, c.dur * 2);
  }

  projectFields(b) {
    b.append(h('div', { class: 'sec', style: 'padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:#fff' },
      h('b', { style: 'font-family:var(--serif);font-size:18px' }, '⚙️ Proyecto'),
      color('Color de fondo del vídeo', state.project.bg, (v) => { state.project.bg = v; this.app.changed(); }, () => commit()),
      h('button', { class: 'btn block', onclick: () => this.app.openProject() }, '📐 Formato y nombre')));
  }
}
