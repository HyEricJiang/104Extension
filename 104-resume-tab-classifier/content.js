/**
 * 104 履歷分頁分類器：頁面浮動介面
 *
 * Shadow DOM 用來隔離 104 頁面與本工具的樣式，避免彼此干擾。
 */

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    rootId: "resume-tab-classifier-root",
    messageType: "CLASSIFY_CURRENT_TAB",
    categories: Object.freeze([
      Object.freeze({ id: "recommendedUnsuitable", label: "推薦但不合適", tone: "warning" }),
      Object.freeze({ id: "reviewedSuitable", label: "人工審核但合適", tone: "info" }),
      Object.freeze({ id: "excludedRecommended", label: "排除但推薦", tone: "info" }),
    ]),
  });

  if (document.getElementById(CONFIG.rootId)) {
    return;
  }

  const host = document.createElement("div");
  host.id = CONFIG.rootId;
  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      --rtc-surface: #ffffff;
      --rtc-text: #1f2937;
      --rtc-muted: #64748b;
      --rtc-border: #d7dee8;
      --rtc-focus: #0f766e;
      all: initial;
      color-scheme: light;
    }

    * {
      box-sizing: border-box;
    }

    .panel {
      position: fixed;
      z-index: 2147483647;
      top: 50%;
      right: 20px;
      width: 216px;
      padding: 16px;
      transform: translateY(-50%);
      border: 1px solid var(--rtc-border);
      border-radius: 14px;
      background: var(--rtc-surface);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
      color: var(--rtc-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    .title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .hint {
      margin: 2px 0 12px;
      color: var(--rtc-muted);
      font-size: 12px;
    }

    .actions {
      display: grid;
      gap: 8px;
    }

    .action {
      min-height: 48px;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid transparent;
      border-radius: 10px;
      cursor: pointer;
      touch-action: manipulation;
      font: inherit;
      font-weight: 700;
      text-align: left;
      transition: background-color 160ms ease, border-color 160ms ease, opacity 160ms ease;
    }

    .action:hover:not(:disabled) {
      filter: brightness(0.97);
    }

    .action:active:not(:disabled) {
      filter: brightness(0.92);
    }

    .action:focus-visible {
      outline: 3px solid var(--rtc-focus);
      outline-offset: 2px;
    }

    .action:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .action[data-tone="positive"] {
      border-color: #86cfa5;
      background: #e9f8ef;
      color: #14532d;
    }

    .action[data-tone="warning"] {
      border-color: #e7c56f;
      background: #fff8df;
      color: #713f12;
    }

    .action[data-tone="info"] {
      border-color: #93b4ed;
      background: #edf4ff;
      color: #1e3a8a;
    }

    .action[data-tone="danger"] {
      border-color: #eaa0a0;
      background: #fff0f0;
      color: #7f1d1d;
    }

    .status {
      min-height: 21px;
      margin: 10px 0 0;
      color: var(--rtc-muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status[data-state="success"] {
      color: #166534;
    }

    .status[data-state="error"] {
      color: #b91c1c;
    }

    @media (max-width: 640px) {
      .panel {
        top: auto;
        right: 16px;
        bottom: 16px;
        width: min(216px, calc(100vw - 32px));
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .action {
        transition: none;
      }
    }

    @media print {
      .panel {
        display: none;
      }
    }
  `;

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("aria-labelledby", "rtc-title");

  const title = document.createElement("h2");
  title.id = "rtc-title";
  title.className = "title";
  title.textContent = "履歷分頁分類";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "將目前分頁加入群組";

  const actions = document.createElement("div");
  actions.className = "actions";

  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const buttons = CONFIG.categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.dataset.tone = category.tone;
    button.textContent = category.label;
    button.addEventListener("click", () => classify(category));
    actions.append(button);
    return button;
  });

  panel.append(title, hint, actions, status);
  shadowRoot.append(style, panel);
  document.documentElement.append(host);

  async function classify(category) {
    setBusy(true);
    setStatus(`正在加入「${category.label}」群組…`, "pending");

    try {
      const response = await chrome.runtime.sendMessage({
        type: CONFIG.messageType,
        categoryId: category.id,
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "擴充功能沒有回傳結果。");
      }

      const actionText = response.created ? "已建立並加入" : "已加入";
      setStatus(`${actionText}「${response.groupTitle}」群組`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`分類失敗：${message}`, "error");
      console.error("[104 履歷分頁分類器] 無法完成分類", { message });
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    for (const button of buttons) {
      button.disabled = isBusy;
    }
  }

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }
})();
