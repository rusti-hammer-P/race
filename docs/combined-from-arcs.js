// 6ヶ月特別編用：sep〜febのデータを動的ロードして連結
// 読み込み順: sep -> oct -> nov -> dec -> jan -> feb

(function(){
    const sources = [
        { id: '2509', candidates: ['dadata/darby-data-2509.js', 'data/darby-data-2509.js'] },
        { id: '2510', candidates: ['dadata/darby-data-2510.js', 'data/darby-data-2510.js'] },
        { id: '2511', candidates: ['dadata/darby-data-2511.js', 'data/darby-data-2511.js'] },
        { id: '2512', candidates: ['dadata/darby-data-2512.js', 'data/darby-data-2512.js'] },
        { id: '2601', candidates: ['dadata/darby-data-2601.js', 'data/darby-data-2601.js'] },
        { id: '2602', candidates: ['dadata/darby-data-2602.js', 'data/darby-data-2602.js'] }
    ];
    const arcBoundaries = [];

    async function loadRawData(src){
        try{
            const res = await fetch(src, { cache: 'no-cache' });
            if(!res.ok) throw new Error(`HTTP ${res.status}`);
            const code = await res.text();
            // グローバル汚染を避けるためローカルスコープで評価
            const wrapped = `(function(){ ${code}\n; return (typeof darbyRawData !== 'undefined') ? darbyRawData : (typeof window!=='undefined' ? window.darbyRawData : undefined); })()`;
            // eslint-disable-next-line no-eval
            const data = eval(wrapped);
            if(Array.isArray(data)) return data;
            console.warn('[combined-from-arcs] No darbyRawData in', src);
            return [];
        }catch(err){
            console.warn('[combined-from-arcs] load failed:', src, err);
            return [];
        }
    }

    async function loadRawDataFromCandidates(candidates){
        const list = Array.isArray(candidates) ? candidates : [];
        for(const src of list){
            const arr = await loadRawData(src);
            if(Array.isArray(arr) && arr.length){
                return { data: arr, source: src };
            }
        }
        return { data: [], source: list[0] || '' };
    }

    function finalize(collected, boundaries){
        // 重複日付を先出優先で除去
        const seen = new Set();
        const mergedDays = [];
        for(const day of collected){
            const date = day[0]?.date;
            if(!date || seen.has(date)) continue;
            seen.add(date);
            mergedDays.push(day);
        }
        const toObj = (dayList) => {
            const obj = { date: dayList[0]?.date || '' };
            dayList.forEach(d => { obj[d.name] = d.price; });
            return obj;
        };
        const combined = mergedDays.map(toObj);
        
        // 積立日の抽出（各ファイルの先頭日付）
        const boundariesArray = Array.isArray(boundaries) ? boundaries : [];
        const accumulationDates = Array.from(new Set(boundariesArray
            .map((b) => {
                if(typeof b === 'string' || typeof b === 'number') return String(b);
                if(b && typeof b === 'object' && b.date) return String(b.date);
                return '';
            })
            .filter(Boolean)
        )).sort();

        window.darbyCombinedArcs = combined;
        window.darbyArcBoundaries = boundariesArray;
        window.darbyAccumulationDates = accumulationDates;
        document.dispatchEvent(new Event('darbyCombinedArcsLoaded'));
    }

    // グローバル公開
    window.loadCombinedData = async function(){
        if(Array.isArray(window.darbyCombinedArcs)){
            document.dispatchEvent(new Event('darbyCombinedArcsLoaded'));
            return;
        }
        const all = [];
        for(const s of sources){
            const { data: arr, source } = await loadRawDataFromCandidates(s.candidates);
            if(Array.isArray(arr)){
                all.push(...arr);
                const firstDay = arr[0];
                const firstDate = firstDay?.[0]?.date;
                if(firstDate) arcBoundaries.push({ id: s.id, date: firstDate });
            }
            if(!arr.length){
                console.warn('[combined-from-arcs] no data loaded for', s.id, s.candidates);
            }else if(source){
                console.info('[combined-from-arcs] loaded', s.id, 'from', source);
            }
        }
        finalize(all, arcBoundaries);
    };

    // 自動実行
    window.loadCombinedData();
})();
