// --- USTAWIENIA KOLORÓW ---
const COLORS = {
    btc: '#ffffff',
    large: '#5f96ff', // Speculators (Mali)
    largeFill: 'rgba(95, 150, 255, 0.25)',
    comm: '#dc4646',  // Commercials (Duzi)
    commFill: 'rgba(220, 70, 70, 0.25)'
};

// --- SILNIK BITSTAMP (1D - Cena BTC od 2017 roku) ---
async function fetchBitstampData() {
    let allCandles = [];
    let currentStartUnix = 1483228800; // 1 Stycznia 2017 (Optymalizacja pod start kontraktów COT BTC)
    let isFetching = true;

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
    return allCandles;
}

// --- SILNIK PRODUKCYJNY COT (POBIERANIE Z TWOJEGO BACKENDU VERCEL) ---
async function fetchCOTData() {
    let cotMap = new Map();
    try {
        // Odpytujemy Twój zabezpieczony serwer na Vercelu (api/cot.js)
        const response = await fetch("/api/cot");
        if (!response.ok) throw new Error("Backend produkcyjny Vercel nie odpowiada");
        const data = await response.json();

        // Sortowanie chronologiczne serii czasowej
        data.sort((a, b) => new Date(a.report_date_as_yyyy_mm_dd) - new Date(b.report_date_as_yyyy_mm_dd));

        data.forEach(row => {
            if (!row.report_date_as_yyyy_mm_dd) return;
            
            let d = new Date(row.report_date_as_yyyy_mm_dd.split('T')[0] + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 3); // Przesunięcie wtorek -> piątek (Dzień publikacji raportu)
            let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;

            let commNet = (parseFloat(row.comm_positions_long_all) || 0) - (parseFloat(row.comm_positions_short_all) || 0);
            let noncommNet = (parseFloat(row.noncomm_positions_long_all) || 0) - (parseFloat(row.noncomm_positions_short_all) || 0);

            // Łączenie i sumowanie danych (odpowiednik opcji "All" z TradingView)
            if (cotMap.has(t)) {
                let existing = cotMap.get(t);
                existing.commNet += commNet;
                existing.noncommNet += noncommNet;
            } else {
                cotMap.set(t, { commNet, noncommNet });
            }
        });
    } catch(e) {
        console.error("Krytyczny błąd pobierania danych z Twojego API Vercel:", e);
    }
    return cotMap;
}

// --- GŁÓWNA LOGIKA APLIKACJI ---
async function init() {
    try {
        const [seriesBTC, cotMap] = await Promise.all([
            fetchBitstampData(),
            fetchCOTData()
        ]);

        if (seriesBTC.length === 0) throw new Error("Brak danych cenowych BTC.");

        let bgData = [];
        let commBarsData = [];
        let largeBarsData = [];
        let commLineData = [];
        let largeLineData = [];
        let zeroData = [];
        let fullCotMap = new Map();

        const cotDates = Array.from(cotMap.keys()).sort((a,b) => a - b);
        let cotIndex = 0;
        let currentCommNet = null;
        let currentLargeNet = null;

        // Budowanie płynnych linii schodkowych zsynchronizowanych z ceną BTC 1D
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
                
                // Kolorowanie tła wskaźnika w zależności od sentymentu Commercials
                let bgColor = currentCommNet > 0 ? 'rgba(42, 239, 24, 0.05)' : 'rgba(238, 23, 23, 0.05)';
                if (currentCommNet === 0) bgColor = 'transparent';
                bgData.push({ time: t, value: 1, color: bgColor });
                
                // Linie konturowe (Stepline)
                commLineData.push({ time: t, value: currentCommNet });
                largeLineData.push({ time: t, value: currentLargeNet });

                // Słupki pionowe rysowane wyłącznie w oficjalne piątki publikacji
                if (isReleaseDay) {
                    commBarsData.push({ time: t, value: currentCommNet });
                    largeBarsData.push({ time: t, value: currentLargeNet });
                }
            } else {
                bgData.push({ time: t, value: 1, color: 'transparent' });
            }
            zeroData.push({ time: t, value: 0 });
        }

        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const formatCOT = new Intl.NumberFormat('en-US');

        // Wstrzykiwanie najnowszych wartości do górnych kart statystyk
        document.getElementById('val-btc').innerText = formatUSD.format(seriesBTC[seriesBTC.length - 1].value);
        document.getElementById('val-large').innerText = currentLargeNet !== null ? formatCOT.format(currentLargeNet) : "Brak";
        document.getElementById('val-comm').innerText = currentCommNet !== null ? formatCOT.format(currentCommNet) : "Brak";

        document.getElementById('loading').style.display = 'none';
        document.getElementById('controls-bar').style.display = 'flex';
        document.getElementById('chart-wrapper').style.display = 'flex';

        // --- INICJALIZACJA TRADINGVIEW LIGHTWEIGHT CHARTS ---
        setTimeout(() => {
            const chartContainer = document.getElementById('chart-main');
            const chart = LightweightCharts.createChart(chartContainer, {
                autoSize: true,
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter, sans-serif' },
                grid: { vertLines: { color: 'rgba(255, 255, 255, 0.04)' }, horzLines: { color: 'rgba(255, 255, 255, 0.04)' } },
                rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Normal, borderVisible: false, scaleMargins: { top: 0.05, bottom: 0.45 } },
                leftPriceScale: { visible: true, mode: LightweightCharts.PriceScaleMode.Normal, borderVisible: false, scaleMargins: { top: 0.65, bottom: 0.05 } },
                timeScale: { borderVisible: false, timeVisible: true, fixLeftEdge: true, fixRightEdge: true }
            });

            new ResizeObserver(entries => {
                if (entries.length === 0 || entries[0].target !== chartContainer) return;
                chart.applyOptions({ height: entries[0].contentRect.height, width: entries[0].contentRect.width });
            }).observe(chartContainer);

            // Warstwa Stref Tła (Sentyment)
            const zoneSeries = chart.addHistogramSeries({ priceScaleId: 'zones', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            chart.priceScale('zones').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
            zoneSeries.setData(bgData);

            // Linia Odniesienia Zero
            const zeroLine = chart.addLineSeries({ priceScaleId: 'left', color: 'rgba(255, 255, 255, 0.15)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            zeroLine.setData(zeroData);

            // Histogramy Słupków
            const commBarsSeries = chart.addHistogramSeries({ color: COLORS.commFill, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            commBarsSeries.setData(commBarsData);

            const largeBarsSeries = chart.addHistogramSeries({ color: COLORS.largeFill, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            largeBarsSeries.setData(largeBarsData);

            // Linie obrysów (Schodki 1:1 z plot.style_steplinebr z TV)
            const commLineSeries = chart.addLineSeries({ color: COLORS.comm, lineWidth: 2, priceScaleId: 'left', lineType: LightweightCharts.LineType.Step, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            commLineSeries.setData(commLineData);

            const largeLineSeries = chart.addLineSeries({ color: COLORS.large, lineWidth: 2, priceScaleId: 'left', lineType: LightweightCharts.LineType.Step, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            largeLineSeries.setData(largeLineData);

            // Główna Linia Ceny Bitcoina
            const lineBTC = chart.addLineSeries({ color: COLORS.btc, lineWidth: 2, priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineBTC.setData(seriesBTC);

            chart.timeScale().fitContent();

            // --- SYSTEM INTERAKTYWNEGO TOOLTIPU ---
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

                if (lineBTC.options().visible && mapBTC.has(timeSec)) {
                    html += `<div class="tooltip-row"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.btc};"></span><span class="tooltip-label">Cena BTC</span></span> <span class="tooltip-value">${formatUSD.format(mapBTC.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }
                
                if (fullCotMap.has(timeSec)) {
                    let cot = fullCotMap.get(timeSec);
                    if (largeLineSeries.options().visible) {
                        html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.large};"></span><span class="tooltip-label">Speculators</span></span> <span class="tooltip-value">${formatCOT.format(cot.noncommNet)}</span></div>`;
                        showTooltip = true;
                    }
                    if (commLineSeries.options().visible) {
                        html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.comm};"></span><span class="tooltip-label">Commercials</span></span> <span class="tooltip-value">${formatCOT.format(cot.commNet)}</span></div>`;
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

            // Obsługa przycisków sterujących widocznością serii danych
            const controls = {
                'btc': [lineBTC],
                'large': [largeBarsSeries, largeLineSeries],
                'comm': [commBarsSeries, commLineSeries, zoneSeries]
            };

            document.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const key = this.getAttribute('data-series');
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
    }
}

window.addEventListener('DOMContentLoaded', init);