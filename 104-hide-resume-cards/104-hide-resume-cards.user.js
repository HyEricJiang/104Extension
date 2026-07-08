// ==UserScript==
// @name         104 Resume Screening Unified
// @namespace    local.resume-screening-system
// @version      3.0.4
// @description  Scan, filter, label, score, and reorder 104 VIP resume cards with shared Google Sheet rules.
// @match        https://vip.104.com.tw/search/searchResult*
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CARD_SELECTOR = '[data-qa-id="resumeCard"].vip-resume-card, [data-qa-id="resumeCard"].resume-card';
  const CODE_SELECTOR = ".resume-card__center .supportInfo-wrap .code, .supportInfo-wrap .code";
  const PROFILE_LINK_SELECTOR = 'a.name[href], .user-photo a[href]';
  const NAME_SELECTOR = ".userInfo-wrap a.name, a.name.word-break-all";
  const EDUCATION_SELECTOR = '[data-qa-id="cardEducation"]';
  const PREFER_TITLE_SELECTOR = '[data-qa-id="cardPreferJobTitle"]';
  const WORK_EXPERIENCE_SELECTOR = '[data-qa-id="cardWorkExperience"]';
  const JOB_HISTORY_SELECTOR = ".content-list li";
  const PAGE_SIZE = 50;
  const FAST_SCROLL_DELAY_MS = 110;
  const BOTTOM_LOAD_WAIT_MS = 3200;
  const BOTTOM_STABLE_ROUNDS = 5;
  const FINAL_BOTTOM_SETTLE_ROUNDS = 4;
  const SCROLL_HEIGHT_STABLE_ROUNDS = 2;
  const MONTHS_TO_HIDE = 3;
  const PANEL_POSITION_KEY = "resume-screening-104-panel-position";
  const RULES_API_URL = "https://script.google.com/macros/s/AKfycbxcXDndkNeJAdfvUbk_C-AQjW7P5u7jPW7oTR_rV0IOb6Ddrp9ehg4QDbXC7Ajufh3h/exec";
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
  const LOW_QUALITY_MAX_NORMALIZED_SCORE = 24;
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

  const ROLE_RULES = {
    "java-programmer": {
      name: "Java Software Programmer",
      hardRequiredAny: ["java"],
      hardRequiredPreferred: ["spring", "spring boot"],
      positiveKeywords: ["spring", "spring boot", "java", "vue", "react", "angular", "javascript", "html", "css", "oracle", "mysql", "mssql", "git", "uml", "ooad", "銀行", "電信", "si", "系統整合", "0到1", "專案開發"],
      negativeIfCurrentMissingAny: ["java", "spring"]
    },
    "csharp-dotnet-programmer": {
      name: "C#.Net Software Programmer",
      hardRequiredAny: ["c#", ".net", "asp.net"],
      hardRequiredPreferred: [".net core", ".net 6", "mvc"],
      positiveKeywords: ["c#", "asp.net", ".net core", ".net 6", "mvc", "mssql", "ms sql", "mysql", "oracle", "vue", "react", "angular", "javascript", "html", "css", "git", "uml", "ooad", "銀行", "電信", "si", "系統整合", "0到1", "專案開發"],
      negativeIfCurrentMissingAny: ["c#", ".net", "asp.net"]
    },
    "system-analyst": {
      name: "System Analyst",
      minimumCoreMatches: 2,
      coreCompetencyKeywords: ["系統分析", "需求訪談", "需求分析", "會議記錄", "會議紀錄", "規格書", "功能規格", "需求規格", "需求文件", "prototype", "原型", "wireframe", "uml", "use case", "flowchart", "流程圖", "erd", "資料流程", "客戶需求"],
      hardRequiredAny: ["系統分析", "需求訪談", "需求分析", "會議記錄", "會議紀錄", "規格書", "功能規格", "需求規格", "prototype", "原型", "wireframe", "uml", "use case", "flowchart", "流程圖", "erd"],
      hardRequiredPreferred: ["需求訪談", "需求分析", "功能規格", "需求規格", "會議記錄", "會議紀錄", "wireframe", "prototype", "axure", "figma", "erd", "api", "驗收"],
      positiveKeywords: ["系統分析", "需求分析", "需求訪談", "會議記錄", "會議紀錄", "規格書", "需求規格", "功能規格", "需求文件", "uml", "use case", "flowchart", "流程圖", "erd", "api", "wireframe", "prototype", "原型", "axure", "figma", "驗收", "測試", "qa", "sql", "java", "c#", "系統整合", "si", "客戶需求", "跨部門"],
      negativeIfCurrentMissingAny: ["系統分析", "需求訪談", "需求分析", "會議記錄", "會議紀錄", "規格書", "功能規格", "需求規格", "prototype", "wireframe", "uml", "use case", "flowchart", "流程圖", "erd"]
    },
    "qa-engineer": {
      name: "Test Engineer / Quality Assurance",
      hardRequiredAny: ["測試", "qa", "quality assurance", "test"],
      hardRequiredPreferred: ["web", "app", "功能測試", "測試報告", "bug", "postman", "jira"],
      positiveKeywords: ["測試", "qa", "quality assurance", "test", "functional test", "功能測試", "usability test", "使用者測試", "security test", "安全性測試", "壓力測試", "stress test", "整合測試", "測試計畫", "測試報告", "bug", "bug tracking", "issue tracking", "jira", "redmine", "github issues", "postman", "notion", "web", "app", "驗收", "跨瀏覽器"],
      negativeIfCurrentMissingAny: ["測試", "qa", "test", "品質", "驗證"]
    },
    "project-manager": {
      name: "Project Manager",
      hardRequiredAny: ["專案", "project manager", "pm", "專案經理", "專案管理"],
      hardRequiredPreferred: ["web application", "系統分析", "wbs", "jira", "notion", "trello", "agile", "scrum", "pmp"],
      positiveKeywords: ["專案經理", "專案管理", "project manager", "pm", "web application", "系統分析", "需求", "wbs", "流程圖", "jira", "notion", "trello", "agile", "scrum", "瀑布", "pmp", "資源調度", "進度追蹤", "風險控管", "任務分配", "驗收", "結案", "pre sale", "presale", "投標", "簡報", "客戶溝通", "跨部門", "si", "系統整合", "程式開發"],
      negativeIfCurrentMissingAny: ["專案", "pm", "project", "管理", "系統分析"]
    }
  };

  const GAMBLING_KEYWORDS = ["博弈", "博彩", "娛樂城", "線上賭", "casino", "betting", "gaming platform"];
  const SOFTWARE_PROJECT_KEYWORDS = ["si", "系統整合", "軟體專案", "專案開發", "web application", "銀行", "電信"];
  const PRESTIGE_EDUCATION_KEYWORDS = [
    "台大", "臺大", "台灣大學", "臺灣大學", "國立台灣大學", "國立臺灣大學", "ntu",
    "清大", "清華大學", "國立清華大學", "nthu",
    "交大", "交通大學", "陽明交通大學", "國立交通大學", "國立陽明交通大學", "nctu", "nycu",
    "政大", "政治大學", "國立政治大學", "nccu",
    "成大", "成功大學", "國立成功大學", "ncku",
    "國外大學", "外國大學", "海外大學", "美國大學", "英國大學", "日本大學", "加拿大大學", "澳洲大學"
  ];
  const LARGE_COMPANY_KEYWORDS = [
    "500人以上", "五百人以上", "員工500", "員工 500", "員工人數500", "員工人數 500",
    "1000人以上", "一千人以上", "千人以上", "大型企業", "大型公司", "上市", "上櫃", "外商",
    "資本額10億", "資本額 10億", "資本額百億", "資本額 百億"
  ];
  const OVERQUALIFIED_KEYWORDS = ["碩士", "博士"].concat(PRESTIGE_EDUCATION_KEYWORDS, LARGE_COMPANY_KEYWORDS);
  const ASSISTANT_STAGNATION_KEYWORDS = ["助理", "副理", "副工程師", "assistant"];
  const FRONTEND_KEYWORDS = ["vue", "react", "angular", "javascript", "typescript", "html", "css", "jquery"];
  const DATABASE_KEYWORDS = ["mssql", "ms sql", "sql server", "mysql", "oracle", "postgres", "資料庫", "db"];
  const ENGINEERING_PROCESS_KEYWORDS = ["git", "版控", "單元測試", "unit test", "ci/cd", "jira", "敏捷", "agile", "scrum"];
  const PROJECT_DEPTH_KEYWORDS = ["0到1", "架構", "導入", "重構", "效能", "api", "後端", "前端", "平台", "系統"];
  const NON_WEB_DESIRED_TITLE_PATTERN = /資料科學|data\s*scientist|data\s*science|區塊鏈|blockchain|ai\s*工程師|人工智慧|machine\s*learning|機器學習|深度學習|半導體|semiconductor|android|andriod|\bios\b|app\s*工程師|app工程師|mobile|行動/i;

  let isScanning = false;
  let panel;
  let statusNode;
  let startButton;
  let copyButton;
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
  let currentResultFilter = "ranked";
  let currentResultPage = 1;
  let latestCardsByCode = new Map();
  let latestScoreByCode = new Map();
  let filterTimer = 0;
  let isCollapsed = true;
  let isPrintHidden = false;
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
          <strong style="color:${UI.navy};font-size:16px;">104 履歷掃描 v3.0.4</strong>
          <button data-screening-toggle style="width:32px;height:30px;border:1px solid ${UI.border};border-radius:8px;background:#fff;color:${UI.navy};font-weight:900;cursor:pointer;" title="收合成右下角按鈕">－</button>
        </div>
        <div data-screening-summary style="margin-bottom:8px;color:${UI.navy};font-size:13px;font-weight:700;">待掃描</div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;color:${UI.muted};font-size:11px;">
            <span>掃描進度</span>
            <span data-screening-progress-label>0%</span>
          </div>
          <div style="height:8px;border-radius:999px;background:${UI.navySoft};overflow:hidden;border:1px solid ${UI.border};">
            <div data-screening-progress-fill style="width:0%;height:100%;border-radius:999px;background:${UI.navy};transition:width .22s ease;"></div>
          </div>
        </div>
        <div data-screening-status style="margin-bottom:10px;color:${UI.muted};font-size:12px;">會跳過有備註或 3 個月內已發出的人選，並依分數排序</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button data-screening-start style="flex:1;height:36px;border:1px solid ${UI.navy};border-radius:8px;background:${UI.navy};color:#fff;font-weight:700;cursor:pointer;">掃描並依分數排序</button>
          <button data-screening-copy style="height:36px;border:1px solid ${UI.borderStrong};border-radius:8px;background:#fff;color:${UI.navy};font-weight:700;cursor:pointer;">開啟勾選</button>
        </div>
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
    toggleButton = panel.querySelector("[data-screening-toggle]");
    bodyNode = panel.querySelector("[data-screening-body]");
    resultNode = panel.querySelector("[data-screening-results]");
    headerNode = panel.querySelector("[data-screening-header]");
    launcherButton.addEventListener("click", () => setCollapsed(false));
    startButton.addEventListener("click", scan);
    copyButton.addEventListener("click", openRankedProfiles);
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

  function isLowConfidence(value) {
    const normalized = normalizeText(value);
    return normalized === "低" || normalized === "中低";
  }

  function matchCompanyRules(text, rules) {
    return (rules || [])
      .map((rule) => {
        const terms = uniqueTerms([rule.canonicalName].concat(rule.aliases || []));
        const matchedTerm = terms.find((term) => termMatches(text, term));
        if (!matchedTerm) return null;

        return {
          kind: "company",
          id: rule.id,
          category: rule.category,
          label: rule.label,
          matchedTerm,
          displayName: rule.canonicalName,
          scoreDelta: Number(rule.scoreDelta || 0),
          reviewRequired: Boolean(rule.reviewRequired),
          confidence: rule.confidence || "",
          lowConfidence: isLowConfidence(rule.confidence),
          sourceUrl: rule.sourceUrl || "",
          note: rule.note || ""
        };
      })
      .filter(Boolean);
  }

  function matchKeywordRules(text, rules) {
    return (rules || [])
      .map((rule) => {
        const matchedTerm = uniqueTerms(rule.keywords || []).find((term) => termMatches(text, term));
        if (!matchedTerm) return null;

        return {
          kind: "keyword",
          id: rule.id,
          category: rule.category,
          label: rule.normalizedTag,
          matchedTerm,
          displayName: rule.normalizedTag,
          scoreDelta: Number(rule.scoreDelta || 0),
          reviewRequired: Boolean(rule.reviewRequired),
          confidence: "",
          lowConfidence: false,
          sourceUrl: "",
          note: rule.note || ""
        };
      })
      .filter(Boolean);
  }

  function matchRulesAgainstText(text, payload = sharedRuleState.payload) {
    if (!payload) return [];
    return matchCompanyRules(text, payload.companyRules)
      .concat(matchKeywordRules(text, payload.keywordRules))
      .sort((a, b) => {
        if (a.reviewRequired !== b.reviewRequired) return a.reviewRequired ? -1 : 1;
        return Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta);
      });
  }

  function buildRulesApiUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";

    try {
      const url = new URL(value);
      if (!url.searchParams.has("action")) url.searchParams.set("action", "rules");
      return url.toString();
    } catch (_error) {
      return value.includes("?") ? `${value}&action=rules` : `${value}?action=rules`;
    }
  }

  function isHtmlResponse(text) {
    const preview = String(text || "").trim().slice(0, 120).toLowerCase();
    return preview.startsWith("<!doctype") || preview.startsWith("<html") || preview.includes("<head");
  }

  function validateRulePayload(payload) {
    if (!payload || payload.ok === false) {
      throw new Error(payload && payload.message ? payload.message : "規則 API 回傳失敗");
    }

    if (!Array.isArray(payload.companyRules) || !Array.isArray(payload.keywordRules)) {
      throw new Error("規則 API 格式不正確，缺少 companyRules 或 keywordRules。");
    }

    return payload;
  }

  function parseRulesApiResponse(response) {
    const body = String(response.responseText || "").trim();
    if (!body) throw new Error("規則 API 回傳空內容。");
    if (isHtmlResponse(body)) {
      throw new Error("規則 API 回傳 HTML，不是 JSON。請確認 Web App 權限是 Anyone with the link，且 URL 是 /exec?action=rules。");
    }

    try {
      return validateRulePayload(JSON.parse(body));
    } catch (error) {
      throw new Error(`規則 API 回傳不是合法 JSON：${error.message || error}`);
    }
  }

  function readCachedRules() {
    try {
      const cached = JSON.parse(localStorage.getItem(SHARED_RULES_CACHE_KEY) || "null");
      if (!cached || !cached.payload || !cached.fetchedAt) return null;
      return cached;
    } catch (_error) {
      return null;
    }
  }

  function writeCachedRules(payload) {
    localStorage.setItem(SHARED_RULES_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      payload
    }));
  }

  function getPayloadTtlMs(payload) {
    const seconds = Number(payload && payload.ttlSeconds) || DEFAULT_TTL_SECONDS;
    return Math.max(10, seconds) * 1000;
  }

  function isCacheFresh(cached) {
    return Date.now() - Number(cached.fetchedAt || 0) <= getPayloadTtlMs(cached.payload);
  }

  function applyCachedRules(cached, stale) {
    sharedRuleState.payload = cached.payload;
    sharedRuleState.fetchedAt = cached.fetchedAt;
    sharedRuleState.stale = Boolean(stale);
    sharedRuleState.statusMessage = stale ? "共用規則可能非最新，已暫用本機快取。" : "";
  }

  function requestRulesFromApi() {
    return new Promise((resolve, reject) => {
      if (!RULES_API_URL) {
        reject(new Error("尚未設定 Apps Script 規則 API URL。"));
        return;
      }

      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("Tampermonkey 尚未提供 GM_xmlhttpRequest。"));
        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url: buildRulesApiUrl(RULES_API_URL),
        timeout: 15000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`規則 API HTTP ${response.status}`));
            return;
          }

          try {
            resolve(parseRulesApiResponse(response));
          } catch (error) {
            reject(error);
          }
        },
        ontimeout: () => reject(new Error("規則 API 逾時。")),
        onerror: () => reject(new Error("規則 API 連線失敗。"))
      });
    });
  }

  async function refreshSharedRulesInBackground() {
    if (sharedRulesRefreshPromise) return sharedRulesRefreshPromise;
    sharedRulesRefreshPromise = requestRulesFromApi()
      .then((payload) => {
        writeCachedRules(payload);
        applyCachedRules({ payload, fetchedAt: Date.now() }, false);
        return payload;
      })
      .catch((error) => {
        if (!sharedRuleState.payload) {
          sharedRuleState.statusMessage = `共用規則尚未載入，僅使用內建評分規則。（${error.message || error}）`;
        } else {
          sharedRuleState.stale = true;
          sharedRuleState.statusMessage = `共用規則更新失敗，已暫用本機快取。（${error.message || error}）`;
        }
        throw error;
      })
      .finally(() => {
        sharedRulesRefreshPromise = null;
      });
    return sharedRulesRefreshPromise;
  }

  async function loadSharedRules() {
    const cached = readCachedRules();
    if (cached) {
      applyCachedRules(cached, !isCacheFresh(cached));
      if (!isCacheFresh(cached)) {
        refreshSharedRulesInBackground().catch((error) => {
          console.warn("shared rules background refresh failed", error);
        });
      }
      return;
    }

    try {
      await refreshSharedRulesInBackground();
    } catch (error) {
      if (cached) {
        applyCachedRules(cached, true);
        return;
      }

      sharedRuleState.payload = null;
      sharedRuleState.statusMessage = `共用規則尚未載入，僅使用內建評分規則。（${error.message || error}）`;
    }
  }

  function extractResumeCode(value) {
    const match = normalizeText(value).match(/(?:代碼\s*[：:]?\s*)?(\d{8,})/);
    return match?.[1] || "";
  }

  function getCutoffDate() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - MONTHS_TO_HIDE);
    cutoff.setHours(0, 0, 0, 0);
    return cutoff;
  }

  function parseHistoryDate(text) {
    const match = text.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  }

  function hasRecentActiveOutreach(card) {
    const cutoffDate = getCutoffDate();
    const historyItems = card.querySelectorAll(".history-list__collapse .list-txt");
    return [...historyItems].some((item) => {
      const text = item.textContent || "";
      const historyDate = parseHistoryDate(text);
      return /發出(?:邀約|面試邀約|職缺邀約|通知|訊息|信件)?/.test(text) && historyDate && historyDate >= cutoffDate;
    });
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
    });
    skippedCards = new Map();
  }

  function getSkipReason(card) {
    const role = ROLE_RULES[inferRoleId()] || {};
    const cardMeta = extractCardMeta(card);
    if (isAllEnglishName(cardMeta.candidateName)) return "姓名為全英文，略過外籍候選人";
    const titleMismatchReason = nonWebDesiredTitleRejectReason(role, cardMeta);
    if (titleMismatchReason) return titleMismatchReason;
    const engineerMismatchReason = nonTargetEngineerRejectReason(role, cardMeta);
    if (engineerMismatchReason) return engineerMismatchReason;
    if (card.querySelector(".resume-remark.mt-2")) return "已有備註";
    if (hasRecentActiveOutreach(card)) return `近 ${MONTHS_TO_HIDE} 個月已有發出紀錄`;
    return "";
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

  function sharedRulesVersion() {
    const payload = sharedRuleState.payload;
    if (!payload) return "no-rules";
    return payload.version || payload.generatedAt || [
      payload.schemaVersion || "",
      payload.companyRules?.length || 0,
      payload.keywordRules?.length || 0,
      sharedRuleState.fetchedAt || 0
    ].join(":");
  }

  function getRuleMatchesForCard(card) {
    const signature = cardTextSignature(card);
    const version = sharedRulesVersion();
    const cached = cardRuleMatchCache.get(card);
    if (cached && cached.signature === signature && cached.version === version) return cached.matches;

    const matches = matchRulesAgainstText(getCardReadableText(card));
    cardRuleMatchCache.set(card, { signature, version, matches });
    return matches;
  }

  function cardScoreSignature(code) {
    const item = latestScoreByCode.get(code);
    return item ? `${item.score}:${item.status}:${item.reasons.slice(0, 2).join("/")}` : "no-score";
  }

  function cardFilterKey(card) {
    const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
    return [
      cardTextSignature(card),
      sharedRulesVersion(),
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

  function buildRuleBadgeText(match) {
    const scoreText = match.scoreDelta > 0 ? `+${match.scoreDelta}` : String(match.scoreDelta || 0);
    if (match.reviewRequired || match.category === "risk_gambling") return `博弈風險 ${scoreText}｜人工覆核`;
    if (match.category === "positive_si" || match.label === "SI_VENDOR") return `SI ${scoreText}`;
    return `${match.label || match.displayName} ${scoreText}`;
  }

  function buildRuleBadgeTitle(match) {
    return [
      `命中：${match.matchedTerm}`,
      match.displayName ? `規則：${match.displayName}` : "",
      match.confidence ? `可信度：${match.confidence}` : "",
      match.note ? `備註：${match.note}` : "",
      match.sourceUrl ? `來源：${match.sourceUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  function renderRuleBadges(card, matches) {
    const existing = card.querySelector("[data-resume-shared-rules-badges]");
    if (!matches.length) {
      if (existing) existing.remove();
      return;
    }

    const container = ensureBadgeContainer(card);
    const renderKey = matches
      .slice(0, BADGE_LIMIT)
      .map((match) => [match.id, match.matchedTerm, match.scoreDelta, match.lowConfidence].join(":"))
      .join("|");
    if (container.dataset.resumeSharedRulesRenderKey === renderKey) return;

    container.dataset.resumeSharedRulesRenderKey = renderKey;
    container.textContent = "";

    matches.slice(0, BADGE_LIMIT).forEach((match) => {
      const badge = document.createElement("span");
      const isRisk = match.reviewRequired || match.category === "risk_gambling";
      badge.className = [
        "resume-shared-rule-badge",
        isRisk ? "resume-shared-rule-badge--risk" : "resume-shared-rule-badge--positive",
        match.lowConfidence ? "resume-shared-rule-badge--low" : ""
      ].filter(Boolean).join(" ");
      badge.textContent = buildRuleBadgeText(match);
      badge.title = buildRuleBadgeTitle(match);
      container.append(badge);
    });
  }

  function getRuleHideReason(matches) {
    if (RISK_ACTION !== "hide") return "";
    const riskMatch = matches.find((match) => match.reviewRequired && !match.lowConfidence && match.category === "risk_gambling");
    return riskMatch ? `命中博弈風險規則：${riskMatch.matchedTerm}` : "";
  }

  function filterResumeCards(options = {}) {
    if (!shouldHideCardsOnThisPage()) {
      restoreHiddenCards();
      return;
    }
    const maxCards = options.force || isScanning ? Infinity : FILTER_MAX_CARDS_PER_PASS;
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    let processed = 0;
    let hasMorePendingCards = false;

    for (const card of cards) {
      const filterKey = cardFilterKey(card);
      if (!options.force && card.dataset.resumeScreeningFilterKey === filterKey) continue;

      const ruleMatches = getRuleMatchesForCard(card);
      renderRuleBadges(card, ruleMatches);
      const code = extractResumeCode(card.querySelector(CODE_SELECTOR)?.textContent || card.id);
      const scoredItem = latestScoreByCode.get(code);
      if (scoredItem) renderScoreBadge(card, scoredItem);
      const reason = card.dataset.resumeScreeningSkipped || getSkipReason(card) || getRuleHideReason(ruleMatches);
      if (reason) {
        rememberSkippedCard(card, reason);
        hideSkippedCard(card, reason);
      }
      card.dataset.resumeScreeningFilterKey = cardFilterKey(card);
      processed += 1;
      if (processed >= maxCards) {
        hasMorePendingCards = true;
        break;
      }
    }

    if (hasMorePendingCards && !isScanning) scheduleFilterResumeCards(FILTER_DEBOUNCE_MS);
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

  function inferRoleId() {
    const url = new URL(location.href);
    const searchText = [url.searchParams.get("kws"), decodeURIComponent(location.href)].join(" ").toLowerCase();
    if (searchText.includes("java") || searchText.includes("spring")) return "java-programmer";
    if (searchText.includes("c#") || searchText.includes(".net") || searchText.includes("asp.net")) return "csharp-dotnet-programmer";
    if (searchText.includes("system analyst") || searchText.includes("系統分析") || searchText.includes("sa") || searchText.includes("uml")) return "system-analyst";
    if (searchText.includes("qa") || searchText.includes("quality assurance") || searchText.includes("test engineer") || searchText.includes("測試")) return "qa-engineer";
    if (searchText.includes("project manager") || searchText.includes("專案經理") || searchText.includes("專案管理") || searchText.includes("pmp")) return "project-manager";
    return "unknown-role";
  }

  function parseDurationMonths(text) {
    const yearMatch = text.match(/(\d+)\s*年/);
    const monthMatch = text.match(/(\d+)\s*個月/);
    if (!yearMatch && !monthMatch) return null;
    return (Number(yearMatch?.[1] || 0) * 12) + Number(monthMatch?.[1] || 0);
  }

  function parseYearMonth(text) {
    const match = text.match(/(\d{4})\/(\d{1,2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, 1);
  }

  function monthDiff(fromDate, toDate) {
    if (!fromDate || !toDate) return 0;
    return Math.max(0, (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth()));
  }

  function formatMonths(months) {
    const value = Math.max(0, Math.round(Number(months) || 0));
    const years = Math.floor(value / 12);
    const restMonths = value % 12;
    if (years && restMonths) return `${years} 年 ${restMonths} 個月`;
    if (years) return `${years} 年`;
    return `${restMonths} 個月`;
  }

  function parseJobPeriod(text) {
    const range = text.match(/(\d{4}\/\d{1,2})\s*~\s*(\d{4}\/\d{1,2}|至今|目前|仍在職)/);
    if (range) {
      return {
        start: parseYearMonth(range[1]),
        end: /至今|目前|仍在職/.test(range[2]) ? null : parseYearMonth(range[2]),
        current: /至今|目前|仍在職/.test(range[2])
      };
    }

    const current = text.match(/(\d{4}\/\d{1,2}).*仍在職/);
    if (current) {
      return { start: parseYearMonth(current[1]), end: null, current: true };
    }

    const single = parseYearMonth(text);
    return single ? { start: single, end: single, current: false } : null;
  }

  function deriveGapSignals(jobLines) {
    const periods = jobLines.map(parseJobPeriod).filter(Boolean);
    if (!periods.length) {
      return { recentGapMonths: 0, repeatedShortGaps: false, gapReason: "", gapDetails: [] };
    }

    const today = new Date();
    const latest = periods[0];
    const recentGapMonths = latest.current ? 0 : monthDiff(latest.end, today);
    const gapDetails = [];
    let gapCount = 0;

    if (recentGapMonths >= 3) {
      gapDetails.push({
        label: "最近一份結束後",
        months: recentGapMonths
      });
    }

    for (let index = 0; index < periods.length - 1; index += 1) {
      const newer = periods[index];
      const older = periods[index + 1];
      if (!older.end || !newer.start) continue;
      const gapMonths = monthDiff(older.end, newer.start);
      if (gapMonths >= 3) {
        gapCount += 1;
        gapDetails.push({
          label: `第 ${index + 1} 與第 ${index + 2} 份工作間`,
          months: gapMonths
        });
      }
    }

    const allText = jobLines.join(" ");
    const hasReason = /進修|照顧|家庭|育嬰|當兵|創業|gap|休息|健康|留學/.test(allText);

    return {
      recentGapMonths,
      repeatedShortGaps: gapCount >= 2,
      gapReason: hasReason ? "卡片工作經歷提到合理空窗原因" : "",
      gapDetails
    };
  }

  function deriveStability(jobLines) {
    const completedDurations = jobLines.map(parseDurationMonths).filter((months) => Number.isFinite(months));
    const recentTwo = completedDurations.slice(0, 2);
    const recentThree = completedDurations.slice(0, 3);
    return {
      lastThreeJobsAllUnderOneYear: completedDurations.slice(0, 3).length === 3
        && completedDurations.slice(0, 3).every((months) => months <= 12),
      lastTwoJobsBothUnderThreeMonths: completedDurations.slice(0, 2).length === 2
        && completedDurations.slice(0, 2).every((months) => months < 3),
      lastTwoJobsBothUnderOneYear: recentTwo.length === 2 && recentTwo.every((months) => months < 12),
      lastThreeJobsAllUnderTwoYears: recentThree.length === 3 && recentThree.every((months) => months <= 24),
      recentJobDurations: recentThree
    };
  }

  function extractCardMeta(card) {
    const jobLines = [...card.querySelectorAll(JOB_HISTORY_SELECTOR)].map((item) => normalizeText(item.textContent));
    return {
      candidateName: normalizeText(card.querySelector(NAME_SELECTOR)?.textContent),
      currentTitle: normalizeText(card.querySelector(PREFER_TITLE_SELECTOR)?.textContent).replace(/^希望職稱\s*[：:]?\s*/, ""),
      experienceText: jobLines.join(" | ")
    };
  }

  function extractCard(card) {
    const codeText = normalizeText(card.querySelector(CODE_SELECTOR)?.textContent);
    const jobLines = [...card.querySelectorAll(JOB_HISTORY_SELECTOR)].map((item) => normalizeText(item.textContent));
    const allText = getCardReadableText(card);
    const href = card.querySelector(PROFILE_LINK_SELECTOR)?.getAttribute("href") || "";
    const cardMeta = extractCardMeta(card);
    const ruleMatches = matchRulesAgainstText(allText);

    return {
      resumeCode: extractResumeCode(codeText || card.id),
      profileUrl: new URL(href, location.origin).toString(),
      candidateName: cardMeta.candidateName,
      currentTitle: cardMeta.currentTitle,
      summary: allText,
      experienceText: cardMeta.experienceText,
      education: normalizeText(card.querySelector(EDUCATION_SELECTOR)?.textContent),
      workExperience: normalizeText(card.querySelector(WORK_EXPERIENCE_SELECTOR)?.textContent),
      hasProjectAchievement: /專案|系統|平台|開發|導入|架構|後端|前端|api|db|database|spring|\.net|mssql|mysql|oracle|銀行|電信/i.test(allText),
      ruleMatches,
      ...deriveGapSignals(jobLines),
      autobiographyMostlyPersonal: false,
      sameLevelYears: 0,
      ...deriveStability(jobLines)
    };
  }

  function buildText(card) {
    return [card.resumeCode, card.candidateName, card.currentTitle, card.summary, card.experienceText, card.education].join(" ");
  }

  function splitExperienceLines(card) {
    const lines = String(card.experienceText || "").split("|").map((line) => line.trim()).filter(Boolean);
    return lines;
  }

  function recentExperienceText(card, take = 3) {
    const lines = splitExperienceLines(card);
    return [card.currentTitle, ...lines.slice(0, take), card.summary].join(" ");
  }

  function roleFocusedText(card, take = 4) {
    const lines = splitExperienceLines(card);
    return [card.currentTitle, ...lines.slice(0, take), card.education].join(" ");
  }

  function parseWorkYears(card) {
    const text = [card.workExperience, card.summary].join(" ");
    const range = text.match(/(\d+)\s*~\s*(\d+)\s*年工作經驗/);
    if (range) return (Number(range[1]) + Number(range[2])) / 2;
    const exact = text.match(/(\d+)\s*年工作經驗/);
    return exact ? Number(exact[1]) : 0;
  }

  function addFactor(factors, label, points, details = "") {
    if (!points) return 0;
    factors.push({ label, points, details });
    return points;
  }

  function hardRejectReasons(role, card, text) {
    const reasons = [];
    if (isAllEnglishName(card.candidateName)) reasons.push("姓名為全英文，略過外籍候選人");
    const titleMismatchReason = nonWebDesiredTitleRejectReason(role, card);
    if (titleMismatchReason) reasons.push(titleMismatchReason);
    const mismatchReason = nonTargetEngineerRejectReason(role, card);
    if (mismatchReason) reasons.push(mismatchReason);
    if (card.lastThreeJobsAllUnderOneYear) reasons.push("近三份工作皆一年或不滿一年，直接排除");
    if (card.lastTwoJobsBothUnderThreeMonths) reasons.push("近兩份工作皆不滿三個月，直接排除");
    return reasons;
  }

  function isAllEnglishName(name) {
    const compact = normalizeText(name);
    return /[a-z]/i.test(compact) && /^[a-z\s.'-]+$/i.test(compact);
  }

  function isProgrammerRole(role) {
    return /Java Software Programmer|C#\.Net Software Programmer/i.test(role.name || "");
  }

  function hasBackendOrGeneralSoftwareSignal(text) {
    return /後端|backend|back-end|全端|full\s*stack|full-stack|軟體工程師|software engineer|程式設計工程師|程式設計師|系統工程師/i.test(text);
  }

  function nonWebDesiredTitleRejectReason(role, card) {
    const title = normalizeText(card.currentTitle);
    if (!title || !NON_WEB_DESIRED_TITLE_PATTERN.test(title)) return "";
    return "期待職稱明顯非網頁/後端/全端/軟體工程師需求";
  }

  function nonTargetEngineerRejectReason(role, card) {
    if (!isProgrammerRole(role)) return "";
    const title = normalizeText(card.currentTitle);
    const recentLines = splitExperienceLines(card).slice(0, 2).join(" ");
    const focusedText = `${title} ${recentLines}`;
    const frontendOnly = /前端|frontend|front-end/i.test(title) && !hasBackendOrGeneralSoftwareSignal(title);
    const nonTargetRecent = /\bgo\b|golang|php|前端|frontend|front-end/i.test(focusedText) && !hasBackendOrGeneralSoftwareSignal(focusedText);
    if (frontendOnly) return "希望職稱為純前端工程師，與後端/全端工程師需求不符";
    if (nonTargetRecent) return "近期工作明顯偏前端/Go/PHP，且未顯示後端/全端/軟體工程師訊號";
    return "";
  }

  function coreMismatchPenalty(role, card) {
    const focusedText = roleFocusedText(card, 4);
    const coreCompetencyMatches = countMatches(focusedText, role.coreCompetencyKeywords || []);
    const minimumCoreMatches = role.minimumCoreMatches || 0;
    if (minimumCoreMatches && coreCompetencyMatches.length < minimumCoreMatches) {
      return {
        points: coreCompetencyMatches.length ? -8 : -14,
        details: `需 ${minimumCoreMatches} 項核心職能，命中 ${coreCompetencyMatches.length} 項`
      };
    }
    if ((role.negativeIfCurrentMissingAny || []).length && !includesAny(focusedText, role.negativeIfCurrentMissingAny)) {
      return {
        points: -12,
        details: "近期職稱與前幾段經歷未顯示核心技術"
      };
    }
    return null;
  }

  function describeRuleMatch(match) {
    return `${match.matchedTerm}${match.displayName && match.displayName !== match.matchedTerm ? `/${match.displayName}` : ""}`;
  }

  function uniqueList(values) {
    return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
  }

  function ruleDisplayName(match) {
    return normalizeText(match.canonicalName || match.displayName || match.matchedTerm || match.label || match.id);
  }

  function positiveSiCompanyNames(card) {
    return uniqueList((card.ruleMatches || [])
      .filter((match) => !match.reviewRequired && match.category !== "risk_gambling" && Number(match.scoreDelta || 0) > 0)
      .map(ruleDisplayName));
  }

  function gamblingRiskNames(card, riskFlags) {
    const ruleNames = (card.ruleMatches || [])
      .filter((match) => match.reviewRequired || match.category === "risk_gambling")
      .map(ruleDisplayName);
    return uniqueList(ruleNames.concat(riskFlags || []));
  }

  function gapDisplaySummary(card) {
    const gaps = (card.gapDetails || []).filter((gap) => Number(gap.months) >= 3);
    if (!gaps.length) return "";
    const details = gaps
      .slice(0, 4)
      .map((gap) => `${gap.label} ${formatMonths(gap.months)}`)
      .join("；");
    return `空窗期過長：${gaps.length} 個空窗，${details}${card.gapReason ? `（${card.gapReason}）` : ""}`;
  }

  function stabilityDisplaySummary(card) {
    const reasons = [];
    const durationText = (card.recentJobDurations || []).map(formatMonths).join("、");
    if (card.lastTwoJobsBothUnderOneYear) reasons.push(`最近兩份皆不滿一年${durationText ? `（${durationText}）` : ""}`);
    if (card.lastThreeJobsAllUnderTwoYears) reasons.push(`最近三份皆兩年以下${durationText ? `（${durationText}）` : ""}`);
    if (!reasons.length) return "";
    return `工作不穩定：${reasons.join("；")}`;
  }

  function coreBonusSummary(factors) {
    const allowedLabels = new Set([
      "核心技術",
      "框架/進階技術",
      "資料庫經驗",
      "前端/全端廣度",
      "工程流程成熟度",
      "專案深度",
      "產業/專案背景",
      "共用清單加分"
    ]);
    const summaries = factors
      .filter((factor) => factor.points > 0 && allowedLabels.has(factor.label) && normalizeText(factor.details))
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((factor) => `${factor.label}：${factor.details}`);
    return summaries.length ? `核心加分項：${summaries.join("；")}` : "";
  }

  function penaltySummary(factors) {
    const summaries = factors
      .filter((factor) => factor.points < 0 && normalizeText(factor.details))
      .sort((a, b) => a.points - b.points)
      .slice(0, 3)
      .map((factor) => `${factor.label} ${Math.round(factor.points)}：${factor.details}`);
    return summaries.length ? `扣分項：${summaries.join("；")}` : "";
  }

  function buildDisplayReasons(card, factors = [], riskFlags = [], rejectedReasons = []) {
    const lines = [];
    const siNames = positiveSiCompanyNames(card);
    const gamblingNames = gamblingRiskNames(card, riskFlags);
    const gapSummary = gapDisplaySummary(card);
    const stabilitySummary = stabilityDisplaySummary(card);
    const penalty = penaltySummary(factors);
    const bonus = coreBonusSummary(factors);

    if (siNames.length) lines.push(`同業SI公司：${siNames.slice(0, 4).join("、")}`);
    if (gamblingNames.length) lines.push(`博弈：疑似 ${gamblingNames.slice(0, 5).join("、")}`);
    if (gapSummary) lines.push(gapSummary);
    if (stabilitySummary) lines.push(stabilitySummary);
    rejectedReasons.forEach((reason) => lines.push(`排除原因：${reason}`));
    if (penalty) lines.push(penalty);
    if (bonus) lines.push(bonus);
    return uniqueList(lines).slice(0, 6);
  }

  function riskFlagsForCard(card, text) {
    const remoteRiskFlags = (card.ruleMatches || [])
      .filter((match) => match.reviewRequired || match.category === "risk_gambling")
      .map((match) => describeRuleMatch(match));
    const keywordRiskFlags = countMatches(text, GAMBLING_KEYWORDS);
    return [...new Set(remoteRiskFlags.concat(keywordRiskFlags))];
  }

  function positiveRuleMatchesForCard(card) {
    return (card.ruleMatches || []).filter((match) => (
      !match.reviewRequired &&
      match.category !== "risk_gambling" &&
      Number(match.scoreDelta || 0) > 0
    ));
  }

  function clientScoringConfig() {
    return (sharedRuleState.payload && sharedRuleState.payload.clientScoring) || {};
  }

  function clientConfigNumber(group, key, fallback) {
    const value = Number(clientScoringConfig()?.[group]?.[key]);
    return Number.isFinite(value) ? value : fallback;
  }

  function clientTimingValue(key, fallback) {
    const value = Number(clientScoringConfig()?.scanTiming?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function clientPenaltyValue(key, fallback) {
    return clientConfigNumber("penalties", key, fallback);
  }

  function clientKeywordList(key, fallback) {
    const values = clientScoringConfig()?.specialFlags?.[key];
    if (!Array.isArray(values) || !values.length) return fallback;
    return uniqueList(values.concat(fallback));
  }

  function lowQualityMaxNormalizedScore() {
    return Math.max(0, clientConfigNumber("scoreNormalization", "lowQualityMaxScore", LOW_QUALITY_MAX_NORMALIZED_SCORE));
  }

  function meaningfulBonusLabels() {
    return new Set([
      "職務核心職能",
      "核心技術",
      "框架/進階技術",
      "職位關鍵字覆蓋",
      "資料庫經驗",
      "前端/全端廣度",
      "工程流程成熟度",
      "專案深度",
      "產業/專案背景",
      "共用清單加分"
    ]);
  }

  function hasMeaningfulPositiveSignals(factors) {
    const labels = meaningfulBonusLabels();
    return factors.some((factor) => factor.points > 0 && labels.has(factor.label));
  }

  function uniqueMatches(text, keywords) {
    return uniqueList(countMatches(text, keywords));
  }

  function erfApprox(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCdf(value) {
    return 0.5 * (1 + erfApprox(value / Math.SQRT2));
  }

  function rawScoreOf(item) {
    const value = Number(item.rawScore);
    return Number.isFinite(value) ? value : Number(item.score || 0);
  }

  function candidateTieBreaker(a, b) {
    return String(a.candidateName || a.resumeCode || "").localeCompare(String(b.candidateName || b.resumeCode || ""));
  }

  function qualityAdjustedScore(normalizedScore, item) {
    if (item.status === "excluded") return 0;
    let score = clamp(Math.round(normalizedScore), 0, 100);
    if (item.qualityFlags && item.qualityFlags.noMeaningfulPositiveSignals) {
      score = Math.min(score, lowQualityMaxNormalizedScore());
    }
    return score;
  }

  function applyScanScoreDistribution(scoredItems) {
    const eligible = scoredItems.filter((item) => item.status !== "excluded");
    if (!eligible.length) return scoredItems;

    if (eligible.length === 1) {
      const item = eligible[0];
      item.score = qualityAdjustedScore(rawScoreOf(item), item);
      item.distributionScore = item.score;
      return scoredItems;
    }

    const rawScores = eligible.map(rawScoreOf);
    const mean = rawScores.reduce((sum, score) => sum + score, 0) / rawScores.length;
    const variance = rawScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / rawScores.length;
    const standardDeviation = Math.sqrt(variance);

    if (!standardDeviation) {
      eligible
        .slice()
        .sort(candidateTieBreaker)
        .forEach((item, index) => {
          const rankScore = eligible.length === 1 ? 100 : (index / (eligible.length - 1)) * 100;
          item.score = qualityAdjustedScore(rankScore, item);
          item.distributionScore = item.score;
        });
      return scoredItems;
    }

    const cdfScores = eligible.map((item) => normalCdf((rawScoreOf(item) - mean) / standardDeviation));
    const minCdf = Math.min.apply(null, cdfScores);
    const maxCdf = Math.max.apply(null, cdfScores);
    const range = maxCdf - minCdf || 1;

    eligible.forEach((item, index) => {
      const normalizedScore = ((cdfScores[index] - minCdf) / range) * 100;
      item.score = qualityAdjustedScore(normalizedScore, item);
      item.distributionScore = item.score;
    });

    return scoredItems;
  }

  function scoreCard(role, card) {
    const text = buildText(card);
    const riskFlags = riskFlagsForCard(card, text);
    const rejectedReasons = hardRejectReasons(role, card, text);
    if (rejectedReasons.length) {
      return {
        resumeCode: card.resumeCode,
        candidateName: card.candidateName || "",
        currentTitle: card.currentTitle || "",
        profileUrl: card.profileUrl || "",
        score: 0,
        rawScore: 0,
        status: "excluded",
        reasons: rejectedReasons,
        displayReasons: buildDisplayReasons(card, [], riskFlags, rejectedReasons),
        ruleMatches: card.ruleMatches || [],
        riskFlags,
        cardElementAvailable: false
      };
    }

    const factors = [];
    let score = 36;
    const recentText = recentExperienceText(card, 2);
    const focusedText = roleFocusedText(card, 4);
    const workYears = parseWorkYears(card);

    const competencyMatches = countMatches(focusedText, role.coreCompetencyKeywords || []);
    score += addFactor(factors, "職務核心職能", Math.min(24, competencyMatches.length * 6), competencyMatches.slice(0, 8).join("、"));
    const coreMatches = countMatches(focusedText, role.hardRequiredAny || []);
    score += addFactor(factors, "核心技術", Math.min(20, coreMatches.length * 14), coreMatches.join("、"));
    const corePenalty = coreMismatchPenalty(role, card);
    if (corePenalty) {
      score += addFactor(factors, "核心職能不足", corePenalty.points, corePenalty.details);
    }
    const preferredMatches = countMatches(text, role.hardRequiredPreferred || []);
    score += addFactor(factors, "框架/進階技術", Math.min(14, preferredMatches.length * 7), preferredMatches.join("、"));
    const roleMatches = countMatches(text, role.positiveKeywords || []);
    score += addFactor(factors, "職位關鍵字覆蓋", Math.min(14, roleMatches.length * 1.6), roleMatches.slice(0, 10).join("、"));
    score += addFactor(factors, "資料庫經驗", Math.min(8, countMatches(text, DATABASE_KEYWORDS).length * 3), countMatches(text, DATABASE_KEYWORDS).join("、"));
    score += addFactor(factors, "前端/全端廣度", Math.min(6, countMatches(text, FRONTEND_KEYWORDS).length * 1.5), countMatches(text, FRONTEND_KEYWORDS).slice(0, 6).join("、"));
    score += addFactor(factors, "工程流程成熟度", Math.min(6, countMatches(text, ENGINEERING_PROCESS_KEYWORDS).length * 2), countMatches(text, ENGINEERING_PROCESS_KEYWORDS).join("、"));
    score += addFactor(factors, "專案深度", Math.min(7, countMatches(text, PROJECT_DEPTH_KEYWORDS).length * 1.5), countMatches(text, PROJECT_DEPTH_KEYWORDS).slice(0, 6).join("、"));
    score += addFactor(factors, "產業/專案背景", Math.min(7, countMatches(text, SOFTWARE_PROJECT_KEYWORDS).length * 2.5), countMatches(text, SOFTWARE_PROJECT_KEYWORDS).join("、"));

    const positiveRuleMatches = positiveRuleMatchesForCard(card);
    const positiveRulePoints = Math.min(8, positiveRuleMatches.reduce((sum, match) => sum + Number(match.scoreDelta || 0), 0));
    score += addFactor(
      factors,
      "共用清單加分",
      positiveRulePoints,
      positiveRuleMatches.map(describeRuleMatch).slice(0, 6).join("、")
    );

    if (workYears >= 10) {
      const penalty = Math.max(1, Math.floor(workYears - 9));
      score -= penalty;
      addFactor(factors, "年資過高", -penalty, `${workYears} 年，10 年以上每多 1 年扣 1 分`);
    } else if (workYears >= 5) score += addFactor(factors, "年資區間", 2, `${workYears} 年，5~10 年`);
    else if (workYears >= 3) score += addFactor(factors, "年資區間", 5, `${workYears} 年，3~5 年`);
    else if (workYears >= 1) score += addFactor(factors, "年資區間", 3, `${workYears} 年，1~3 年`);

    if (card.recentGapMonths >= 3 && !card.gapReason) {
      const penalty = card.recentGapMonths >= 18
        ? Math.abs(clientPenaltyValue("recentGapMonths18Plus", -34))
        : card.recentGapMonths >= 12
          ? Math.abs(clientPenaltyValue("recentGapMonths12To17", -28))
          : card.recentGapMonths >= 6
            ? Math.abs(clientPenaltyValue("recentGapMonths6To11", -22))
            : Math.abs(clientPenaltyValue("recentGapMonths3To5", -16));
      score -= penalty;
      addFactor(factors, "近期空窗", -penalty, `最近一份工作結束後約 ${card.recentGapMonths} 個月未見在職/合理原因`);
    }

    if (card.repeatedShortGaps) {
      const penalty = Math.abs(clientPenaltyValue("repeatedWorkGap", -14));
      score -= penalty;
      addFactor(factors, "工作間空窗", -penalty, "多段工作間隔超過 3 個月");
    }

    if (card.lastTwoJobsBothUnderOneYear || card.lastThreeJobsAllUnderTwoYears) {
      const stabilityReasons = [];
      if (card.lastTwoJobsBothUnderOneYear) stabilityReasons.push("最近兩份皆不滿一年");
      if (card.lastThreeJobsAllUnderTwoYears) stabilityReasons.push("最近三份皆兩年以下");
      const penalty = card.lastTwoJobsBothUnderOneYear && card.lastThreeJobsAllUnderTwoYears
        ? Math.abs(clientPenaltyValue("veryUnstableRecentJobs", -22))
        : Math.abs(clientPenaltyValue("unstableRecentJobs", -16));
      score -= penalty;
      addFactor(factors, "工作穩定性", -penalty, stabilityReasons.join("；"));
    }

    const qualityFlags = {
      noMeaningfulPositiveSignals: false
    };
    if (!hasMeaningfulPositiveSignals(factors)) {
      qualityFlags.noMeaningfulPositiveSignals = true;
      const penalty = Math.abs(clientConfigNumber("scoreNormalization", "noMeaningfulPositivePenalty", -28));
      score -= penalty;
      addFactor(factors, "缺少明確加分項", -penalty, "卡片未命中核心技術、專案深度、資料庫、工程流程或共用清單加分");
    }

    const prestigeEducationMatches = uniqueMatches(text, clientKeywordList("prestigeEducationKeywords", PRESTIGE_EDUCATION_KEYWORDS));
    if (prestigeEducationMatches.length) {
      const penalty = Math.abs(clientPenaltyValue("prestigeEducation", -12));
      score -= penalty;
      addFactor(factors, "過高學歷標注", -penalty, `命中 ${prestigeEducationMatches.slice(0, 5).join("、")}，需評估薪資/發展期待落差`);
    }

    const largeCompanyMatches = uniqueMatches(text, clientKeywordList("largeCompanyKeywords", LARGE_COMPANY_KEYWORDS));
    if (largeCompanyMatches.length) {
      const penalty = Math.abs(clientPenaltyValue("largeCompany", -10));
      score -= penalty;
      addFactor(factors, "大型公司標注", -penalty, `命中 ${largeCompanyMatches.slice(0, 5).join("、")}，可能有薪資、年終或資源落差`);
    } else if (includesAny(text, OVERQUALIFIED_KEYWORDS)) {
      score -= 6;
      addFactor(factors, "過於優秀風險", -6, "學歷或公司背景可能高於職缺預期");
    }
    if (includesAny(text, ASSISTANT_STAGNATION_KEYWORDS) && card.sameLevelYears >= 5) {
      score -= 6;
      addFactor(factors, "特殊職涯狀況", -6, "助理/副職級停留超過 5 年");
    }

    return {
      resumeCode: card.resumeCode,
      candidateName: card.candidateName || "",
      currentTitle: card.currentTitle || "",
      profileUrl: card.profileUrl || "",
      score: Math.max(0, Math.min(100, Math.round(score))),
      rawScore: Math.max(0, Math.min(100, Math.round(score))),
      status: riskFlags.length ? "review_required" : "ranked",
      ruleMatches: card.ruleMatches || [],
      riskFlags,
      cardElementAvailable: false,
      qualityFlags,
      displayReasons: buildDisplayReasons(card, factors, riskFlags),
      reasons: factors
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .map((factor) => `${factor.label} ${factor.points > 0 ? "+" : ""}${Math.round(factor.points)}：${factor.details}`)
        .concat(riskFlags.length ? [`人工覆核：${riskFlags.slice(0, 5).join("、")}`] : [])
        .slice(0, 8)
    };
  }

  function rankCandidates(cards) {
    const role = ROLE_RULES[inferRoleId()] || {
      name: "Unknown Role",
      hardRequiredAny: [],
      hardRequiredPreferred: [],
      positiveKeywords: [],
      negativeIfCurrentMissingAny: []
    };
    const scored = applyScanScoreDistribution(cards.map((card) => scoreCard(role, card)));
    const excludedItems = scored.filter((item) => item.status === "excluded");
    const excludedCount = excludedItems.length;
    const excludedReasonCounts = excludedItems.reduce((counts, item) => {
      const reason = item.reasons[0] || "其他硬排除";
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {});
    const ranked = scored
      .filter((item) => item.status === "ranked")
      .sort((a, b) => b.score - a.score || candidateTieBreaker(a, b));
    const reviewRequired = scored
      .filter((item) => item.status === "review_required")
      .sort((a, b) => b.score - a.score || candidateTieBreaker(a, b));
    return {
      ranked,
      reviewRequired,
      excluded: excludedItems,
      allResults: ranked.concat(reviewRequired).concat(excludedItems),
      excludedCount,
      excludedReasonCounts,
      scoredCount: scored.length
    };
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
    setProgress(progressPercent(cardsByCode, totalCount));
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
    return {
      ranked: latestRanked,
      review: latestReviewRequired,
      excluded: latestExcluded,
      all: latestAllResults
    };
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

  function renderResultItem(item, absoluteIndex) {
    const checked = selectedResumeCodes.has(item.resumeCode) ? "checked" : "";
    const disabled = item.profileUrl ? "" : "disabled";
    const displayReasons = (item.displayReasons && item.displayReasons.length ? item.displayReasons : item.reasons || []).slice(0, 5);
    const statusLabel = item.status === "review_required" ? "人工覆核" : item.status === "excluded" ? "排除" : "推薦";
    const statusColor = item.status === "review_required" ? UI.warningBg : item.status === "excluded" ? "#eef2f6" : UI.navySoft;
    const statusBorder = item.status === "review_required" ? "#d7a45b" : item.status === "excluded" ? UI.border : UI.borderStrong;
    const statusTextColor = item.status === "review_required" ? UI.warning : item.status === "excluded" ? UI.muted : UI.navy;
    const cardMark = item.cardElementAvailable ? "目前頁" : "跨頁/未載入";
    const displayName = normalizeText(item.candidateName) || `候選人 ${absoluteIndex}`;
    const currentTitle = normalizeText(item.currentTitle);
    return `
      <article data-result-item="${escapeHtml(item.resumeCode)}" style="border:1px solid ${UI.border};border-radius:8px;background:${UI.surface};padding:10px;cursor:${item.profileUrl ? "pointer" : "default"};box-shadow:0 1px 2px rgba(15,39,66,.04);" title="${item.profileUrl ? "點擊卡片可切換勾選" : ""}">
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:start;">
          <input type="checkbox" data-result-select="${escapeHtml(item.resumeCode)}" ${checked} ${disabled} title="勾選後可批次開啟">
          <div style="min-width:0;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <a href="${escapeHtml(item.profileUrl)}" target="_blank" rel="noreferrer" style="font-weight:800;color:${UI.navy};text-decoration:none;">${absoluteIndex}. ${escapeHtml(displayName)}</a>
              <span style="border:1px solid ${statusBorder};border-radius:8px;background:${statusColor};color:${statusTextColor};padding:1px 6px;font-size:11px;font-weight:700;">${statusLabel}</span>
              <span style="border:1px solid ${UI.border};border-radius:8px;background:#fff;padding:1px 6px;font-size:11px;color:${UI.muted};">${cardMark}</span>
            </div>
            ${currentTitle ? `<div style="margin-top:3px;color:${UI.ink};font-size:12px;font-weight:600;">${escapeHtml(currentTitle)}</div>` : ""}
            <ul style="margin:6px 0 0;padding-left:18px;color:${UI.muted};font-size:12px;">${displayReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
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
  }

  function attachResultEvents() {
    resultNode.querySelectorAll("[data-result-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        currentResultFilter = button.dataset.resultFilter || "ranked";
        currentResultPage = 1;
        renderResults();
      });
    });
    resultNode.querySelectorAll("[data-result-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.dataset.resultPage || 1);
        currentResultPage = Math.min(Math.max(nextPage, 1), totalResultPages());
        renderResults();
      });
    });
    resultNode.querySelectorAll("[data-select-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.selectAction === "select-page") setVisibleSelection(true);
        if (button.dataset.selectAction === "clear-page") setVisibleSelection(false);
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
        if (event.target.closest("a,button,input,label")) return;
        const code = card.dataset.resultItem;
        if (code) toggleResultSelection(code);
      });
    });
  }

  function updateOpenButtonLabel() {
    if (!copyButton) return;
    const count = selectedResumeCodes.size;
    copyButton.textContent = count ? `開啟勾選 ${count}` : "開啟勾選";
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
        ${renderSelectionButton("select-page", "本頁全勾")}
        ${renderSelectionButton("clear-page", "本頁全不勾")}
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
    setProgress(100, "完成");
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
    copyButton.disabled = true;
    setStatus(`準備開啟 ${profiles.length} 個已勾選履歷分頁。`);
    for (const [index, item] of profiles.entries()) {
      GM_openInTab(item.profileUrl, {
        active: index === 0,
        insert: true,
        setParent: true
      });
      setSummary(`已開啟 ${index + 1}/${profiles.length} 個履歷分頁`);
      setProgress(Math.round(((index + 1) / profiles.length) * 100), `${index + 1}/${profiles.length}`);
      await sleep(180);
    }
    setStatus(`已開啟 ${profiles.length} 個已勾選履歷分頁。`);
    copyButton.disabled = false;
  }

  async function scan() {
    mountPanel();
    if (isScanning) return;
    isScanning = true;
    startButton.disabled = true;
    skippedCards = new Map();
    latestRanked = [];
    latestReviewRequired = [];
    latestExcluded = [];
    latestAllResults = [];
    latestCardsByCode = new Map();
    latestScoreByCode = new Map();
    selectedResumeCodes = new Set();
    currentResultFilter = "ranked";
    currentResultPage = 1;
    resultNode.innerHTML = "";
    updateOpenButtonLabel();
    setCollapsed(false);
    setSummary("準備掃描");
    setStatus("準備讀取共用規則與目前頁卡片...");
    setProgress(2, "準備中");

    const cardsByCode = new Map();
    let batch = 1;
    let noGrowthRounds = 0;

    try {
      await loadSharedRules();
      if (sharedRuleState.statusMessage) setStatus(sharedRuleState.statusMessage);
      else setStatus("共用規則已就緒，開始掃描卡片...");
      setProgress(5, "開始");
      await waitForCards();
      await prepareScanPosition(cardsByCode);
      const totalCount = getTotalCount();
      const expectedPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : 30;
      if (totalCount && totalCount <= PAGE_SIZE) {
        await scanSinglePage(cardsByCode, totalCount);
      } else {
        while (batch <= expectedPages + 3 && !targetReached(cardsByCode, totalCount)) {
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

      const cards = [...cardsByCode.values()];
      const ranking = rankCandidates(cards);
      const scoredItems = ranking.allResults;
      latestScoreByCode = new Map(scoredItems.map((item) => [item.resumeCode, item]));
      const movedCards = reorderLoadedCardsByScore(scoredItems);
      latestRanked = applyCardElementAvailability(ranking.ranked);
      latestReviewRequired = applyCardElementAvailability(ranking.reviewRequired);
      latestExcluded = applyCardElementAvailability(ranking.excluded);
      latestAllResults = latestRanked.concat(latestReviewRequired).concat(latestExcluded);
      latestCardsByCode = cardsByCode;
      renderResults({
        scannedCount: cards.length,
        excludedCount: ranking.excludedCount,
        excludedReasonCounts: ranking.excludedReasonCounts
      });
      if (movedCards) setStatus(`已掃描並依分數重排目前頁 ${movedCards} 張卡片；跨頁結果請看右下角排名清單。`);
    } catch (error) {
      console.error(error);
      setStatus(`失敗：${error.message}`);
      setProgress(0, "失敗");
    } finally {
      isScanning = false;
      startButton.disabled = false;
    }
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
