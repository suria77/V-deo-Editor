// Catálogos: filtros, transiciones, movimientos, animaciones de texto, efectos de partículas y de imagen.

export const ASPECTS = {
  '9:16': { w: 1080, h: 1920, name: 'Vertical 9:16', sub: 'Shorts · Reels · TikTok' },
  '4:5': { w: 1080, h: 1350, name: 'Retrato 4:5', sub: 'Instagram' },
  '1:1': { w: 1080, h: 1080, name: 'Cuadrado 1:1', sub: 'Feed' },
  '16:9': { w: 1920, h: 1080, name: 'Horizontal 16:9', sub: 'YouTube' },
};

export const ADJ_DEFAULT = {
  exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  hue: 0, highlights: 0, shadows: 0, vignette: 0, grain: 0, blur: 0, sharpen: 0,
};

export const ADJ_CONTROLS = [
  { k: 'exposure', n: 'Exposición', min: -1, max: 1 },
  { k: 'brightness', n: 'Brillo', min: -1, max: 1 },
  { k: 'contrast', n: 'Contraste', min: -1, max: 1 },
  { k: 'saturation', n: 'Saturación', min: -1, max: 1 },
  { k: 'temperature', n: 'Temperatura', min: -1, max: 1 },
  { k: 'tint', n: 'Matiz (tinte)', min: -1, max: 1 },
  { k: 'hue', n: 'Tono de color', min: -180, max: 180, step: 1 },
  { k: 'highlights', n: 'Luces', min: -1, max: 1 },
  { k: 'shadows', n: 'Sombras', min: -1, max: 1 },
  { k: 'vignette', n: 'Viñeta', min: 0, max: 1 },
  { k: 'grain', n: 'Grano de película', min: 0, max: 1 },
  { k: 'blur', n: 'Desenfoque', min: 0, max: 1 },
  { k: 'sharpen', n: 'Nitidez', min: 0, max: 1 },
];

export const FILTERS = {
  none: { n: 'Original', adj: {} },
  warm: { n: 'Cálido', adj: { temperature: 0.35, saturation: 0.1, contrast: 0.05 } },
  cold: { n: 'Frío', adj: { temperature: -0.35, saturation: 0.05, tint: 0.05 } },
  cine: { n: 'Cine', adj: { contrast: 0.2, saturation: -0.05, temperature: -0.15, shadows: -0.15, vignette: 0.35, tint: -0.08 } },
  golden: { n: 'Hora dorada', adj: { temperature: 0.5, exposure: 0.1, saturation: 0.2, highlights: -0.1, vignette: 0.2 } },
  vintage: { n: 'Vintage', adj: { temperature: 0.25, saturation: -0.3, contrast: -0.1, grain: 0.35, vignette: 0.4, brightness: 0.03 } },
  bw: { n: 'Blanco y negro', adj: { saturation: -1, contrast: 0.15 } },
  noir: { n: 'Noir', adj: { saturation: -1, contrast: 0.45, shadows: -0.3, vignette: 0.5, grain: 0.2 } },
  vivid: { n: 'Vívido', adj: { saturation: 0.45, contrast: 0.15, highlights: 0.05 } },
  soft: { n: 'Suave', adj: { contrast: -0.15, brightness: 0.06, saturation: -0.05, blur: 0.08, highlights: -0.1 } },
  drama: { n: 'Drama', adj: { contrast: 0.4, saturation: 0.1, shadows: -0.3, highlights: 0.1, vignette: 0.3 } },
  night: { n: 'Noche', adj: { temperature: -0.45, exposure: -0.25, contrast: 0.15, saturation: -0.1, tint: 0.1 } },
  dream: { n: 'Ensueño', adj: { brightness: 0.1, contrast: -0.2, saturation: 0.15, blur: 0.12, temperature: 0.12, tint: 0.12 } },
  matcha: { n: 'Verde bosque', adj: { tint: -0.25, saturation: 0.1, temperature: -0.05, contrast: 0.1 } },
  rose: { n: 'Rosa', adj: { tint: 0.3, temperature: 0.12, saturation: 0.1, brightness: 0.04 } },
};

export const MOTIONS = [
  { id: 'none', n: 'Ninguno', i: '▭' },
  { id: 'zoomIn', n: 'Zoom lento +', i: '🔍' },
  { id: 'zoomOut', n: 'Zoom lento −', i: '🔎' },
  { id: 'panLeft', n: 'Paneo ←', i: '⬅️' },
  { id: 'panRight', n: 'Paneo →', i: '➡️' },
  { id: 'panUp', n: 'Paneo ↑', i: '⬆️' },
  { id: 'shake', n: 'Temblor', i: '📳' },
  { id: 'pulse', n: 'Latido', i: '💓' },
  { id: 'float', n: 'Flotar', i: '🎈' },
  { id: 'rotate', n: 'Giro lento', i: '🌀' },
  { id: 'bounce', n: 'Rebote', i: '⚽' },
  { id: 'sway', n: 'Balanceo', i: '🪁' },
];

export const TRANSITIONS = [
  { id: 'none', n: 'Corte', i: '✂️' },
  { id: 'fade', n: 'Fundido', i: '🌫️' },
  { id: 'slideL', n: 'Deslizar ←', i: '⏪' },
  { id: 'slideR', n: 'Deslizar →', i: '⏩' },
  { id: 'slideUp', n: 'Deslizar ↑', i: '⏫' },
  { id: 'zoomIn', n: 'Zoom entra', i: '🔍' },
  { id: 'zoomOut', n: 'Zoom sale', i: '🔎' },
  { id: 'spin', n: 'Giro', i: '🌀' },
  { id: 'blur', n: 'Desenfoque', i: '💨' },
  { id: 'wipeL', n: 'Cortinilla ←', i: '◀️' },
  { id: 'wipeUp', n: 'Cortinilla ↑', i: '🔼' },
  { id: 'flash', n: 'Destello', i: '⚡' },
  { id: 'glitch', n: 'Glitch', i: '📺' },
];

export const BLENDS = [
  { id: 'normal', n: 'Normal' },
  { id: 'screen', n: 'Pantalla (quita negros)' },
  { id: 'add', n: 'Luz (suma)' },
  { id: 'multiply', n: 'Multiplicar' },
];

export const MASKS = [
  { id: 'none', n: 'Sin máscara' },
  { id: 'circle', n: 'Círculo' },
  { id: 'rounded', n: 'Esquinas redondeadas' },
  { id: 'ellipse', n: 'Elipse' },
  { id: 'fadeBottom', n: 'Degradado abajo' },
  { id: 'fadeTop', n: 'Degradado arriba' },
  { id: 'fadeSides', n: 'Degradado lados' },
];

export const FONTS = [
  { f: 'Montserrat', n: 'Montserrat', g: true },
  { f: 'Figtree', n: 'Figtree (tipo CapCut)', g: true },
  { f: 'Poppins', n: 'Poppins', g: true },
  { f: 'Anton', n: 'Anton (impacto)', g: true },
  { f: 'Bebas Neue', n: 'Bebas Neue', g: true },
  { f: 'Playfair Display', n: 'Playfair Display', g: true },
  { f: 'Cinzel', n: 'Cinzel (clásica)', g: true },
  { f: 'Cormorant Garamond', n: 'Cormorant', g: true },
  { f: 'Pacifico', n: 'Pacifico (manuscrita)', g: true },
  { f: 'Dancing Script', n: 'Dancing Script', g: true },
  { f: 'Fraunces', n: 'Fraunces', g: true },
  { f: 'Sora', n: 'Sora', g: true },
  { f: 'Caveat', n: 'Caveat (a mano)', g: true },
  { f: 'Arial', n: 'Arial', g: false },
  { f: 'Georgia', n: 'Georgia', g: false },
];

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Caveat:wght@400;700&family=Cinzel:wght@400;700;900&family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Dancing+Script:wght@400;700&family=Figtree:wght@400;600;700;900&family=Fraunces:wght@400;700;900&family=Montserrat:ital,wght@0,400;0,700;0,900;1,700&family=Pacifico&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,700&family=Poppins:wght@400;700;900&family=Sora:wght@400;700&display=swap';

export const TEXT_IN = [
  { id: 'none', n: 'Sin animación' },
  { id: 'fade', n: 'Aparecer' },
  { id: 'slideUp', n: 'Sube' },
  { id: 'slideDown', n: 'Baja' },
  { id: 'slideLeft', n: 'Entra desde la izquierda' },
  { id: 'slideRight', n: 'Entra desde la derecha' },
  { id: 'pop', n: 'Pop (rebote)' },
  { id: 'zoomOut', n: 'Zoom desde grande' },
  { id: 'typewriter', n: 'Máquina de escribir' },
  { id: 'lettersRise', n: 'Letras que suben' },
  { id: 'lettersFade', n: 'Letra a letra' },
  { id: 'lettersPop', n: 'Letras con pop' },
  { id: 'glow', n: 'Brillo que aparece' },
  { id: 'callejuela', n: 'Callejuela', dur: 0.6 },
  { id: 'perroForma', n: 'Perro forma', dur: 0.42 },
  { id: 'apertura', n: 'Apertura', dur: 1.8 },
  { id: 'luciernaga', n: 'Luciérnagas', dur: 3 },
];

export const TEXT_OUT = [
  { id: 'none', n: 'Sin animación' },
  { id: 'fade', n: 'Desvanecer' },
  { id: 'slideDown', n: 'Baja' },
  { id: 'slideUp', n: 'Sube' },
  { id: 'zoomIn', n: 'Se agranda' },
  { id: 'shrink', n: 'Se encoge' },
  { id: 'lettersFade', n: 'Letra a letra' },
];

export const TEXT_LOOP = [
  { id: 'none', n: 'Ninguna' },
  { id: 'float', n: 'Flotar' },
  { id: 'pulse', n: 'Latido' },
  { id: 'shake', n: 'Temblor' },
  { id: 'glowPulse', n: 'Brillo que respira' },
  { id: 'wave', n: 'Ola de letras' },
  { id: 'rainbow', n: 'Arcoíris' },
];

export const TEXT_STYLES = [
  { n: 'Título', css: 'font-family:Montserrat;font-weight:900;color:#fff;text-shadow:0 2px 8px #0008', p: { font: 'Montserrat', weight: 900, size: 0.07, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0.4, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'pop', dur: 0.5 }, outAnim: { type: 'fade', dur: 0.4 } } },
  { n: 'Impacto', css: 'font-family:Anton;color:#ffe600;-webkit-text-stroke:1px #000', p: { font: 'Anton', weight: 400, size: 0.1, color: '#ffe600', color2: '', stroke: { w: 0.012, color: '#000000' }, shadow: { blur: 0.3, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'zoomOut', dur: 0.35 }, outAnim: { type: 'fade', dur: 0.3 }, upper: true } },
  { n: 'Dorado', css: 'font-family:Cinzel;font-weight:700;background:linear-gradient(#fff3b0,#c8921a);-webkit-background-clip:text;color:transparent', p: { font: 'Cinzel', weight: 700, size: 0.075, color: '#fff1a8', color2: '#c8921a', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0.5, color: '#7a4b00' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'glow', dur: 0.9 }, outAnim: { type: 'fade', dur: 0.6 }, loop: { type: 'glowPulse', amount: 0.5 } } },
  { n: 'Neón', css: 'font-family:Sora;font-weight:700;color:#fff;text-shadow:0 0 6px #ff3df2,0 0 14px #ff3df2', p: { font: 'Sora', weight: 700, size: 0.07, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 1, color: '#ff3df2' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'fade', dur: 0.4 }, outAnim: { type: 'fade', dur: 0.4 }, loop: { type: 'glowPulse', amount: 0.8 } } },
  { n: 'Subtítulo', css: 'font-family:Poppins;font-weight:700;color:#fff;background:#000a;padding:2px 8px;border-radius:6px', p: { font: 'Poppins', weight: 700, size: 0.045, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: true, color: '#000000', alpha: 0.65 }, y: 0.55, inAnim: { type: 'fade', dur: 0.2 }, outAnim: { type: 'fade', dur: 0.2 } } },
  { n: 'Karaoke', css: 'font-family:Montserrat;font-weight:900;color:#fff;text-shadow:0 0 0 #000;-webkit-text-stroke:1px #6a2cff', p: { font: 'Montserrat', weight: 900, size: 0.065, color: '#ffffff', color2: '', stroke: { w: 0.01, color: '#6a2cff' }, shadow: { blur: 0.2, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'lettersPop', dur: 0.8 }, outAnim: { type: 'fade', dur: 0.3 } } },
  { n: 'Elegante', css: 'font-family:Playfair Display;font-style:italic;color:#fff', p: { font: 'Playfair Display', weight: 400, italic: true, size: 0.06, color: '#fff8ea', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0.5, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'lettersFade', dur: 1.2 }, outAnim: { type: 'fade', dur: 0.6 } } },
  { n: 'Escritura', css: 'font-family:Dancing Script;font-weight:700;color:#ffd6e8', p: { font: 'Dancing Script', weight: 700, size: 0.09, color: '#ffd6e8', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0.5, color: '#b0006a' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'typewriter', dur: 1.4 }, outAnim: { type: 'fade', dur: 0.5 } } },
  { n: 'Callejuela', css: 'font-family:Figtree;font-weight:600;color:#fff;text-shadow:0 0 8px #ff7ad9', p: { font: 'Figtree', weight: 600, size: 0.06, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'callejuela', dur: 0.6 }, outAnim: { type: 'fade', dur: 0.3 } } },
  { n: 'Perro forma', css: 'font-family:Figtree;font-weight:600;color:#fff;text-shadow:0 0 10px #fff', p: { font: 'Figtree', weight: 600, size: 0.06, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'perroForma', dur: 0.42 }, outAnim: { type: 'fade', dur: 0.3 } } },
  { n: 'Apertura', css: 'font-family:Figtree;font-weight:600;color:#fff;-webkit-mask-image:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent)', p: { font: 'Figtree', weight: 600, size: 0.06, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'apertura', dur: 1.8 }, outAnim: { type: 'fade', dur: 0.3 } } },
  { n: 'Luciérnagas', css: 'font-family:Figtree;font-weight:600;color:#fff;text-shadow:0 0 12px #e8b07a', p: { font: 'Figtree', weight: 600, size: 0.06, color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'luciernaga', dur: 3 }, outAnim: { type: 'fade', dur: 0.3 } } },
  { n: 'Arcoíris', css: 'font-family:Poppins;font-weight:900;background:linear-gradient(90deg,#f33,#fc0,#3c3,#39f,#c3f);-webkit-background-clip:text;color:transparent', p: { font: 'Poppins', weight: 900, size: 0.08, color: '#ffffff', color2: '', stroke: { w: 0.006, color: '#000000' }, shadow: { blur: 0.2, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 }, inAnim: { type: 'lettersRise', dur: 0.9 }, outAnim: { type: 'fade', dur: 0.4 }, loop: { type: 'rainbow', amount: 0.7 } } },
];

// Efectos de partículas / ambiente. add = mezcla aditiva (luz)
export const PARTICLES = [
  // --- luces y estrellas ---
  { id: 'radiant', n: 'Brillo radiante', i: '🔆', cat: 'luz', add: true, color: '#ffe9a8', size: 1, speed: 1, intensity: 0.7 },
  { id: 'constellation', n: 'Constelación', i: '🌌', cat: 'luz', add: true, color: '#cfe0ff', size: 1, speed: 1, intensity: 0.7 },
  { id: 'winter', n: 'Luces de invierno', i: '🎄', cat: 'luz', add: true, color: '#ffd98a', size: 1, speed: 1, intensity: 0.7 },
  { id: 'stellar', n: 'Estelar', i: '💫', cat: 'luz', add: true, color: '#dfe9ff', size: 1, speed: 1, intensity: 0.7 },
  { id: 'spotlight', n: 'Reflector celestial', i: '🔦', cat: 'luz', add: true, color: '#fff3cf', size: 1, speed: 1, intensity: 0.7 },
  { id: 'shards', n: 'Fragmentos de estrella', i: '🌠', cat: 'luz', add: true, color: '#ffe08a', size: 1, speed: 1, intensity: 0.7 },
  { id: 'callejuela', n: 'Callejuela', i: '🌟', cat: 'luz', add: true, color: '#ffbf4d', size: 1, speed: 1, intensity: 0.8 },
  { id: 'perroForma', n: 'Perro forma', i: '🫧', cat: 'luz', add: true, color: '#e7a3a0', size: 1, speed: 1, intensity: 0.8 },
  { id: 'ascuas', n: 'Ascuas', i: '🔴', cat: 'luz', add: true, color: '#e8461c', size: 1, speed: 1, intensity: 0.8 },
  { id: 'luciernagas', n: 'Luciérnagas', i: '🟠', cat: 'luz', add: true, color: '#d9861c', size: 1, speed: 1, intensity: 0.8 },
  // --- ambiente ---
  { id: 'fire', n: 'Fuego', i: '🔥', add: true, color: '#ff7a1a', size: 1, speed: 1, intensity: 0.7 },
  { id: 'embers', n: 'Brasas', i: '✨', add: true, color: '#ff9a3c', size: 1, speed: 1, intensity: 0.6 },
  { id: 'fog', n: 'Niebla', i: '🌫️', add: false, color: '#ffffff', size: 1, speed: 1, intensity: 0.6 },
  { id: 'smoke', n: 'Humo', i: '💨', add: false, color: '#cfcfcf', size: 1, speed: 1, intensity: 0.6 },
  { id: 'snow', n: 'Nieve', i: '❄️', add: false, color: '#ffffff', size: 1, speed: 1, intensity: 0.6 },
  { id: 'rain', n: 'Lluvia', i: '🌧️', add: false, color: '#cfe3ff', size: 1, speed: 1, intensity: 0.6 },
  { id: 'sparkles', n: 'Destellos', i: '⭐', add: true, color: '#fff2b0', size: 1, speed: 1, intensity: 0.6 },
  { id: 'dust', n: 'Polvo dorado', i: '🌟', add: true, color: '#ffd36b', size: 1, speed: 1, intensity: 0.6 },
  { id: 'bokeh', n: 'Bokeh', i: '🔵', add: true, color: '#ffcf8a', size: 1, speed: 1, intensity: 0.5 },
  { id: 'rays', n: 'Rayos de luz', i: '🌅', add: true, color: '#fff1c2', size: 1, speed: 1, intensity: 0.6 },
  { id: 'confetti', n: 'Confeti', i: '🎉', add: false, color: '#ffffff', size: 1, speed: 1, intensity: 0.6 },
  { id: 'hearts', n: 'Corazones', i: '💗', add: false, color: '#ff4f8b', size: 1, speed: 1, intensity: 0.5 },
  { id: 'petals', n: 'Pétalos', i: '🌸', add: false, color: '#ffb7d0', size: 1, speed: 1, intensity: 0.5 },
  { id: 'leaves', n: 'Hojas', i: '🍃', add: false, color: '#8fbf5a', size: 1, speed: 1, intensity: 0.5 },
];

// Efectos de imagen (post-proceso sobre todo el fotograma)
export const POSTFX = [
  { id: 'glitch', n: 'Glitch', i: '📺', intensity: 0.7 },
  { id: 'rgb', n: 'Separación RGB', i: '🌈', intensity: 0.6 },
  { id: 'vhs', n: 'VHS antiguo', i: '📼', intensity: 0.7 },
  { id: 'grain', n: 'Grano de película', i: '🎞️', intensity: 0.6 },
  { id: 'shake', n: 'Cámara temblando', i: '📳', intensity: 0.5 },
  { id: 'flash', n: 'Flashes', i: '⚡', intensity: 0.6 },
  { id: 'pulse', n: 'Latido de zoom', i: '💓', intensity: 0.5 },
  { id: 'blur', n: 'Desenfoque', i: '🫧', intensity: 0.6 },
  { id: 'pixel', n: 'Pixelado', i: '🟦', intensity: 0.5 },
  { id: 'mirror', n: 'Espejo', i: '🪞', intensity: 1 },
  { id: 'bw', n: 'Blanco y negro', i: '⚫', intensity: 1 },
  { id: 'sepia', n: 'Sepia', i: '🟤', intensity: 0.8 },
  { id: 'vignette', n: 'Viñeta oscura', i: '🕳️', intensity: 0.6 },
  { id: 'glow', n: 'Resplandor', i: '🌟', intensity: 0.6 },
];
