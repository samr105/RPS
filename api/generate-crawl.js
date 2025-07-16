// api/generate-crawl.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
        const orsApiKey = process.env.VITE_ORS_API_KEY;

        if (!supabaseUrl || !supabaseServiceKey || !orsApiKey) {
            return res.status(500).json({ error: "Server configuration error." });
        }
        
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') return res.status(200).send('ok');

        const { lng, lat, start_pub_id } = req.query; // Capture start pub id
        if (!lng || !lat || !start_pub_id) return res.status(400).json({ error: 'Missing coordinates or starting pub ID.' });

        const { data: nearbyPubs, error: rpcError } = await supabase.rpc('find_nearby_unvisited_pubs', {
            origin_long: parseFloat(lng),
            origin_lat: parseFloat(lat)
        });

        if (rpcError) throw rpcError;
        if (!nearbyPubs || nearbyPubs.length < 2) {
            return res.status(404).json({ error: 'Not enough nearby unvisited pubs found to generate a crawl.' });
        }
        
        // **NEW**: Create an array of the pub IDs on the route
        const pubIdsOnCrawl = [
            parseInt(start_pub_id), 
            nearbyPubs[0].id, 
            nearbyPubs[1].id
        ];

        const coordinates = [[parseFloat(lng),parseFloat(lat)],[nearbyPubs[0].lon,nearbyPubs[0].lat],[nearbyPubs[1].lon,nearbyPubs[1].lat]];
        const orsRes = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson',{method:'POST',headers:{'Content-Type':'application/json','Authorization':orsApiKey},body:JSON.stringify({coordinates})});
        const routeData = await orsRes.json();
        if (!orsRes.ok) throw new Error(routeData.error?.message || 'Error from OpenRouteService');
        
        // **NEW**: Return the route, duration, and the pub IDs
        return res.status(200).json({ 
            route: routeData, 
            totalDuration: routeData.features[0].properties.summary.duration,
            pubIds: pubIdsOnCrawl 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}