// api/generate-crawl.js

const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    console.log("\n--- Mini-Crawl Request Received ---");

    try {
        // --- SETUP ---
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
        const orsApiKey = process.env.VITE_ORS_API_KEY;

        if (!supabaseUrl || !supabaseServiceKey || !orsApiKey) {
            console.error("! ERROR: Server configuration error. A key is missing.");
            return res.status(500).json({ error: "Server configuration error." });
        }
        console.log("-> Server environment keys are present.");
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // CORS Setup
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') return res.status(200).send('ok');

        const { lng, lat } = req.query;
        if (!lng || !lat) return res.status(400).json({ error: 'Missing coordinates.' });
        console.log(`-> Received coordinates: lng=${lng}, lat=${lat}`);

        // --- STEP 1: FIND NEARBY PUBS ---
        console.log("-> Querying Supabase for nearby pubs...");
        const { data: nearbyPubs, error: rpcError } = await supabase.rpc('find_nearby_unvisited_pubs', {
            origin_long: parseFloat(lng),
            origin_lat: parseFloat(lat)
        });

        if (rpcError) throw rpcError;
        if (!nearbyPubs || nearbyPubs.length < 2) {
            console.warn("! WARN: Not enough nearby pubs found.");
            return res.status(404).json({ error: 'Not enough nearby pubs found.' });
        }
        console.log(`-> Found ${nearbyPubs.length} nearby pubs. Proceeding with crawl generation.`);

        // --- STEP 2: CALL OPENROUTESERVICE ---
        const coordinates = [
            [parseFloat(lng), parseFloat(lat)],
            [nearbyPubs[0].lon, nearbyPubs[0].lat],
            [nearbyPubs[1].lon, nearbyPubs[1].lat]
        ];
        
        console.log("-> Preparing to call OpenRouteService with payload:", JSON.stringify({ coordinates }));
        const orsRes = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': orsApiKey },
            body: JSON.stringify({ coordinates })
        });
        
        console.log(`-> Received response from OpenRouteService with status: ${orsRes.status}`);

        // --- STEP 3: PROCESS RESPONSE ---
        const routeData = await orsRes.json();
        if (!orsRes.ok) {
            console.error("! ERROR from ORS:", routeData);
            throw new Error(routeData.error?.message || 'Error from OpenRouteService');
        }
        console.log("-> Successfully received and parsed route data from ORS.");
        
        // All checks passed, sending successful response.
        console.log("--- Request Successful. Sending route to client. ---");
        return res.status(200).json({ route: routeData, totalDuration: routeData.features[0].properties.summary.duration });

    } catch (error) {
        console.error("!!! CRITICAL ERROR in backend function:", error.message);
        return res.status(500).json({ error: error.message });
    }
}