const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../104-hide-resume-cards.user.js'), 'utf8');

// 用虛構代碼、虛擬時間及 DOM 狀態模擬慢載入,不連線 104。
function harness(options = {}) {
  let time = 0, sleeps = 0, page = 1, signature = '90000001|90000002', clicked = 0;
  let onSleep = options.onSleep || (() => {});
  const listeners = new Map();
  function node() {
    const n = { style: {}, dataset: {}, children: [],
      addEventListener() {}, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      setAttribute() {}, removeAttribute() {}, querySelector(selector) { return this.parts?.[selector] || null; }
    };
    Object.defineProperty(n, 'innerHTML', { get() { return this.html || ''; }, set(html) {
      this.html = html; this.parts = {};
      for (const attr of html.matchAll(/\b(data-screening-[\w-]+)/g)) this.parts[`[${attr[1]}]`] = node();
    }});
    return n;
  }
  const next = { textContent: '下一頁', disabled: false, classList: { contains: () => false },
    getAttribute: () => '', closest: () => null, scrollIntoView() {}, click() { clicked += 1; } };
  let showNext = options.showNext !== false;
  const doc = { hidden: false, body: node(), head: node(), documentElement: { scrollHeight: 1000 },
    scrollingElement: { scrollHeight: 1000 }, createElement: node, getElementById: () => null,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    querySelector(selector) {
      if (options.profileHref && selector.includes('aria-current')) return null;
      if (options.profileHref) return { getAttribute: () => options.profileHref };
      return selector.includes('aria-current') ? { textContent: String(page) } : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('.code')) return signature.split('|').filter(Boolean).map(code => ({ textContent: code }));
      if (selector.startsWith('.pagination') || selector === 'button, a') return showNext ? [next] : [];
      return [];
    }
  };
  const win = { scrollY: 0, innerHeight: 1000, addEventListener() {}, scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(y, 0)); } };
  class ClockDate extends Date { static now() { return time; } }
  const ctx = { __RESUME_SCREENING_TEST_MODE__: true, document: doc, window: win,
    location: { pathname: '/test-fixture', origin: 'https://example.invalid' },
    console, Date: ClockDate, localStorage: { getItem: () => null, removeItem() {} },
    setTimeout(resolve, delay) {
      sleeps += 1; time += options.timerDelay || delay;
      if (sleeps > 2000) throw new Error('fixture runaway');
      onSleep({ time, sleeps }); resolve();
    }
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { api: ctx.__RESUME_SCREENING_TEST_API__, doc, listeners,
    advance(ms) { time += ms; }, get time() { return time; }, get clicked() { return clicked; },
    set signature(value) { signature = value; }, set page(value) { page = value; },
    set showNext(value) { showNext = value; }, set onSleep(fn) { onSleep = fn; },
    visibility(hidden) { doc.hidden = hidden; listeners.get('visibilitychange')?.(); }
  };
}
const cards = count => new Map(Array.from({ length: count }, (_, i) => [String(90000001 + i), {}]));

test('持續增加資料超過原本 22 秒仍不逾時', () => {
  const h = harness(); const clock = h.api.createScanClock();
  const watchdog = h.api.createProgressWatchdog(22000, clock.now);
  for (let i = 0; i < 300; i += 1) { h.advance(1000); assert.equal(watchdog.stalled(String(i)), false); }
  assert.ok(h.time > 22000); clock.dispose(); assert.equal(h.listeners.size, 0);
});
test('背景十分鐘不消耗停滯額度,回到前景後才判斷真停滯', () => {
  const h = harness(); const clock = h.api.createScanClock(); const watchdog = h.api.createProgressWatchdog(22000, clock.now);
  assert.equal(watchdog.stalled('50'), false);
  h.visibility(true); h.advance(600000); assert.equal(watchdog.stalled('50'), false);
  h.visibility(false);
  for (let i = 0; i < 4; i++) { h.advance(5000); assert.equal(watchdog.stalled('50'), false); }
  h.advance(2001); assert.equal(watchdog.stalled('50'), true);
});
test('749/972 不允許進第二階段;未知總數必須確認末頁', () => {
  const h = harness();
  assert.throws(() => h.api.assertCollectionComplete(cards(749), 972), /仍缺 223 份/);
  assert.throws(() => h.api.assertCollectionComplete(cards(50), 0), /總數未知/);
  assert.doesNotThrow(() => h.api.assertCollectionComplete(cards(972), 972));
  assert.doesNotThrow(() => h.api.assertCollectionComplete(cards(50), 0, true));
});
test('慢載入 972 份、超過 22 秒時收集持續進行至總數達標', async () => {
  const h = harness(); const map = cards(50);
  h.onSleep = ({ sleeps }) => {
    if (sleeps % 2 === 0 && map.size < 972) {
      const nextSize = Math.min(972, map.size + 20);
      while (map.size < nextSize) map.set(String(90000001 + map.size), {});
      h.signature = [...map.keys()].join('|');
    }
  };
  await h.api.scrollUntilStable(map, 972);
  assert.ok(h.time > 22000); assert.equal(map.size, 972);
  assert.doesNotThrow(() => h.api.assertCollectionComplete(map, 972));
});
test('翻頁不以頁碼先改或同頁新增卡片作為換頁成功', () => {
  const { api } = harness();
  assert.equal(api.pageTransitionReady('1|2', '1|2', 1, 2), false);
  assert.equal(api.pageTransitionReady('1|2', '1|2|3', 1, 1), false);
  assert.equal(api.pageTransitionReady('1|2', '3|4', 1, 2), true);
  assert.equal(api.pageTransitionReady('1|2', '3|4', 1, 1), true);
});
test('切分頁後翻頁延遲逾 14 秒仍等到新卡片,不以第一頁結算', async () => {
  const h = harness({ timerDelay: 60000 }); const map = cards(50); const clock = h.api.createScanClock();
  h.visibility(true);
  h.onSleep = ({ sleeps }) => { if (sleeps === 4) { h.page = 2; h.signature = '91000001|91000002'; } };
  assert.equal(await h.api.goNextPage(map, 972, clock), true);
  assert.equal(h.clicked, 1); assert.ok(h.time >= 240000);
  assert.throws(() => h.api.assertCollectionComplete(map, 972), /收集未完成/);
});
test('已知還缺資料但下一頁按鈕延遲出現時繼續等待', async () => {
  const h = harness({ showNext: false }); const clock = h.api.createScanClock();
  h.onSleep = ({ sleeps }) => {
    if (sleeps === 3) h.showNext = true;
    if (sleeps === 5) { h.page = 2; h.signature = '91000001'; }
  };
  assert.equal(await h.api.goNextPage(cards(50), 972, clock), true);
  assert.equal(h.clicked, 1);
});
test('前景真正卡住翻頁時回報未完成,不回傳末頁成功', async () => {
  const h = harness({ showNext: false }); const clock = h.api.createScanClock();
  await assert.rejects(h.api.goNextPage(cards(50), 972, clock), /尚未找到可用的下一頁/);
});
test('進第二階段前程式一定檢核完整性,沒有固定總耗時結算或固定批數上限', () => {
  const scan = source.slice(source.indexOf('  async function scan()'));
  assert.ok(scan.indexOf('assertCollectionComplete(') < scan.indexOf('await enrichResumeDetails('));
  assert.doesNotMatch(source, /先用目前已(?:載入|收集)履歷結算|Date\.now\(\) - startedAt|batch <= expectedPages/);
});
test('單頁只載入 30 份時不能因頁尾穩定跳過另外 20 份', async () => {
  const h = harness(); const map = cards(30); h.signature = [...map.keys()].join('|');
  h.onSleep = ({ time }) => {
    if (time >= 30000 && map.size < 50) {
      while (map.size < 50) map.set(String(90000001 + map.size), {});
      h.signature = [...map.keys()].join('|');
    }
  };
  await h.api.scrollUntilStable(map, 100);
  assert.equal(map.size, 50); assert.ok(h.time >= 30000);
  assert.throws(() => h.api.assertCollectionComplete(map, 100), /仍缺 50 份/);
});

test('頁碼可從編碼連結取得,不完整 URL 編碼不造成中斷', () => {
  assert.equal(harness({ profileHref: '%7B%22page%22%3A%20%2017%7D' }).api.currentPageNumber(), 17);
  assert.doesNotThrow(() => harness({ profileHref: '%bad%url' }).api.currentPageNumber());
});
