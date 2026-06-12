module.exports = async (req, res) => {
    try {
        // AMUNICJA LIVE: Zamieniamy kod 1330E1 (martwe CBOE) na 133741 (żywe, aktualne CME Bitcoin Futures)
        const response = await fetch("https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=133741&$limit=2000");
        
        if (!response.ok) throw new Error("Błąd serwera CFTC");
        const data = await response.json();
        
        // Wyłączamy pamięć podręczną serwera, aby natychmiast wyczyścić stare śmieci z 2019 roku
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};