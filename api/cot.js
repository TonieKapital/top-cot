export default async function handler(req, res) {
    try {
        // Oficjalna, żywa baza Futures Only (6dca-aqww)
        const response = await fetch("https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=1330E1&$limit=2000");
        
        if (!response.ok) throw new Error("Błąd serwera CFTC");
        const data = await response.json();
        
        // ZMIANA: Całkowicie wyłączamy pamięć podręczną serwera, aby wymusić natychmiastowe pobranie nowej bazy
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}