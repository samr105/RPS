// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(-3.53); // Centered on Exeter
  const [lat, setLat] = useState(50.72);
  const [zoom, setZoom] = useState(12);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPubs = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { console.error('Error fetching pubs:', error); alert("Could not load pubs."); return []; }
    const pubsForMap = data
      .map(pub => {
        if (!pub.geom) return null;
        try {
          const coordString = pub.geom.replace('POINT(', '').replace(')', '');
          const [lng, lat] = coordString.split(' ').map(Number);
          if (isNaN(lng) || isNaN(lat)) throw new Error("Invalid coords");
          return {
            type: 'Feature',
            id: pub.id,
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { ...pub, is_visited: !!pub.last_visit_date },
          };
        } catch (e) { return null; }
      })
      .filter(p => p !== null);
    setIsLoading(false);
    return pubsForMap;
  }, []);

  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    const mapStyle = `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: mapStyle, center: [lng, lat], zoom: zoom });
    map.current.on('load', async () => {
      const pubsData = await fetchPubs();
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: pubsData }, promoteId: 'id' });
      const interactiveLayers = ['unvisited-pubs-layer', 'visited-pubs-layer'];
      map.current.addLayer({
        id: 'unvisited-pubs-layer', type: 'circle', source: 'pubs-source',
        paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], 'circle-color': '#c53030', 'circle-stroke-color': 'white', 'circle-stroke-width': 2, },
        filter: ['==', 'is_visited', false],
      });
      map.current.addLayer({
        id: 'visited-pubs-layer', type: 'circle', source: 'pubs-source',
        paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], 'circle-color': '#2f855a', 'circle-stroke-color': 'white', 'circle-stroke-width': 2, },
        filter: ['==', 'is_visited', true],
      });
      
      // *** CHANGE 1: SIMPLIFIED LABEL LAYER ***
      // The text-field is now data-driven. It shows the name if 'hover' is true, otherwise it's empty.
      // We removed 'visibility': 'none' because this expression handles it automatically.
      map.current.addLayer({
        id: 'pub-labels', type: 'symbol', source: 'pubs-source',
        layout: { 
          'text-field': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            ['get', 'name'],
            ''
          ],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 
          'text-offset': [0, 1.25], 
          'text-anchor': 'top',
          'text-allow-overlap': true, // Prevent labels from disappearing if they collide
          'text-ignore-placement': true // Ensure our hovered label always shows
        },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5, }
      });

      let hoveredPubId = null;

      // *** CHANGE 2: SIMPLIFIED MOUSEMOVE HANDLER ***
      map.current.on('mousemove', interactiveLayers, (e) => {
        if (e.features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          if (hoveredPubId !== null) { 
            map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: false });
          }
          hoveredPubId = e.features[0].id;
          map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
          // We no longer need to toggle layer visibility or set a filter here.
        }
      });
      
      // *** CHANGE 3: SIMPLIFIED MOUSELEAVE HANDLER ***
      map.current.on('mouseleave', interactiveLayers, () => {
        map.current.getCanvas().style.cursor = '';
        if (hoveredPubId !== null) {
          map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: false });
        }
        hoveredPubId = null;
        // We no longer need to toggle layer visibility here.
      });

      map.current.on('click', interactiveLayers, (e) => {
        const feature = e.features[0];
        new maplibregl.Popup({ offset: [0, -15] })
          .setLngLat(feature.geometry.coordinates).setHTML(createPopupHTML(feature.properties, feature.geometry.coordinates)).addTo(map.current);
        const reviewForm = document.getElementById('review-form'); if(reviewForm) reviewForm.addEventListener('submit', handleReviewSubmit);
        const crawlBtn = document.getElementById('generate-crawl-btn'); if (crawlBtn) crawlBtn.addEventListener('click', handleGenerateCrawl);
      });
    });
  }, [fetchPubs, lng, lat, zoom]);

  const createPopupHTML = (props, coordinates) => {
      const avgRating = props.avg_rating ? `${Number(props.avg_rating).toFixed(1)} ★` : 'Not Rated';
      return `<div class="popup-header"><h3>${props.name}</h3><p>${props.address||'No address'}</p><span class="popup-status ${props.is_visited?'status-visited':'status-unvisited'}">${props.is_visited?'Visited':'Not Visited'}</span><div>Avg Rating: ${avgRating}</div></div><div class="popup-section"><h4>Add a Visit/Review</h4><form id="review-form"><input type="hidden" name="pub_id" value="${props.id}"><label for="author">Your Name:</label><input type="text" name="author" required placeholder="John D."><label for="rating">Rating:</label><select name="rating" required><option value="5">5 ★★★★★</option><option value="4">4 ★★★★</option><option value="3">3 ★★★</option><option value="2">2 ★★</option><option value="1">1 ★</option></select><label for="comment">Comment:</label><textarea name="comment" rows="3" required></textarea><button type="submit">Submit Visit</button></form></div>${!props.is_visited?`<div class="popup-section"><button id="generate-crawl-btn" data-lng="${coordinates[0]}" data-lat="${coordinates[1]}">Generate Mini-Crawl</button></div>`:''}`;
  };
  const handleReviewSubmit = async(event)=>{event.preventDefault();const form=event.target;form.querySelector('button').disabled=true;form.querySelector('button').innerText="Submitting...";const formData=new FormData(form);const visitData={pub_id:formData.get('pub_id'),rating:parseInt(formData.get('rating')),comment:formData.get('comment'),author:formData.get('author')||'Anonymous',visit_date:new Date().toISOString().slice(0,10),};const {error}=await supabase.from('visits').insert(visitData);if(error){alert('Error: '+error.message);form.querySelector('button').disabled=false;form.querySelector('button').innerText="Submit Visit";}else{alert('Visit submitted! Reloading...');window.location.reload();}};
  const handleGenerateCrawl = async(event)=>{const button=event.target;button.innerText='Calculating...';button.disabled=true;const {lng,lat}=button.dataset;try{const response=await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}`);const data=await response.json();if(!response.ok)throw new Error(data.error);if(map.current.getLayer('crawl-route')){map.current.removeLayer('crawl-route');map.current.removeSource('crawl-route');}map.current.addSource('crawl-route',{type:'geojson',data:data.route});map.current.addLayer({id:'crawl-route',type:'line',source:'crawl-route',paint:{'line-color':'#2563eb','line-width':5,'line-opacity':0.8,},});alert(`Crawl found! Walking time: ${Math.round(data.totalDuration/60)} minutes.`);}catch(err){alert(`Error: ${err.message}`);}finally{button.innerText='Generate Mini-Crawl';button.disabled=false;}};

  return (<>{isLoading && <div className="loading-overlay">Loading Pubs...</div>}<div ref={mapContainer} className="map-container"/></>);
}

export default App;