const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"),
);

test("manifest 使用 MV3 並保持最小權限", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["tabGroups"]);
  assert.equal(manifest.host_permissions, undefined);
});

test("內容腳本只會注入指定的 104 頁面", () => {
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["https://vip.104.com.tw/search/SearchResumeMaster*"],
      js: ["content.js"],
      run_at: "document_idle",
    },
  ]);
});

test("manifest 引用的程式檔案都存在", () => {
  const referencedFiles = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];

  for (const relativePath of referencedFiles) {
    assert.equal(
      fs.existsSync(path.join(projectRoot, relativePath)),
      true,
      `找不到 ${relativePath}`,
    );
  }
});
