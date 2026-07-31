// ==UserScript==
// @name         104 履歷內建 Gemini 試算 (claude熱情贊助版)
// @namespace    http://tampermonkey.net/
// @version      73.0
// @description  要求 AI 結合「具體公司名稱」、「產業規模」與「年資」綜合推估，打破齊頭式平等的薪資盲區
// @author       Your Assistant
// @match        https://vip.104.com.tw/search/*
// @match        https://vip.104.com.tw/resume/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 🔑 【重要】請在這裡貼上你從 Google AI Studio 申請的 API Key
    const GEMINI_API_KEY = '請把你的API_KEY貼在這裡';

    // 🔀 【雙版型相容】104履歷頁面目前存在兩種不同的DOM結構，用逗號並列多組選擇器，
    //    只要符合「任一版型」的 class 就會被抓到，不需要額外寫版型判斷邏輯
    //
    //    版型①（舊版）：class 前綴為 experience-list-list__
    //    版型②（新版）：company 用 experience-time-list__main__cust-name；
    //                    「工作職稱」欄位改用 experience-list__other-info /
    //                    experience-time-list__other-info（沿用了不同世代的命名）；
    //                    「工作時間」目前只找得到通用 bootstrap 工具class組合，
    //                    沒有專屬命名class，相對容易因104改版而失效，之後若發現版型②
    //                    抓不到時間，要優先檢查這行
    const JOB_NAME_SELECTOR = '.experience-list-list__jobName, .experience-list__other-info, .experience-time-list__other-info';
    const OTHER_INFO_SELECTOR = '.experience-list-list__other-info';
    const COMPANY_SELECTOR = '.experience-list-list__companyName, .experience-time-list__main__cust-name';
    const DURATION_SELECTOR = '.experience-list-list__duration, .t4.d-flex.text-gray-darker.flex-column.flex-md-row';

    // 版型②的職稱文字被拆成兩個節點：.experience-time-list__other-info（已由 JOB_NAME_SELECTOR 抓到）
    // 以及 .experience-time-list__main 底下這個沒有專屬命名的 div（通常才是真正的職稱本文）。
    // 這個節點沒有專屬 class，只能靠有命名的父層 .experience-time-list__main 定位，相對比較脆弱，
    // 之後若104改版又抓不到，要優先檢查這行。
    const MAIN_TITLE_TEXT_SELECTOR = '.experience-time-list__main > div.row.mx-0.mt-0.mt-md-3 > div';

    function extractJobInfo(titleNode) {
        let mainJobName = (titleNode.innerText || titleNode.textContent).trim();
        mainJobName = mainJobName.split(/✨|💰|❌|⚡/)[0].trim();

        function findClosest(selector, maxDepth) {
            let result = "未知";
            let parent = titleNode.parentElement;
            let depth = 0;
            while (parent && parent !== document.body && depth < maxDepth) {
                let targets = Array.from(parent.querySelectorAll(selector));
                if (targets.length === 1) {
                    result = (targets[0].innerText || targets[0].textContent).trim().replace(/\s+/g, ' ');
                    break;
                } else if (targets.length > 1) {
                    let closestTarget = null;
                    let minDistance = Infinity;
                    const titleRect = titleNode.getBoundingClientRect();
                    for (let t of targets) {
                        const tRect = t.getBoundingClientRect();
                        if (tRect.width === 0 && tRect.height === 0) continue;
                        const dist = Math.abs(tRect.top - titleRect.top);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestTarget = t;
                        }
                    }
                    if (closestTarget) {
                        result = (closestTarget.innerText || closestTarget.textContent).trim().replace(/\s+/g, ' ');
                    }
                    break;
                }
                parent = parent.parentElement;
                depth++;
            }
            return result;
        }

        let companyName = findClosest(COMPANY_SELECTOR, 8) || "未知公司";
        let otherInfoText = findClosest(OTHER_INFO_SELECTOR, 3) || "";
       let durationText = findClosest(DURATION_SELECTOR, 5) || "未知年資";

        // 版型②：把 .experience-time-list__main 底下那段無名職稱文字也併入判斷，
        // 避免關鍵字（如「實習」）只出現在其中一個節點、另一個節點漏檢
        let secondaryTitleText = findClosest(MAIN_TITLE_TEXT_SELECTOR, 6);
        if (secondaryTitleText && secondaryTitleText !== '未知' && !mainJobName.includes(secondaryTitleText)) {
            mainJobName = `${secondaryTitleText} ${mainJobName}`.trim();
        }

// 如果是仍在職，自動補成年資
if (/仍在職|至今|Present|Current/i.test(durationText)) {

    const match = durationText.match(/(\d{4})\/(\d{1,2})/);

    if (match) {

        const startYear = parseInt(match[1], 10);
        const startMonth = parseInt(match[2], 10);

        const now = new Date();

        const months =
            (now.getFullYear() - startYear) * 12 +
            (now.getMonth() + 1 - startMonth);

        const years = Math.floor(months / 12);
        const remain = months % 12;

        durationText += ` ${years > 0 ? years + "年" : ""}${remain}個月`;
    }
}

        if (companyName === "未知") companyName = "未知公司";
        if (durationText === "未知") durationText = "未知年資";

        let fullJobTitle = mainJobName;
        if (otherInfoText && otherInfoText !== "未知") {
            fullJobTitle = `${mainJobName} (${otherInfoText})`;
        }
        return { companyName, fullJobTitle, durationText };
    }

    // 🔒 【一致性防護】固定使用的模型優先序，避免「動態抓清單」導致每次呼叫到不同版本模型
    //    只有在這些模型都失效時，才退回動態查詢清單作為最後備援
    const PREFERRED_MODELS = [
        'gemini-1.5-flash-002',
        'gemini-1.5-flash-001',
        'gemini-1.5-flash',
        'gemini-1.5-pro-002'
    ];

    // 快取有效期限（毫秒）：同一份履歷在這段時間內，重複查詢會直接回傳同一個結果
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小時

    // 🔑 快取版本號：每次調整「校正邏輯 / prompt 規則」都要手動 +1，
    //    這樣同一份履歷即使舊快取還留在 localStorage，也會因版本號不同而自動失效重算，
    //    不用擔心改完程式邏輯、結果卻因為讀到舊快取而「看起來沒變」
    const CACHE_VERSION = 'v4';

    // 簡單穩定雜湊，把「公司+職稱+年資」的完整經歷字串轉成固定 key，
    // 同一份履歷（內容沒變）永遠對應同一把快取 key
    function stableHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return `salaryCache_${CACHE_VERSION}_` + Math.abs(hash);
    }

    function readCache(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function writeCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
        } catch (e) {
            // 儲存失敗（例如 localStorage 已滿）不影響主流程，靜默略過
        }
    }

    // 🎯 【校正參數】實測發現 AI 估算普遍偏高，且偏誤幅度會隨薪資高低等比例放大/縮小，
    //    因此改用「等比例縮減」而非固定扣減金額（固定金額對低薪族群會校正過頭，對高薪族群又扣不夠）
    //
    //    目前依實測校正比例：0.867（等於整體下修約 13.3%）
    //    校正依據：總年資1~2年、小微型公司(1~30人)全端工程師案例
    //      AI原估 6.0~7.5萬 → 專家校正 5.2~6.5萬，兩端降幅皆為13.3%，故先採此比例為預設值
    //
    //    ⚠️ 此比例目前僅由「單一案例」推導而來，建議之後累積更多不同「公司規模 / 年資區間」的
    //       實測校正案例，確認這個比例在其他情境（例如大公司、資深職位）是否同樣成立。
    //       若發現不同情境的偏誤比例不同，可把下面的 DEFAULT_RATIO 改成依條件查表（見下方 TODO）。
    const SALARY_CALIBRATION_RATIO_DEFAULT = 0.867;

    function getCalibrationRatio(totalTenureYears, companyName) {
        // TODO：未來若累積足夠案例，可在這裡依「年資區間 / 公司規模」回傳不同比例，例如：
        // if (totalTenureYears <= 2) return 0.867;       // 資淺 + 小公司，目前唯一驗證過的區間
        // if (totalTenureYears >= 8) return 0.93;         // 資深族群，偏誤幅度待驗證後填入
        // 目前資料量不足以拆分，先統一使用預設比例
        return SALARY_CALIBRATION_RATIO_DEFAULT;
    }

    function applyCalibration(rawSalary, totalTenureYears, companyName) {
        // rawSalary 格式固定為 "X~Y萬" 或 "X~Y萬(含其他文字)"，抓出兩個數字做校正後再組回去
        const match = rawSalary.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)/);
        if (!match) return rawSalary; // 格式不如預期就不動，避免弄壞顯示

        const ratio = getCalibrationRatio(totalTenureYears, companyName);
        let low = parseFloat(match[1]) * ratio;
        let high = parseFloat(match[2]) * ratio;

        // 校正後避免出現不合理的下限（例如低於基本工資換算的月薪水準）
        low = Math.max(low, 2.8);
        high = Math.max(high, low + 0.5);

        const fmt = (n) => (Number.isInteger(n) ? n.toString() : Math.round(n * 10) / 10);
        return rawSalary.replace(match[0], `${fmt(low)}~${fmt(high)}`);
    }

    function calculateTotalTenure(experiences) {
        let totalMonths = 0;
        experiences.forEach(exp => {
            let text = exp.durationText;
            if (!text || text === "未知年資") return;

            let years = 0;
            let months = 0;
            let yearMatch = text.match(/(\d+)\s*年/);
            if (yearMatch) years = parseInt(yearMatch[1], 10);

            let monthMatch = text.match(/(\d+)\s*個?月/);
            if (monthMatch) months = parseInt(monthMatch[1], 10);

            totalMonths += (years * 12) + months;
        });

        let y = Math.floor(totalMonths / 12);
        let m = totalMonths % 12;
        let result = "";
        if (y > 0) result += `${y}年`;
        if (m > 0) result += `${m}個月`;
        return result || "低於1個月";
    }

    function getCandidateJobs(titleNode) {
        const allJobs = Array.from(document.querySelectorAll(JOB_NAME_SELECTOR));
        let wrapper = titleNode.closest('article, .el-card');
        if (wrapper) {
            return Array.from(wrapper.querySelectorAll(JOB_NAME_SELECTOR));
        }
        if (window.location.href.includes('/resume/')) {
            return allJobs;
        }
        let expList = titleNode.closest('.experience-list');
        if (expList) {
            return Array.from(expList.querySelectorAll(JOB_NAME_SELECTOR));
        }
        return allJobs;
    }

    function addGeminiButton() {
        const allJobs = Array.from(document.querySelectorAll(JOB_NAME_SELECTOR));

        allJobs.forEach((titleNode) => {
            if (titleNode.querySelector('.gemini-btn-wrapper')) return;

            let candidateJobs = getCandidateJobs(titleNode);
            if (candidateJobs.length > 0 && candidateJobs[0] !== titleNode) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'gemini-btn-wrapper';
            Object.assign(wrapper.style, {
                display: 'inline-flex',
                alignItems: 'center',
                position: 'relative',
                verticalAlign: 'middle',
                marginLeft: '12px'
            });

            const btn = document.createElement('div');
            Object.assign(btn.style, {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                padding: '3px 8px',
                backgroundColor: '#1a73e8',
                color: 'white',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                lineHeight: '1.2'
            });
            btn.innerHTML = `<span>✨</span><span>AI 算薪水</span>`;

            const tooltip = document.createElement('div');
            Object.assign(tooltip.style, {
                position: 'absolute',
                bottom: '120%',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#202124',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 'normal',
                lineHeight: '1.5',
                width: 'max-content',
                maxWidth: '350px',
                whiteSpace: 'normal',
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                display: 'none',
                zIndex: '9999',
                pointerEvents: 'none'
            });

            wrapper.appendChild(btn);
            wrapper.appendChild(tooltip);
            titleNode.appendChild(wrapper);

            wrapper.addEventListener('mouseenter', () => {
                if (tooltip.innerHTML !== '') tooltip.style.display = 'block';
            });
            wrapper.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });

            function renderResult(finalSalary, finalReason, totalTenure, validExperiences, ignoredExperiences, fromCache) {
                let detailHTML = `<strong>💡 薪資評估與年資精算：</strong>`;
                detailHTML += fromCache ? ` <span style="font-size:11px; color:#9aa0a6;">(快取結果，24hr內同履歷保持一致)</span><br>` : `<br>`;
                detailHTML += `✓ 有效總年資：<span style="color:#66bb6a; font-weight:bold;">${totalTenure}</span><br>`;
                detailHTML += `<div style="font-size: 11.5px; color: #ccc; margin-top: 4px; padding-left: 8px; border-left: 2px solid #555;">`;

                validExperiences.forEach(exp => {
                    detailHTML += `+ ${exp.companyName} (${exp.durationText})<br>`;
                });

                if (ignoredExperiences.length > 0) {
                     const ignoredNames = ignoredExperiences.map(e => e.fullJobTitle).join('、');
                     detailHTML += `<span style="color:#ef5350; margin-top: 2px; display:inline-block;">- 🚫已剃除雜訊：${ignoredNames}</span><br>`;
                }
                detailHTML += `</div>`;
                detailHTML += `<div style="margin-top: 8px; border-top: 1px dashed #555; padding-top: 6px;"><strong>🤖 AI 觀點：</strong>${finalReason}</div>`;
                let arrowHTML = `<div style="position:absolute; top:100%; left:50%; transform:translateX(-50%); border-width:6px; border-style:solid; border-color:#202124 transparent transparent transparent;"></div>`;

                tooltip.innerHTML = detailHTML + arrowHTML;

                btn.innerHTML = `<span>💰</span><span>${finalSalary}</span><span title="重新運算" style="font-size:11px; opacity:0.7; margin-left:2px;">🔄</span>`;
                Object.assign(btn.style, {
                    backgroundColor: '#e6f4ea',
                    color: '#137333',
                    border: '1px solid #ceead6',
                    cursor: 'pointer'
                });
            }

            btn.onclick = async (e) => {
                e.preventDefault();

                if (GEMINI_API_KEY === '請把你的API_KEY貼在這裡' || GEMINI_API_KEY === '') {
                    alert('⚠️ 請先在 Tampermonkey 腳本中填入你的 Gemini API Key！');
                    return;
                }

                // 🔍 金鑰基本檢查：只擋「明顯異常」的情況（例如帶有空白/換行），
                //    不再對長度、字元組成做死板的樣式比對，避免誤判合法但格式略有差異的 Key
                const trimmedKey = GEMINI_API_KEY.trim();
                if (trimmedKey !== GEMINI_API_KEY || /\s/.test(trimmedKey)) {
                    alert(
                        '⚠️ 偵測到 API Key 前後或中間有多餘的空白/換行，請重新複製貼上一次。'
                    );
                    return;
                }

                if (btn.innerText.includes('運算中')) return;

                // 若按鈕已經顯示過結果（含 💰 或 ❌），代表這次點擊是使用者主動按🔄要求「強制重算」，
                // 此時略過快取，直接重新呼叫 AI；否則一律先查快取，確保同一份履歷結果穩定不跳動
                const isForceRefresh = btn.innerHTML.includes('💰') || btn.innerHTML.includes('❌');

                btn.innerHTML = `<span>⚡</span><span>極速運算中...</span>`;
                Object.assign(btn.style, {
                    backgroundColor: '#f4b400',
                    color: '#fff',
                    border: 'none',
                    cursor: 'wait'
                });
                tooltip.innerHTML = '';

                try {
                    let rawExperiences = candidateJobs.map(node => extractJobInfo(node));

                    // 🔍 【除錯用】按F12打開主控台，可以看到每一筆「實際被抓到的資料」，
                    //    方便確認：是「文字沒抓對」還是「同一份工作被重複拆成好幾筆」
                    console.log('[薪資試算-除錯] 抓到的原始經歷筆數：', rawExperiences.length);
                    console.table(rawExperiences.map(info => ({
                        公司: info.companyName,
                        職稱: info.fullJobTitle,
                        時間: info.durationText
                    })));

                    const excludeKeywords = [
                        // 教育/培訓/實習類
                        '實習', '家教', '工讀生', '培訓班', '培訓養成班', '補習班', '課輔', '助教', '教師', '老師', '講師',
                        // 餐飲/服務類
                        '服務生', '吧檯', '服務員', '房務', '餐飲助理', '廚師', '內場', '外場', '廚務', '咖啡師', '烘焙師', '甜點師',
                        // 零售/門市類
                        '門市店員', '專櫃', '收銀', '理貨', '促銷', '店鋪人員', '職員',
                        // 生產/物流/外勤類
                        '作業員', '包裝員', '外送', '司機', '搬運', '倉管', '物流助理', '物流人員', '粗工', '工地', '板模',
                        // 行政庶務類
                        '總機', '櫃檯', '櫃台', '資料輸入',
                        // 陌生開發/派發類
                        '發傳單',
                        // 保全/清潔/居家照護類
                        '保全', '警衛', '清潔', '打掃', '保潔', '看護', '褓姆', '居服員',
                        // 美容美髮類
                        '美髮', '美容', '美甲', '寵物美容師', '按摩師',
                        // 醫療/健康類
                        '醫師', '牙醫師', '護理師', '護士', '藥師', '物理治療師', '職能治療師',
                        '醫事檢驗師', '心理諮商師', '臨床心理師', '營養師',
                        // 公務/制服單位類
                        '警察', '消防員',
                        // 農漁/一級產業類
                        '農夫',
                        // 傳播/媒體/創作類
                        '模特', '翻譯員', '主播', '編輯', '記者', '配音員', '影音創作者', '攝影師',
                        // 旅遊/運輸服務類
                        '導遊', '領隊', '空服員',
                        // 運動/教練類
                        '健身教練',
                        // 建築/工程專業類（非軟體工程）
                        '建築師', '土木技師', '結構技師',
                        // 法律類
                        '律師', '法務人員', '代書',
                        // 仲介類
                        '房仲', '仲介', '直銷'
                    ];
                    let validExperiences = [];
                    let ignoredExperiences = [];

                    rawExperiences.forEach(info => {
                        let isIgnored = excludeKeywords.some(keyword => info.fullJobTitle.includes(keyword));
                        if(isIgnored) {
                            ignoredExperiences.push(info);
                        } else {
                            validExperiences.push(info);
                        }
                    });

                    // 🔍 【除錯用】看每一筆最後被判定「保留」還是「排除」，以及排除的話是命中哪個關鍵字
                    console.log('[薪資試算-除錯] 排除判定結果：');
                    console.table(rawExperiences.map(info => {
                        const hitKeyword = excludeKeywords.find(k => info.fullJobTitle.includes(k));
                        return {
                            職稱: info.fullJobTitle,
                            判定: hitKeyword ? '🚫排除' : '✅保留',
                            命中關鍵字: hitKeyword || '-'
                        };
                    }));

                    if (validExperiences.length === 0) {
                        validExperiences = rawExperiences;
                        ignoredExperiences = [];
                    }

                    let totalTenure = calculateTotalTenure(validExperiences);

                    let chronologicalExperiences = [...validExperiences].reverse();
                    let trajectorySummary = chronologicalExperiences.map(info => {
                        return `${info.durationText} * ${info.companyName}的${info.fullJobTitle}`;
                    }).join(" + ");

                    // 🔒 【一致性防護】用經歷內容產生固定快取 key，同一份履歷 24 小時內查詢結果一律相同
                    const cacheKey = stableHash(trajectorySummary);
                    if (!isForceRefresh) {
                        const cached = readCache(cacheKey);
                        if (cached) {
                            renderResult(cached.finalSalary, cached.finalReason, cached.totalTenure, cached.validExperiences, cached.ignoredExperiences, true);
                            return;
                        }
                    }

                    // 🌟 核心防護：要求 AI 綜合「公司招牌」、「產業」、「年資」進行獵頭級精算
                    const promptText = `你是一位精通台灣就業市場與科技業薪資結構的資深人資獵頭。
求職者經歷：
${trajectorySummary}
嚴格評估邏輯與規則：
1. 核心指標：請務必根據經歷中的「具體公司名稱」判斷其公司規模、產業級別與業界真實給薪水準，並結合「職稱」與「有效年資」，推估其目前合理的薪資級距。
2. 幣值定位：必須以「新台幣(TWD)月薪」為基準，貼合台灣實際市場行情（參考在地業界常態）。絕對禁止套用海外或中國大陸薪水。
3. 保守校準：請以該職稱「一般到中高水準」的實際發放行情估算，而非該公司最頂尖職缺、分紅入股後的天花板數字，也不要參考求職社群/薪資論壇上偏誇大自報的極端值。寧可估保守一點，不要浮誇。
4. 第一行「只能」輸出數字區間，格式必須為「X~Y萬」(如：6~7.5萬)。絕對禁止只給單一數字，禁止加任何前綴！
5. 第二行說明評估原因(30字內)，必須簡述「前東家規模/產業特性」與「年資」對此薪資的影響。`;

                    // 🔒 【一致性防護】用同一份履歷內容產生固定 seed，讓「同樣輸入」在模型端也盡量拿到同樣的抽樣結果
                    const fixedSeed = Math.abs(
                        Array.from(trajectorySummary).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
                    ) % 2147483647;

                    // 抓出「真正的薪資區間」用的固定樣式：兩個數字中間夾分隔符號（~－-—到）
                    const SALARY_RANGE_PATTERN = /\d+(?:\.\d+)?\s*[－\-—到~]\s*\d+(?:\.\d+)?/;

                    // 格式驗證：直接找「符合兩數字+分隔符」的那一行，而不是「第一行只要有數字就當作它」，
                    // 避免 AI 偶爾在數字前多加一句含數字的前言（例如「根據2025年行情」）時誤判成截斷失敗，
                    // 或誤把前言當成薪資行去解析，導致算出離譜的數字
                    function isCompleteSalaryFormat(text) {
                        const cleaned = text.replace(/[*`#]/g, '').trim();
                        return cleaned.split('\n').some(l => SALARY_RANGE_PATTERN.test(l));
                    }

                    async function callModel(modelName) {
                        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: promptText }] }],
                                generationConfig: {
                                    // 100 tokens 偏緊，AI 寫到一半（例如剛打完「5~」）額度就用完，
                                    // 導致回應被硬生生截斷，缺第二個數字。拉高額度降低截斷機率。
                                    maxOutputTokens: 200,
                                    temperature: 0.0,
                                    seed: fixedSeed
                                }
                            })
                        });
                        const data = await response.json();
                        if (data.error) throw new Error(data.error.message);
                        const text = data.candidates[0].content.parts[0].text.trim();

                        // 🔒 回應格式不完整（很可能是被截斷，例如只有「5~」缺上限數字），
                        //    直接視為這次呼叫失敗，讓外層迴圈換下一個模型/重試，
                        //    而不是把殘缺字串硬湊成「5~萬」這種看似合理實則錯誤的結果
                        if (!isCompleteSalaryFormat(text)) {
                            throw new Error('回應格式不完整（可能被截斷），視為失敗並重試');
                        }
                        return text;
                    }

                    let aiResult = "";

                    // 先嘗試固定版本模型清單（避免用「flash-latest」這種會隨時間指向不同版本的別名）
                    for (let modelName of PREFERRED_MODELS) {
                        try {
                            aiResult = await callModel(modelName);
                            if (aiResult) break;
                        } catch (err) {
                            continue;
                        }
                    }

                    // 固定模型都打不通時（例如帳號權限問題），才退回動態查詢清單作為最後備援
                    if (!aiResult) {
                        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
                        const modelsData = await modelsRes.json();
                        if (modelsData.error) throw new Error("權限驗證：" + modelsData.error.message);

                        let validModels = modelsData.models.filter(m =>
                            m.supportedGenerationMethods &&
                            m.supportedGenerationMethods.includes('generateContent') &&
                            m.name.includes('gemini') &&
                            !m.name.includes('2.5')
                        );

                        validModels.sort((a, b) => {
                            let scoreA = a.name.includes('flash') ? 2 : 1;
                            let scoreB = b.name.includes('flash') ? 2 : 1;
                            return scoreB - scoreA;
                        });

                        for (let model of validModels) {
                            try {
                                const targetModelName = model.name.replace('models/', '');
                                aiResult = await callModel(targetModelName);
                                if (aiResult) break;
                            } catch (err) {
                                continue;
                            }
                        }
                    }

                    if (!aiResult) throw new Error("運算失敗，請稍後再試");

                    let cleanResult = aiResult.replace(/[*`#]/g, '').trim();
                    let lines = cleanResult.split('\n').filter(l => l.trim().length > 0);

                    let finalSalary = '解析異常';
                    let finalReason = '綜合過往公司背景與年資推估。';

                    let salaryLineIndex = lines.findIndex(l => SALARY_RANGE_PATTERN.test(l));
                    // 極少數情況下 AI 可能只給單一數字（無分隔符），仍退回「第一行有數字」當備援
                    if (salaryLineIndex === -1) {
                        salaryLineIndex = lines.findIndex(l => /\d/.test(l));
                    }
                    if (salaryLineIndex !== -1) {
                        let rawSalary = lines[salaryLineIndex].replace(/^.*?(\d)/, '$1').trim();

                        rawSalary = rawSalary.replace(/\s*[－\-—到~]\s*/g, '~');

                        if (!rawSalary.includes('~')) {
                            let numMatch = rawSalary.match(/(\d+(\.\d+)?)/);
                            if (numMatch) {
                                let baseNum = parseFloat(numMatch[1]);
                                let upperNum = Number.isInteger(baseNum) ? baseNum + 1.5 : baseNum + 1.5;
                                rawSalary = rawSalary.replace(numMatch[0], `${baseNum}~${upperNum}`);
                            }
                        }

                        rawSalary = rawSalary.replace(/萬(?=.*~)/g, '');

                        if (!rawSalary.includes('萬') && !/[kK]/.test(rawSalary)) {
                            rawSalary += '萬';
                        }

                        // 從「X年Y個月」字串換算約略年資（供未來分眾校正使用）
                        const tenureYearMatch = totalTenure.match(/(\d+)\s*年/);
                        const approxTenureYears = tenureYearMatch ? parseInt(tenureYearMatch[1], 10) : 0;
                        const latestCompanyName = validExperiences.length > 0 ? validExperiences[0].companyName : '';

                        finalSalary = applyCalibration(rawSalary, approxTenureYears, latestCompanyName);

                        if (lines.length > salaryLineIndex + 1) {
                            finalReason = lines[salaryLineIndex + 1].replace(/^(AI評估|評估原因|原因)[：:]?\s*/, '').trim();
                        }
                    }

                    // 🔒 寫入快取：同一份履歷（trajectorySummary 沒變）在 24 小時內都會拿到這次算出的結果
                    writeCache(cacheKey, { finalSalary, finalReason, totalTenure, validExperiences, ignoredExperiences });

                    renderResult(finalSalary, finalReason, totalTenure, validExperiences, ignoredExperiences, false);

                } catch (error) {
                    btn.innerHTML = `<span>❌</span><span>計算錯誤</span><span title="重新運算" style="font-size:11px; opacity:0.7; margin-left:2px;">🔄</span>`;
                    Object.assign(btn.style, {
                        backgroundColor: '#fce8e6',
                        color: '#c5221f',
                        border: '1px solid #f8d8d8',
                        cursor: 'pointer'
                    });
                    tooltip.innerHTML = `系統回報錯誤：<br>${error.message}<div style="position:absolute; top:100%; left:50%; transform:translateX(-50%); border-width:6px; border-style:solid; border-color:#202124 transparent transparent transparent;"></div>`;
                }
            };
        });
    }

    const observer = new MutationObserver(() => {
        addGeminiButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(addGeminiButton, 1000);

})();