// api/generate-crawl.js - USING MODERN 'import' SYNTAX

// The fix is right here: we're using 'import' now!
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
        const orsApiKey = process.env.VITE_ORS_API_KEY;

        if (!supabaseUrl || !supabaseServiceKey || !orsApiKey) {
            console.error("Server config error: A key is missing.");
            return res.status(500).json({ error: "Server configuration error." });
        }
        
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // CORS Setup - Remains the same
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') return res.status(200).send('ok');

        const { lng, lat } = req.query;
        if (!lng || !lat) return res.status(400).json({ error: 'Missing coordinates.' });

        const { data: nearbyPubs, error: rpcError } = await supabase.rpc('find_nearby_unvisited_pubs', {
            origin_long: parseFloat(lng),
            origin_lat: parseFloat(lat)
        });

        if (rpcError) throw rpcError;
        if (!nearbyPubs || nearbyPubs.length < 2) {
            return res.status(404).json({ error: 'Not enough nearby pubs found.' });
        }

        const coordinates = [
            [parseFloat(lng), parseFloat(lat)],
            [nearbyPubs[0].lon, nearbyPubs[0].lat],
            [nearbyPubs[1].lon, nearbyPubs[1].lat]
        ];

        const orsRes = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': orsApiKey },
            body: JSON.stringify({ coordinates })
        });
        
        const routeData = await orsRes.json();
        if (!orsRes.ok) throw new Error(routeData.error?.message || 'Error from OpenRouteService');
        
        return res.status(200).json({ route: routeData, totalDuration: routeData.features[0].properties.summary.duration });

    } catch (error) {
        console.error("Backend function error:", error.message);
        return res.status(500).json({ error: error.message });
    }
}