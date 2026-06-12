// --- USTAWIENIA KOLORÓW ---
const COLORS = {
    btc: '#ffffff',
    large: '#5f96ff', // Speculators
    comm: '#dc4646'   // Commercials
};

// --- REAL-TIME SERWER ODLICZANIA (PIĄTEK 15:30 EST -> 21:30 CEST) ---
function startReportCountdown() {
    function updateClock() {
        const now = new Date();
        let targetFriday = new Date(now);
        
        targetFriday.setUTCHours(19, 30, 0, 0); // Publikacja rządu USA (15:30 EST)
        
        let daysToAdd = (5 - now.getUTCDay() + 7) % 7;
        if (daysToAdd === 0 && (now.getUTCHours() > 19 || (now.getUTCHours() === 19 && now.getUTCMinutes() >= 30))) {
            daysToAdd = 7;
        }
        targetFriday.setUTCDate(targetFriday.getUTCDate() + daysToAdd);
        
        const timeDiff = targetFriday - now;
        
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        document.getElementById('val-countdown').innerText = 
            `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
    }
    updateClock();
    setInterval(updateClock, 60000); // Odświeżanie co minutę
}

// --- SILNIK BITSTAMP (1D - Cena BTC od 2017 roku) ---
async function fetchBitstampData() {
    let allCandles = [];
    let currentStartUnix = 1483228800; // 1 Stycznia 2017
    let isFetching = true;

    try {
        while (isFetching) {
            if (currentStartUnix > Math.floor(Date.now() / 1000)) break; 
            const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${currentStartUnix}`;
            const response = await fetch(url);
            const json = await response.json();

            if (!json.data || !json.data.ohlc || json.data.ohlc.length === 0) {
                isFetching = false; break;
            }

            const candles = json.data.ohlc;
            for (let i = 0; i < candles.length; i++) {
                allCandles.push({
                    time: parseInt(candles[i].timestamp),
                    value: parseFloat(candles[i].close)
                });
            }
            currentStartUnix = parseInt(candles[candles.length - 1].timestamp) + 86400;
            if (candles.length < 1000) isFetching = false;
        }
    } catch (e) {
        console.error("Błąd pobierania ceny Bitstampa:", e);
    }
    return allCandles;
}

// --- SILNIK PRODUKCYJNY COT Z ROZBIJANIEM CACHE ---
async function fetchCOTData() {
    let cotMap = new Map();
    try {
        const response = await fetch("/api/cot?t=" + Date.now());
        if (!response.ok) throw new Error("Backend Vercel nie odpowiada");
        const data = await response.json();

        if (Array.isArray(data)) {
            data.sort((a, b) => new Date(a.report_date_as_yyyy_mm_dd) - new Date(b.report_date_as_yyyy_mm_dd));
            data.forEach(row => {
                if (!row.report_date_as_yyyy_mm_dd) return;
                
                let d = new Date(row.report_date_as_yyyy_mm_dd.split('T')[0] + 'T00:00:00Z');
                let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;

                let commNet = (parseFloat(row.comm_positions_long_all) || 0) - (parseFloat(row.comm_positions_short_all) || 0);
                let noncommNet = (parseFloat(row.noncomm_positions_long_all) || 0) - (parseFloat(row.noncomm_positions_short_all) || 0);

                if (cotMap.has(t)) {
                    let existing = cotMap.get(t);
                    existing.commNet += commNet;
                    existing.noncommNet += noncommNet;
                } else {
                    cotMap.set(t, { commNet, noncommNet });
                }
            });
        }
    } catch(e) {
        console.error("Błąd pobierania danych COT:", e);
    }
    return cotMap;
}

// --- GŁÓWNA LOGIKA APLIKACJI ---
async function init() {
    try {
        startReportCountdown(); // Odpalenie odliczania w tle

        const [seriesBTC, cotMap] = await Promise.all([
            fetchBitstampData(),
            fetchCOTData()
        ]);

        if (seriesBTC.length === 0) throw new Error("Brak danych cenowych BTC.");

        let bgData = [];
        let commBarsData = [];
        let largeBarsData = [];
        let zeroData = [];
        let helperLineData = []; 
        let cotMarkers = [];
        let fullCotMap = new Map();

        const cotDates = Array.from(cotMap.keys()).sort((a,b) => a - b);
        let cotIndex = 0;
        let currentCommNet = null;
        let currentLargeNet = null;

        for (let i = 0; i < seriesBTC.length; i++) {
            let t = seriesBTC[i].time;
            let isReleaseDay = false;

            while (cotIndex < cotDates.length && cotDates[cotIndex] <= t) {
                if (cotDates[cotIndex] === t) isReleaseDay = true;
                currentCommNet = cotMap.get(cotDates[cotIndex]).commNet;
                currentLargeNet = cotMap.get(cotDates[cotIndex]).noncommNet;
                cotIndex++;
            }

            if (currentCommNet !== null) {
                fullCotMap.set(t, { commNet: currentCommNet, noncommNet: currentLargeNet });
                
                let bgColor = currentCommNet > 0 ? 'rgba(42, 239, 24, 0.02)' : 'rgba(238, 23, 23, 0.02)';
                if (currentCommNet === 0) bgColor = 'transparent';
                bgData.push({ time: t, color: bgColor, value: 1 });
                
                if (isReleaseDay) {
                    commBarsData.push({ time: t, value: currentCommNet });
                    largeBarsData.push({ time: t, value: currentLargeNet });
                    
                    helperLineData.push({ time: t, value: 0 });
                }
            } else {
                bgData.push({ time: t, color: 'transparent', value: 1 });
            }
            zeroData.push({ time: t, value: 0 });
        }

        // --- SILNIK PROJEKCJI PRZYSZŁOŚCI (PROJEKTUJEMY NADCHODZĄCY WTOREK) ---
        if (cotDates.length > 0) {
            const lastReportTuesday = cotDates[cotDates.length - 1];
            const nextReportTuesday = lastReportTuesday + (7 * 86400); // Dokładnie +7 dni do przodu
            
            // Rozszerzamy oś zera i niewidzialną serię o krok w przyszłość
            zeroData.push({ time: nextReportTuesday, value: 0 });
            helperLineData.push({ time: nextReportTuesday, value: 0 });
            
            // Kotwiczymy wirtualny marker oczekiwania na przyszłym wtorku
            cotMarkers.push({
                time: nextReportTuesday,
                position: 'inBar',
                shape: 'circle',
                color: '#e5c158',
                text: '⏳ RAPORT',
                size: 2
            });
        }

        const latestBTCPrice = seriesBTC[seriesBTC.length - 1].value;
        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const formatCOT = new Intl.NumberFormat('en-US');

        const formatMoneyExposure = (contracts, btcPrice) => {
            if (contracts === null) return "Brak";
            const cashValue = Math.abs(contracts * 5 * btcPrice); 
            const absContracts = Math.abs(contracts); 
            const cashFormatted = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                notation: 'compact',
                compactDisplay: 'short'
            }).format(cashValue);
            return `${cashFormatted} (${formatCOT.format(absContracts)})`;
        };

        document.getElementById('val-btc').innerText = formatUSD.format(latestBTCPrice);
        document.getElementById('val-large').innerText = formatMoneyExposure(currentLargeNet, latestBTCPrice);
        document.getElementById('val-comm').innerText = formatMoneyExposure(currentCommNet, latestBTCPrice);

        document.getElementById('loading').style.display = 'none';
        document.getElementById('controls-bar').style.display = 'flex';
        document.getElementById('chart-wrapper').style.display = 'flex';

        // --- INICJALIZACJA WYKRESU TRADINGVIEW ---
        setTimeout(() => {
            const chartContainer = document.getElementById('chart-main');
            const chart = LightweightCharts.createChart(chartContainer, {
                autoSize: true,
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter, sans-serif' },
                grid: { 
                    vertLines: { color: 'rgba(255, 255, 255, 0.04)' }, 
                    horzLines: { color: 'rgba(255, 255, 255, 0.04)' } 
                },
                crosshair: {
                    vertLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: LightweightCharts.LineStyle.Dash },
                    horzLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: LightweightCharts.LineStyle.Dash }
                },
                rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Normal, borderVisible: false, scaleMargins: { top: 0.05, bottom: 0.45 } },
                leftPriceScale: { visible: true, mode: LightweightCharts.PriceScaleMode.Normal, borderVisible: false, scaleMargins: { top: 0.65, bottom: 0.05 } },
                timeScale: { 
                    borderVisible: true, 
                    borderColor: 'rgba(255, 255, 255, 0.06)',
                    timeVisible: true, 
                    fixLeftEdge: true, 
                    fixRightEdge: false, // Pozwalamy na wysunięcie osi w prawo dla przyszłego markera
                    barSpacing: 28, 
                    minBarSpacing: 5
                }
            });

            new ResizeObserver(entries => {
                if (entries.length === 0 || entries[0].target !== chartContainer) return;
                chart.applyOptions({ height: entries[0].contentRect.height, width: entries[0].contentRect.width });
            }).observe(chartContainer);

            const zoneSeries = chart.addHistogramSeries({ priceScaleId: 'zones', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            chart.priceScale('zones').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
            zoneSeries.setData(bgData);

            const zeroLine = chart.addLineSeries({ priceScaleId: 'left', color: 'rgba(255, 255, 255, 0.15)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            zeroLine.setData(zeroData);

            const commBarsSeries = chart.addHistogramSeries({ color: COLORS.comm, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            commBarsSeries.setData(commBarsData);

            const largeBarsSeries = chart.addHistogramSeries({ color: COLORS.large, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            largeBarsSeries.setData(largeBarsData);

            const lineBTC = chart.addLineSeries({ color: COLORS.btc, lineWidth: 2, priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineBTC.setData(seriesBTC);

            // Wstrzyknięcie markerów historycznych oraz przyszłego na serwer linii pomocniczej
            const dotHelperSeries = chart.addLineSeries({
                priceScaleId: 'left',
                color: 'transparent',
                lineWidth: 0,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false
            });
            dotHelperSeries.setData(helperLineData);
            dotHelperSeries.setMarkers(cotMarkers);

            const timeScale = chart.timeScale();
            const lastTime = zeroData[zeroData.length - 1].time; // Skupiamy się na punkcie z wirtualnym markerem
            const startTime = lastTime - (90 * 86400); 
            timeScale.setVisibleRange({ from: startTime, to: lastTime });

            // --- INTERAKTYWNY TOOLTIP ---
            const toolTip = document.getElementById('tv-tooltip');
            const mapBTC = new Map(seriesBTC.map(p => [p.time, p.value]));

            chart.subscribeCrosshairMove(param => {
                if (param.point === undefined || !param.time || param.point.x < 0 || param.point.x > chartContainer.clientWidth || param.point.y < 0 || param.point.y > chartContainer.clientHeight) {
                    toolTip.style.display = 'none'; return;
                }

                const timeSec = param.time;
                const d = new Date(timeSec * 1000);
                const dateStr = `${d.getUTCDate()}.${(d.getUTCMonth()+1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
                let html = `<div class="tooltip-date">${dateStr}</div>`;
                let showTooltip = false;

                const currentPriceAtTime = mapBTC.get(timeSec) || latestBTCPrice;

                if (lineBTC.options().visible && mapBTC.has(timeSec)) {
                    html += `<div class="tooltip-row"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.btc};"></span><span class="tooltip-label">Cena BTC</span></span> <span class="tooltip-value">${formatUSD.format(mapBTC.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }
                
                if (fullCotMap.has(timeSec)) {
                    let cot = fullCotMap.get(timeSec);
                    
                    const formatTooltipMoney = (val) => {
                        const usd = Math.abs(val * 5 * currentPriceAtTime);
                        const formattedUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(usd);
                        return `${formattedUsd} (${formatCOT.format(Math.abs(val))})`;
                    };

                    if (largeBarsSeries.options().visible) {
                        html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.large};"></span><span class="tooltip-label">Speculators</span></span> <span class="tooltip-value" style="color: ${COLORS.large};">${formatTooltipMoney(cot.noncommNet)}</span></div>`;
                        showTooltip = true;
                    }
                    if (commBarsSeries.options().visible) {
                        html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.comm};"></span><span class="tooltip-label">Commercials</span></span> <span class="tooltip-value" style="color: ${COLORS.comm};">${formatTooltipMoney(cot.commNet)}</span></div>`;
                        showTooltip = true;
                    }
                }

                if (!showTooltip) { toolTip.style.display = 'none'; return; }

                toolTip.innerHTML = html;
                toolTip.style.display = 'block';
                
                let xPos = param.point.x + 20; 
                if (xPos + toolTip.offsetWidth > chartContainer.clientWidth - 20) xPos = param.point.x - toolTip.offsetWidth - 20;
                toolTip.style.left = xPos + 'px'; toolTip.style.top = param.point.y + 'px';
            });

            const controls = { 'btc': [lineBTC] };

            document.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const key = this.getAttribute('data-series');
                    if (!controls[key]) return;
                    const isActive = this.classList.contains('active');
                    if (isActive) {
                        this.classList.remove('active'); controls[key].forEach(l => l.applyOptions({ visible: false }));
                    } else {
                        this.classList.add('active'); controls[key].forEach(l => l.applyOptions({ visible: true }));
                    }
                });
            });

            let isLogScale = false; 
            document.getElementById('toggle-log').addEventListener('click', function() {
                isLogScale = !isLogScale;
                if(isLogScale) {
                    this.classList.add('active'); chart.applyOptions({ rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Logarithmic } });
                } else {
                    this.classList.remove('active'); chart.applyOptions({ rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Normal } });
                }
            });

        }, 50);
    } catch (err) {
        console.error("Krytyczny błąd ładowania aplikacji:", err);
        document.getElementById('loading').innerHTML = `<span style="color: #dc4646;">⚠️ Wystąpił błąd synchronizacji. Odśwież stronę (Ctrl + F5).</span>`;
    }
}

window.addEventListener('DOMContentLoaded', init);