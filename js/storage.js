// Guardado automático en el navegador (IndexedDB): proyecto + archivos de medios.
const DB = 'editor-video-db';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('media');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
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

export async function saveProject(project, mediaMap) {
  try {
    const usedIds = new Set(project.clips.map((c) => c.media).filter(Boolean));
    for (const m of mediaMap.values()) {
      if (!m.saved) {
        await tx('media', 'readwrite', (s) => s.put({ id: m.id, name: m.name, kind: m.kind, blob: m.blob, w: m.w, h: m.h, duration: m.duration, thumb: m.thumb }, m.id));
        m.saved = true;
      }
    }
    await tx('kv', 'readwrite', (s) => s.put(JSON.stringify(project), 'project'));
    // limpia medios no usados
    const keys = await tx('media', 'readonly', (s) => s.getAllKeys());
    for (const k of keys || []) {
      if (!mediaMap.has(k) && !usedIds.has(k)) await tx('media', 'readwrite', (s) => s.delete(k));
    }
    return true;
  } catch (e) {
    return false;
  }
}

export async function loadSaved() {
  try {
    const p = await tx('kv', 'readonly', (s) => s.get('project'));
    if (!p) return null;
    const recs = await tx('media', 'readonly', (s) => s.getAll());
    return { project: JSON.parse(p), media: recs || [] };
  } catch (e) {
    return null;
  }
}

export async function clearSaved() {
  try {
    await tx('kv', 'readwrite', (s) => s.clear());
    await tx('media', 'readwrite', (s) => s.clear());
  } catch (e) { /* nada */ }
}
