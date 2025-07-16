import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';
import Notification from './Notification';

function ReviewCard({ review }) { const visitDate = new Date(review.visit_date).toLocaleDateString(); const rating = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating); return (<div className="review-card"><div className="review-card-header"><span className="author">{review.author}</span><span>{visitDate}</span></div><p>{review.comment}</p><p>Rating: {rating}</p></div>); }

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(-3.53);
  const [lat, setLat] = useState(50.72);
  const [zoom, setZoom] = useState(12);
  const [isLoading, setIsLoading] = useState(true);

  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [selectedPubReviews, setSelectedPubReviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });

  // State to manage which pub is hovered, and which are part of a crawl
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);

  // Fetch functions do not need to change
  const fetchPubs = useCallback(async () => { /* ...no change... */ setIsLoading(true); const { data, error } = await supabase.rpc('get_all_pub_details'); if (error) { console.error('Error fetching pubs:', error); setNotification({ message: 'Error: Could not load pubs.', type: 'error' }); setIsLoading(false); return; } const transformedData = data.map(pub => ({ ...pub, is_visited: !!pub.last_visit_date })); setAllPubs(transformedData); const pubsForMap = transformedData.map(pub => { if (!pub.geom) return null; try { const coordString = pub.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = coordString.split(' ').map(Number); if (isNaN(lng) || isNaN(lat)) throw new Error("Invalid coords"); return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: pub.name, is_visited: pub.is_visited }, }; } catch (e) { console.error("Error parsing pub geometry:", pub.name, e); return null; } }).filter(p => p !== null); if (map.current.getSource('pubs-source')) { map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap }); } else { map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: pubsForMap }, promoteId: 'id' }); } setIsLoading(false); }, []);
  const fetchReviewsForPub = useCallback(async (pubId) => { /* ...no change... */ const { data, error } = await supabase.from('visits').select('*').eq('pub_id', pubId).order('visit_date', { ascending: false }); if (error) { console.error("Error fetching reviews:", error); setNotification({ message: 'Could not fetch reviews for this pub.', type: 'error' }); setSelectedPubReviews([]); } else { setSelectedPubReviews(data); } }, []);
  useEffect(() => { if (selectedPub) { fetchReviewsForPub(selectedPub.id); } else { setSelectedPubReviews([]); } }, [selectedPub, fetchReviewsForPub]);

  // Main map initialization effect
  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY; const mapStyle = `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`; map.current = new maplibregl.Map({ container: mapContainer.current, style: mapStyle, center: [lng, lat], zoom: zoom, antialias: true });
    
    map.current.on('load', async () => {
      await fetchPubs();
      
      // *** REFACTORED: Single Layer for All Pubs ***
      // This one layer handles color and size based on properties and feature-state.
      map.current.addLayer({
        id: 'pubs-layer', // The one layer to rule them all
        type: 'circle',
        source: 'pubs-source',
        paint: {
          // Color is green if visited, red if not.
          'circle-color': ['case', ['get', 'is_visited'], '#2f855a', '#c53030'],
          // Radius is larger if hovered.
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7],
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
          // We will control opacity separately via an effect.
          'circle-opacity': 1.0, 
          'circle-opacity-transition': { duration: 300 }, // Smooth fade effect
        }
      });
      
      map.current.addLayer({ id: 'pub-labels', type: 'symbol', source: 'pubs-source', layout: { 'text-field': ['case', ['boolean', ['feature-state', 'hover'], false], ['get', 'name'], ''], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5, } });
      
      // Corrected Event Listeners
      let currentHoverId = null; // Use a local var inside the closure for performance
      map.current.on('mousemove', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          const newHoverId = e.features[0].id;
          if (newHoverId !== currentHoverId) {
            // Un-hover the previous pub
            if (currentHoverId !== null) {
              map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
            }
            // Hover the new one
            map.current.setFeatureState({ source: 'pubs-source', id: newHoverId }, { hover: true });
            setHoveredPubId(newHoverId); // Set React state
            currentHoverId = newHoverId;
          }
        }
      });

      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        if (currentHoverId !== null) {
          map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
        }
        setHoveredPubId(null); // Clear React state
        currentHoverId = null;
      });
      
      map.current.on('click', 'pubs-layer', (e) => {
        const featureId = e.features[0].id; const pubData = allPubs.find(p => p.id === featureId); setSelectedPub(pubData); map.current.flyTo({ center: e.features[0].geometry.coordinates, zoom: 15, essential: true });
      });
    });
  }, [lng, lat, zoom, fetchPubs, allPubs]);

  // *** FIXED: Style Controller Effect ***
  // This now reliably targets the single 'pubs-layer'.
  useEffect(() => {
    // Wait until the map and layer are fully ready
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getLayer('pubs-layer')) {
      return;
    }

    let opacityExpression;
    if (hoveredPubId !== null) {
      // Dim all pubs except the one being hovered
      opacityExpression = ['case', ['==', ['id'], hoveredPubId], 1.0, 0.3];
    } else if (crawlPubIds.length > 0) {
      // Dim all pubs not on the crawl route
      opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.3];
    } else {
      // If nothing is selected, all pubs are fully opaque
      opacityExpression = 1.0;
    }
    
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
    // Also fade out labels for dimmed pubs
    map.current.setPaintProperty('pub-labels', 'text-opacity', opacityExpression);

  }, [hoveredPubId, crawlPubIds]); // Re-runs ONLY when hover or crawl state changes

  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);

  const handleSelectPubFromList = (pub) => { clearCrawlRoute(); setSelectedPub(pub); if (pub && map.current) { const coordString = pub.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = coordString.split(' ').map(Number); if (!isNaN(lng) && !isNaN(lat)) { map.current.flyTo({ center: [lng, lat], zoom: 15, essential: true }); } } };
  
  const handleBackToList = () => { clearCrawlRoute(); setSelectedPub(null); };

  const handleReviewSubmit = async (event) => { event.preventDefault(); setIsSubmitting(true); const form = event.target; const formData = new FormData(form); const visitData = { pub_id: selectedPub.id, rating: parseInt(formData.get('rating')), comment: formData.get('comment'), author: formData.get('author') || 'Anonymous', visit_date: new Date().toISOString().slice(0, 10), }; const { error } = await supabase.from('visits').insert(visitData); if (error) { setNotification({ message: 'Error: ' + error.message, type: 'error' }); } else { form.reset(); await fetchReviewsForPub(selectedPub.id); await fetchPubs(); setNotification({ message: 'Visit submitted successfully!', type: 'success' }); } setIsSubmitting(false); };
  
  const handleGenerateCrawl = async (event) => { const button = event.target; button.innerText = 'Calculating...'; button.disabled = true; const { lng, lat, pubid } = button.dataset; try { const response = await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}&start_pub_id=${pubid}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); clearCrawlRoute(); map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.8, }, }); setCrawlPubIds(data.pubIds); setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} minutes.`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } };

  // Render functions do not need to change
  const renderSelectedPub = () => { if (!selectedPub) return null; const avgRating = selectedPub.avg_rating ? `${Number(selectedPub.avg_rating).toFixed(1)} ★` : 'Not Rated'; const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number); return (<> <button className="back-button" onClick={handleBackToList}>← Back to Full List</button><div className="selected-pub-header"><h3>{selectedPub.name}</h3><p>{selectedPub.address || 'No address provided'}</p><div><span className={`sidebar-status ${selectedPub.is_visited ? 'status-visited' : 'status-unvisited'}`}>{selectedPub.is_visited ? 'Visited' : 'Not Visited'}</span> • Avg Rating: {avgRating}</div></div><div className="review-section"><h4>Add a Visit/Review</h4><form className="review-form" onSubmit={handleReviewSubmit}><label htmlFor="author">Your Name:</label><input type="text" name="author" required placeholder="John D." /><label htmlFor="rating">Rating:</label><select name="rating" required defaultValue="5"><option value="5">5 ★★★★★</option><option value="4">4 ★★★★</option><option value="3">3 ★★★</option><option value="2">2 ★★</option><option value="1">1 ★</option></select><label htmlFor="comment">Comment:</label><textarea name="comment" rows="3" required></textarea><button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit Visit'}</button></form></div>{!selectedPub.is_visited && (<button id="generate-crawl-btn" data-lng={lng} data-lat={lat} data-pubid={selectedPub.id} onClick={handleGenerateCrawl}>Generate Mini-Crawl</button>)}<div className="review-list"><h4>Previous Visits ({selectedPubReviews.length})</h4>{selectedPubReviews.length > 0 ? selectedPubReviews.map(r => <ReviewCard key={r.id} review={r} />) : <p>No reviews yet. Be the first!</p>}</div></>); };
  const renderPubList = () => (<><h2>All Pubs ({allPubs.length})</h2><ul className="pub-list">{allPubs.sort((a, b) => a.name.localeCompare(b.name)).map(pub => (<li key={pub.id} className="pub-list-item" onClick={() => handleSelectPubFromList(pub)}><strong>{pub.name}</strong><span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span></li>))}</ul></>);

  return (<><div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading...</div><div className="app-container"><Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} /><aside className="sidebar">{selectedPub ? renderSelectedPub() : renderPubList()}</aside><div ref={mapContainer} className="map-container" /></div></>);
}

export default App;