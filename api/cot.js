export default async function handler(req, res) {
    try {
        // Serwer Vercela pobiera dane bezpośrednio z CFTC – brak blokad CORS i banów IP
        const response = await fetch("https://publicreporting.cftc.gov/resource/jun7-fc8e.json?cftc_contract_market_code=1330E1&$limit=2000");
        
        if (!response.ok) throw new Error("Błąd serwera CFTC");
        const data = await response.json();
        
        // Cache na poziomie Vercel Edge (1 godzina), aby strona ładowała się błyskawicznie
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
