// ==UserScript==
// @name         104 Resume Screening Unified
// @namespace    local.104-hide-resume-cards
// @version      4.1.2
// @description  Scan, filter, label, score, and reorder 104 VIP resume cards with shared Google Sheet rules.
// @match        https://vip.104.com.tw/search/searchResult*
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      *.104.com.tw
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CARD_SELECTOR = '[data-qa-id="resumeCard"].vip-resume-card, [data-qa-id="resumeCard"].resume-card';
  const CODE_SELECTOR = ".resume-card__center .supportInfo-wrap .code, .supportInfo-wrap .code";
  const PROFILE_LINK_SELECTOR = 'a.name[href], .user-photo a[href]';
  const NAME_SELECTOR = ".userInfo-wrap a.name, a.name.word-break-all";
  const EDUCATION_SELECTOR = '[data-qa-id="cardEducation"], #education-component > div > div > div.py-3';
  const MILITARY_SELECTOR = '#info-component > div.mode-browser.mode-locale-zhTW > div > div.add-on__wrapper > div > div > div > div > div > div > div:nth-child(1) > div.col.t3 > span:nth-child(3)';
  const PREFER_TITLE_SELECTORS = Object.freeze([
    '[data-qa-id="cardPreferJobTitle"]',
    '#info-component > div.mode-browser.mode-locale-zhTW > div > div.rounded.position-relative > div > div > div.info.mb-4.form-element-theme-container-fluid > div > div.col.info-container > div.row.no-gutters.mt-4.texts > div > div.live.mb-4.text-gray-darker.h4 > span:nth-child(3)',
    '#jobCondition-component > div > div > div.py-4.py-md-6.r3.form-element-theme-container-fluid > div:nth-child(8) > div:nth-child(2)'
  ]);
  const PREFER_TITLE_SELECTOR = PREFER_TITLE_SELECTORS.join(", ");
  const WORK_EXPERIENCE_SELECTOR = '[data-qa-id="cardWorkExperience"]';
  const LANGUAGE_SELECTOR = '#language-component > div > div > div.py-4';
  const CERTIFICATE_SELECTOR = '#certificate-component > div > div';
  const EXPECTED_SALARY_SELECTOR = '#jobCondition-component > div > div > div.py-4.py-md-5.r3.form-element-theme-container-fluid > div > div:nth-child(4) > div.col.d-flex > div';
  const CURRENT_SALARY_SELECTOR = '#experience-component > div > div > div > div.pt-3.pb-2 > div:nth-child(2) > div > div:nth-child(1) > div > div > div > div.col.pr-0.pl-3.pl-md-0 > div > div.col-12.col-md.px-0.ml-0.ml-md-5 > div.experience-time-list__other-info.t4 > span:nth-child(2)';
  const DETAIL_CORE_SECTION_SELECTOR = [
    '#experience-component',
    '#education-component',
    '#skill-component',
    '#skills-component',
    '#speciality-component',
    '#project-component',
    '#projects-component',
    '#portfolio-component',
    '#autobiography-component'
  ].join(', ');
  const JOB_HISTORY_SELECTOR = ".content-list li";
  const PAGE_SIZE = 50;
  const FAST_SCROLL_DELAY_MS = 110;
  const BOTTOM_LOAD_WAIT_MS = 3200;
  const BOTTOM_STABLE_ROUNDS = 5;
  const FINAL_BOTTOM_SETTLE_ROUNDS = 4;
  const SCROLL_HEIGHT_STABLE_ROUNDS = 2;
  const MONTHS_TO_HIDE = 3;
  const PANEL_POSITION_KEY = "resume-screening-104-panel-position";
  const RULES_API_URL = "https://script.google.com/a/macros/hy-tech.com.tw/s/AKfycbxkf5Cmf-mulR-MCny4fSppNCyuqV6BpjZul7AQ8mDc1jBVb4FSyTcvyT_OOix3sAXB/exec";
  const SHARED_RULES_CACHE_KEY = "104-hide-resume-cards.shared-rules-cache.v1";
  const DEFAULT_TTL_SECONDS = 60;
  const RISK_ACTION = "review";
  const ENABLE_INLINE_REORDER = true;
  const DEFAULT_OPEN_LIMIT = 0;
  const RANKED_LIST_PAGE_SIZE = 50;
  const BADGE_LIMIT = 4;
  const FILTER_DEBOUNCE_MS = 450;
  const FILTER_MAX_CARDS_PER_PASS = 40;
  const SCAN_STALL_TIMEOUT_MS = 22000;
  const PAGE_CHANGE_TIMEOUT_MS = 14000;
  const DETAIL_REQUEST_CONCURRENCY = 2;
  const DETAIL_REQUEST_MIN_DELAY_MS = 800;
  const DETAIL_REQUEST_MAX_DELAY_MS = 1200;
  const DETAIL_REQUEST_TIMEOUT_MS = 10000;
  const DETAIL_REQUEST_RETRIES = 1;
  const UI = Object.freeze({
    navy: "#0f2742",
    navyHover: "#183b61",
    navySoft: "#eaf0f7",
    ink: "#172033",
    muted: "#657386",
    border: "#d8e0ea",
    borderStrong: "#b9c6d5",
    surface: "#ffffff",
    page: "#f6f8fb",
    success: "#0f6b4f",
    successBg: "#e8f5f0",
    warning: "#96530f",
    warningBg: "#fff4e5",
    danger: "#9f2f18",
    dangerBg: "#fff1ed"
  });

  let isScanning = false;
  let panel;
  let statusNode;
  let startButton;
  let copyButton;
  let quickOpenButton;
  let launcherButton;
  let toggleButton;
  let resultNode;
  let summaryNode;
  let progressFillNode;
  let progressLabelNode;
  let bodyNode;
  let headerNode;
  let shellNode;
  let skippedCards = new Map();
  let latestRanked = [];
  let latestReviewRequired = [];
  let latestExcluded = [];
  let latestAllResults = [];
  let selectedResumeCodes = new Set();
  let openedResumeCodes = new Set();
  let isOpeningProfiles = false;
  let currentResultFilter = "ranked";
  let currentResultPage = 1;
  let latestCardsByCode = new Map();
  let latestScoreByCode = new Map();
  let filterTimer = 0;
  let isCollapsed = true;
  let isPrintHidden = false;
  let scanCancellationRequested = false;
  const cardTextCache = new WeakMap();
  const cardRuleMatchCache = new WeakMap();
  const sharedRuleState = {
    payload: null,
    fetchedAt: 0,
    stale: false,
    statusMessage: ""
  };
  let sharedRulesRefreshPromise = null;

  function mountPanel() {
    if (panel || !document.body) return;
    injectPrintStyle();
    panel = document.createElement("div");
    panel.id = "resume-screening-104-panel";
    panel.style.cssText = [
      "position:fixed",
      "left:auto",
      "top:auto",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:64px",
      "height:64px",
      "padding:0",
      `border:1px solid ${UI.border}`,
      "border-radius:999px",
      "box-shadow:0 18px 42px rgba(15,39,66,.20)",
      `background:${UI.surface}`,
      `color:${UI.ink}`,
      "font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Noto Sans TC',sans-serif",
      "overflow:visible",
      "box-sizing:border-box"
    ].join(";");

    panel.innerHTML = `
      <button data-screening-launch style="width:64px;height:64px;border:0;border-radius:999px;background:${UI.navy};color:#fff;font-weight:900;cursor:pointer;box-shadow:0 14px 32px rgba(15,39,66,.28);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1px;line-height:1.05;" title="開啟 104 履歷掃描">
        <span style="font-size:18px;">104</span>
        <span style="font-size:11px;">掃描</span>
      </button>
      <div data-screening-shell style="display:none;min-height:0;">
        <div data-screening-header style="position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-4px -4px 10px;padding:4px 4px 10px;border-bottom:1px solid ${UI.border};background:${UI.surface};cursor:move;user-select:none;">
          <strong style="color:${UI.navy};font-size:16px;">104 履歷掃描 v4.1.2</strong>
          <button data-screening-toggle style="width:32px;height:30px;border:1px solid ${UI.border};border-radius:8px;background:#fff;color:${UI.navy};font-weight:900;cursor:pointer;" title="收合成右下角按鈕">－</button>
        </div>
        <div data-screening-summary style="margin-bottom:8px;color:${UI.navy};font-size:13px;font-weight:700;">待掃描</div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;color:${UI.muted};font-size:11px;">
            <span>共 4 個處理階段</span>
            <span data-screening-progress-label>0%</span>
          </div>
          <div style="height:8px;border-radius:999px;background:${UI.navySoft};overflow:hidden;border:1px solid ${UI.border};">
            <div data-screening-progress-fill style="width:0%;height:100%;border-radius:999px;background:${UI.navy};transition:width .22s ease;"></div>
          </div>
        </div>
        <select data-role aria-label="搜尋職缺" style="width:100%;padding:8px;margin-bottom:8px;">
          <option value="">請選擇本次篩選職缺</option>
          <option value="java-programmer">Java 工程師</option>
          <option value="csharp-dotnet-programmer">C#/.NET 工程師</option>
          <option value="system-analyst">系統分析師 SA</option>
          <option value="qa-engineer">軟體測試 QA</option>
          <option value="project-manager">專案經理 PM</option>
        </select>
        <div data-screening-status style="margin-bottom:10px;color:${UI.muted};font-size:12px;">會跳過有備註或 3 個月內已發出的人選，並依分數排序</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button data-screening-start style="flex:1;height:36px;border:1px solid ${UI.navy};border-radius:8px;background:${UI.navy};color:#fff;font-weight:700;cursor:pointer;">掃描並依分數排序</button>
          <button data-screening-copy style="height:36px;border:1px solid ${UI.borderStrong};border-radius:8px;background:#fff;color:${UI.navy};font-weight:700;cursor:pointer;">開啟勾選</button>
        </div>
        <button data-screening-quick-open disabled style="width:100%;height:36px;margin-bottom:10px;border:1px solid ${UI.navy};border-radius:8px;background:${UI.navySoft};color:${UI.navy};font-weight:800;cursor:pointer;">掃描後可開啟前 15 筆</button>
        <div data-screening-body style="display:none;min-height:0;overflow:auto;padding-right:2px;">
          <div data-screening-results style="display:grid;gap:8px;"></div>
        </div>
      </div>
    `;
    document.body.append(panel);

    launcherButton = panel.querySelector("[data-screening-launch]");
    shellNode = panel.querySelector("[data-screening-shell]");
    statusNode = panel.querySelector("[data-screening-status]");
    summaryNode = panel.querySelector("[data-screening-summary]");
    progressFillNode = panel.querySelector("[data-screening-progress-fill]");
    progressLabelNode = panel.querySelector("[data-screening-progress-label]");
    startButton = panel.querySelector("[data-screening-start]");
    copyButton = panel.querySelector("[data-screening-copy]");
    quickOpenButton = panel.querySelector("[data-screening-quick-open]");
    toggleButton = panel.querySelector("[data-screening-toggle]");
    bodyNode = panel.querySelector("[data-screening-body]");
    resultNode = panel.querySelector("[data-screening-results]");
    headerNode = panel.querySelector("[data-screening-header]");
    launcherButton.addEventListener("click", () => setCollapsed(false));
    startButton.addEventListener("click", () => {
      if (isScanning) {
        scanCancellationRequested = true;
        setStatus("正在安全中止掃描，已完成的結果不會送出或永久保存...");
        return;
      }
      scan();
    });
    copyButton.addEventListener("click", openRankedProfiles);
    quickOpenButton.addEventListener("click", openNextUnreadHighScoreProfiles);
    toggleButton.addEventListener("click", () => setCollapsed(true));
    setupPrintAutoHide();
    enablePanelDrag();
    setCollapsed(true);
  }

  function ensurePanel() {
    mountPanel();
    if (!panel) setTimeout(ensurePanel, 300);
  }

  function setStatus(message) {
    mountPanel();
    statusNode.textContent = message;
  }

  function setSummary(message) {
    mountPanel();
    summaryNode.textContent = message;
  }

  function setProgress(percent, label = "") {
    mountPanel();
    const nextPercent = clamp(Number(percent) || 0, 0, 100);
    if (progressFillNode) progressFillNode.style.width = `${nextPercent}%`;
    if (progressLabelNode) progressLabelNode.textContent = label || `${Math.round(nextPercent)}%`;
  }

  function setStageProgress(stageIndex, stageName, completed, total, startPercent, endPercent) {
    const safeCompleted = Math.max(0, Number(completed) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const ratio = safeTotal ? clamp(safeCompleted / safeTotal, 0, 1) : 0;
    const overallPercent = clamp(startPercent + ((endPercent - startPercent) * ratio), 0, 100);
    const countLabel = safeTotal ? `${Math.min(safeCompleted, safeTotal)}/${safeTotal}` : `${safeCompleted}/?`;
    setProgress(overallPercent, `第 ${stageIndex}/4 階段 · ${stageName} ${countLabel}（總完成 ${Math.round(overallPercent)}%）`);
  }

  function setCollapsed(nextCollapsed) {
    isCollapsed = nextCollapsed;
    if (!bodyNode || !launcherButton || !shellNode || !toggleButton || !panel) return;
    launcherButton.style.display = isCollapsed ? "flex" : "none";
    shellNode.style.display = isCollapsed ? "none" : "flex";
    shellNode.style.flexDirection = "column";
    shellNode.style.minHeight = "0";
    shellNode.style.maxHeight = isCollapsed ? "64px" : "calc(76vh - 24px)";
    bodyNode.style.display = isCollapsed ? "none" : "block";
    bodyNode.style.maxHeight = isCollapsed ? "0" : "max(180px, calc(76vh - 190px))";
    toggleButton.textContent = "－";
    panel.style.width = isCollapsed ? "64px" : "420px";
    panel.style.height = isCollapsed ? "64px" : "auto";
    panel.style.maxHeight = isCollapsed ? "64px" : "76vh";
    panel.style.padding = isCollapsed ? "0" : "12px";
    panel.style.borderRadius = isCollapsed ? "999px" : "8px";
    panel.style.overflow = isCollapsed ? "visible" : "hidden";
    if (isCollapsed) {
      panel.style.left = "auto";
      panel.style.top = "auto";
      panel.style.right = "18px";
      panel.style.bottom = "18px";
      return;
    }
    applySavedPanelPosition();
    keepPanelInViewport();
  }

  function setupPrintAutoHide() {
    if (setupPrintAutoHide.done) return;
    setupPrintAutoHide.done = true;
    window.addEventListener("beforeprint", hidePanelForPrint);
    window.addEventListener("afterprint", showPanelAfterPrint);
    if (typeof window.matchMedia !== "function") return;
    const printQuery = window.matchMedia("print");
    const handlePrintChange = (event) => {
      if (event.matches) hidePanelForPrint();
      else showPanelAfterPrint();
    };
    if (typeof printQuery.addEventListener === "function") {
      printQuery.addEventListener("change", handlePrintChange);
    } else if (typeof printQuery.addListener === "function") {
      printQuery.addListener(handlePrintChange);
    }
  }

  function injectPrintStyle() {
    if (document.getElementById("resume-screening-104-print-style")) return;
    const style = document.createElement("style");
    style.id = "resume-screening-104-print-style";
    style.textContent = `
      @media print { #resume-screening-104-panel { display: none !important; } }
      [data-resume-shared-rules-badges] {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 6px 0 8px;
        align-items: center;
      }
      .resume-shared-rule-badge {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        min-height: 22px;
        padding: 2px 8px;
        border-radius: 6px;
        border: 1px solid ${UI.border};
        background: ${UI.surface};
        color: ${UI.ink};
        font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans TC", sans-serif;
        white-space: normal;
        word-break: break-word;
        box-sizing: border-box;
      }
      .resume-shared-rule-badge--positive {
        border-color: ${UI.borderStrong};
        background: ${UI.navySoft};
        color: ${UI.navy};
      }
      .resume-shared-rule-badge--risk {
        border-color: #d98b78;
        background: ${UI.dangerBg};
        color: ${UI.danger};
        font-weight: 700;
      }
      .resume-shared-rule-badge--low {
        border-style: dashed;
        opacity: .78;
        font-weight: 500;
      }
      .resume-screening-score-badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 2px 8px;
        border-radius: 6px;
        background: ${UI.navy};
        color: #fff;
        font: 700 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans TC", sans-serif;
      }
      .resume-screening-result-tag {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 2px 8px;
        border: 1px solid ${UI.border};
        border-radius: 999px;
        background: ${UI.page};
        color: ${UI.muted};
        font: 650 11px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans TC", sans-serif;
      }
      .resume-screening-result-tag--skip {
        border-color: ${UI.warning};
        background: ${UI.warningBg};
        color: ${UI.warning};
        font-weight: 800;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function hidePanelForPrint() {
    mountPanel();
    if (!panel) return;
    setCollapsed(true);
    panel.style.display = "none";
    isPrintHidden = true;
  }

  function showPanelAfterPrint() {
    if (!panel || !isPrintHidden) return;
    panel.style.display = "block";
    setCollapsed(true);
    isPrintHidden = false;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getPanelRectFromStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || "null");
      if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return null;
      return saved;
    } catch (_error) {
      return null;
    }
  }

  function setPanelPosition(left, top) {
    if (!panel) return;
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextLeft = clamp(left, margin, maxLeft);
    const nextTop = clamp(top, margin, maxTop);
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({ left: nextLeft, top: nextTop }));
  }

  function applySavedPanelPosition() {
    const saved = getPanelRectFromStorage();
    if (!saved) return;
    requestAnimationFrame(() => setPanelPosition(saved.left, saved.top));
  }

  function keepPanelInViewport() {
    if (!panel || panel.style.left === "auto" || !panel.style.left) return;
    requestAnimationFrame(() => {
      const rect = panel.getBoundingClientRect();
      setPanelPosition(rect.left, rect.top);
    });
  }

  function enablePanelDrag() {
    if (!headerNode || !panel) return;
    let dragState = null;
    headerNode.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      headerNode.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    headerNode.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      setPanelPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    });
    const endDrag = (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState = null;
    };
    headerNode.addEventListener("pointerup", endDrag);
    headerNode.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", keepPanelInViewport);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function includesAny(text, keywords = []) {
    const normalized = normalize(text);
    return keywords.some((keyword) => normalized.includes(normalize(keyword)));
  }

  function countMatches(text, keywords = []) {
    const normalized = normalize(text);
    return keywords.filter((keyword) => normalized.includes(normalize(keyword)));
  }

  function normalizeForMatch(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isEnglishShortToken(term) {
    return /^[a-z0-9+#.]{1,3}$/i.test(term);
  }

  function termMatches(text, term) {
    const normalizedText = normalizeForMatch(text);
    const normalizedTerm = normalizeForMatch(term);
    if (!normalizedTerm) return false;

    if (isEnglishShortToken(normalizedTerm)) {
      const regex = new RegExp("(^|[^a-z0-9])" + escapeRegExp(normalizedTerm) + "([^a-z0-9]|$)", "i");
      return regex.test(normalizedText);
    }

    return normalizedText.includes(normalizedTerm);
  }

  function uniqueTerms(terms) {
    const seen = new Set();
    return (terms || [])
      .map(normalizeText)
      .filter(Boolean)
      .filter((term) => {
        const key = normalizeForMatch(term);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function textsFromSelectors(root, selectors) {
    if (!root || !selectors?.length) return [];
    return uniqueList(selectors.flatMap((selector) => (
      [...root.querySelectorAll(selector)].map((node) => normalizeText(node.textContent))
    )));
  }

  function desiredTitlesFromRoot(root) {
    return textsFromSelectors(root, PREFER_TITLE_SELECTORS)
      .map((text) => text.replace(/^(?:希望|期待)職稱\s*[：:]?\s*/i, "").trim())
      .filter(Boolean);
  }

  function labelledSectionText(root, labelPattern) {
    if (!root) return "";
    const nodes = [...root.querySelectorAll("div, li, dt, dd, span")];
    const labelNode = nodes.find((node) => {
      const ownText = normalizeText(node.textContent);
      return ownText.length <= 180 && labelPattern.test(ownText);
    });
    if (!labelNode) return "";
    const row = labelNode.closest(".row, li, dl, [class*='form-element'], [class*='condition']") || labelNode.parentElement;
    return normalizeText(row?.textContent || labelNode.textContent);
  }

  function parseResumeDetailHtml(html) {
    const source = String(html || "");
    if (!source.trim()) throw new Error("履歷詳情回傳空內容");
    if (/Just a moment|cf-chl|access denied/i.test(source)) {
      throw new Error("履歷詳情需要登入或遭到存取驗證");
    }
    if (typeof DOMParser !== "function") throw new Error("瀏覽器不支援 DOMParser");
    const documentNode = new DOMParser().parseFromString(source, "text/html");
    if (!documentNode?.documentElement) throw new Error("履歷詳情 HTML 無法解析");
    if (/請先登入|尚未登入/i.test(source) && !documentNode.querySelector("#experience-component, #education-component, #jobCondition-component")) {
      throw new Error("履歷詳情需要登入");
    }
    return documentNode;
  }

  function extractResumeDetail(root) {
    const desiredTitles = desiredTitlesFromRoot(root);
    const languageText = normalizeText([...root.querySelectorAll(LANGUAGE_SELECTOR)].map((node) => node.textContent).join(" "));
    const certificateText = normalizeText([...root.querySelectorAll(CERTIFICATE_SELECTOR)].map((node) => node.textContent).join(" "));
    const expectedSalaryText = normalizeText(root.querySelector(EXPECTED_SALARY_SELECTOR)?.textContent)
      || labelledSectionText(root, /希望待遇|期待待遇|希望薪資|期待薪資/);
    const currentSalaryText = normalizeText(root.querySelector(CURRENT_SALARY_SELECTOR)?.textContent)
      || normalizeText([...root.querySelectorAll("#experience-component .experience-time-list__other-info span")]
        .map((node) => normalizeText(node.textContent))
        .find((text) => /^(?:月薪|年薪)/.test(text)));
    const experienceText = normalizeText(root.querySelector("#experience-component")?.textContent);
    const experienceEntries = uniqueList([...root.querySelectorAll("#experience-component div.pt-3.pb-2")]
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean));
    const educationText = normalizeText(root.querySelector("#education-component")?.textContent);
    const coreSections = [...root.querySelectorAll(DETAIL_CORE_SECTION_SELECTOR)]
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);

    return {
      status: coreSections.length ? "loaded" : "partial",
      desiredTitles,
      languageText,
      certificateText,
      expectedSalaryText,
      currentSalaryText,
      experienceText,
      experienceEntries,
      educationText,
      coreEvidenceText: uniqueList(coreSections).join(" | "),
      coreSectionsFound: coreSections.length
    };
  }

  function requestResumeDetail(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error("履歷詳情缺少 URL"));
        return;
      }
      let validatedUrl;
      try {
        validatedUrl = new URL(url, location.origin);
        if (validatedUrl.protocol !== "https:" || !/(^|\.)104\.com\.tw$/i.test(validatedUrl.hostname)) {
          throw new Error("非 104 HTTPS 網址");
        }
      } catch (_error) {
        reject(new Error("履歷詳情 URL 不合法"));
        return;
      }
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("Tampermonkey 尚未提供 GM_xmlhttpRequest"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: validatedUrl.toString(),
        timeout: clientConfigNumber("detailEnrichment", "timeoutMs", DETAIL_REQUEST_TIMEOUT_MS),
        anonymous: false,
        headers: { Accept: "text/html,application/xhtml+xml" },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`履歷詳情 HTTP ${response.status}`));
            return;
          }
          try {
            resolve(extractResumeDetail(parseResumeDetailHtml(response.responseText)));
          } catch (error) {
            reject(error);
          }
        },
        ontimeout: () => reject(new Error("履歷詳情讀取逾時")),
        onerror: () => reject(new Error("履歷詳情連線失敗"))
      });
    });
  }

  async function requestResumeDetailWithRetry(card) {
    let lastError;
    const retries = Math.max(0, Math.floor(clientConfigNumber("detailEnrichment", "retries", DETAIL_REQUEST_RETRIES)));
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await requestResumeDetail(card.profileUrl);
      } catch (error) {
        lastError = error;
        console.warn("resume detail enrichment failed", {
          resumeCode: card.resumeCode,
          attempt: attempt + 1,
          errorType: error?.message || "unknown"
        });
        if (attempt < retries) await sleep(600);
      }
    }
    throw lastError || new Error("履歷詳情讀取失敗");
  }

  function detailRequestDelay(index) {
    const minimum = clientConfigNumber("detailEnrichment", "minDelayMs", DETAIL_REQUEST_MIN_DELAY_MS);
    const maximum = Math.max(minimum, clientConfigNumber("detailEnrichment", "maxDelayMs", DETAIL_REQUEST_MAX_DELAY_MS));
    const spread = Math.max(0, maximum - minimum);
    return minimum + ((index * 97) % (spread + 1));
  }

  function needsDetailEnrichment(roleId, role, card) {
    // 薪資與完整期待職稱是五類職缺共用條件；QA 另需語言與證照，因此所有可讀取的履歷都補強詳情。
    return Boolean(card.profileUrl);
  }

  async function enrichResumeDetails(roleId, role, cards) {
    const targets = cards.filter((card) => needsDetailEnrichment(roleId, role, card));
    if (!targets.length) {
      setStageProgress(2, "詳情補強", 0, 0, 65, 85);
      return { requested: 0, loaded: 0, failed: 0 };
    }

    let cursor = 0;
    let completed = 0;
    let loaded = 0;
    let failed = 0;
    setStageProgress(2, "詳情補強", 0, targets.length, 65, 85);
    async function worker() {
      while (cursor < targets.length && isScanning && !scanCancellationRequested) {
        const index = cursor;
        cursor += 1;
        const card = targets[index];
        setStatus(`第 2/4 階段：正在讀取履歷詳情（已完成 ${completed}/${targets.length}）...`);
        try {
          card.detail = await requestResumeDetailWithRetry(card);
          loaded += 1;
        } catch (error) {
          failed += 1;
          card.detail = {
            status: "failed",
            errorType: normalizeText(error?.message || "履歷詳情讀取失敗")
          };
        }
        completed += 1;
        setStageProgress(2, "詳情補強", completed, targets.length, 65, 85);
        await sleep(detailRequestDelay(index));
      }
    }

    const concurrency = Math.max(1, Math.floor(clientConfigNumber("detailEnrichment", "concurrency", DETAIL_REQUEST_CONCURRENCY)));
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
    return { requested: targets.length, loaded, failed };
  }

  function extractResumeCode(value) {
    const match = normalizeText(value).match(/(?:代碼\s*[：:]?\s*)?(\d{8,})/);
    return match?.[1] || "";
  }

  function parseOutreachHistoryDate(text) {
    const match = String(text || "").match(/(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!match) return null;
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isRecentActiveOutreachText(text, now = new Date(), monthsToHide = MONTHS_TO_HIDE) {
    if (!/發出(?:邀約|面試邀約|職缺邀約|通知|訊息|信件)?/.test(String(text || ""))) return false;
    const historyDate = parseOutreachHistoryDate(text);
    if (!historyDate) return false;
    const currentDate = new Date(now);
    const cutoff = new Date(currentDate);
    cutoff.setMonth(cutoff.getMonth() - monthsToHide);
    cutoff.setHours(0, 0, 0, 0);
    return historyDate >= cutoff && historyDate <= currentDate;
  }

  function skipReasonFromSignals({ hasRemark = false, historyEntries = [], now = new Date() } = {}) {
    if (hasRemark) return "已有備註";
    const hasRecentOutreach = historyEntries.some((text) => isRecentActiveOutreachText(text, now));
    return hasRecentOutreach ? `近 ${MONTHS_TO_HIDE} 個月已有發出紀錄` : "";
  }

  function isResumeCodeLookupMode() {
    const url = new URL(location.href);
    const kws = url.searchParams.get("kws") || "";
    const codes = kws.match(/\b\d{10,}\b/g) || [];
    return codes.length >= 1;
  }

  function shouldHideCardsOnThisPage() {
    return location.pathname.startsWith("/search/searchResult") && !isResumeCodeLookupMode();
  }

  function restoreHiddenCards() {
    document.querySelectorAll("[data-resume-screening-skipped]").forEach((card) => {
      delete card.dataset.resumeScreeningSkipped;
      card.style.removeProperty("display");
      card.querySelector("[data-resume-skip-badge]")?.remove();
    });
    skippedCards = new Map();
  }

  function restoreExcludedCards() {
    document.querySelectorAll("[data-resume-screening-excluded]").forEach((card) => {
      delete card.dataset.resumeScreeningExcluded;
      card.style.removeProperty("display");
    });
  }

  function hideExcludedCards(scoredItems) {
    const excludedCodes = new Set(scoredItems.filter((item) => item.status === "excluded").map((item) => item.resumeCode));
    let hidden = 0;
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
      if (!excludedCodes.has(code)) return;
      card.dataset.resumeScreeningExcluded = "true";
      card.style.setProperty("display", "none", "important");
      hidden += 1;
    });
    return hidden;
  }

  function getSkipReason(card) {
    return skipReasonFromSignals({
      hasRemark: Boolean(card.querySelector(".resume-remark.mt-2, .resume-remark, [data-qa-id='resumeRemark']")),
      historyEntries: textsFromSelectors(card, [".history-list__collapse .list-txt"])
    });
  }

  function processedCount(cardsByCode) {
    return cardsByCode.size + skippedCards.size;
  }

  function targetScannableCount(totalCount) {
    return totalCount ? Math.max(totalCount - skippedCards.size, 0) : 0;
  }

  function targetReached(cardsByCode, totalCount) {
    if (!totalCount) return false;
    return cardsByCode.size >= targetScannableCount(totalCount) || processedCount(cardsByCode) >= totalCount;
  }

  function progressText(cardsByCode, totalCount) {
    if (!totalCount) return `可分析 ${cardsByCode.size}，跳過 ${skippedCards.size}`;
    return `可分析 ${cardsByCode.size}/${targetScannableCount(totalCount)}，跳過 ${skippedCards.size}，原始 ${totalCount}`;
  }

  function progressPercent(cardsByCode, totalCount) {
    if (!totalCount) return Math.min(95, cardsByCode.size ? 12 : 0);
    return Math.min(100, Math.round((processedCount(cardsByCode) / totalCount) * 100));
  }

  function hideSkippedCard(card, reason) {
    card.dataset.resumeScreeningSkipped = reason;
    card.style.setProperty("display", "none", "important");
  }

  function renderSkipReasonBadge(card, reason) {
    const container = ensureBadgeContainer(card);
    let badge = container.querySelector("[data-resume-skip-badge]");
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.resumeSkipBadge = "true";
      badge.className = "resume-screening-result-tag resume-screening-result-tag--skip";
      container.append(badge);
    }
    badge.textContent = reason === "已有備註" ? "#已有備註" : `#近${MONTHS_TO_HIDE}個月已邀約`;
    badge.title = reason;
  }

  function rememberSkippedCard(card, reason) {
    const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id) || card.id;
    if (code) skippedCards.set(code, reason);
  }

  function isScreeningOwnedElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(
      element.closest("#resume-screening-104-panel")
      || element.closest("[data-resume-shared-rules-badges]")
      || element.matches(".resume-screening-score-badge")
    );
  }

  function cardTextSignature(card) {
    const ownedTextLength = [...card.querySelectorAll("[data-resume-shared-rules-badges]")]
      .reduce((sum, node) => sum + normalizeText(node.textContent).length, 0);
    return [
      extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id),
      Math.max(0, normalizeText(card.textContent).length - ownedTextLength),
      card.querySelectorAll(JOB_HISTORY_SELECTOR).length,
      normalizeText(card.querySelector(NAME_SELECTOR)?.textContent),
      normalizeText(card.querySelector(PREFER_TITLE_SELECTOR)?.textContent)
    ].join("|");
  }

  function readNativeCardText(card) {
    const pieces = [];
    const walker = document.createTreeWalker(
      card,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || isScreeningOwnedElement(parent)) return NodeFilter.FILTER_REJECT;
          return normalizeText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      pieces.push(walker.currentNode.nodeValue);
    }

    return normalizeText(pieces.join(" "));
  }

  function getCardReadableText(card) {
    const signature = cardTextSignature(card);
    const cached = cardTextCache.get(card);
    if (cached && cached.signature === signature) return cached.text;

    const text = readNativeCardText(card);
    cardTextCache.set(card, { signature, text });
    return text;
  }

  function cardScoreSignature(code) {
    const item = latestScoreByCode.get(code);
    return item ? `${item.score}:${item.status}:${item.reasons.slice(0, 2).join("/")}` : "no-score";
  }

  function cardFilterKey(card) {
    const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
    return [
      cardTextSignature(card),
      "remote",
      cardScoreSignature(code),
      card.dataset.resumeScreeningSkipped || ""
    ].join("||");
  }

  function ensureBadgeContainer(card) {
    let container = card.querySelector("[data-resume-shared-rules-badges]");
    if (container) return container;

    container = document.createElement("div");
    container.dataset.resumeSharedRulesBadges = "true";
    const anchor = card.querySelector(".resume-card__center, .userInfo-wrap, .card-body") || card.firstElementChild;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(container, anchor);
    else card.insertBefore(container, card.firstChild);
    return container;
  }

  function filterResumeCards(options = {}) {
    if (!shouldHideCardsOnThisPage()) {
      restoreHiddenCards();
      return;
    }
    const maxCards = options.force || isScanning ? Infinity : FILTER_MAX_CARDS_PER_PASS;
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    let processed = 0;

    for (const card of cards) {
      const filterKey = cardFilterKey(card);
      if (!options.force && card.dataset.resumeScreeningFilterKey === filterKey) continue;

      const reason = getSkipReason(card);
      if (reason) {
        renderSkipReasonBadge(card, reason);
        rememberSkippedCard(card, reason);
        hideSkippedCard(card, reason);
      }
      card.dataset.resumeScreeningFilterKey = cardFilterKey(card);
      processed += 1;
      if (processed >= maxCards) {
        if (!isScanning) scheduleFilterResumeCards(FILTER_DEBOUNCE_MS);
        break;
      }
    }
  }

  function scheduleFilterResumeCards(delay = FILTER_DEBOUNCE_MS) {
    if (filterTimer) window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterTimer = 0;
      filterResumeCards();
    }, delay);
  }

  function elementFromMutationNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    return node.parentElement || null;
  }

  function isScreeningOwnedNode(node) {
    return isScreeningOwnedElement(elementFromMutationNode(node));
  }

  function mutationOnlyTouchesScreeningUi(mutation) {
    const targetIsOwned = isScreeningOwnedNode(mutation.target);
    const addedNodes = [...mutation.addedNodes];
    const removedNodes = [...mutation.removedNodes];
    const addedAreOwned = !addedNodes.length || addedNodes.every(isScreeningOwnedNode);
    const removedAreOwned = !removedNodes.length || removedNodes.every(isScreeningOwnedNode);
    return targetIsOwned || (addedAreOwned && removedAreOwned && (addedNodes.length || removedNodes.length));
  }

  function shouldScheduleFilterForMutations(mutations) {
    if (isScanning) return false;
    if (!mutations.length) return false;
    return mutations.some((mutation) => !mutationOnlyTouchesScreeningUi(mutation));
  }

  function getTotalCount() {
    const totalText = [...document.querySelectorAll("span, div")]
      .map((node) => normalizeText(node.textContent))
      .find((text) => /^共\s*[\d,]+\s*筆$/.test(text));
    const match = totalText?.match(/共\s*([\d,]+)\s*筆/);
    return Number(match?.[1]?.replaceAll(",", "") || 0);
  }

  function inferRoleId() { return panel?.querySelector("[data-role]")?.value || ""; }

  function extractCardMeta(card) {
    const jobLines = [...card.querySelectorAll(JOB_HISTORY_SELECTOR)].map(node => normalizeText(node.textContent));
    const desiredTitles = desiredTitlesFromRoot(card);
    return { candidateName: normalizeText(card.querySelector(NAME_SELECTOR)?.textContent),
      currentTitle: desiredTitles[0] || "", desiredTitles, jobLines, recentJobs: [] };
  }

  function extractCard(card) {
    const meta = extractCardMeta(card);
    const href = card.querySelector(PROFILE_LINK_SELECTOR)?.getAttribute("href") || "";
    return { ...meta, resumeCode: extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id),
      profileUrl: href ? new URL(href, location.origin).toString() : "",
      summary: getCardReadableText(card),
      education: textsFromSelectors(card, [EDUCATION_SELECTOR]).join(" "),
      militaryStatus: normalizeText(card.querySelector(MILITARY_SELECTOR)?.textContent),
      workExperience: normalizeText(card.querySelector(WORK_EXPERIENCE_SELECTOR)?.textContent),
      hasRemark: Boolean(card.querySelector(".resume-remark.mt-2")),
      historyEntries: textsFromSelectors(card, [".history-list__collapse .list-txt"]),
      detail: {status:"partial"}
    };
  }


  // 以下僅為資料與介面輔助，不含任何職缺判定規則。
  function uniqueList(values) { return [...new Set(values.map(normalizeText).filter(Boolean))]; }
  function cleanupJobTitle(value) { return normalizeText(value); }
  function reasonTagLabel() { return "待確認"; }
  function tagKey(value) { return "#" + normalizeText(value).replace(/^#/, ""); }
  function clientConfigNumber(group, key, fallback) { return fallback; }
  function clientTimingValue(key, fallback) { return fallback; }

  async function loadSharedRules() {
    // 清除舊版曾保存的規則，新版不再下載它們。
    localStorage.removeItem(SHARED_RULES_CACHE_KEY);
    const response = await backendRequest({action:"health"}, true);
    if (response.mode !== "private_backend") throw new Error("請先部署私有後端 v4.0.0。");
  }

  function backendRequest(input, health = false) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: health ? "GET" : "POST",
        url: RULES_API_URL + (health ? "?action=health" : ""),
        anonymous: false,
        timeout: 120000,
        headers: {"Content-Type":"application/json"},
        data: health ? undefined : JSON.stringify(input),
        onload(response) {
          try {
            const data = JSON.parse(response.responseText);
            if (!data.ok) throw new Error("請先以公司 Google 帳號登入規則服務，再重新掃描。");
            resolve(data);
          } catch (_) { reject(new Error("後端未授權或回應失敗；請開啟規則服務並以公司帳號登入。")); }
        },
        onerror() { reject(new Error("後端連線失敗")); },
        ontimeout() { reject(new Error("後端計算逾時，請重新掃描")); }
      });
    });
  }

  async function rankCandidates(cards, roleId) {
    const all = [];
    setStageProgress(3, "後端評分", 0, cards.length, 85, 98);
    for (let offset = 0; offset < cards.length; offset += 25) {
      if (scanCancellationRequested) throw new Error("SCAN_CANCELLED");
      setStatus(`第 3/4 階段：後端評分中（已完成 ${offset}/${cards.length}）...`);
      const batch = cards.slice(offset, offset + 25);
      const response = await backendRequest({action:"screen", roleId, cards:batch.map(card => {
        // 姓名與履歷連結保留於畫面；只送評估所需欄位。
        const {candidateName, profileUrl, ...evidence} = card;
        return evidence;
      })});
      if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error("後端回傳筆數不符");
      response.results.forEach(result => {
        const original = batch.find(card => card.resumeCode === result.resumeCode);
        if (!original) throw new Error("後端履歷對應不符");
        all.push({...result, candidateName:original.candidateName, profileUrl:original.profileUrl});
      });
      setStageProgress(3, "後端評分", Math.min(offset + batch.length, cards.length), cards.length, 85, 98);
    }
    // 分數只由後端計算；前端一律以總分由高到低呈現。
    const sorted = sortResultsByScore(all);
    const ranked = sorted.filter(item => item.status === "ranked");
    const reviewRequired = sorted.filter(item => item.status === "review_required");
    const excluded = sorted.filter(item => item.status === "excluded");
    return {ranked, reviewRequired, excluded, allResults:sorted, excludedCount:excluded.length, excludedReasonCounts:{}};
  }

  function sortResultsByScore(items) {
    return (items || []).map((item, originalIndex) => ({ item, originalIndex })).sort((a, b) => (
      Number(b.item.score || 0) - Number(a.item.score || 0) ||
      Number(a.item.rankTier || 99) - Number(b.item.rankTier || 99) ||
      statusOrder(a.item.status) - statusOrder(b.item.status) ||
      a.originalIndex - b.originalIndex
    )).map((entry) => entry.item);
  }

  function buildSortedResultGroups(groups) {
    return {
      ranked: sortResultsByScore(groups.ranked),
      review: sortResultsByScore(groups.review),
      excluded: sortResultsByScore(groups.excluded),
      all: sortResultsByScore(groups.all)
    };
  }

  function nextUnreadHighScoreBatch(items, openedCodes, limit = 15) {
    return sortResultsByScore(items)
      .filter((item) => item.status !== "excluded" && item.profileUrl && !openedCodes.has(item.resumeCode))
      .slice(0, limit);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForCards() {
    for (let index = 0; index < 60; index += 1) {
      if (document.querySelector(CARD_SELECTOR)) {
        filterResumeCards();
        return;
      }
      await sleep(500);
    }
    throw new Error("等不到履歷卡片");
  }

  function currentCodeSignature() {
    return [...document.querySelectorAll(CODE_SELECTOR)].map((node) => extractResumeCode(node.textContent)).filter(Boolean).join("|");
  }

  function documentHeight() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    return Math.max(
      scrollingElement.scrollHeight || 0,
      document.documentElement.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
  }

  function scrollToDocumentBottom() {
    window.scrollTo(0, documentHeight());
  }

  function isNearBottom(tolerance = 120) {
    return window.scrollY + window.innerHeight >= documentHeight() - tolerance;
  }

  function collectVisibleCards(cardsByCode) {
    filterResumeCards();
    const pageCards = [...document.querySelectorAll(CARD_SELECTOR)]
      .filter((card) => !card.dataset.resumeScreeningSkipped && getComputedStyle(card).display !== "none")
      .map(extractCard);
    for (const card of pageCards) {
      if (card.resumeCode) cardsByCode.set(card.resumeCode, card);
    }
    return pageCards.length;
  }

  function currentCardElementsByCode() {
    const map = new Map();
    [...document.querySelectorAll(CARD_SELECTOR)].forEach((card) => {
      const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
      if (code) map.set(code, card);
    });
    return map;
  }

  function applyCardElementAvailability(items) {
    const elementsByCode = currentCardElementsByCode();
    return items.map((item) => ({
      ...item,
      cardElementAvailable: elementsByCode.has(item.resumeCode)
    }));
  }

  function renderScoreBadge(card, item) {
    const container = ensureBadgeContainer(card);
    let badge = container.querySelector("[data-resume-score-badge]");
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.resumeScoreBadge = "true";
      badge.className = "resume-screening-score-badge";
      container.prepend(badge);
    }
    badge.textContent = item.status === "excluded" ? "排除" : `分數 ${item.score}`;
    badge.title = item.reasons.slice(0, 5).join("\n");
    renderBackendResultTags(card, item);
  }

  function renderBackendResultTags(card, item) {
    const container = ensureBadgeContainer(card);
    container.querySelectorAll("[data-resume-result-tag]").forEach((node) => node.remove());
    const tags = (item.displayTags || []).slice(0, BADGE_LIMIT);
    tags.forEach((tag) => {
      const badge = document.createElement("span");
      badge.dataset.resumeResultTag = "true";
      badge.className = "resume-screening-result-tag";
      badge.textContent = tagKey(tag);
      badge.title = tagTooltip(tag, item);
      container.append(badge);
    });
  }

  function reorderLoadedCardsByScore(scoredItems) {
    if (!ENABLE_INLINE_REORDER) return 0;
    const scoreByCode = new Map(scoredItems.map((item) => [item.resumeCode, item]));
    const cards = [...document.querySelectorAll(CARD_SELECTOR)]
      .map((card, originalIndex) => {
        const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
        return {
          card,
          code,
          originalIndex,
          item: scoreByCode.get(code)
        };
      })
      .filter((entry) => entry.code && entry.item && !entry.card.dataset.resumeScreeningSkipped && getComputedStyle(entry.card).display !== "none");

    const groups = new Map();
    cards.forEach((entry) => {
      const parent = entry.card.parentElement;
      if (!parent) return;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(entry);
    });

    let moved = 0;
    groups.forEach((entries, parent) => {
      const sorted = entries.slice().sort((a, b) => (
        b.item.score - a.item.score ||
        (a.item.rankTier || 99) - (b.item.rankTier || 99) ||
        statusOrder(a.item.status) - statusOrder(b.item.status) ||
        a.originalIndex - b.originalIndex
      ));
      sorted.forEach((entry) => {
        parent.appendChild(entry.card);
        renderScoreBadge(entry.card, entry.item);
        moved += 1;
      });
    });

    return moved;
  }

  function statusOrder(status) {
    if (status === "ranked") return 0;
    if (status === "review_required") return 1;
    return 2;
  }

  function collectAndUpdateProgress(cardsByCode, totalCount) {
    const count = collectVisibleCards(cardsByCode);
    setSummary(progressText(cardsByCode, totalCount));
    setStageProgress(1, "收集履歷", processedCount(cardsByCode), totalCount, 5, 65);
    return count;
  }

  async function prepareScanPosition(cardsByCode) {
    filterResumeCards();
    collectVisibleCards(cardsByCode);
    if (window.scrollY <= 40) return;
    setStatus("重新從頁首掃描，避免在頁尾空等...");
    window.scrollTo(0, 0);
    await sleep(900);
    collectVisibleCards(cardsByCode);
  }

  async function fastScrollToBottom(cardsByCode, totalCount) {
    const startedAt = Date.now();
    const stallTimeoutMs = clientTimingValue("stallTimeoutMs", SCAN_STALL_TIMEOUT_MS);
    const fastScrollDelayMs = clientTimingValue("fastScrollDelayMs", FAST_SCROLL_DELAY_MS);
    let lastScrollY = -1;
    let stuckRounds = 0;
    while (!isNearBottom() && stuckRounds < 4 && !targetReached(cardsByCode, totalCount)) {
      if (Date.now() - startedAt >= stallTimeoutMs) {
        setStatus(`滾動等待超過 ${Math.round(stallTimeoutMs / 1000)} 秒，先用目前已載入履歷結算...${progressText(cardsByCode, totalCount)}`);
        break;
      }
      collectAndUpdateProgress(cardsByCode, totalCount);
      window.scrollTo(0, Math.min(documentHeight(), window.scrollY + Math.max(window.innerHeight * 2.8, 2200)));
      await sleep(fastScrollDelayMs);
      if (Math.abs(window.scrollY - lastScrollY) < 8) stuckRounds += 1;
      else stuckRounds = 0;
      lastScrollY = window.scrollY;
    }
    collectAndUpdateProgress(cardsByCode, totalCount);
  }

  async function scrollUntilStable(cardsByCode, totalCount) {
    const startedAt = Date.now();
    const stallTimeoutMs = clientTimingValue("stallTimeoutMs", SCAN_STALL_TIMEOUT_MS);
    const bottomLoadWaitMs = clientTimingValue("bottomLoadWaitMs", BOTTOM_LOAD_WAIT_MS);
    const fastScrollDelayMs = clientTimingValue("fastScrollDelayMs", FAST_SCROLL_DELAY_MS);
    const bottomStableRounds = clientTimingValue("bottomStableRounds", BOTTOM_STABLE_ROUNDS);
    const scrollHeightStableRounds = clientTimingValue("scrollHeightStableRounds", SCROLL_HEIGHT_STABLE_ROUNDS);
    let timedOut = false;
    let previousProcessed = -1;
    let previousHeight = -1;
    let stableRounds = 0;
    let heightStableRounds = 0;
    while ((stableRounds < bottomStableRounds || heightStableRounds < scrollHeightStableRounds || !isNearBottom(24)) && !targetReached(cardsByCode, totalCount)) {
      if (Date.now() - startedAt >= stallTimeoutMs) {
        setStatus(`等待下一批超過 ${Math.round(stallTimeoutMs / 1000)} 秒，先用目前已載入履歷結算...${progressText(cardsByCode, totalCount)}`);
        timedOut = true;
        break;
      }
      await fastScrollToBottom(cardsByCode, totalCount);
      const beforeWaitProcessed = processedCount(cardsByCode);
      setStatus(`快速到頁尾，等待下一批...${progressText(cardsByCode, totalCount)}`);
      await sleep(bottomLoadWaitMs);
      scrollToDocumentBottom();
      await sleep(fastScrollDelayMs);
      collectAndUpdateProgress(cardsByCode, totalCount);
      const currentProcessed = processedCount(cardsByCode);
      const currentHeight = documentHeight();
      if (currentProcessed === beforeWaitProcessed && currentProcessed === previousProcessed) stableRounds += 1;
      else stableRounds = 0;
      if (currentHeight === previousHeight) heightStableRounds += 1;
      else heightStableRounds = 0;
      previousProcessed = currentProcessed;
      previousHeight = currentHeight;
    }
    return { timedOut };
  }

  async function settleFinalBottom(cardsByCode, totalCount) {
    const startedAt = Date.now();
    const stallTimeoutMs = clientTimingValue("stallTimeoutMs", SCAN_STALL_TIMEOUT_MS);
    const bottomLoadWaitMs = clientTimingValue("bottomLoadWaitMs", BOTTOM_LOAD_WAIT_MS);
    const finalBottomSettleRounds = clientTimingValue("finalBottomSettleRounds", FINAL_BOTTOM_SETTLE_ROUNDS);
    let previousProcessed = -1;
    let previousHeight = -1;
    let stableRounds = 0;
    while (stableRounds < finalBottomSettleRounds && !targetReached(cardsByCode, totalCount)) {
      if (Date.now() - startedAt >= stallTimeoutMs) break;
      scrollToDocumentBottom();
      await sleep(bottomLoadWaitMs);
      collectAndUpdateProgress(cardsByCode, totalCount);
      const currentProcessed = processedCount(cardsByCode);
      const currentHeight = documentHeight();
      if (currentProcessed === previousProcessed && currentHeight === previousHeight && isNearBottom(24)) stableRounds += 1;
      else stableRounds = 0;
      previousProcessed = currentProcessed;
      previousHeight = currentHeight;
    }
  }

  function currentPageNumber() {
    const href = document.querySelector(PROFILE_LINK_SELECTOR)?.getAttribute("href") || "";
    const match = decodeURIComponent(href).match(/"page"\s*:\s*(\d+)/);
    return Number(match?.[1] || 1);
  }

  function findNextButton() {
    const nextPage = String(currentPageNumber() + 1);
    const scoped = [...document.querySelectorAll(".pagination button, .pagination a, .pager button, .pager a, [class*='page'] button, [class*='page'] a")];
    const candidates = scoped.length ? scoped : [...document.querySelectorAll("button, a")];
    const usable = (element) => !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("disabled") && !element.closest(".resume-card");
    return candidates.find((element) => usable(element) && normalizeText(element.textContent) === nextPage)
      || candidates.find((element) => usable(element) && /下一頁|下頁|>|›/.test(`${normalizeText(element.textContent)} ${normalizeText(element.getAttribute("aria-label"))}`));
  }

  async function goNextPage() {
    const nextButton = findNextButton();
    if (!nextButton) return false;
    const beforeCodes = currentCodeSignature();
    setStatus(`切換到第 ${currentPageNumber() + 1} 頁，等待 104 回應...`);
    nextButton.scrollIntoView({ block: "center" });
    await sleep(500);
    nextButton.click();
    await sleep(1200);
    const pageChangeTimeoutMs = clientTimingValue("pageChangeTimeoutMs", PAGE_CHANGE_TIMEOUT_MS);
    const deadline = Date.now() + pageChangeTimeoutMs;
    while (Date.now() < deadline) {
      if (currentCodeSignature() && currentCodeSignature() !== beforeCodes) return true;
      await sleep(500);
    }
    setStatus(`等待第 ${currentPageNumber() + 1} 頁超過 ${Math.round(pageChangeTimeoutMs / 1000)} 秒，先用目前已收集履歷結算。`);
    return false;
  }

  async function waitForAutoGeneratedBatch(beforeSignature, cardsByCode, totalCount) {
    for (let index = 0; index < 4; index += 1) {
      setStatus(`等待下一批資料...${progressText(cardsByCode, totalCount)}`);
      await sleep(700);
      scrollToDocumentBottom();
      collectAndUpdateProgress(cardsByCode, totalCount);
      if (currentCodeSignature() && currentCodeSignature() !== beforeSignature) return true;
      if (targetReached(cardsByCode, totalCount)) return true;
    }
    return false;
  }

  async function scanSinglePage(cardsByCode, totalCount) {
    setStatus(`單頁掃描中...${progressText(cardsByCode, totalCount)}`);
    collectAndUpdateProgress(cardsByCode, totalCount);
    await fastScrollToBottom(cardsByCode, totalCount);
    await sleep(500);
    collectAndUpdateProgress(cardsByCode, totalCount);
    setSummary(progressText(cardsByCode, totalCount));
  }

  function resultGroups() {
    return buildSortedResultGroups({
      ranked: latestRanked,
      review: latestReviewRequired,
      excluded: latestExcluded,
      all: latestAllResults
    });
  }

  function resultFilterLabel(filter) {
    return {
      ranked: "推薦",
      review: "人工覆核",
      excluded: "排除",
      all: "全部"
    }[filter] || "推薦";
  }

  function visibleResultItems() {
    const groups = resultGroups();
    const items = groups[currentResultFilter] || groups.ranked;
    const start = (currentResultPage - 1) * RANKED_LIST_PAGE_SIZE;
    return items.slice(start, start + RANKED_LIST_PAGE_SIZE);
  }

  function totalResultPages() {
    const groups = resultGroups();
    const items = groups[currentResultFilter] || groups.ranked;
    return Math.max(1, Math.ceil(items.length / RANKED_LIST_PAGE_SIZE));
  }

  function renderFilterButton(filter, count) {
    const active = currentResultFilter === filter;
    return `<button data-result-filter="${filter}" style="height:30px;border:1px solid ${active ? UI.navy : UI.border};border-radius:8px;background:${active ? UI.navy : UI.surface};color:${active ? "#fff" : UI.navy};font-weight:700;cursor:pointer;padding:0 10px;">${resultFilterLabel(filter)} ${count}</button>`;
  }

  function renderSelectionButton(action, label) {
    return `<button data-select-action="${action}" style="height:30px;border:1px solid ${UI.borderStrong};border-radius:8px;background:${UI.surface};color:${UI.navy};font-weight:700;cursor:pointer;padding:0 10px;">${label}</button>`;
  }

  function formatJobLine(job, fallbackItem = {}) {
    const companyName = normalizeText(job?.companyName) || normalizeText(fallbackItem.recentCompanyName) || "最近任職公司未顯示";
    const jobTitle = cleanupJobTitle(job?.jobTitle || fallbackItem.recentJobTitle || fallbackItem.currentTitle) || "職稱未顯示";
    const durationText = normalizeText(job?.durationText) || normalizeText(fallbackItem.recentJobDurationText);
    return `${companyName} - ${jobTitle}${durationText ? `（${durationText}）` : ""}`;
  }

  function renderRecentJobs(item) {
    const jobs = (item.recentJobs || []).filter((job) => normalizeText(job?.companyName) || normalizeText(job?.jobTitle)).slice(0, 3);
    const displayJobs = jobs.length ? jobs : [{
      companyName: item.recentCompanyName,
      jobTitle: item.recentJobTitle || item.currentTitle,
      durationText: item.recentJobDurationText
    }];
    return displayJobs.map((job, index) => {
      const style = index === 0
        ? `margin-top:3px;color:${UI.ink};font-size:12px;font-weight:650;line-height:1.45;word-break:break-word;`
        : `margin-top:2px;color:${UI.muted};font-size:11px;font-weight:500;line-height:1.4;word-break:break-word;`;
      return `<div style="${style}">${escapeHtml(formatJobLine(job, item))}</div>`;
    }).join("");
  }

  function tagTooltip(tag, item) {
    const detail = item.displayTagDetails?.[tag] || item.displayTagDetails?.[tagKey(tag)] || "";
    if (detail) return detail;
    const matchedReason = (item.reasons || []).find((reason) => reason.includes(tag.replace(/^#/, "")));
    return matchedReason || `${tag}：此標籤來自本次掃描評分條件`;
  }

  function renderScoreBreakdown(item) {
    const rows = Array.isArray(item.scoreBreakdown) ? item.scoreBreakdown : [];
    return `<details data-score-details style="margin-top:8px;color:${UI.ink};font-size:12px;cursor:default;">
      <summary style="cursor:pointer;min-height:28px;line-height:28px;color:${UI.navy};font-weight:700;">查看加扣分明細（唯讀）</summary>
      <div style="padding:6px 0;line-height:1.5;">${escapeHtml(item.scoreExplanation || "")}</div>
      ${rows.map((row) => `<div style="border-top:1px solid ${UI.border};padding:6px 0;">
        <div style="display:flex;justify-content:space-between;gap:8px;"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(typeof row.points === "number" && Number.isFinite(row.points) ? `${row.points > 0 ? "+" : ""}${row.points}` : "—")}</strong></div>
        <div style="color:${UI.muted};overflow-wrap:anywhere;">${escapeHtml(row.details || "")}</div>
      </div>`).join("")}
      ${!rows.length ? (item.reasons || []).map((reason) => `<div style="padding:4px 0;">${escapeHtml(reason)}</div>`).join("") : ""}
    </details>`;
  }

  function renderResultItem(item, absoluteIndex) {
    const checked = selectedResumeCodes.has(item.resumeCode) ? "checked" : "";
    const disabled = item.profileUrl ? "" : "disabled";
    const displayTags = (item.displayTags && item.displayTags.length ? item.displayTags : (item.reasons || []).map((reason) => `#${reasonTagLabel(reason)}`)).slice(0, 9);
    const displayName = normalizeText(item.candidateName) || `候選人 ${absoluteIndex}`;
    return `
      <article data-result-item="${escapeHtml(item.resumeCode)}" style="border:1px solid ${UI.border};border-radius:8px;background:${UI.surface};padding:10px 10px 9px;cursor:${item.profileUrl ? "pointer" : "default"};box-shadow:0 1px 2px rgba(15,39,66,.04);" title="${item.profileUrl ? "點擊卡片可切換勾選" : ""}">
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:start;">
          <input type="checkbox" data-result-select="${escapeHtml(item.resumeCode)}" ${checked} ${disabled} title="勾選後可批次開啟">
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;">
              <a href="${escapeHtml(item.profileUrl)}" target="_blank" rel="noreferrer" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:900;color:${UI.navy};font-size:14px;text-decoration:none;">${absoluteIndex}. ${escapeHtml(displayName)}</a>
              ${openedResumeCodes.has(item.resumeCode) ? `<span data-opened-marker style="flex:none;border:1px solid ${UI.success};border-radius:999px;background:${UI.successBg};color:${UI.success};padding:1px 7px;font-size:11px;font-weight:800;">已讀</span>` : ""}
            </div>
            ${renderRecentJobs(item)}
            ${renderScoreBreakdown(item)}
            <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:7px;">
              ${displayTags.map((tag) => `<span title="${escapeHtml(tagTooltip(tag, item))}" style="border:1px solid ${UI.border};border-radius:999px;background:${UI.page};color:${UI.muted};padding:1px 7px;font-size:11px;font-weight:650;">${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
          <strong style="background:${UI.navy};color:#fff;border-radius:8px;padding:2px 8px;">${item.score}</strong>
        </div>
      </article>
    `;
  }

  function visibleSelectableCodes() {
    return visibleResultItems()
      .filter((item) => item.profileUrl && item.resumeCode)
      .map((item) => item.resumeCode);
  }

  function setVisibleSelection(selected) {
    visibleSelectableCodes().forEach((code) => {
      if (selected) selectedResumeCodes.add(code);
      else selectedResumeCodes.delete(code);
    });
    renderResults();
  }

  function isVisiblePageFullySelected() {
    const codes = visibleSelectableCodes();
    return codes.length > 0 && codes.every((code) => selectedResumeCodes.has(code));
  }

  function toggleVisibleSelection() {
    setVisibleSelection(!isVisiblePageFullySelected());
  }

  function toggleResultSelection(code) {
    const input = resultNode.querySelector(`[data-result-select="${CSS.escape(code)}"]`);
    if (!input || input.disabled) return;
    input.checked = !input.checked;
    if (input.checked) selectedResumeCodes.add(code);
    else selectedResumeCodes.delete(code);
    updateSelectionUi();
  }

  function updateSelectionUi() {
    updateOpenButtonLabel();
    const selectedCountNode = resultNode?.querySelector("[data-selected-count]");
    if (selectedCountNode) selectedCountNode.textContent = `已勾選 ${selectedResumeCodes.size} 筆`;
    const toggleSelectionButton = resultNode?.querySelector('[data-select-action="toggle-page"]');
    if (toggleSelectionButton) toggleSelectionButton.textContent = isVisiblePageFullySelected() ? "取消本頁全選" : "本頁全選";
  }

  function scrollResultViewToTop() {
    if (!bodyNode) return;
    if (typeof bodyNode.scrollTo === "function") bodyNode.scrollTo({ top: 0, left: 0, behavior: "auto" });
    else bodyNode.scrollTop = 0;
  }

  function attachResultEvents() {
    resultNode.querySelectorAll("[data-result-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        currentResultFilter = button.dataset.resultFilter || "ranked";
        currentResultPage = 1;
        renderResults();
        scrollResultViewToTop();
      });
    });
    resultNode.querySelectorAll("[data-result-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.dataset.resultPage || 1);
        currentResultPage = Math.min(Math.max(nextPage, 1), totalResultPages());
        renderResults();
        scrollResultViewToTop();
      });
    });
    resultNode.querySelectorAll("[data-select-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.selectAction === "toggle-page") toggleVisibleSelection();
      });
    });
    resultNode.querySelectorAll("[data-restore-excluded]").forEach((button) => {
      button.addEventListener("click", () => {
        restoreExcludedCards();
        setStatus("已還原目前頁被硬性排除的履歷卡片；排除結果與原因仍保留在清單中。");
      });
    });
    resultNode.querySelectorAll("[data-result-select]").forEach((input) => {
      input.addEventListener("change", () => {
        const code = input.dataset.resultSelect;
        if (!code) return;
        if (input.checked) selectedResumeCodes.add(code);
        else selectedResumeCodes.delete(code);
        updateSelectionUi();
      });
    });
    resultNode.querySelectorAll("[data-result-item]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a,button,input,label,details,summary")) return;
        const code = card.dataset.resultItem;
        if (code) toggleResultSelection(code);
      });
    });
  }

  function updateOpenButtonLabel() {
    if (!copyButton) return;
    const count = selectedResumeCodes.size;
    copyButton.textContent = count ? `開啟勾選 ${count}` : "開啟勾選";
    updateQuickOpenButton();
  }

  function updateQuickOpenButton() {
    if (!quickOpenButton) return;
    const eligible = sortResultsByScore(latestAllResults).filter((item) => item.status !== "excluded" && item.profileUrl);
    const batch = nextUnreadHighScoreBatch(eligible, openedResumeCodes, 15);
    quickOpenButton.disabled = isOpeningProfiles || !batch.length;
    if (!batch.length) {
      quickOpenButton.textContent = eligible.length ? "高分履歷已全部開啟" : "掃描後可開啟前 15 筆";
      return;
    }
    const firstRank = eligible.findIndex((item) => item.resumeCode === batch[0].resumeCode) + 1;
    const lastRank = eligible.findIndex((item) => item.resumeCode === batch[batch.length - 1].resumeCode) + 1;
    quickOpenButton.textContent = `開啟未讀高分履歷 ${firstRank}–${lastRank}`;
  }

  function renderResults(scanStats) {
    const scannedCount = scanStats?.scannedCount || latestAllResults.length;
    const excludedCount = scanStats?.excludedCount ?? latestExcluded.length;
    const excludedReasonCounts = scanStats?.excludedReasonCounts || {};
    const excludedReasonSummary = Object.entries(excludedReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([reason, count]) => `${reason.replace("，直接排除", "")} ${count}`)
      .join("；");
    const totalPages = totalResultPages();
    const visibleItems = visibleResultItems();
    const startIndex = (currentResultPage - 1) * RANKED_LIST_PAGE_SIZE;
    resultNode.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        ${renderFilterButton("ranked", latestRanked.length)}
        ${renderFilterButton("review", latestReviewRequired.length)}
        ${renderFilterButton("excluded", latestExcluded.length)}
        ${renderFilterButton("all", latestAllResults.length)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        ${renderSelectionButton("toggle-page", isVisiblePageFullySelected() ? "取消本頁全選" : "本頁全選")}
        ${latestExcluded.length ? `<button data-restore-excluded style="height:30px;border:1px solid ${UI.borderStrong};border-radius:8px;background:${UI.surface};color:${UI.navy};font-weight:700;cursor:pointer;padding:0 10px;">還原排除卡片</button>` : ""}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:${UI.muted};font-size:12px;">
        <span>${resultFilterLabel(currentResultFilter)}第 ${currentResultPage}/${totalPages} 頁，每頁 ${RANKED_LIST_PAGE_SIZE} 筆</span>
        <span data-selected-count>已勾選 ${selectedResumeCodes.size} 筆</span>
      </div>
      ${visibleItems.length ? visibleItems.map((item, index) => renderResultItem(item, startIndex + index + 1)).join("") : `<div style="color:${UI.muted};">沒有符合條件的候選人</div>`}
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;">
        <button data-result-page="${currentResultPage - 1}" ${currentResultPage <= 1 ? "disabled" : ""} style="height:32px;border:1px solid ${UI.border};border-radius:8px;background:#fff;color:${UI.navy};font-weight:700;cursor:pointer;padding:0 10px;">上一頁</button>
        <button data-result-page="${currentResultPage + 1}" ${currentResultPage >= totalPages ? "disabled" : ""} style="height:32px;border:1px solid ${UI.border};border-radius:8px;background:#fff;color:${UI.navy};font-weight:700;cursor:pointer;padding:0 10px;">下一頁</button>
      </div>
    `;
    attachResultEvents();
    updateOpenButtonLabel();
    setSummary(`完成：推薦 ${latestRanked.length} · 人工覆核 ${latestReviewRequired.length} · 排除 ${excludedCount} · 跳過 ${skippedCards.size}`);
    setProgress(100, "第 4/4 階段 · 排序呈現完成（總完成 100%）");
    const shortageNote = latestRanked.length
      ? `已依分數排序；可勾選後開啟履歷。${excludedReasonSummary ? `硬排除主因：${excludedReasonSummary}` : ""}`
      : `沒有推薦候選人。${excludedReasonSummary ? `硬排除主因：${excludedReasonSummary}` : ""}`;
    setStatus(shortageNote);
  }

  function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  async function openRankedProfiles() {
    const selectedItems = latestAllResults.filter((item) => selectedResumeCodes.has(item.resumeCode) && item.profileUrl);
    const profiles = DEFAULT_OPEN_LIMIT > 0 ? selectedItems.slice(0, DEFAULT_OPEN_LIMIT) : selectedItems;
    if (!profiles.length) {
      setStatus("目前沒有勾選可開啟的履歷；請先在排名清單勾選。");
      return;
    }
    isOpeningProfiles = true;
    copyButton.disabled = true;
    updateQuickOpenButton();
    setStatus(`準備開啟 ${profiles.length} 個已勾選履歷分頁。`);
    try {
      for (const [index, item] of profiles.entries()) {
        GM_openInTab(item.profileUrl, {
          active: index === 0,
          insert: true,
          setParent: true
        });
        openedResumeCodes.add(item.resumeCode);
        setSummary(`已開啟 ${index + 1}/${profiles.length} 個履歷分頁`);
        setProgress(Math.round(((index + 1) / profiles.length) * 100), `${index + 1}/${profiles.length}`);
        await sleep(180);
      }
    } finally {
      isOpeningProfiles = false;
      copyButton.disabled = false;
      renderResults();
    }
    setStatus(`已開啟 ${profiles.length} 個已勾選履歷分頁，清單已標示為「已讀」。`);
  }

  async function openNextUnreadHighScoreProfiles() {
    if (isOpeningProfiles) return;
    const profiles = nextUnreadHighScoreBatch(latestAllResults, openedResumeCodes, 15);
    if (!profiles.length) {
      setStatus("目前沒有尚未開啟的高分履歷。");
      updateQuickOpenButton();
      return;
    }
    isOpeningProfiles = true;
    copyButton.disabled = true;
    updateQuickOpenButton();
    setStatus(`準備依分數開啟下一批 ${profiles.length} 筆未讀履歷。`);
    try {
      for (const [index, item] of profiles.entries()) {
        GM_openInTab(item.profileUrl, {
          active: index === 0,
          insert: true,
          setParent: true
        });
        openedResumeCodes.add(item.resumeCode);
        setSummary(`本批已開啟 ${index + 1}/${profiles.length} 筆高分履歷`);
        await sleep(180);
      }
    } finally {
      isOpeningProfiles = false;
      copyButton.disabled = false;
      renderResults();
    }
    setStatus(`已開啟 ${profiles.length} 筆高分履歷，清單已標示為「已讀」。再次點擊會接續下一批。`);
  }

  async function scan() {
    mountPanel();
    if (isScanning) return;
    isScanning = true;
    scanCancellationRequested = false;
    startButton.disabled = false;
    startButton.textContent = "中止掃描";
    startButton.style.background = UI.danger;
    startButton.style.borderColor = UI.danger;
    restoreExcludedCards();
    skippedCards = new Map();
    latestRanked = [];
    latestReviewRequired = [];
    latestExcluded = [];
    latestAllResults = [];
    latestCardsByCode = new Map();
    latestScoreByCode = new Map();
    selectedResumeCodes = new Set();
    openedResumeCodes = new Set();
    isOpeningProfiles = false;
    currentResultFilter = "ranked";
    currentResultPage = 1;
    resultNode.innerHTML = "";
    updateOpenButtonLabel();
    setCollapsed(false);
    setSummary("準備掃描");
    setStatus("準備讀取共用規則與目前頁卡片...");
    setProgress(2, "第 1/4 階段 · 準備收集（總完成 2%）");

    const cardsByCode = new Map();
    let batch = 1;
    let noGrowthRounds = 0;

    try {
      const roleId = inferRoleId();
      const role = Boolean(roleId);
      if (!role) {
        throw new Error("請先在面板選擇要篩選的職缺，再開始掃描。");
      }
      await loadSharedRules();
      if (sharedRuleState.statusMessage) setStatus(sharedRuleState.statusMessage);
      else setStatus("共用規則已就緒，開始掃描卡片...");
      setStageProgress(1, "收集履歷", 0, getTotalCount(), 5, 65);
      await waitForCards();
      await prepareScanPosition(cardsByCode);
      const totalCount = getTotalCount();
      const expectedPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : 30;
      if (totalCount && totalCount <= PAGE_SIZE) {
        await scanSinglePage(cardsByCode, totalCount);
      } else {
        while (batch <= expectedPages + 3 && !targetReached(cardsByCode, totalCount) && !scanCancellationRequested) {
          const beforeProcessed = processedCount(cardsByCode);
          const beforeSignature = currentCodeSignature();
          const progress = progressText(cardsByCode, totalCount);
          setSummary(progress);
          setStatus(`連續掃描中...${progress}`);
          const stableResult = await scrollUntilStable(cardsByCode, totalCount);
          if (stableResult?.timedOut) break;
          if (targetReached(cardsByCode, totalCount)) break;
          const autoGenerated = await waitForAutoGeneratedBatch(beforeSignature, cardsByCode, totalCount);
          if (!autoGenerated && !targetReached(cardsByCode, totalCount)) {
            const hasNext = await goNextPage();
            if (!hasNext) break;
          }
          if (processedCount(cardsByCode) <= beforeProcessed) noGrowthRounds += 1;
          else noGrowthRounds = 0;
          if (noGrowthRounds >= 2) break;
          batch += 1;
        }
      }
      setStatus(`最後確認頁尾是否還有延遲載入卡片...${progressText(cardsByCode, totalCount)}`);
      await settleFinalBottom(cardsByCode, totalCount);
      if (scanCancellationRequested) throw new Error("SCAN_CANCELLED");

      const cards = [...cardsByCode.values()];
      setStatus(`初篩完成 ${cards.length} 筆，開始詳情補強...`);
      const enrichment = await enrichResumeDetails(roleId, role, cards);
      if (scanCancellationRequested) throw new Error("SCAN_CANCELLED");
      if (enrichment.requested) {
        setSummary(`詳情補強：成功 ${enrichment.loaded} · 待確認 ${enrichment.failed}`);
      }
      const ranking = await rankCandidates(cards, roleId);
      setStatus("第 4/4 階段：正在依分數排序並更新畫面...");
      setStageProgress(4, "排序呈現", 0, 1, 98, 100);
      const scoredItems = ranking.allResults;
      latestScoreByCode = new Map(scoredItems.map((item) => [item.resumeCode, item]));
      const movedCards = reorderLoadedCardsByScore(scoredItems);
      const hiddenExcludedCards = hideExcludedCards(scoredItems);
      latestRanked = sortResultsByScore(applyCardElementAvailability(ranking.ranked));
      latestReviewRequired = sortResultsByScore(applyCardElementAvailability(ranking.reviewRequired));
      latestExcluded = sortResultsByScore(applyCardElementAvailability(ranking.excluded));
      latestAllResults = sortResultsByScore(applyCardElementAvailability(ranking.allResults));
      latestCardsByCode = cardsByCode;
      renderResults({
        scannedCount: cards.length,
        excludedCount: ranking.excludedCount,
        excludedReasonCounts: ranking.excludedReasonCounts
      });
      if (movedCards || hiddenExcludedCards) {
        setStatus(`已重排目前頁 ${movedCards} 張卡片並隱藏 ${hiddenExcludedCards} 張硬排除卡片；跨頁結果請看右下角排名清單。`);
      }
    } catch (error) {
      console.error(error);
      if (error?.message === "SCAN_CANCELLED") {
        setStatus("掃描已由使用者中止；本次詳情資料已停止處理，重新整理頁面即可清除記憶體資料。");
        setProgress(0, "已中止");
      } else {
        setStatus(`失敗：${error.message}`);
        setProgress(0, "失敗");
      }
    } finally {
      isScanning = false;
      scanCancellationRequested = false;
      startButton.disabled = false;
      startButton.textContent = "掃描並依分數排序";
      startButton.style.background = UI.navy;
      startButton.style.borderColor = UI.navy;
    }
  }

  if (globalThis.__RESUME_SCREENING_TEST_MODE__) {
    globalThis.__RESUME_SCREENING_TEST_API__ = Object.freeze({desiredTitlesFromRoot, extractResumeDetail, renderScoreBreakdown, sortResultsByScore, buildSortedResultGroups, nextUnreadHighScoreBatch, parseOutreachHistoryDate, isRecentActiveOutreachText, skipReasonFromSignals});
    return;
  }

  ensurePanel();
  loadSharedRules().then(() => scheduleFilterResumeCards(0)).catch((error) => {
    console.warn("shared rules load failed", error);
  });

  const observer = new MutationObserver((mutations) => {
    if (shouldScheduleFilterForMutations(mutations)) scheduleFilterResumeCards();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
