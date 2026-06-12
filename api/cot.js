export default async function handler(req, res) {
    try {
        // Oficjalna, żywa baza Futures Only (6dca-aqww), której używa TradingView do dzisiaj
        const response = await fetch("https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=1330E1&$limit=2000");
        
        if (!response.ok) throw new Error("Błąd serwera CFTC");
        const data = await response.json();
        
        // Cache na poziomie Vercel Edge (1 godzina)
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}