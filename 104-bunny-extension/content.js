(() => {
  if (window.__bunnyExtractOne) return; // 避免重複注入時覆蓋既有函式

  /**
   * 設定集中管理：
   * - waitTimeoutMs：等待 modal 與資料載入時間
   * - pollIntervalMs：輪詢間隔，避免過度頻繁造成頁面負擔
   * - closeTimeoutMs：關閉 modal 的最長等待時間
   *
   * 為什麼要集中管理？
   * 因為 104 頁面可能會改版或變慢，集中設定可以讓維護者快速調整，不必到處找魔法數字。
   */
  const CFG = {
    waitTimeoutMs: 7000,
    pollIntervalMs: 120,
    closeTimeoutMs: 2500,
    hiddenText: "求職者已隱藏",
  };

  /**
   * 優先保留既有 selector。
   * 若未來 104 DOM 微調，後面也有 fallback 邏輯，不會只靠單一路徑導致整個流程失效。
   */
  const SEL = {
    name:  '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(1) > div',
    email: '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(2) > div.col-10 > a, #app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(2) > div.col-10 > div',
    phone: '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(3) > div.col-10 > div > a, #app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(3) > div.col-10 > div',
    resumeCodeSpans: 'span.copy-content',
    contactBtnIcon: 'i.vip-icon-contact',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const attrOf = (el, name) => (el?.getAttribute?.(name) || '').trim();

  function logInfo(...args) {
    console.log("[104-bunny-content]", ...args);
  }

  function logError(...args) {
    console.error("[104-bunny-content]", ...args);
  }

  async function waitForFn(fn, timeoutMs = CFG.waitTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      try {
        const value = fn();
        if (value) return value;
      } catch (_) {}
      await sleep(CFG.pollIntervalMs);
    }
    return null;
  }

  /**
   * TSV 輸出需要把換行壓平，避免貼到 Google Sheet 時欄位錯位。
   */
  function tsvEscape(v) {
    return String(v ?? '').replace(/\r?\n/g, ' ').trim();
  }

  function toTSVLine(values) {
    return values.map(tsvEscape).join('\t');
  }

  function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }

  function normalizeValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isHiddenValue(value) {
    return normalizeValue(value).includes(CFG.hiddenText);
  }

  function getResumeCode() {
    const spans = Array.from(document.querySelectorAll(SEL.resumeCodeSpans));
    const texts = spans.map(textOf).filter(Boolean);

    let pick = texts.find((t) => /^\d{6,12}$/.test(t.replace(/\s+/g, '')));
    if (pick) return pick.replace(/\s+/g, '').trim();

    pick = texts.find((t) => /^[A-Za-z0-9_-]{4,20}$/.test(t.replace(/\s+/g, '')));
    if (pick) return pick.replace(/\s+/g, '').trim();

    return (texts[0] || '').trim();
  }

  function findContactButton() {
    const icon = document.querySelector(SEL.contactBtnIcon);
    if (icon) {
      const clickable = icon.closest('button,a,[role="button"]');
      if (clickable) return clickable;
    }

    const buttons = Array.from(document.querySelectorAll('button,a,[role="button"]'));
    return buttons.find((b) => /聯繫方式/.test(textOf(b))) || null;
  }

  function modalSignatureOk(modalRoot) {
    if (!modalRoot || !isVisible(modalRoot)) return false;

    const hasClose = !!modalRoot.querySelector('button.close,button[aria-label="Close"],i.vip-icon-close');
    const titleText = textOf(
      modalRoot.querySelector('.modal-header .modal-title, h2.modal-title, [class*="modal-title"], #Label')
    );
    const hasTitle = /聯繫方式/.test(titleText);

    /**
     * 原本只接受 mailto / tel 連結，會把「求職者已隱藏」當成未載入。
     * 現在改成只要 modal 本體存在，而且內容有 E-mail / 聯絡電話區塊就算有效 modal。
     */
    const bodyText = textOf(modalRoot.querySelector('.modal-body') || modalRoot);
    const hasContactFields = /E-mail|聯絡電話|手機|住家/.test(bodyText);
    const hasContactLink = !!modalRoot.querySelector('a[href^="mailto:"]') || !!modalRoot.querySelector('a[href^="tel:"]');

    return (hasClose && hasTitle) || (hasClose && hasContactLink) || (hasClose && hasContactFields);
  }

  function getVisibleContactModalRoot() {
    const candidates = Array.from(document.querySelectorAll('div.modal, div[role="dialog"], dialog'));
    const hits = candidates.filter(modalSignatureOk);
    if (!hits.length) return null;

    hits.sort((a, b) => {
      const za = Number(getComputedStyle(a).zIndex || 0);
      const zb = Number(getComputedStyle(b).zIndex || 0);
      return zb - za;
    });

    return hits[0];
  }

  function getVisibleDialog(modalRoot) {
    const root = modalRoot || getVisibleContactModalRoot();
    if (!root) return null;
    const dlg = root.querySelector('div.modal-dialog') || root.querySelector('.modal-dialog') || root;
    return isVisible(dlg) ? dlg : null;
  }

  function dispatchMouseClick(el, clientX, clientY) {
    if (!el) return false;
    try {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
        }));
      });
      return true;
    } catch {
      try {
        el.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  function pressEsc() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true
    }));
  }

  function modalIsGone() {
    const root = getVisibleContactModalRoot();
    if (root && isVisible(root)) return false;

    const bd = document.querySelector('.modal-backdrop.show') || document.querySelector('.modal-backdrop');
    if (bd && isVisible(bd)) return false;

    return true;
  }

  function readName() {
    const v1 = textOf(document.querySelector(SEL.name));
    if (v1) return v1;

    const root = getVisibleContactModalRoot();
    if (!root) return '';

    const nameEl =
      root.querySelector('.information--content .col.t3.font-weight-bold') ||
      root.querySelector('.information--content .t3.font-weight-bold') ||
      root.querySelector('.modal-body .t3.font-weight-bold') ||
      root.querySelector('.modal-body .font-weight-bold');

    const nameText = textOf(nameEl);
    if (nameText && !/E-mail|聯絡電話|手機|住家|聯繫方式/i.test(nameText)) return nameText;

    const body = root.querySelector('.modal-body') || root;
    const maybe = Array.from(body.querySelectorAll('div,span'))
      .map(textOf)
      .filter((t) => t && t.length <= 10 && !/E-mail|電話|手機|住家|視訊|聯繫方式/i.test(t))[0];

    return maybe || '';
  }

  /**
   * 依 label 讀取欄位值。
   * 這樣做的原因是 104 有時是 a 標籤，有時是 div 純文字，隱藏時更不會有 mailto / tel。
   * 直接靠欄位名稱往後找，容錯會高很多。
   */
  function readLabeledValue(labels) {
    const root = getVisibleContactModalRoot();
    if (!root) return '';

    const body = root.querySelector('.modal-body') || root;
    const labelSet = new Set(labels);

    const rows = Array.from(body.querySelectorAll('div.row, .row, [class*="information"], [class*="contact"], .modal-body > div > div > div, .modal-body > div > div'));
    for (const row of rows) {
      const rowText = textOf(row);
      if (!rowText) continue;

      const hitLabel = labels.find((label) => rowText.includes(label));
      if (!hitLabel) continue;

      const linked = row.querySelector('a[href^="mailto:"], a[href^="tel:"]');
      if (linked) {
        const href = attrOf(linked, 'href').replace(/^mailto:/i, '').replace(/^tel:/i, '').trim();
        return href || textOf(linked);
      }

      const texts = Array.from(row.querySelectorAll('a,div,span,p'))
        .map(textOf)
        .filter(Boolean)
        .filter((t) => !labelSet.has(t))
        .filter((t) => !labels.some((label) => t === label));

      const hiddenText = texts.find((t) => isHiddenValue(t));
      if (hiddenText) return CFG.hiddenText;

      const useful = texts.find((t) => !labels.some((label) => t.includes(label)));
      if (useful) return useful;
    }

    /**
     * 最後 fallback：從整個 modal 文字裡抓。
     * 這段是保險機制，避免 DOM 微調後整個欄位讀不到。
     */
    const allTexts = Array.from(body.querySelectorAll('a,div,span,p'))
      .map(textOf)
      .filter(Boolean);

    const hiddenText = allTexts.find((t) => isHiddenValue(t));
    if (hiddenText) return CFG.hiddenText;

    return '';
  }


  /**
   * 手機欄位常會夾帶「手機：」「聯絡電話：」等標籤文字。
   * 使用者貼到 Google Sheet 時通常只需要實際號碼，因此在這裡集中清洗。
   *
   * 設計原因：
   * - 不在最後 TSV 組字串時才清理，避免後續其他流程拿到髒資料
   * - 保留 +、數字、空白、括號與連字號，兼容國碼與不同格式
   */
  function normalizePhoneValue(value) {
    const raw = normalizeValue(value);
    if (!raw) return '';
    if (isHiddenValue(raw)) return CFG.hiddenText;

    let cleaned = raw
      .replace(/^(聯絡電話|手機|住家電話|電話)\s*[:：]?\s*/i, '')
      .replace(/\s*分機\s*\d+$/i, '')
      .trim();

    const matched = cleaned.match(/\+?[\d][\d\s\-()]{6,}/);
    if (matched) {
      cleaned = matched[0].trim();
    }

    cleaned = cleaned.replace(/[^\d+\-()\s]/g, '').trim();

    return cleaned;
  }

  function readEmail() {
    const el1 = document.querySelector(SEL.email);
    const href1 = attrOf(el1, 'href').replace(/^mailto:/i, '').trim();
    if (href1) return href1;

    const txt1 = textOf(el1);
    if (txt1) return isHiddenValue(txt1) ? CFG.hiddenText : txt1;

    const fallback = readLabeledValue(['E-mail', 'Email', '信箱']);
    return isHiddenValue(fallback) ? CFG.hiddenText : fallback;
  }

  function readPhone() {
    const el1 = document.querySelector(SEL.phone);
    const href1 = attrOf(el1, 'href').replace(/^tel:/i, '').trim();
    if (href1) return normalizePhoneValue(href1);

    const txt1 = textOf(el1);
    if (txt1) return normalizePhoneValue(txt1);

    const fallback = readLabeledValue(['聯絡電話', '手機', '住家電話', '電話']);
    return normalizePhoneValue(fallback);
  }

  async function closeModalRobust() {
    const root = getVisibleContactModalRoot();
    const dialog = getVisibleDialog(root);
    if (!root || !dialog) return;
    if (modalIsGone()) return;

    const closeBtn =
      dialog.querySelector('button.close[aria-label="Close"]') ||
      dialog.querySelector('button.close') ||
      dialog.querySelector('button[aria-label="Close"]') ||
      dialog.querySelector('i.vip-icon-close')?.closest('button') ||
      null;

    if (closeBtn) {
      const r = closeBtn.getBoundingClientRect();
      dispatchMouseClick(closeBtn, r.left + r.width / 2, r.top + r.height / 2);
      const ok = await waitForFn(() => modalIsGone(), CFG.closeTimeoutMs);
      if (ok) return;
    }

    {
      const dr = dialog.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 2, dr.right - 10);
      const y = Math.max(2, dr.top + 10);

      const topEl = document.elementFromPoint(x, y);
      if (topEl) {
        const clickable = topEl.closest('button,a,i,div,span,[role="button"]') || topEl;
        dispatchMouseClick(clickable, x, y);
        const ok = await waitForFn(() => modalIsGone(), CFG.closeTimeoutMs);
        if (ok) return;
      }
    }

    {
      const bd = document.querySelector('.modal-backdrop.show') || document.querySelector('.modal-backdrop');
      if (bd && isVisible(bd)) {
        const br = bd.getBoundingClientRect();
        dispatchMouseClick(bd, br.left + 10, br.top + 10);
        const ok = await waitForFn(() => modalIsGone(), CFG.closeTimeoutMs);
        if (ok) return;
      }
    }

    pressEsc();
    await waitForFn(() => modalIsGone(), CFG.closeTimeoutMs);

    if (!modalIsGone()) {
      try {
        root.style.display = 'none';
        root.style.visibility = 'hidden';
        root.style.pointerEvents = 'none';
        document.body.style.overflow = '';
        const bd = document.querySelector('.modal-backdrop.show') || document.querySelector('.modal-backdrop');
        bd?.remove?.();
      } catch (error) {
        logError("強制關閉 modal 失敗", error);
      }
    }
  }

  /**
   * 判斷 modal 是否已載入到可讀取狀態。
   * 與舊版最大的差異：
   * - 不再強制要求 email / phone 必須通過 mailto / tel 格式
   * - 允許值為「求職者已隱藏」
   */
  function modalReadyForRead() {
    const root = getVisibleContactModalRoot();
    if (!root) return false;

    const name = readName();
    const email = readEmail();
    const phone = readPhone();

    return Boolean(name && (email || isHiddenValue(email)) && (phone || isHiddenValue(phone)));
  }

  async function extractOne() {
    try {
      const resumeCode = getResumeCode();
      const contactBtn = findContactButton();

      if (!contactBtn) {
        return { ok: false, error: "找不到聯繫方式按鈕" };
      }

      contactBtn.click();

      const ready = await waitForFn(() => modalReadyForRead());
      if (!ready) {
        return { ok: false, error: "聯繫方式資料未出現（可能未載入或頁面結構變更）" };
      }

      const name = readName();
      const email = readEmail() || '';
      const phone = readPhone() || '';

      await closeModalRobust();

      const line = toTSVLine([name, email, phone, resumeCode]);
      logInfo("成功擷取一筆", { name, email, phone, resumeCode });
      return { ok: true, line, resumeCode };
    } catch (error) {
      const reason = String(error?.message || error);
      logError("extractOne 失敗", reason);
      return { ok: false, error: reason };
    }
  }

  window.__bunnyExtractOne = extractOne;
})();
