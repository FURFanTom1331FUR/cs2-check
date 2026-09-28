// Последние разобранные матчи в IndexedDB (только сводка, без самой демки).
const DB = "cs2-check";
const STORE = "matches";
const KEEP = 5;

function open() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) return reject(new Error("no idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(out?.result ?? out);
  t.onerror = () => reject(t.error);
});

export function matchId(match) {
  const m = match.meta;
  return `${m.fileName}|${m.fileSize}|${m.map}`;
}

// Компактная копия для хранения: без урона/выстрелов/гранат (их можно получить повторным разбором).
export function summarize(match, stats) {
  const { damages, shots, grenades, ...rest } = match;
  return { ...rest, stats };
}

export async function saveMatch(match, stats) {
  try {
    const db = await open();
    const rec = { id: matchId(match), savedAt: Date.now(), data: summarize(match, stats) };
    await tx(db, "readwrite", (s) => s.put(rec));
    const all = await listMatches();
    for (const old of all.slice(KEEP)) await tx(db, "readwrite", (s) => s.delete(old.id));
  } catch { /* IndexedDB недоступна (приватный режим) — просто не сохраняем */ }
}

export async function listMatches() {
  try {
    const db = await open();
    const req = await tx(db, "readonly", (s) => s.getAll());
    return (req || []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function deleteMatch(id) {
  try {
    const db = await open();
    await tx(db, "readwrite", (s) => s.delete(id));
  } catch { /* ignore */ }
}
