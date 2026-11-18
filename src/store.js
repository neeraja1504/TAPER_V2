/* Storage.
 *   IndexedDB "taper-latex": papers, translations, renders (compiled PDFs), quizzes.
 *   localStorage "taper2:*": settings, profiles, study log, UI state.
 * Everything stays in this browser. Use Library → Export to back it up or move it.
 */
const DB_NAME = "taper-latex", DB_VER = 1;
const STORES = ["papers", "translations", "renders", "quizzes"];
let dbp = null;

function openDb() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function run(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Storage transaction aborted (the browser may be out of space)."));
  });
}
export const db = {
  get: (s, id) => run(s, "readonly", st => st.get(id)),
  put: (s, obj) => run(s, "readwrite", st => st.put(obj)),
  del: (s, id) => run(s, "readwrite", st => st.delete(id)),
  all: (s) => run(s, "readonly", st => st.getAll()),
  keys: (s) => run(s, "readonly", st => st.getAllKeys()),
  clear: (s) => run(s, "readwrite", st => st.clear())
};

/* Deletes a paper and everything made from it. */
export async function deletePaper(paperId) {
  for (const s of ["translations", "renders", "quizzes"]) {
    const rows = await db.all(s);
    for (const r of rows) if (r.paperId === paperId) await db.del(s, r.id);
  }
  await db.del("papers", paperId);
}
export async function deleteTranslation(trId) {
  const [paperId, lang] = trId.split("|");
  for (const s of ["renders", "quizzes"]) {
    const rows = await db.all(s);
    for (const r of rows) if (r.paperId === paperId && r.lang === lang) await db.del(s, r.id);
  }
  await db.del("translations", trId);
}

export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return null; }
}

export const local = {
  get(k, d) { try { const v = localStorage.getItem("taper2:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("taper2:" + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem("taper2:" + k); } catch { /* ignore */ } }
};

export async function sha256(bytes) {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
