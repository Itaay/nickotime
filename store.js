// IndexedDB on the device only. 'kv' holds the app state, 'photos' holds JPEG data URLs.
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open('nickotime', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function tx(store, mode, fn) {
  const db = await dbp;
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const get = (s, k) => tx(s, 'readonly', o => o.get(k));
export const put = (s, k, v) => tx(s, 'readwrite', o => o.put(v, k));
export const del = (s, k) => tx(s, 'readwrite', o => o.delete(k));
export const clear = s => tx(s, 'readwrite', o => o.clear());
export async function getAll(s) {
  const [keys, vals] = await Promise.all([tx(s, 'readonly', o => o.getAllKeys()), tx(s, 'readonly', o => o.getAll())]);
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
}
