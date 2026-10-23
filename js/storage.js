// Guardado en el navegador (IndexedDB): varios proyectos + los archivos de medios.
// El proyecto (texto) se guarda siempre primero y por separado de los vídeos: si un vídeo es tan grande
// que el iPad no deja guardarlo, el resto del proyecto se conserva igualmente.
const DB = 'editor-video-db';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const n of ['kv', 'media', 'projects']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

// Pide al navegador que no borre estos datos cuando necesite espacio (en iPad ayuda mucho)
export async function askPersistent() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* nada */ }
  return false;
}

export async function storageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    }
  } catch (e) { /* nada */ }
  return null;
}

function mediaIds(project) {
  return [...new Set(project.clips.map((c) => c.media).filter(Boolean))];
}

// Guarda el proyecto actual. Devuelve { ok, failed: [nombres de medios que no se pudieron guardar] }
export async function saveProject(project, mediaMap) {
  const out = { ok: false, failed: [] };
  try {
    const ids = mediaIds(project);
    const first = ids.map((i) => mediaMap.get(i)).find((m) => m && m.thumb);
    const dur = project.clips.reduce((a, c) => Math.max(a, c.start + c.dur), 0);
    const rec = {
      id: project.id, name: project.name, aspect: project.aspect, updated: Date.now(),
      dur, count: project.clips.length, thumb: first ? first.thumb : '', media: ids, json: JSON.stringify(project),
    };
    await tx('projects', 'readwrite', (s) => s.put(rec, rec.id));
    await tx('kv', 'readwrite', (s) => s.put(rec.id, 'current'));
    out.ok = true;
  } catch (e) {
    return out;
  }
  // los medios, uno a uno: si uno falla (p. ej. un vídeo enorme), los demás se guardan igual
  for (const m of mediaMap.values()) {
    if (m.saved || m.saveFailed) continue;
    try {
      await tx('media', 'readwrite', (s) => s.put({ id: m.id, name: m.name, kind: m.kind, blob: m.blob, w: m.w, h: m.h, duration: m.duration, thumb: m.thumb }, m.id));
      m.saved = true;
    } catch (e) {
      m.saveFailed = true;
      out.failed.push(m.name);
    }
  }
  try { await cleanupMedia(mediaMap); } catch (e) { /* nada */ }
  return out;
}

// borra medios que ya no usa ningún proyecto
async function cleanupMedia(mediaMap) {
  const recs = (await tx('projects', 'readonly', (s) => s.getAll())) || [];
  const used = new Set();
  for (const r of recs) for (const i of r.media || []) used.add(i);
  if (mediaMap) for (const k of mediaMap.keys()) used.add(k);
  const keys = (await tx('media', 'readonly', (s) => s.getAllKeys())) || [];
  for (const k of keys) if (!used.has(k)) await tx('media', 'readwrite', (s) => s.delete(k));
}

async function readProject(rec) {
  const project = JSON.parse(rec.json);
  project.id = rec.id;
  const media = [];
  for (const id of rec.media || []) {
    try {
      const m = await tx('media', 'readonly', (s) => s.get(id));
      if (m) media.push(m);
    } catch (e) { /* medio perdido */ }
  }
  return { project, media, missing: (rec.media || []).length - media.length };
}

// El proyecto con el que se cerró la app la última vez (también recoge el formato antiguo de un solo proyecto)
export async function loadSaved() {
  try {
    const cur = await tx('kv', 'readonly', (s) => s.get('current'));
    if (cur) {
      const rec = await tx('projects', 'readonly', (s) => s.get(cur));
      if (rec) return await readProject(rec);
    }
    const old = await tx('kv', 'readonly', (s) => s.get('project'));
    if (old) {
      const project = JSON.parse(old);
      project.id = project.id || 'p' + Date.now().toString(36);
      const all = (await tx('media', 'readonly', (s) => s.getAll())) || [];
      return { project, media: all, missing: 0 };
    }
  } catch (e) { /* nada */ }
  return null;
}

export async function listProjects() {
  try {
    const recs = (await tx('projects', 'readonly', (s) => s.getAll())) || [];
    return recs.map(({ json, ...meta }) => meta).sort((a, b) => b.updated - a.updated);
  } catch (e) {
    return [];
  }
}

export async function openSavedProject(id) {
  const rec = await tx('projects', 'readonly', (s) => s.get(id));
  return rec ? readProject(rec) : null;
}

export async function deleteProject(id, mediaMap) {
  try {
    await tx('projects', 'readwrite', (s) => s.delete(id));
    await cleanupMedia(mediaMap);
  } catch (e) { /* nada */ }
}
