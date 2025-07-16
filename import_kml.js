// import_kml.js - THE REAL, NO-REALLY-THIS-TIME CORRECTED VERSION
import { createClient } from '@supabase/supabase-js';
import { kml } from '@tmcw/togeojson';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import dotenv from 'dotenv';

// THIS IS THE FIX: We are explicitly telling the script where to find the keys.
dotenv.config({ path: '.env.local' });

// Check if the filename is provided as an argument
if (process.argv.length < 3) {
  console.error('You forgot to tell me the filename.');
  console.log('Usage: node import_kml.js your_file.kml');
  process.exit(1);
}

const kmlFilePath = process.argv[2];

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("I can't find the Supabase URL or Key in .env.local.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function importKmlData() {
    console.log(`Okay, for real this time. Reading ${kmlFilePath}...`);
    const kmlString = fs.readFileSync(kmlFilePath, 'utf-8');
    
    // Create a virtual DOM from the KML string
    const dom = new JSDOM(kmlString, { contentType: 'application/xml' });
    // Convert the KML from the virtual DOM to GeoJSON
    const geojson = kml(dom.window.document);

    if (!geojson || !geojson.features || geojson.features.length === 0) {
        throw new Error("Could not parse KML or KML file has no placemarks.");
    }

    console.log(`Found ${geojson.features.length} pubs. Impressive.`);

    const pubsToInsert = geojson.features.map(feature => {
        const [lng, lat] = feature.geometry.coordinates;
        return {
            name: feature.properties.name,
            address: feature.properties.description || null, // Handle if description is missing
            geom: `POINT(${lng} ${lat})`
        };
    });

    console.log("Sending the pub list to the database...");

    const { data, error } = await supabase
        .from('pubs')
        .insert(pubsToInsert)
        .select();

    if (error) {
        console.error('Import failed:', error.message);
    } else {
        console.log(`Success! All ${data.length} pubs are now safely in the database. Thank you for your patience.`);
    }
}

// Let's get this over with.
importKmlData();