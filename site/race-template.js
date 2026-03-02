// Reusable race slide logic.
// Configure via window.DARBY_RACE_CONFIG before loading this script.
(function () {
  // ===== CONFIG (defaults) =====
  const DEFAULT_FUNDS = [
    "SOX",
    "レバナス",
    "FANG+",
    "S&P500",
    "全米株式",
    "オルカン",
    "ABB",
    "SOMPO123",
    "VYM",
    "SPYD",
  ];

  const DEFAULT_COLORS = {
    SOX: "#5f27cd",
    レバナス: "#e84393",
    "FANG+": "#ff6b6b",
    "S&P500": "#2ecc71",
    全米株式: "#1abc9c",
    オルカン: "#3498db",
    ABB: "#9b59b6",
    SOMPO123: "#f39c12",
    VYM: "#27ae60",
    SPYD: "#e67e22",
  };

  const config = (window.DARBY_RACE_CONFIG && typeof window.DARBY_RACE_CONFIG === "object")
    ? window.DARBY_RACE_CONFIG
    : {};

  // If true (default), treat the first data point as an accumulation day.
  // If false, assume accumulation happened before the first day in the JSON.
  const DAY0_IS_ACCUMULATION = (typeof config.day0IsAccumulation === "boolean")
    ? config.day0IsAccumulation
    : true;

  const FUNDS = Array.isArray(config.funds) && config.funds.length ? config.funds.slice() : DEFAULT_FUNDS.slice();
  const COLORS = (config.colors && typeof config.colors === "object") ? { ...DEFAULT_COLORS, ...config.colors } : DEFAULT_COLORS;

  // シンプル連結では口数標準化は行わない
  // 基準（初期）として各ファンドに割り当てる金額（3_notitle と同様の扱い）
  const INITIAL_INVESTMENT_AMOUNT = Number.isFinite(config.initialInvestmentAmount)
    ? config.initialInvestmentAmount
    : 10000;

  // 積立日の指定方法
  // mode: 'month-change'（各月の最初の営業日）, 'day-of-month'（指定日。なければ翌営業日、なければ当月最終）,'custom-dates'（YYYYMMDD配列）
  // dayOfMonth: 1-31（存在しない場合はロジックにより調整）
  // dates: 明示指定する場合の配列。例: ['20240910','20241015']
  const defaultAccumulationDates = (Array.isArray(window.darbyAccumulationDates) && window.darbyAccumulationDates.length)
    ? window.darbyAccumulationDates.slice()
    : ["20250903", "20251003", "20251106", "20251203"];

  const fallbackAccumulateOn = {
    mode: "custom-dates",
    dayOfMonth: 1,
    dates: defaultAccumulationDates,
  };

  const ACCUMULATE_ON = (() => {
    const fromTemplate = (config.accumulateOn && typeof config.accumulateOn === "object") ? config.accumulateOn : null;
    const fromLegacy = (window.ACCUMULATE_ON && typeof window.ACCUMULATE_ON === "object") ? window.ACCUMULATE_ON : null;
    const merged = { ...fallbackAccumulateOn, ...(fromLegacy || {}), ...(fromTemplate || {}) };
    if (!Array.isArray(merged.dates) || !merged.dates.length) merged.dates = defaultAccumulationDates;
    return merged;
  })();

  // 日替わりポーズ（ms）: 積立日は少し長め
  const dwell = (config.dwell && typeof config.dwell === "object") ? config.dwell : {};
  const DWELL_NORMAL = Number.isFinite(dwell.normal) ? dwell.normal : 125;
  const DWELL_ACCUM = Number.isFinite(dwell.accum) ? dwell.accum : 225;
  const DWELL_RANK_CHANGE = Number.isFinite(dwell.rankChange) ? dwell.rankChange : 400;

  const msPerSwap = Number.isFinite(config.msPerSwap) ? config.msPerSwap : 220;
  const speedDefault = Number.isFinite(config.speedDefault) ? config.speedDefault : 400;

  // Optional: template can override title/header without editing HTML.
  if (typeof config.title === "string" && config.title.trim()) {
    document.title = config.title;
  }
  if (typeof config.header === "string" && config.header.trim()) {
    const headerEl = document.getElementById("race-header");
    if (headerEl) headerEl.textContent = config.header;
  }

  const speedInput = document.getElementById("speed");
  if (speedInput && Number.isFinite(speedDefault)) {
    speedInput.value = String(speedDefault);
  }

  // ===== DATA PREP =====
  // combined-from-arcs.js が提供する darbyCombinedArcs を使用（非同期ロード対応）
  // 各要素: { date: YYYYMMDD, FUND: 価格 }（9月→10月→11月 レンジ推移）
  let simpleSeq = Array.isArray(window.darbyCombinedArcs) ? window.darbyCombinedArcs : [];

  function computeDisplayValues(index) {
    const slice = simpleSeq[index];
    return slice;
  }

  // 積立日（ここでは月替わりの最初の営業日と仮定）に基準を1口分ずつ追加する
  let baselineAtIndex = [];
  let lotCountAtIndex = [];
  let isAccumDay = [];
  let baselineDigitWidth = INITIAL_INVESTMENT_AMOUNT.toString().length;

  function computeAccumulationFlags(seq) {
    const n = seq.length;
    const flags = new Array(n).fill(false);
    if (!n) return flags;
    // day0 accumulation is configurable (default: true for backward compatibility)
    flags[0] = DAY0_IS_ACCUMULATION;
    if (ACCUMULATE_ON.mode === "custom-dates") {
      const set = new Set((ACCUMULATE_ON.dates || []).map(String));
      for (let i = 1; i < n; i++) {
        if (set.has(seq[i].date)) flags[i] = true;
      }
      return flags;
    }
    // 月ごとに代表日を決める
    const monthMap = new Map(); // key -> indices[]
    for (let i = 0; i < n; i++) {
      const m = seq[i].date.slice(0, 6);
      if (!monthMap.has(m)) monthMap.set(m, []);
      monthMap.get(m).push(i);
    }
    if (ACCUMULATE_ON.mode === "month-change") {
      for (const idxs of monthMap.values()) {
        const first = idxs[0];
        flags[first] = true; // 初日
      }
      // 先頭は既に true
      return flags;
    }
    if (ACCUMULATE_ON.mode === "day-of-month") {
      const targetDay = Math.max(1, Math.min(31, ACCUMULATE_ON.dayOfMonth || 1));
      for (const idxs of monthMap.values()) {
        // その月の候補群
        let chosen = null;
        // 1. ちょうど指定日
        for (const i of idxs) {
          if (parseInt(seq[i].date.slice(6, 8)) === targetDay) {
            chosen = i;
            break;
          }
        }
        if (chosen == null) {
          // 2. 指定日以降で最初（翌営業日）
          for (const i of idxs) {
            if (parseInt(seq[i].date.slice(6, 8)) > targetDay) {
              chosen = i;
              break;
            }
          }
        }
        if (chosen == null) {
          // 3. なければ当月最終営業日
          chosen = idxs[idxs.length - 1];
        }
        flags[chosen] = true;
      }
      // 先頭は既に true
      return flags;
    }
    // フォールバック
    for (const idxs of monthMap.values()) {
      const first = idxs[0];
      flags[first] = true;
    }
    return flags;
  }

  function computeBaselines() {
    baselineAtIndex = [];
    lotCountAtIndex = [];
    isAccumDay = computeAccumulationFlags(simpleSeq);
    let lot = 0;
    for (let i = 0; i < simpleSeq.length; i++) {
      if (i === 0) {
        if (Number.isFinite(config.initialLotCount)) {
            lot = config.initialLotCount;
            if (isAccumDay[i]) lot++;
        } else {
            // Legacy behavior: Force start at 1
            lot = 1;
        }
        baselineAtIndex.push(INITIAL_INVESTMENT_AMOUNT * lot);
        lotCountAtIndex.push(lot); // isAccumDay[0] は true のはず
        continue;
      }
      if (isAccumDay[i]) {
        lot += 1;
      }
      baselineAtIndex.push(INITIAL_INVESTMENT_AMOUNT * lot);
      lotCountAtIndex.push(lot);
    }
    // 表示桁幅は全期間の最大基準額に合わせて固定
    const maxBaseline = baselineAtIndex.length ? Math.max(...baselineAtIndex) : INITIAL_INVESTMENT_AMOUNT;
    baselineDigitWidth = Math.max(baselineDigitWidth, maxBaseline.toString().length);
  }
  if (simpleSeq.length) {
    computeBaselines();
  }

  // ===== CHART =====
  let currentIndex = 0;
  let isPlaying = false;
  let timer;
  let speed = speedDefault;
  let rafTimer = null;
  let dwellTimer = null;
  let lastOrder = []; // 順位変動検出用
  let rankChangeDetected = false; // 順位変動フラグ

  function createRaceChart() {
    const container = d3.select("#race-chart");
    const width = container.node().clientWidth;
    const height = 650; // Adjusted height to match cockpit
    const margin = { top: 100, right: 160, bottom: 40, left: 220 }; // Increased left margin for larger labels
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const svg = container.append("svg").attr("width", width).attr("height", height);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().range([0, innerW]);
    const y = d3.scaleBand().range([0, innerH]).padding(0.15); // Increased padding slightly
    const dateLabel = g
      .append("text")
      .attr("x", innerW)
      .attr("y", -50)
      .attr("text-anchor", "end")
      .attr("class", "date-label")
      .style("font-size", "36px") // Larger date label
      .text("Loading...");
    // 基準ライン
    const baseLine = g.append("line").attr("class", "goal-line").style("stroke", "#666").attr("y1", 0).attr("y2", innerH);
    const baseText = g.append("text").attr("class", "goal-text").style("fill", "#666").attr("text-anchor", "middle");

    // 初期スケールを最初の基準額に合わせて設定（途中参加の場合に対応）
    const initialBaseline = baselineAtIndex[0] || INITIAL_INVESTMENT_AMOUNT;
    let currentMaxDomain = initialBaseline * 1.3; 
    let targetMaxDomain = currentMaxDomain; // 目標スケール（滑らかに遷移するため）

    function update(dOverride) {
      const dObj = dOverride || computeDisplayValues(currentIndex);
      if (!dObj) {
        // データ未準備時はラベルのみ表示
        dateLabel.text("Loading...");
        return;
      }

      // 初回ロード時などのドメイン補正:
      // もし現在のドメインが初期基準額より著しく小さい場合（非同期ロード等で初期化が間に合わなかった場合）、
      // 強制的にドメインを拡張して「突き抜け」を防ぐ。
      if (baselineAtIndex.length > 0) {
        const properInitialBaseline = baselineAtIndex[0];
        // マージンを含めた適正初期ドメイン
        const properMinDomain = properInitialBaseline * 1.3;
        
        // 現在のドメインが適正値の半分以下なら、初期化ミスとみなして強制リセット
        if (currentMaxDomain < properMinDomain * 0.5) {
            currentMaxDomain = properMinDomain;
            targetMaxDomain = currentMaxDomain;
        }
      }

      // 補間中は段階的な順序を使用、そうでなければ現在の価格で再ソート
      let order;
      if (dObj && dObj._displayOrder) {
        order = dObj._displayOrder;
      } else {
        order = FUNDS.slice();
        order.sort((a, b) => (dObj[b] || 0) - (dObj[a] || 0));
      }
      const maxV = d3.max(order, (f) => dObj[f] || 0) || 0;

      // 積立中かどうかを判定
      const isAccumulating = dObj && dObj._accumBlend;

      if (isAccumulating) {
        // 現在の基準線値を取得
        const baselineNow = dObj && typeof dObj._baseline === "number" ? dObj._baseline : baselineAtIndex[currentIndex] || INITIAL_INVESTMENT_AMOUNT;

        // 積立開始時: ピクセル比率を記録（基準線値ではなく、baseline/domain の比率）
        if (!window._baselinePixelRatio) {
          // 補間が始まる直前（i日目）の基準線位置を使う
          const prevBaseline = baselineAtIndex[currentIndex] || INITIAL_INVESTMENT_AMOUNT;
          window._baselinePixelRatio = prevBaseline / currentMaxDomain;
        }
        // 積立中: 現在の基準線値に対して、記録したピクセル比率を維持するようにスケールを即座に設定
        // イージングなしで直接設定することで、基準線のピクセル位置を完全に固定
        currentMaxDomain = baselineNow / window._baselinePixelRatio;
        targetMaxDomain = currentMaxDomain;
      } else {
        // 積立終了時: リセット
        window._baselinePixelRatio = undefined;

        // 通常時: 現在の最大値がドメインを超えそうな場合、目標スケールを更新（余白が1/3残るように拡張）
        if (maxV > targetMaxDomain * 0.9) {
          targetMaxDomain = maxV * 1.1; // 余白33%確保
        }

        // 現在のスケールを目標に向かって滑らかに移行（イージング）
        const diff = targetMaxDomain - currentMaxDomain;
        if (Math.abs(diff) > 1) {
          currentMaxDomain += diff * 0.08; // 8%ずつゆっくり目標に近づける
        } else {
          currentMaxDomain = targetMaxDomain;
        }
      }

      x.domain([0, currentMaxDomain]);
      y.domain(order);

      // Show business-day counter (0-based)
      const dateStr = dObj.date;
      dateLabel.text(`${currentIndex}営業日経過`);

      // 基準ライン（補間フレームがあればそれを使用、なければ現在の離散値）
      const discreteBaseline = baselineAtIndex[currentIndex] || INITIAL_INVESTMENT_AMOUNT;
      const currentBaseline = dObj && typeof dObj._baseline === "number" ? dObj._baseline : discreteBaseline;
      const baseX = x(currentBaseline);
      baseLine.attr("x1", baseX).attr("x2", baseX);
      // lotCount も補間値があればそれを表示
      const discreteLot = lotCountAtIndex[currentIndex] || 1;
      const currentLot = dObj && typeof dObj._lotCount === "number" ? dObj._lotCount : discreteLot;
      const lotCountDisplay = String(Math.round(currentLot));
      // 桁数を一定にする: 初期投資額の桁を基準にゼロパディング（通貨記号なし）
      const baselineRaw = Math.round(currentBaseline);
      const padded = baselineRaw.toString().padStart(baselineDigitWidth, "0");
      baseText
        .attr("x", baseX)
        .attr("y", -5)
        .style("font-feature-settings", '"tnum"') // 等幅数字
        .style("font-variant-numeric", "tabular-nums")
        .text(`投資元本: ${padded}円 (積立${lotCountDisplay}回)`);
      // 積立日のときはラインを少し強調（ただし最初の積立日は除く）
      const accumEmphasis = ((dObj && dObj._accumBlend) ? true : !!isAccumDay[currentIndex]) && currentLot > 1;
      baseLine
        .style("stroke-width", accumEmphasis ? 3 : 1.5)
        .style("stroke", accumEmphasis ? "#e84393" : "#666")
        .style("stroke-dasharray", accumEmphasis ? "5,3" : "none");

      // 積立中の視覚的強調
      const mainContent = document.getElementById("main-content");
      const accumIndicator = document.getElementById("accumulation-indicator");
      if (accumEmphasis) {
        mainContent.style.backgroundColor = "#fff5f8";
        accumIndicator.style.display = "inline";
      } else {
        mainContent.style.backgroundColor = "";
        accumIndicator.style.display = "none";
      }

      // 順位変動検出と変動の大きさを計算
      rankChangeDetected = false;
      let maxRankChange = 0; // 最大順位変動幅

      if (lastOrder.length > 0 && JSON.stringify(lastOrder) !== JSON.stringify(order)) {
        rankChangeDetected = true;
        // 各ファンドの順位変動幅を計算
        for (let i = 0; i < order.length; i++) {
          const fund = order[i];
          const oldIdx = lastOrder.indexOf(fund);
          const newIdx = i;
          const rankChange = Math.abs(newIdx - oldIdx);
          maxRankChange = Math.max(maxRankChange, rankChange);
        }
      }
      lastOrder = order.slice();

      const bars = g.selectAll(".bar").data(order, (d) => d);
      bars.exit().remove();
      const enter = bars.enter().append("g").attr("class", "bar");
      enter.append("rect");
      enter.append("text").attr("class", "lbl").attr("dy", "0.35em").attr("x", -28).attr("text-anchor", "end");
      enter.append("text").attr("class", "val").attr("dy", "0.35em").attr("x", 10).attr("text-anchor", "start");

      const merged = enter.merge(bars);

      // 順位の最大変動幅に応じたアニメーション時間を決定
      const rankChangeRatio = Math.min(maxRankChange / FUNDS.length, 1); // 最大1.0に正規化
      const baseDuration = speed * 0.7;
      const adjustedDuration = baseDuration * (1 + rankChangeRatio * 3); // 最大4倍まで遅くなる

      merged.each(function (d) {
        d3.select(this)
          .transition()
          .duration(adjustedDuration)
          .ease(d3.easeCubicOut)
          .attr("transform", `translate(0,${y(d)})`);

        d3.select(this)
          .select("rect")
          .transition()
          .duration(adjustedDuration)
          .ease(d3.easeCubicOut)
          .attr("x", 0)
          .attr("width", x(dObj[d] || 0))
          .attr("height", y.bandwidth())
          .attr("fill", COLORS[d] || "#999");

        d3.select(this)
          .select(".lbl")
          .transition()
          .duration(adjustedDuration)
          .ease(d3.easeCubicOut)
          .attr("y", y.bandwidth() / 2)
          .text(d);

        d3.select(this)
          .select(".val")
          .transition()
          .duration(adjustedDuration)
          .ease(d3.easeCubicOut)
          .attr("y", y.bandwidth() / 2)
          .attr("x", x(dObj[d] || 0) + 8)
          .text(`${Math.round(dObj[d] || 0).toLocaleString()}円`);
      });

      // コクピット更新（補間値があればそれを使用、なければ現在の離散値）
      const lotForCockpit = dObj && typeof dObj._lotCount === "number" ? dObj._lotCount : lotCountAtIndex[currentIndex] || 1;
      updateCockpit(dObj, order, lotForCockpit);
    }

    update();
    return update;
  }

  function updateCockpit(currentData, orderedFunds, lotCount) {
    const names = orderedFunds || Object.keys(currentData).filter((k) => k !== "date");
    const fundsCount = FUNDS.length;
    // 総資産の基準は「基準価額 × ファンド数 × 積立回数」（lotCount は整数）
    let investedPrincipal = INITIAL_INVESTMENT_AMOUNT * fundsCount * lotCount; // 積立回数に応じた総投資元本（全ファンド）
    let totalCurrent = 0;
    const perf = {};
    names.forEach((f) => {
      const current = currentData[f] || 0;
      // パフォーマンスは「初期1回当たりの比較」（整数ロット）
      perf[f] = ((current / (INITIAL_INVESTMENT_AMOUNT * lotCount)) - 1) * 100;
      totalCurrent += current;
    });
    // leader
    let leader = "",
      maxPerf = -Infinity;
    for (const [f, p] of Object.entries(perf)) {
      if (p > maxPerf) {
        maxPerf = p;
        leader = f;
      }
    }
    // category average
    const categoryMap = {
      イケイケ系: ["SOX", "レバナス", "FANG+"],
      堅実系: ["S&P500", "全米株式", "オルカン"],
      アクティブ系: ["ABB", "SOMPO123"],
      高配当系: ["VYM", "SPYD"],
    };
    const catPerf = {};
    for (const [cat, list] of Object.entries(categoryMap)) {
      let sum = 0,
        cnt = 0;
      list.forEach((f) => {
        if (perf[f] !== undefined) {
          sum += perf[f];
          cnt++;
        }
      });
      if (cnt) catPerf[cat] = sum / cnt;
    }
    let bestCat = "",
      bestCatPerf = -Infinity;
    for (const [c, p] of Object.entries(catPerf)) {
      if (p > bestCatPerf) {
        bestCatPerf = p;
        bestCat = c;
      }
    }

    // DOM update
    document.getElementById("cockpit-date").textContent = `${currentData.date.slice(0, 4)}年${parseInt(currentData.date.slice(4, 6))}月${parseInt(currentData.date.slice(6, 8))}日`;
    document.getElementById("total-value").textContent = `${Math.round(totalCurrent).toLocaleString()}円`;
    const totChange = ((totalCurrent / investedPrincipal) - 1) * 100;
    const tv = document.getElementById("total-change");
    tv.textContent = `${totChange >= 0 ? "+" : ""}${totChange.toFixed(1)}%`;
    tv.style.color = totChange >= 0 ? "#0a0" : "#b00";
    document.getElementById("leader-name").textContent = leader;
    const leaderEl = document.getElementById("leader-change");
    leaderEl.textContent = `${maxPerf >= 0 ? "+" : ""}${maxPerf.toFixed(1)}%`;
    leaderEl.style.color = maxPerf >= 0 ? "#0a0" : "#b00";
    document.getElementById("best-category").textContent = bestCat;
    const bc = document.getElementById("best-category-change");
    bc.textContent = `${bestCatPerf >= 0 ? "+" : ""}${bestCatPerf.toFixed(1)}%`;
    bc.style.color = bestCatPerf >= 0 ? "#0a0" : "#b00";
    // baseline display
    document.getElementById("baseline-value").textContent = `${Math.round(investedPrincipal).toLocaleString()} 円 (投資元本×${fundsCount}ファンド×${lotCount}回)`;
  }

  // 補間描画 - バブルソート的に隣同士を交換して最終順序に到達
  function interpolateSlice(i, t) {
    const a = simpleSeq[i];
    const b = simpleSeq[i + 1] || a;
    const out = { date: a.date };
    FUNDS.forEach((f) => {
      const va = a[f] || 0,
        vb = b[f] || va;
      out[f] = va + (vb - va) * t;
    });

    // 現在の日の初期順序
    const currentOrder = FUNDS.slice();
    currentOrder.sort((x, y) => (a[y] || 0) - (a[x] || 0));

    // 次の日の最終順序を計算
    const finalOrder = FUNDS.slice();
    finalOrder.sort((x, y) => (b[y] || 0) - (b[x] || 0));

    // 正しいバブルソート: 最終順序に到達するために必要な交換をする
    let workingOrder = currentOrder.slice();
    const totalSwapsNeeded = calculateSwapsNeeded(currentOrder, finalOrder);
    const swapsToApply = Math.floor(t * totalSwapsNeeded);

    let swapCount = 0;
    // バブルソート: passごとに1周、隣同士のみ比較交換
    let done = false;
    for (let pass = 0; pass < workingOrder.length && !done && swapCount < swapsToApply; pass++) {
      let swappedThisPass = false;
      for (let j = 0; j < workingOrder.length - 1 - pass; j++) {
        if (swapCount >= swapsToApply) {
          done = true;
          break;
        }
        const curr = workingOrder[j];
        const next = workingOrder[j + 1];
        const currTargetIdx = finalOrder.indexOf(curr);
        const nextTargetIdx = finalOrder.indexOf(next);

        // 最終順序でcurrが後ろにいるなら交換
        if (currTargetIdx > nextTargetIdx) {
          [workingOrder[j], workingOrder[j + 1]] = [workingOrder[j + 1], workingOrder[j]];
          swapCount++;
          swappedThisPass = true;
        }
      }
      // バブルソートが完全にソートされたら終了
      if (!swappedThisPass) break;
    }

    out._displayOrder = workingOrder;
    out._sortSwapsNeeded = totalSwapsNeeded; // ソート回数を保存

    // 次の日(i+1)が積立日かどうか
    const isNextAccum = i + 1 < simpleSeq.length && isAccumDay[i + 1];
    const currBaseline = baselineAtIndex[i] || INITIAL_INVESTMENT_AMOUNT;
    const currLot = lotCountAtIndex[i] || 1;

    if (isNextAccum) {
      // 次が積立日の場合、現在の日から次の日(積立後)へ向かって補間
      const nextBaseline = baselineAtIndex[i + 1] || currBaseline;
      const nextLot = lotCountAtIndex[i + 1] || currLot;
      out._baseline = currBaseline + (nextBaseline - currBaseline) * t;
      out._lotCount = currLot + (nextLot - currLot) * t;
      out._accumBlend = t > 0; // 補間中は強調
    } else {
      // 通常日への移行、または補間完了後は現在の値を維持
      out._baseline = currBaseline;
      out._lotCount = currLot;
      out._accumBlend = false;
    }

    return out;
  }

  // バブルソートに必要な交換回数を計算
  function calculateSwapsNeeded(current, target) {
    let swaps = 0;
    const work = current.slice();

    // 標準的なバブルソート: 隣同士の比較交換でソート
    for (let pass = 0; pass < work.length; pass++) {
      let swapped = false;
      for (let j = 0; j < work.length - 1 - pass; j++) {
        const currIdx = target.indexOf(work[j]);
        const nextIdx = target.indexOf(work[j + 1]);
        if (currIdx > nextIdx) {
          [work[j], work[j + 1]] = [work[j + 1], work[j]];
          swaps++;
          swapped = true;
        }
      }
      if (!swapped) break;
    }
    return swaps;
  }

  const chart = createRaceChart();

  function step() {
    if (currentIndex < simpleSeq.length - 1) {
      currentIndex++;
      chart();
    } else {
      pause();
    }
  }

  function playSmooth() {
    if (isPlaying) return;
    isPlaying = true;
    function loop() {
      if (currentIndex >= simpleSeq.length - 1) {
        pause();
        return;
      }

      // ソート回数に基づいてアニメーション時間を計算
      const frame = interpolateSlice(currentIndex, 0.99); // ほぼ完全に進めてソート回数を取得
      const sortSwapsNeeded = frame._sortSwapsNeeded || 0;

      // ソート1回あたりの時間（ms）
      const dur = Math.max(speed * 0.4, sortSwapsNeeded * msPerSwap); // 最小値は speed*0.4

      rafTimer = d3.timer((elapsed) => {
        const t = Math.min(1, elapsed / dur);
        const frame = interpolateSlice(currentIndex, t);
        chart(frame);
        if (t >= 1) {
          rafTimer.stop();
          // 次の日を確定表示（オーバーレイ演出のため dOverride なし）
          const nextIndex = currentIndex + 1;
          if (nextIndex >= simpleSeq.length) {
            pause();
            return;
          }
          currentIndex = nextIndex;
          chart();
          // ポーズ時間決定: 順位変動 > 積立日 > 通常
          let dwell = DWELL_NORMAL;
          if (rankChangeDetected) {
            dwell = DWELL_RANK_CHANGE; // 順位変動時は最長
          } else if (isAccumDay[currentIndex]) {
            dwell = DWELL_ACCUM; // 積立日は中程度
          }
          if (dwellTimer) {
            clearTimeout(dwellTimer);
            dwellTimer = null;
          }
          dwellTimer = setTimeout(() => {
            if (isPlaying) loop();
          }, dwell);
        }
      });
    }
    loop();
  }

  function play() {
    // 既存のPlayボタンをスムース再生に割り当て
    playSmooth();
  }

  function pause() {
    if (timer) clearInterval(timer);
    if (rafTimer) {
      rafTimer.stop();
      rafTimer = null;
    }
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    isPlaying = false;
  }

  function reset() {
    pause();
    currentIndex = 0;
    chart();
  }

  const btnPlay = document.getElementById("play-btn");
  const btnPause = document.getElementById("pause-btn");
  const btnReset = document.getElementById("reset-btn");
  btnPlay.disabled = true;
  btnPause.disabled = true;
  btnReset.disabled = true;
  btnPlay.addEventListener("click", play);

  document.getElementById("pause-btn").addEventListener("click", pause);
  document.getElementById("reset-btn").addEventListener("click", reset);
  document.getElementById("speed").addEventListener("input", (e) => {
    speed = +e.target.value;
    if (isPlaying) {
      pause();
      play();
    }
  });

  const btnFullscreen = document.getElementById("fullscreen-btn");
  const btnFullscreenFloat = document.getElementById("fullscreen-float-btn");

  function isFullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function updateFullscreenButtonLabel() {
    const label = isFullscreenActive() ? "通常表示" : "全画面";
    if (btnFullscreen) btnFullscreen.textContent = label;
    if (btnFullscreenFloat) btnFullscreenFloat.textContent = label;
  }

  async function toggleFullscreen() {
    const root = document.documentElement;
    try {
      if (!isFullscreenActive()) {
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
          root.webkitRequestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (e) {
      console.warn("[fullscreen] toggle failed", e);
    }
    updateFullscreenButtonLabel();
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener("click", toggleFullscreen);
  }
  if (btnFullscreenFloat) {
    btnFullscreenFloat.addEventListener("click", toggleFullscreen);
  }
  if (btnFullscreen || btnFullscreenFloat) {
    document.addEventListener("fullscreenchange", updateFullscreenButtonLabel);
    document.addEventListener("webkitfullscreenchange", updateFullscreenButtonLabel);
    updateFullscreenButtonLabel();
  }

  function initializeFromLoadedData() {
    simpleSeq = Array.isArray(window.darbyCombinedArcs) ? window.darbyCombinedArcs : [];
    if (ACCUMULATE_ON.mode === "custom-dates" && Array.isArray(window.darbyAccumulationDates) && window.darbyAccumulationDates.length) {
      ACCUMULATE_ON.dates = window.darbyAccumulationDates.slice();
    }
    computeBaselines();
    currentIndex = 0;
    pause();
    chart();
    btnPlay.disabled = false;
    btnPause.disabled = false;
    btnReset.disabled = false;
  }

  // 非同期ロード完了後に初期化
  document.addEventListener("darbyCombinedArcsLoaded", initializeFromLoadedData);

  // 先にデータがロード済みだった場合（イベント取りこぼし）にも初期化
  if (Array.isArray(window.darbyCombinedArcs) && window.darbyCombinedArcs.length) {
    initializeFromLoadedData();
  }
})();
