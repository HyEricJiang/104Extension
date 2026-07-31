// ==UserScript==
// @name         104 二邀助手｜批次開啟聊天室
// @namespace    https://vip.104.com.tw/
// @version      1.0
// @description  在履歷代碼查詢結果頁，掃描候選人卡片內的「詢問意願」連結，分批依序開啟對應聊天室分頁；不做搜尋、不做填入，只負責開分頁
// @match        https://vip.104.com.tw/idSearch/searchResult*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP = "[104 批次開聊]";
  const VERSION = "1.0";
  const BATCH_SIZE = 5;
  const OPEN_DELAY_MS = 150;

  const normalizeText = (text) => String(text || "").replace(/\s+/g, "").trim();

  // ─────────────────────────────────────────────
  // 候選人卡片掃描
  // ─────────────────────────────────────────────

  function findCandidateCards() {
    return Array.from(document.querySelectorAll(".vip-resume-card[data-qa-id='resumeCard']"));
  }

  // 只在「卡片容器內」找連結，天然不會抓到卡片外的浮動客服/工具列。
  function getChatLinkFromCard(card) {
    return card.querySelector("a.msg_master[href]");
  }

  function getResumeCodeFromCard(card, chatLink) {
    // 優先用聊天連結上的 id_no 屬性（最直接可靠）；
    // 沒有聊天連結時，退回讀卡片上「代碼：xxxxx」那段文字。
    const fromLink = chatLink?.getAttribute("id_no");
    if (fromLink) return fromLink;

    const codeText = normalizeText(card.querySelector(".support-info .code")?.textContent);
    return codeText.replace(/^代碼[:：]/, "");
  }

  function getCandidateInfoFromCard(card) {
    const nameEl = card.querySelector("a.name");
    const chatLink = getChatLinkFromCard(card);

    return {
      name: normalizeText(nameEl?.textContent) || "(未知姓名)",
      code: getResumeCodeFromCard(card, chatLink),
      href: chatLink?.href || ""
    };
  }

  function collectChatTargets() {
    const cards = findCandidateCards();
    const withChat = [];
    const withoutChat = [];

    cards.forEach((card) => {
      const info = getCandidateInfoFromCard(card);

      if (info.href) {
        withChat.push(info);
      } else {
        withoutChat.push(info);
      }
    });

    return { withChat, withoutChat };
  }

  // 依序開啟，中間插入小延遲，降低被瀏覽器判定為異常彈出視窗而攔截的機率。
  async function openBatch(targets) {
    for (const target of targets) {
      window.open(target.href, "_blank");
      await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS));
    }
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────

  let panel;
  let statusBox;
  let startButton;
  let nextBatchButton;
  let queue = [];
  let skippedList = [];
  let openedCount = 0;

  function createPanel() {
    if (document.getElementById("hr104-batch-open-panel")) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      #hr104-batch-open-panel {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 300px;
        background: #ffffff;
        border: 1px solid #d9d9d9;
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
        font-family: Arial, "Noto Sans TC", sans-serif;
        color: #222222;
        padding: 14px;
      }
      #hr104-batch-open-panel * {
        box-sizing: border-box;
      }
      #hr104-batch-open-panel .hr104b-title {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      #hr104-batch-open-panel button {
        width: 100%;
        min-height: 38px;
        border-radius: 9px;
        border: 0;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
        margin-top: 8px;
      }
      #hr104-batch-open-panel button:disabled {
        background: #bdbdbd;
        cursor: not-allowed;
      }
      #hr104-batch-open-panel .hr104b-primary {
        background: #222222;
        color: #ffffff;
      }
      #hr104-batch-open-panel .hr104b-status {
        margin-top: 10px;
        padding: 9px 10px;
        min-height: 30px;
        border-radius: 8px;
        background: #f8f8f8;
        color: #555555;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
      }
    `;
    document.head.appendChild(style);

    panel = document.createElement("section");
    panel.id = "hr104-batch-open-panel";
    panel.innerHTML = `
      <div class="hr104b-title">104 批次開聊 v${VERSION}</div>
      <button class="hr104b-primary hr104b-start-btn" type="button">掃描並開始批次開啟</button>
      <button class="hr104b-primary hr104b-next-btn" type="button" style="display:none;"></button>
      <div class="hr104b-status">
        取得查詢結果後，按上方按鈕開始；每批開 ${BATCH_SIZE} 筆，開完會出現「開啟下一批」。
      </div>
    `;
    document.body.appendChild(panel);

    statusBox = panel.querySelector(".hr104b-status");
    startButton = panel.querySelector(".hr104b-start-btn");
    nextBatchButton = panel.querySelector(".hr104b-next-btn");

    startButton.addEventListener("click", async () => {
      const { withChat, withoutChat } = collectChatTargets();
      queue = withChat;
      skippedList = withoutChat;
      openedCount = 0;

      if (queue.length === 0) {
        showStatus(
          `目前頁面上找不到任何已聯絡過（有「詢問意願」記錄）的候選人。\n` +
          `共 ${withoutChat.length} 筆沒有聊天室連結，可能是尚未邀約過的候選人。`
        );
        return;
      }

      log("掃描到可開啟聊天室名單：", queue);
      showStatus(`共找到 ${queue.length} 筆可開啟聊天室，開始第一批……`);
      await openNextBatch();
    });

    nextBatchButton.addEventListener("click", openNextBatch);
  }

  async function openNextBatch() {
    const batch = queue.slice(openedCount, openedCount + BATCH_SIZE);

    if (batch.length === 0) {
      finishReport();
      return;
    }

    startButton.disabled = true;
    nextBatchButton.disabled = true;
    showStatus(`正在開啟第 ${openedCount + 1}～${openedCount + batch.length} 筆……`);

    await openBatch(batch);
    openedCount += batch.length;

    const remaining = queue.length - openedCount;

    if (remaining > 0) {
      nextBatchButton.style.display = "block";
      nextBatchButton.disabled = false;
      nextBatchButton.textContent = `開啟下一批（剩 ${remaining} 筆）`;
      showStatus(
        `已開啟 ${openedCount} / ${queue.length} 筆。\n` +
        `若部分分頁沒有出現，請允許 vip.104.com.tw 開啟彈出式視窗。`
      );
    } else {
      finishReport();
    }

    startButton.disabled = false;
  }

  function finishReport() {
    nextBatchButton.style.display = "none";

    const lines = [`全部開啟完畢，共 ${openedCount} 筆。`];

    if (skippedList.length > 0) {
      lines.push(`另有 ${skippedList.length} 筆沒有聊天室連結被跳過：`);
      skippedList.forEach((item) => {
        lines.push(`- ${item.name}（${item.code || "代碼未知"}）`);
      });
    }

    showStatus(lines.join("\n"));
  }

  function showStatus(message) {
    if (!statusBox) return;
    statusBox.textContent = message;
  }

  function log(...args) {
    console.log(APP, ...args);
  }

  createPanel();
})();
