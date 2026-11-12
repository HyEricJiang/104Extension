const INVITE_BOOK = "REPLACE_WITH_SPREADSHEET_ID";
const INVITE_TAB = "邀約紀錄";
const INVITE_TAB_ID = 61635491;
const INVITE_HEADERS = ["編號", "邀約人", "招募管道", "職稱", "測驗題目", "姓名", "E-Mail", "手機", "履歷編號"];
const INVITE_POSITIONS = Object.freeze({
  "Sr.Java PG": "資深Java軟體工程師",
  "Jr.Java PG": "Java軟體工程師",
  "Sr.Net PG": "資深C#.Net軟體工程師",
  "Jr.Net PG": "C#.Net軟體工程師",
  "SA": "SA系統分析師",
  "PM": "PM專案經理",
  "Jr.QA": "軟體測試工程師",
  "Sr.QA": "資深軟體測試工程師"
});

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index").setTitle("104 履歷登錄｜邀約紀錄");
}

function getRecruiter_() {
  const email = String(Session.getActiveUser().getEmail()).trim().toLowerCase();
  if (!email) throw new Error("Google 未提供目前帳號的電子郵件，無法帶入邀約人。請在登錄頁確認選用的 Google 帳號及授權。");
  const match = email.match(/^([a-z]+)\.([a-z])[a-z]*@[^@\s]+$/);
  if (!match) throw new Error("目前 Google 帳號的電子郵件無法轉為邀約人名稱。");
  return match[1][0].toUpperCase() + match[1].slice(1) + "." + match[2].toUpperCase();
}

function submitInvitations(payload) {
  const recruiter = getRecruiter_();
  const { batchId, rows } = validateBatch_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);

  try {
    const book = SpreadsheetApp.openById(INVITE_BOOK);
    const sheet = book.getSheetByName(INVITE_TAB);
    if (!sheet || sheet.getSheetId() !== INVITE_TAB_ID ||
        sheet.getRange(1, 1, 1, 9).getDisplayValues()[0].join("\t") !== INVITE_HEADERS.join("\t")) {
      throw new Error("邀約紀錄的工作表或欄位已變更，已停止登錄。");
    }

    const last = sheet.getLastRow();
    const batchNote = "104Toolkit " + recruiter + " " + batchId;
    if (last > 1) {
      const previous = sheet.getRange(2, 2, last - 1, 1).getNotes()
        .findIndex(([note]) => note.split("\n").includes(batchNote));
      if (previous >= 0) return { recruiter, firstRow: previous + 2, count: rows.length };
    }

    const settings = book.getSheetByName("設定");
    const recruiterAllowed = settings && settings.getRange("L2:L" + settings.getLastRow())
      .getDisplayValues().some(([name]) => name === recruiter);
    if (!recruiterAllowed) throw new Error("目前 Google 帳號對應的邀約人「" + recruiter + "」尚未加入「設定」分頁 L 欄。");

    const firstRow = findInviteStart_(sheet, last);
    const endRow = firstRow + rows.length - 1;
    const gridRows = sheet.getMaxRows();
    const inGrid = Math.min(endRow, gridRows) - firstRow + 1;
    if (inGrid > 0) assertDestinationEmpty_(sheet, firstRow, inGrid);

    const requests = [];
    if (endRow > gridRows) {
      requests.push({ appendDimension: { sheetId: INVITE_TAB_ID, dimension: "ROWS", length: endRow - gridRows } });
    }
    requests.push(
      updateInviteCells_(firstRow, 2, rows.map(row =>
        [recruiter, "104邀約", INVITE_POSITIONS[row.group]].map(textCell_)
      ), "userEnteredValue"),
      updateInviteCells_(firstRow, 2, [[{
        note: [inGrid > 0 ? sheet.getRange(firstRow, 2).getNote() : "", batchNote].filter(Boolean).join("\n")
      }]], "note"),
      updateInviteCells_(firstRow, 6, rows.map(row =>
        [row.name, row.email, row.phone, row.resumeCode].map(textCell_)
      ), "userEnteredValue")
    );
    Sheets.Spreadsheets.batchUpdate({ requests }, INVITE_BOOK);
    return { recruiter, firstRow, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function validateBatch_(payload) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(payload?.batchId) ||
      !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 100) {
    throw new Error("登錄批次資料格式不正確。");
  }
  const seen = new Set();
  const rows = payload.rows.map((row, index) => {
    const group = row?.group;
    const fields = [row?.name, row?.email, row?.phone, row?.resumeCode];
    if (!Object.prototype.hasOwnProperty.call(INVITE_POSITIONS, group) ||
        fields.some(value => typeof value !== "string" || value.length > 254 || /[\r\n\t]/.test(value)) ||
        !row.name.trim() || !row.resumeCode.trim()) {
      throw new Error("第 " + (index + 1) + " 筆履歷資料或職缺群組不正確。");
    }
    const key = group + ":" + row.resumeCode;
    if (seen.has(key)) throw new Error("同一批次有重複的履歷與職缺。");
    seen.add(key);
    return row;
  });
  return { batchId: payload.batchId, rows };
}

function findInviteStart_(sheet, last) {
  // 從尾端往上找 A:D 或 F:I 的最後一筆，含 A 尚未補號的待處理紀錄。
  for (let end = last; end > 1;) {
    const start = Math.max(2, end - 199);
    const values = sheet.getRange(start, 1, end - start + 1, 9).getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i].some((value, index) => index !== 4 && value !== "")) return start + i + 1;
    }
    end = start - 1;
  }
  return 2;
}

function assertDestinationEmpty_(sheet, firstRow, count) {
  const occupied = [sheet.getRange(firstRow, 1, count, 4), sheet.getRange(firstRow, 6, count, 4)]
    .some(range => [range.getValues(), range.getFormulas()].some(rows => rows.some(row => row.some(value => value !== ""))));
  if (occupied) throw new Error("預計寫入的範圍已有資料或公式。請確認邀約紀錄表尾後再重試。");
}

function textCell_(value) {
  return { userEnteredValue: { stringValue: value } };
}

function updateInviteCells_(row, column, cellRows, fields) {
  return { updateCells: {
    start: { sheetId: INVITE_TAB_ID, rowIndex: row - 1, columnIndex: column - 1 },
    rows: cellRows.map(values => ({ values })),
    fields
  } };
}
