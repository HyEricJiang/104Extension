// ==UserScript==
// @name         104 二邀助手｜聊天室貼上小助手
// @namespace    https://vip.104.com.tw/
// @version      3.3
// @description  聊天室貼上小助手：只在聊天室頁顯示面板，避免與批次開聊工具的面板重疊；姓名抓取/範本/填入邏輯不變
// @match        https://vip.104.com.tw/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP = "[104 二邀助手]";
  const VERSION = "3.3";

  const CONFIG = {
    templateKey: "secondInviteTemplate",
    hrNameKey: "secondInviteHrName",
    panelCollapsedKey: "hr104_v18_panel_collapsed"
  };

  const DEFAULT_HR_NAME = "Eric";

  // 預設範本，可在面板內直接修改並儲存
  // {{name}} 會自動替換成求職者姓名末兩字，{{hrName}} 會自動替換成HR名稱
  const DEFAULT_TEMPLATE = `{{name}} 您好，
我是鴻揚科技HR {{hrName}}~
<br>日前有在人力銀行看到您的履歷，
先前有嘗試信件聯絡，但可能忙碌錯過或還在考慮中，
因為履歷上傳遞的個人特質與經歷，與我們目前希望尋找的夥伴很符合，
期待鴻揚在未來能有你的加入，一起並肩作戰。
<br>如果希望多了解再做決定，很願意一起聊聊更多的可能性，
可提供我方便時間，會再透過公司電話撥打手機做分享！
（平日中午的時間也可以配合聯繫）`;

  const normalizeText = (text) => String(text || "").replace(/\s+/g, "").trim();
  const textOf = (el) => normalizeText(el?.textContent);

  // ─────────────────────────────────────────────
  // Template / HR 名稱
  // ─────────────────────────────────────────────

  function getTemplate() {
    try {
      const saved = localStorage.getItem(CONFIG.templateKey);
      return saved && saved.trim() ? saved : DEFAULT_TEMPLATE;
    } catch (error) {
      console.warn(APP, "無法讀取儲存的範本，使用預設範本", error);
      return DEFAULT_TEMPLATE;
    }
  }

  function saveTemplate(text) {
    try {
      localStorage.setItem(CONFIG.templateKey, text);
    } catch (error) {
      console.warn(APP, "無法儲存範本", error);
    }
  }

  function getHrName() {
    try {
      const saved = localStorage.getItem(CONFIG.hrNameKey);
      return saved && saved.trim() ? saved.trim() : DEFAULT_HR_NAME;
    } catch (error) {
      console.warn(APP, "無法讀取HR名稱，使用預設值", error);
      return DEFAULT_HR_NAME;
    }
  }

  function saveHrName(text) {
    try {
      localStorage.setItem(CONFIG.hrNameKey, text.trim());
    } catch (error) {
      console.warn(APP, "無法儲存HR名稱", error);
    }
  }

  function getDisplayName(fullName) {
    const cleanName = normalizeText(fullName);
    return cleanName.length <= 2 ? cleanName : cleanName.slice(-2);
  }

  function buildMessage(fullName) {
    return getTemplate()
      .replaceAll("{{name}}", getDisplayName(fullName))
      .replaceAll("{{hrName}}", getHrName());
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isMessagePage() {
    return location.pathname.startsWith("/message/");
  }

  function getChatTextarea() {
    return document.querySelector(
      "#chatApp textarea, " +
      ".inputbox textarea, " +
      "textarea[placeholder*='訊息'], " +
      "textarea[placeholder*='輸入']"
    );
  }

  // ─────────────────────────────────────────────
  // 姓名讀取：只從目前已開啟的聊天室視窗抓取
  // ⚠️ 這段是根據畫面觀察的初版猜測，selector 待用實際 HTML 片段驗證後調整。
  // 抓不到姓名時，畫面會清楚顯示「抓不到姓名」，可直接手動輸入，不會卡住流程。
  // ─────────────────────────────────────────────

  function getNameFromChatHeader() {
    // 使用者從瀏覽器 DevTools 複製的精確路徑確認：
    // #chatApp 內的 a.chat-header-title 是聊天室標題列裡的姓名連結，
    // 內容應該就是純姓名，不會混到職缺名稱。
    const el = document.querySelector(
      "#chatApp a.chat-header-title, .chat-header .chat-header-title"
    );

    return textOf(el);
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────

  let panel;
  let nameInput;
  let fillButton;
  let statusBox;
  let collapseButton;
  let templateToggle;
  let templateSection;
  let hrNameInput;
  let templateTextarea;
  let templateSaveButton;
  let templateResetButton;

  function createPanel() {
    if (document.getElementById("hr104-helper-panel")) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      #hr104-helper-panel {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 320px;
        background: #ffffff;
        border: 1px solid #d9d9d9;
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
        font-family: Arial, "Noto Sans TC", sans-serif;
        color: #222222;
        overflow: hidden;
        max-height: 85vh;
      }
      #hr104-helper-panel * {
        box-sizing: border-box;
      }
      #hr104-helper-panel .hr104-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: #f7f7f7;
        border-bottom: 1px solid #e8e8e8;
      }
      #hr104-helper-panel .hr104-title {
        font-size: 15px;
        font-weight: 700;
      }
      #hr104-helper-panel .hr104-version {
        margin-left: 6px;
        color: #888888;
        font-size: 12px;
        font-weight: 400;
      }
      #hr104-helper-panel .hr104-collapse {
        border: 0;
        background: transparent;
        cursor: pointer;
        font-size: 18px;
        color: #666666;
        padding: 0 4px;
      }
      #hr104-helper-panel .hr104-body {
        padding: 14px;
        max-height: calc(85vh - 50px);
        overflow-y: auto;
      }
      #hr104-helper-panel textarea,
      #hr104-helper-panel input[type="text"] {
        width: 100%;
        border: 1px solid #cfcfcf;
        border-radius: 10px;
        padding: 10px 11px;
        font-size: 14px;
        line-height: 1.5;
        outline: none;
        font-family: inherit;
      }
      #hr104-helper-panel textarea {
        min-height: 120px;
        resize: vertical;
      }
      #hr104-helper-panel .hr104-template-textarea {
        min-height: 180px;
      }
      #hr104-helper-panel textarea:focus,
      #hr104-helper-panel input[type="text"]:focus {
        border-color: #777777;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
      }
      #hr104-helper-panel .hr104-label {
        font-size: 13px;
        color: #333333;
        margin-bottom: 6px;
        line-height: 1.5;
      }
      #hr104-helper-panel .hr104-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      #hr104-helper-panel button.hr104-primary,
      #hr104-helper-panel button.hr104-secondary {
        flex: 1;
        min-height: 38px;
        border-radius: 9px;
        border: 0;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
      }
      #hr104-helper-panel button.hr104-primary {
        background: #222222;
        color: #ffffff;
      }
      #hr104-helper-panel button.hr104-primary:hover:not(:disabled) {
        background: #000000;
      }
      #hr104-helper-panel button.hr104-secondary {
        background: #f1f1f1;
        color: #333333;
        border: 1px solid #d4d4d4;
      }
      #hr104-helper-panel button.hr104-secondary:hover {
        background: #e8e8e8;
      }
      #hr104-helper-panel .hr104-status {
        margin-top: 10px;
        padding: 9px 10px;
        min-height: 38px;
        border-radius: 8px;
        background: #f8f8f8;
        color: #555555;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      #hr104-helper-panel .hr104-template-toggle {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: 0;
        border-top: 1px solid #ececec;
        margin-top: 12px;
        padding: 10px 2px 0;
        font-size: 12px;
        color: #666666;
        cursor: pointer;
      }
      #hr104-helper-panel .hr104-template-section {
        margin-top: 10px;
      }
      #hr104-helper-panel.collapsed .hr104-body {
        display: none;
      }
    `;
    document.head.appendChild(style);

    panel = document.createElement("section");
    panel.id = "hr104-helper-panel";

    panel.innerHTML = `
      <div class="hr104-header">
        <div class="hr104-title">
          104 二邀助手
          <span class="hr104-version">v${VERSION}</span>
        </div>
        <button class="hr104-collapse" type="button" title="收合">−</button>
      </div>
      <div class="hr104-body">
        <div class="hr104-label">求職者姓名（可直接修改）：</div>
        <input type="text" class="hr104-name-input" placeholder="留空會自動抓取，或先手動輸入姓名" />
        <div class="hr104-actions">
          <button class="hr104-primary hr104-fill-btn" type="button" style="flex:1;">填入聊天室</button>
        </div>
        <div class="hr104-status">
          先確認已經打開正確的聊天室，按「填入聊天室」會自動抓姓名並套用範本，
          直接送出前的訊息會出現在輸入框裡，仍需你自己手動送出；若抓不到姓名，
          可在上方欄位手動輸入後再按一次。
        </div>
        <button class="hr104-template-toggle" type="button">▾ 訊息範本設定</button>
        <div class="hr104-template-section" style="display:none;">
          <div class="hr104-label">HR 名稱：</div>
          <input type="text" class="hr104-hrname-input" />
          <div class="hr104-label" style="margin-top:10px;">
            編輯訊息範本（{{name}} 會自動換成求職者姓名末兩字，{{hrName}} 會自動換成上方HR名稱）：
          </div>
          <textarea class="hr104-template-textarea"></textarea>
          <div class="hr104-actions">
            <button class="hr104-primary hr104-template-save" type="button">儲存設定</button>
            <button class="hr104-secondary hr104-template-reset" type="button">還原預設值</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    nameInput = panel.querySelector(".hr104-name-input");
    fillButton = panel.querySelector(".hr104-fill-btn");
    statusBox = panel.querySelector(".hr104-status");
    collapseButton = panel.querySelector(".hr104-collapse");
    templateToggle = panel.querySelector(".hr104-template-toggle");
    templateSection = panel.querySelector(".hr104-template-section");
    hrNameInput = panel.querySelector(".hr104-hrname-input");
    templateTextarea = panel.querySelector(".hr104-template-textarea");
    templateSaveButton = panel.querySelector(".hr104-template-save");
    templateResetButton = panel.querySelector(".hr104-template-reset");

    templateTextarea.value = getTemplate();
    hrNameInput.value = getHrName();

    const initiallyCollapsed = getPanelCollapsed();
    panel.classList.toggle("collapsed", initiallyCollapsed);
    collapseButton.textContent = initiallyCollapsed ? "+" : "−";
    collapseButton.title = initiallyCollapsed ? "展開" : "收合";

    collapseButton.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      collapseButton.textContent = collapsed ? "+" : "−";
      collapseButton.title = collapsed ? "展開" : "收合";
      savePanelCollapsed(collapsed);
    });

    fillButton.addEventListener("click", () => {
      if (!isMessagePage()) {
        showStatus("目前不是聊天室頁面，請先打開求職者的聊天室視窗。");
        return;
      }

      // 姓名欄位若已手動填入就直接用；空白的話才自動去聊天室標題抓取。
      let name = normalizeText(nameInput.value);

      if (!name) {
        name = getNameFromChatHeader();
        nameInput.value = name;
      }

      if (!name) {
        showStatus("抓不到姓名，請直接在上方欄位手動輸入姓名，再按一次「填入聊天室」。");
        return;
      }

      const chatTextarea = getChatTextarea();

      if (!chatTextarea) {
        showStatus("找不到聊天輸入框，請確認目前已打開聊天室視窗。");
        return;
      }

      console.log(`[二邀助手] 聊天室讀取姓名：${name}`);
      setNativeValue(chatTextarea, buildMessage(name));
      chatTextarea.scrollIntoView({ behavior: "smooth", block: "center" });
      chatTextarea.focus();

      showStatus(`已為 ${name} 填入訊息，請確認內容後手動送出。`);
    });

    templateToggle.addEventListener("click", () => {
      const isHidden = templateSection.style.display === "none";
      templateSection.style.display = isHidden ? "block" : "none";
      templateToggle.textContent = isHidden ? "▾ 訊息範本設定（展開中）" : "▾ 訊息範本設定";
      if (isHidden) {
        templateTextarea.value = getTemplate();
        hrNameInput.value = getHrName();
      }
    });

    templateSaveButton.addEventListener("click", () => {
      const text = templateTextarea.value;
      const hrName = hrNameInput.value.trim();

      if (!hrName) {
        showStatus("HR 名稱不可為空，尚未儲存。");
        return;
      }

      saveTemplate(text);
      saveHrName(hrName);

      if (!text.includes("{{name}}")) {
        showStatus("已儲存，但範本裡沒有 {{name}} 標記，訊息將不會自動帶入求職者姓名。");
      } else {
        showStatus("已儲存訊息範本與HR名稱。");
      }
    });

    // 用「按兩次才生效」取代原生 confirm()，避免阻塞畫面。
    armDoubleClick(templateResetButton, "再按一次確認還原", () => {
      templateTextarea.value = DEFAULT_TEMPLATE;
      hrNameInput.value = DEFAULT_HR_NAME;
      saveTemplate(DEFAULT_TEMPLATE);
      saveHrName(DEFAULT_HR_NAME);
      showStatus("已還原為預設範本與HR名稱。");
    });
  }

  function armDoubleClick(button, armedLabel, onConfirmed) {
    const originalLabel = button.textContent;
    let armed = false;
    let timer = null;

    button.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        button.textContent = armedLabel;
        timer = setTimeout(() => {
          armed = false;
          button.textContent = originalLabel;
        }, 3000);
        return;
      }

      armed = false;
      clearTimeout(timer);
      button.textContent = originalLabel;
      onConfirmed();
    });
  }

  function getPanelCollapsed() {
    try {
      const stored = localStorage.getItem(CONFIG.panelCollapsedKey);
      if (stored === null) return true;
      return stored === "true";
    } catch (error) {
      return true;
    }
  }

  function savePanelCollapsed(collapsed) {
    try {
      localStorage.setItem(CONFIG.panelCollapsedKey, collapsed ? "true" : "false");
    } catch (error) {
      console.warn(APP, "無法保存收合狀態", error);
    }
  }

  function showStatus(message) {
    if (!statusBox) return;
    statusBox.textContent = message;
  }

  // ─────────────────────────────────────────────
  // Main
  // ─────────────────────────────────────────────

  console.log(`${APP} v${VERSION} 已載入`);

  // 只在聊天室頁顯示面板，避免跟其他頁面（例如查詢結果頁的批次開聊面板）重疊。
  if (isMessagePage()) {
    createPanel();
  }
})();
