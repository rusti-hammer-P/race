(function () {
  const MONTHS = [
    { id: "2511", label: "2025年11月", file: "data/chase-data-2511.js" },
    { id: "2512", label: "2025年12月", file: "data/chase-data-2512.js" },
    { id: "2601", label: "2026年1月", file: "data/chase-data-2601.js" },
    { id: "2602", label: "2026年2月", file: "data/chase-data-2602.js" },
    { id: "2603", label: "2026年3月", file: "data/chase-data-2603.js" },
    { id: "2604", label: "2026年4月", file: "data/chase-data-2604.js" },
    { id: "2605", label: "2026年5月", file: "data/chase-data-2605.js" },
    { id: "2606", label: "2026年6月", file: "data/chase-data-2606.js" },
  ];

  const cache = new Map();

  // 目標リターン率（年率）
  const TARGET_RETURNS = {
    levanas: 0.30,  // 年30%
    vt: 0.15,       // 年15%
  };

  function getMonthMeta(monthId) {
    return MONTHS.find((month) => month.id === monthId) || MONTHS[MONTHS.length - 1];
  }

  function getDefaultMonthId() {
    return MONTHS[MONTHS.length - 1].id;
  }

  function getSelectedMonthId() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("month");
    if (MONTHS.some((month) => month.id === requested)) return requested;

    try {
      const stored = window.localStorage.getItem("chase-selected-month");
      if (MONTHS.some((month) => month.id === stored)) return stored;
    } catch (error) {
      console.warn("localStorage unavailable", error);
    }

    return getDefaultMonthId();
  }

  function setSelectedMonthId(monthId) {
    try {
      window.localStorage.setItem("chase-selected-month", monthId);
    } catch (error) {
      console.warn("localStorage unavailable", error);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return dateStr || "-";
    return `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
  }

  function formatYen(value) {
    return `¥${Number(value || 0).toLocaleString("ja-JP")}`;
  }

  function formatSignedYen(value) {
    if (!Number.isFinite(value)) return "-";
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${Math.abs(Math.round(value)).toLocaleString("ja-JP")}円`;
  }

  function computeExpectedTrend(basePrice, annualRate, numDays) {
    if (!Number.isFinite(basePrice) || !Number.isFinite(annualRate) || numDays <= 0) return [];
    const dailyRate = Math.pow(1 + annualRate, 1 / 252) - 1;
    const trend = [];
    let current = basePrice;
    for (let i = 0; i < numDays; i++) {
      trend.push(current);
      current = current * (1 + dailyRate);
    }
    return trend;
  }

  function getTargetReturns() {
    return TARGET_RETURNS;
  }

  function computeAchievementRate(actual, expected) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected === 0) return null;
    return (actual - expected) / expected;
  }

  async function getCumulativeExpectedTrend(monthId) {
    const targetIndex = MONTHS.findIndex((m) => m.id === monthId);
    if (targetIndex < 0) return { vt: [], levanas: [] };

    const allDays = [];
    const targets = TARGET_RETURNS;

    for (let i = 0; i <= targetIndex; i++) {
      const month = MONTHS[i];
      const data = await loadMonthData(month.id).catch(() => []);
      allDays.push(...data);
    }

    if (!allDays.length) return { vt: [], levanas: [] };

    const targetMonthStart = MONTHS.slice(0, targetIndex).reduce((sum, m) => {
      return sum + (cache.get(m.id)?.length || 0);
    }, 0);

    const result = { vt: [], levanas: [] };
    const vtBase = allDays[0].vt;
    const levanasBase = allDays[0].levanas;

    for (let i = targetMonthStart; i < allDays.length; i++) {
      const dayOffset = i + 1;
      const vtExpected = vtBase * Math.pow(1 + targets.vt, dayOffset / 252);
      const levanasExpected = levanasBase * Math.pow(1 + targets.levanas, dayOffset / 252);
      result.vt.push(vtExpected);
      result.levanas.push(levanasExpected);
    }

    return result;
  }

  function computeDCAReturnRate(days) {
    // 単一積立期間のリターン: 初日（積立日）→ 最終日の価格変化を年率換算
    if (!Array.isArray(days) || days.length < 2) return { vt: null, levanas: null };
    const first = days[0];
    const last = days[days.length - 1];
    const periodDays = days.length - 1; // 期間の営業日数（インターバル数）
    const vtReturn = (last.vt / first.vt - 1) * (252 / periodDays);
    const levanasReturn = (last.levanas / first.levanas - 1) * (252 / periodDays);
    return { vt: vtReturn, levanas: levanasReturn };
  }

  async function computeCumulativeDCAIRR(monthId) {
    // 全月通算のDCA IRR（内部収益率）
    // 各ファイルの初日が積立日。積立額 = 当月初日価格 - 前月最終日価格
    const targetIndex = MONTHS.findIndex((m) => m.id === monthId);
    if (targetIndex < 0) return { vt: null, levanas: null, totalDays: 0 };

    const monthsData = [];
    for (let i = 0; i <= targetIndex; i++) {
      const data = await loadMonthData(MONTHS[i].id).catch(() => []);
      monthsData.push(data);
    }
    if (!monthsData.length || !monthsData[0].length) return { vt: null, levanas: null, totalDays: 0 };

    const cashFlowsLev = [];
    const cashFlowsVT = [];
    let dayOffset = 0;

    for (let i = 0; i < monthsData.length; i++) {
      const monthDays = monthsData[i];
      if (!monthDays.length) continue;

      if (i === 0) {
        // 最初の月: 初日価格全体が初回投資額
        cashFlowsLev.push({ dayOffset: 0, amount: monthDays[0].levanas });
        cashFlowsVT.push({ dayOffset: 0, amount: monthDays[0].vt });
      } else {
        // 以降の月: 初日価格 - 前月最終日価格 = 新規積立額
        const prevDays = monthsData[i - 1];
        const prevEnd = prevDays[prevDays.length - 1];
        const thisStart = monthDays[0];
        const levNew = thisStart.levanas - prevEnd.levanas;
        const vtNew = thisStart.vt - prevEnd.vt;
        if (levNew > 0) cashFlowsLev.push({ dayOffset, amount: levNew });
        if (vtNew > 0) cashFlowsVT.push({ dayOffset, amount: vtNew });
      }

      // 各ファイルの最終日 = 次ファイルの初日なので (length - 1) だけ進む
      dayOffset += monthDays.length - 1;
    }

    const totalDays = dayOffset;
    const lastDays = monthsData[monthsData.length - 1];
    const terminalLev = lastDays[lastDays.length - 1].levanas;
    const terminalVT = lastDays[lastDays.length - 1].vt;

    function solveIRR(cashFlows, terminalValue, totalDays) {
      if (!cashFlows.length || totalDays <= 0) return null;
      // IRR: sum(cf.amount * (1+r)^((totalDays - cf.dayOffset) / 252)) = terminalValue
      // fv(r) は r の単調増加関数 → 二分法で解く
      function fv(r) {
        return cashFlows.reduce((sum, cf) => {
          return sum + cf.amount * Math.pow(1 + r, (totalDays - cf.dayOffset) / 252);
        }, 0);
      }
      let lo = -0.99, hi = 100;
      if (fv(lo) >= terminalValue) return lo;
      if (fv(hi) <= terminalValue) return hi;
      for (let iter = 0; iter < 300; iter++) {
        const mid = (lo + hi) / 2;
        if (fv(mid) < terminalValue) lo = mid;
        else hi = mid;
        if (hi - lo < 1e-12) break;
      }
      return (lo + hi) / 2;
    }

    return {
      vt: solveIRR(cashFlowsVT, terminalVT, totalDays),
      levanas: solveIRR(cashFlowsLev, terminalLev, totalDays),
      totalDays,
    };
  }

  async function computeCumulativeTWR(monthId) {
    // 時間加重収益率（TWR）年率換算
    // VT: DCAなし → 全期間の first→last で単純計算
    // Levanas: DCAあり → 月ファイル単位の HPR チェーン
    const targetIndex = MONTHS.findIndex((m) => m.id === monthId);
    if (targetIndex < 0) return { vt: null, levanas: null, totalDays: 0 };

    const monthsData = [];
    for (let i = 0; i <= targetIndex; i++) {
      const d = await loadMonthData(MONTHS[i].id).catch(() => []);
      monthsData.push(d);
    }

    // 日付ベース重複除去で allDays を構築（月境界が重複しない場合も正しく処理）
    const allDays = [];
    for (const md of monthsData) {
      if (!md.length) continue;
      if (allDays.length === 0) {
        allDays.push(...md);
      } else {
        const skip = md[0].date === allDays[allDays.length - 1].date;
        allDays.push(...(skip ? md.slice(1) : md));
      }
    }

    if (allDays.length < 2) return { vt: null, levanas: null, totalDays: 0 };

    const totalDays = allDays.length - 1;
    const annFactor = 252 / totalDays;

    // VT: DCAなし → allDays の最初と最後だけで計算
    const twrVT = allDays[allDays.length - 1].vt / allDays[0].vt;

    // Levanas: 月ファイル単位の HPR をチェーン（DCA サブ期間）
    let twrLev = 1;
    for (const md of monthsData) {
      if (md.length >= 2) twrLev *= md[md.length - 1].levanas / md[0].levanas;
    }

    return {
      levanas:   Math.pow(twrLev, annFactor) - 1,
      vt:        Math.pow(twrVT,  annFactor) - 1,
      totalDays,
    };
  }

  function normalizeData(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((day) => {
      const lev = Array.isArray(day) ? day.find((item) => item.name === "レバナス") : null;
      const vt = Array.isArray(day) ? day.find((item) => item.name === "楽天VT") : null;
      const date = lev?.date || vt?.date || "";
      return {
        date,
        levanas: Number(lev?.price),
        vt: Number(vt?.price),
      };
    }).filter((day) => day.date && Number.isFinite(day.levanas) && Number.isFinite(day.vt));
  }

  function loadMonthData(monthId) {
    const meta = getMonthMeta(monthId);
    if (!meta) return Promise.resolve([]);
    if (cache.has(meta.id)) return Promise.resolve(cache.get(meta.id));

    return fetch(`${meta.file}?v=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${meta.file}: HTTP ${response.status}`);
        return response.text();
      })
      .then((code) => {
        const raw = new Function(`${code}\nreturn typeof darbyRawData !== "undefined" ? darbyRawData : [];`)();
        const loaded = normalizeData(raw);
        // ファイル内のデータはその月の積立日～翌月の積立日までなので、
        // ファイル全体を月の実績データとして使用
        cache.set(meta.id, loaded);
        return loaded;
      });
  }

  function getPreviousMonthId(monthId) {
    const index = MONTHS.findIndex((month) => month.id === monthId);
    if (index <= 0) return null;
    return MONTHS[index - 1].id;
  }

  function getMonthSummary(days) {
    if (!Array.isArray(days) || !days.length) return null;
    const first = days[0];
    const last = days[days.length - 1];
    return {
      startDate: first.date,
      endDate: last.date,
      tradingDays: days.length,
      vtStart: first.vt,
      vtEnd: last.vt,
      vtChange: last.vt - first.vt,
      levanasStart: first.levanas,
      levanasEnd: last.levanas,
      levanasChange: last.levanas - first.levanas,
      gapEnd: last.vt - last.levanas,
    };
  }

  async function loadAllMonths() {
    const results = [];
    let cumulativeDays = 0;
    for (const month of MONTHS) {
      const days = await loadMonthData(month.id);
      const summary = getMonthSummary(days);
      const tradingDays = days.length;
      results.push({ 
        month, 
        days, 
        summary,
        tradingDays,
        cumulativeStart: cumulativeDays,
        cumulativeEnd: cumulativeDays + tradingDays
      });
      cumulativeDays += tradingDays;
    }
    return results;
  }

  async function getCumulativeTradingDay(monthId) {
    const rows = await loadAllMonths();
    const row = rows.find((r) => r.month.id === monthId);
    return row ? { start: row.cumulativeStart, end: row.cumulativeEnd, days: row.tradingDays } : null;
  }

  window.ChaseData = {
    MONTHS,
    getMonthMeta,
    getDefaultMonthId,
    getSelectedMonthId,
    setSelectedMonthId,
    getPreviousMonthId,
    formatDate,
    formatYen,
    formatSignedYen,
    loadMonthData,
    loadAllMonths,
    getMonthSummary,
    getCumulativeTradingDay,
    computeExpectedTrend,
    getCumulativeExpectedTrend,
    computeCumulativeDCAIRR,
    computeCumulativeTWR,
    getTargetReturns,
    computeAchievementRate,
    computeDCAReturnRate,
  };
})();