(() => {
  "use strict";
  const META_KEY = "output_directory_v1";
  const DB_NAME = "104-toolkit-output";
  const STORE = "handles";
  let writes = Promise.resolve();

  function storedHandle(operation, value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(new Error("無法開啟資料夾設定，請重新選擇資料夾。"));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE, operation === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore(STORE);
        const item = operation === "get" ? store.get("selected") : store.put(value, "selected");
        let result;
        item.onsuccess = () => { result = item.result; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(new Error("無法保存資料夾設定，請重新選擇。")); };
      };
    });
  }
  async function set(handle) {
    if (handle?.kind !== "directory") throw new Error("請選擇資料夾。");
    if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("未取得此資料夾的存取許可。");
    await storedHandle("put", handle);
    await chrome.storage.local.set({ [META_KEY]: { enabled: true, name: handle.name } });
  }
  async function status() {
    const data = (await chrome.storage.local.get(META_KEY))[META_KEY];
    return data?.enabled ? { selected: true, name: data.name } : { selected: false, name: "瀏覽器預設下載位置" };
  }
  async function getSavedHandle() {
    return (await status()).selected ? storedHandle("get") : null;
  }
  async function getTarget() {
    if (!(await status()).selected) return null;
    const handle = await getSavedHandle();
    if (!handle || await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error("所選資料夾需要重新授權，請重新開始匯出並在工具頁授權原資料夾。檔案尚未儲存。");
    }
    return handle;
  }
  async function useDefault() {
    await chrome.storage.local.set({ [META_KEY]: { enabled: false, name: "" } });
  }
  async function writeFile(target, filename, data) {
    if (!target) throw new Error("尚未選擇資料夾。");
    if (!filename || /[\\/]/.test(filename) || filename === "." || filename === "..") throw new Error("檔名格式不正確。");
    const task = writes.catch(() => {}).then(async () => {
      if (await target.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("資料夾存取許可已失效，請重新選擇資料夾。");
      const dot = filename.lastIndexOf(".");
      const base = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : "";
      let actualName;
      for (let index = 0; index < 10000; index++) {
        const candidate = index ? `${base} (${index})${ext}` : filename;
        try { await target.getFileHandle(candidate); }
        catch (error) {
          if (error.name === "TypeMismatchError") continue;
          if (error.name !== "NotFoundError") throw error;
          actualName = candidate; break;
        }
      }
      if (!actualName) throw new Error("同名檔案過多，請更換資料夾。");
      const file = await target.getFileHandle(actualName, { create: true });
      const stream = await file.createWritable();
      try { await stream.write(data); await stream.close(); }
      catch (error) { try { await stream.abort(); } catch (_) {} throw error; }
      return { filename: actualName, path: `${target.name}/${actualName}`, directWrite: true };
    });
    writes = task;
    return task;
  }
  const api = Object.freeze({ set, status, getSavedHandle, getTarget, useDefault, writeFile });
  globalThis.RecruitingOutputDirectory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
