(() => {
  if (window.__bunnyExtractOne) return; // avoid re-register

  const CFG = {
    waitTimeoutMs: 7000,
    pollIntervalMs: 120,
    closeTimeoutMs: 2500,
  };

  const SEL = {
    name:  '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(1) > div',
    email: '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(2) > div.col-10 > a',
    phone: '#app > div:nth-child(1) > div:nth-child(3) > main > div.modal.contact-information-modal.modal-centered > div.modal-dialog.modal-dialog--md > div > div.modal-body > div > div > div:nth-child(3) > div.col-10 > div > a',
    resumeCodeSpans: 'span.copy-content',
    contactBtnIcon: 'i.vip-icon-contact',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const attrOf = (el, name) => (el?.getAttribute?.(name) || '').trim();

  async function waitForFn(fn, timeoutMs = CFG.waitTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      await sleep(CFG.pollIntervalMs);
    }
    return null;
  }

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

  function getResumeCode() {
    const spans = Array.from(document.querySelectorAll(SEL.resumeCodeSpans));
    const texts = spans.map(textOf).filter(Boolean);

    let pick = texts.find(t => /^\d{6,12}$/.test(t.replace(/\s+/g, '')));
    if (pick) return pick.replace(/\s+/g, '').trim();

    pick = texts.find(t => /^[A-Za-z0-9_-]{4,20}$/.test(t.replace(/\s+/g, '')));
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
    return buttons.find(b => /聯繫方式/.test(textOf(b))) || null;
  }

  function modalSignatureOk(modalRoot) {
    if (!modalRoot) return false;
    if (!isVisible(modalRoot)) return false;

    const hasClose =
      !!modalRoot.querySelector('button.close,button[aria-label="Close"],i.vip-icon-close');

    const titleText = textOf(
      modalRoot.querySelector('.modal-header .modal-title, h2.modal-title, [class*="modal-title"], #Label')
    );
    const hasTitle = /聯繫方式/.test(titleText);

    const hasContactLink =
      !!modalRoot.querySelector('a[href^="mailto:"]') || !!modalRoot.querySelector('a[href^="tel:"]');

    return (hasClose && hasTitle) || (hasClose && hasContactLink);
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
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
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
      try { el.click(); return true; } catch { return false; }
    }
  }

  function pressEsc() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
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
      .filter(t => t && t.length <= 10 && !/E-mail|電話|手機|住家|視訊|聯繫方式/i.test(t))[0];
    return maybe || '';
  }

  function readEmail() {
    const el1 = document.querySelector(SEL.email);
    const href1 = attrOf(el1, 'href');
    const fromHref1 = href1.replace(/^mailto:/i, '').trim();
    if (fromHref1) return fromHref1;
    const txt1 = textOf(el1);
    if (txt1) return txt1;

    const root = getVisibleContactModalRoot();
    if (!root) return '';
    const el = root.querySelector('a[href^="mailto:"]');
    const href = attrOf(el, 'href').replace(/^mailto:/i, '').trim();
    return href || textOf(el);
  }

  function readPhone() {
    const el1 = document.querySelector(SEL.phone);
    const href1 = attrOf(el1, 'href');
    const fromHref1 = href1.replace(/^tel:/i, '').trim();
    if (fromHref1) return fromHref1;
    const txt1 = textOf(el1);
    if (txt1) return txt1;

    const root = getVisibleContactModalRoot();
    if (!root) return '';
    const el = root.querySelector('a[href^="tel:"]');
    const href = attrOf(el, 'href').replace(/^tel:/i, '').trim();
    return href || textOf(el);
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

    // click top-right point
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

    // click backdrop
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
      } catch {}
    }
  }

  async function extractOne() {
    const resumeCode = getResumeCode();

    const contactBtn = findContactButton();
    if (!contactBtn) {
      return { ok: false, error: "找不到聯繫方式按鈕" };
    }

    contactBtn.click();

    const ready = await waitForFn(() => {
      const root = getVisibleContactModalRoot();
      if (!root) return false;

      const emailEl = root.querySelector('a[href^="mailto:"]');
      const phoneEl = root.querySelector('a[href^="tel:"]');

      const okEmail = !!emailEl && (attrOf(emailEl, 'href').startsWith('mailto:') || textOf(emailEl));
      const okPhone = !!phoneEl && (attrOf(phoneEl, 'href').startsWith('tel:') || textOf(phoneEl));
      return okEmail && okPhone;
    });

    if (!ready) {
      return { ok: false, error: "聯繫方式資料未出現（可能未載入或權限/狀態限制）" };
    }

    const name = readName();
    const email = readEmail();
    const phone = readPhone();

    await closeModalRobust();

    const line = toTSVLine([name, email, phone, resumeCode]);
    return { ok: true, line, resumeCode };
  }

  // Expose function for background.js to call
  window.__bunnyExtractOne = extractOne;
})();