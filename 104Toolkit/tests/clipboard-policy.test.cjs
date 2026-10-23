const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "clipboard-policy.js"),
  "utf8"
);

function loadPolicy() {
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.globalThis.RecruitingClipboardPolicy;
}

test("背景頁失焦時仍回報資料整理完成，不顯示複製失敗", () => {
  const policy = loadPolicy();
  const result = policy.resolveCompletion("本頁資料已整理完成", {
    ok: false,
    error: "Failed to execute 'writeText' on 'Clipboard': Document is not focused."
  });

  assert.equal(result.clipboardState, "focus-fallback");
  assert.equal(result.message, "本頁資料已整理完成，可直接貼上使用");
  assert.doesNotMatch(result.message, /失敗|Failed|not focused/i);
});

test("剪貼簿成功時維持明確的成功訊息", () => {
  const policy = loadPolicy();
  const result = policy.resolveCompletion("全部分頁資料已整理完成", { ok: true });

  assert.equal(result.clipboardState, "copied");
  assert.equal(result.message, "全部分頁資料已整理完成，已複製到剪貼簿");
});
