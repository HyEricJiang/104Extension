const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const VERSION = require('../manifest.json').version;

function popup(state, save = async () => ({ok: true})) {
  const elements = new Map();
  const calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', options: [{value: ''}], disabled: true,
      querySelectorAll: () => [], setAttribute() {}, append(option) {this.options.push(option);}
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    console, URL, setTimeout, clearTimeout,
    document: {getElementById: element, querySelectorAll: () => [], addEventListener() {}},
    chrome: {
      runtime: {getManifest: () => ({version: VERSION}), onMessage: {addListener() {}}},
      storage: {local: {get: async () => ({})}}
    },
    ResumeTrainingLabels: {trainingFilename: () => 'AI訓練資料_Test.pdf'}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), context);
  context.sendClassification = async message => {
    calls.push(message);
    return message.type === 'TOOLKIT_GET_CLASSIFIER_STATE' ? state : save(message);
  };
  return {context, element, calls};
}
const current = () => ({ok: true, canClassify: true, resumeKey: 'search:TEST1',
  trainingLabel: '系統推薦但不合適', reason: '', serviceVersion: VERSION,
  capabilities: {trainingReason: true}, jobGroups: []});

test('舊背景仍能讀標籤時，停用原因並提供完整更新方法', async () => {
  // v1.5.1 的狀態沒有原因能力與服務版本，但仍能正常下標籤。
  const h = popup({ok: true, canClassify: true, trainingLabel: '系統推薦但不合適', jobGroups: []});
  await h.context.refreshClassification();
  assert.equal(h.element('classificationGroup').textContent, '系統推薦但不合適');
  assert.equal(h.element('trainingReason').disabled, true);
  assert.match(h.element('reasonStatus').textContent, /chrome:\/\/extensions.*重新載入/);
  assert.match(h.element('reasonStatus').textContent, /請勿移除/);
  h.context.saveCurrentReason();
  assert.equal(h.calls.length, 1);
});

test('背景宣告原因能力但版本不同時，禁止使用混合版本', async () => {
  const h = popup({...current(), serviceVersion: '1.8.0'});
  await h.context.refreshClassification();
  assert.equal(h.element('trainingReason').disabled, true);
  assert.equal(h.element('toolkitVersion').textContent, `工作台 v${VERSION}／背景 1.8.0`);
});

test('相容背景可以儲存、修改及清空原因，帶入同一履歷識別', async () => {
  const writes = [];
  const h = popup(current(), async message => {writes.push(message); return {ok: true};});
  await h.context.refreshClassification();
  assert.equal(h.element('trainingReason').disabled, false);
  for (const reason of ['缺乏 Java 經驗', '需要主管確認', '']) {
    h.element('trainingReason').value = reason;
    h.context.saveCurrentReason();
    assert.equal(await h.context.ensureReasonSaved(), true);
    assert.equal(writes.at(-1).resumeKey, 'search:TEST1');
    assert.equal(writes.at(-1).reason, reason);
  }
  assert.equal(h.element('reasonStatus').textContent, '原因已清空');
});

test('重現截圖的舊背景錯誤：保留輸入並阻止更新標籤及匯出遺漏原因', async () => {
  const h = popup(current(), async () => ({ok: false, error: '不支援這個分類操作。'}));
  await h.context.refreshClassification();
  h.element('trainingReason').value = '尚未儲存的重要原因';
  h.context.saveCurrentReason();
  assert.equal(await h.context.ensureReasonSaved(), false);
  assert.equal(h.element('trainingReason').value, '尚未儲存的重要原因');
  assert.equal(h.element('trainingReason').disabled, true);
  assert.match(h.element('reasonStatus').textContent, /背景服務版本不相容/);
  const before = h.calls.length;
  await h.context.classifyCurrent('reviewedShouldRecommend');
  await h.context.startPdf('downloadCurrent');
  assert.equal(h.calls.length, before);
  assert.match(h.element('pdfStatus').textContent, /原因尚未儲存/);
});

test('儲存失敗不回報成功，保留文字且修正後可再次儲存', async () => {
  let fails = true;
  const h = popup(current(), async () => {if (fails) throw Error('儲存空間不足'); return {ok: true};});
  await h.context.refreshClassification();
  h.element('trainingReason').value = '草稿內容';
  h.context.saveCurrentReason();
  assert.equal(await h.context.ensureReasonSaved(), false);
  assert.match(h.element('reasonStatus').textContent, /儲存空間不足/);
  assert.equal(h.element('trainingReason').value, '草稿內容');
  fails = false;
  h.context.saveCurrentReason();
  assert.equal(await h.context.ensureReasonSaved(), true);
  assert.equal(h.element('reasonStatus').textContent, '原因已自動儲存');
});
