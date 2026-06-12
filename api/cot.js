module.exports = async (req, res) => {
    try {
        // ŻYWA BAZA CME (133741): Pobieramy oficjalne dane Futures Only z aktualnymi odczytami
        const response = await fetch("https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=133741&$limit=2000");
        
        if (!response.ok) throw new Error("Błąd serwera CFTC");
        const data = await response.json();
        
        // Całkowicie wyłączamy cache serwera na czas testów, aby pobrać świeże dane
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};