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
  const allPubsRef = useRef([]); // A ref to hold pub data for event listeners.
  
  const [lng] = useState(-3.53);
  const [lat] = useState(50.72);
  const [zoom] = useState(12);
  
  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [selectedPubReviews, setSelectedPubReviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [hoveredPubId, setHoveredPubId] = useState(null); // State to trigger the dimming effect.
  const [crawlPubIds, setCrawlPubIds] = useState([]);

  // This effect runs EXACTLY ONCE to build the map and attach permanent listeners.
  useEffect(() => {
    if (map.current) return;

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`, center: [lng, lat], zoom: zoom, antialias: true, });
    
    map.current.on('load', async () => {
      console.log('Map Loaded. Setting up sources, layers, and listeners.');
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id', });
      map.current.addLayer({
        id: 'pubs-layer', type: 'circle', source: 'pubs-source',
        paint: {
          'circle-color': ['case', ['get', 'is_visited'], '#2f855a', '#c53030'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], // size depends on hover
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
          'circle-opacity-transition': { duration: 300 },
        },
      });

      map.current.addLayer({
        id: 'pub-labels', type: 'symbol', source: 'pubs-source',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.25], 'text-anchor': 'top',
          'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5,
          'text-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.0],
          'text-opacity-transition': { duration: 200 },
        }
      });
      
      // Use a closure variable to track the currently hovered feature ID.
      // This is more performant than relying on React state for every mouse move.
      let hoveredFeatureId = null;

      map.current.on('mousemove', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          // Ensure the feature has a valid ID.
          const newHoverId = e.features[0].id;

          if (newHoverId !== hoveredFeatureId) {
            // If there was a previously hovered feature, reset its state.
            if (hoveredFeatureId !== null) {
              map.current.setFeatureState({ source: 'pubs-source', id: hoveredFeatureId }, { hover: false });
            }
            
            // Handle the newly hovered feature, but only if its ID is valid.
            if (newHoverId !== undefined && newHoverId !== null) {
              map.current.setFeatureState({ source: 'pubs-source', id: newHoverId }, { hover: true });
              hoveredFeatureId = newHoverId;
              setHoveredPubId(newHoverId); // Update React state for dimming
            } else {
              hoveredFeatureId = null;
              setHoveredPubId(null);
            }
          }
        }
      });

      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        if (hoveredFeatureId !== null) {
          map.current.setFeatureState({ source: 'pubs-source', id: hoveredFeatureId }, { hover: false });
          hoveredFeatureId = null;
          setHoveredPubId(null); // Update React state to remove dimming
        }
      });
      
      map.current.on('click', 'pubs-layer', (e) => {
        if (e.features.length > 0 && e.features[0].id !== undefined) {
          const pubData = allPubsRef.current.find(p => p.id === e.features[0].id);
          if (pubData) setSelectedPub(pubData);
        }
      });
      
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_all_pub_details');
      setIsLoading(false);
      if (error) { setNotification({ message: 'Error: Could not load pubs.', type: 'error' }); return; }
      const pubData = data.map(pub => ({ ...pub, is_visited: !!pub.last_visit_date }));
      setAllPubs(pubData);
      allPubsRef.current = pubData;
      const pubsForMap = pubData.map(p=>{ if (!p.geom) return null; try { const cs = p.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = cs.split(' ').map(Number); return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: p.name, is_visited: p.is_visited }, }; } catch (e) { return null; } }).filter(i=>i);
      map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This effect ONLY controls the dimming.
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getLayer('pubs-layer')) return;
    let opacityExpression;
    // Using != null checks for both null and undefined, fixing the error.
    if (hoveredPubId != null) {
      opacityExpression = ['case', ['==', ['id'], hoveredPubId], 1.0, 0.3];
    } else if (crawlPubIds.length > 0) {
      opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.3];
    } else {
      opacityExpression = 1.0;
    }
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
  }, [hoveredPubId, crawlPubIds]);
  
  // Handlers for data & UI logic
  useEffect(() => { if (selectedPub && map.current) { const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number); map.current.flyTo({ center: [lng, lat], zoom: 15, essential: true }); } }, [selectedPub]);
  const fetchReviewsForPub = useCallback(async (pubId) => { const { data, error } = await supabase.from('visits').select('*').eq('pub_id', pubId).order('visit_date', { ascending: false }); if (error) { setNotification({ message: 'Could not fetch reviews.', type: 'error' }); setSelectedPubReviews([]); } else { setSelectedPubReviews(data); } }, []);
  useEffect(() => { if (selectedPub) fetchReviewsForPub(selectedPub.id); else setSelectedPubReviews([]); }, [selectedPub, fetchReviewsForPub]);
  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current && map.current.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);
  const handleBackToList = () => { clearCrawlRoute(); setSelectedPub(null); };
  const handleSelectPubFromList = (pub) => { clearCrawlRoute(); setSelectedPub(pub); };
  const handleReviewSubmit = async (event) => { event.preventDefault(); setIsSubmitting(true); const form = event.target; const visitData = { pub_id: selectedPub.id, rating: parseInt(form.rating.value), comment: form.comment.value, author: form.author.value || 'Anonymous', visit_date: new Date().toISOString().slice(0, 10), }; const { error } = await supabase.from('visits').insert(visitData); if (error) { setNotification({ message: 'Error: ' + error.message, type: 'error' }); } else { form.reset(); await fetchReviewsForPub(selectedPub.id); const { data: allPubData } = await supabase.rpc('get_all_pub_details'); if (allPubData) { const pubData = allPubData.map(p => ({ ...p, is_visited: !!p.last_visit_date })); setAllPubs(pubData); allPubsRef.current = pubData; const pubsForMap = pubData.map(p=>{ if (!p.geom) return null; const cs = p.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = cs.split(' ').map(Number); return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: p.name, is_visited: p.is_visited }, }; }).filter(i=>i); map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap }); } setNotification({ message: 'Visit submitted successfully!', type: 'success' }); } setIsSubmitting(false); };
  const handleGenerateCrawl = async (event) => { const button = event.target; button.innerText = 'Calculating...'; button.disabled = true; const { lng, lat, pubid } = button.dataset; try { const response = await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}&start_pub_id=${pubid}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); clearCrawlRoute(); map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', paint: { 'line-color': '#2563eb', 'line-width': 5, } }); setCrawlPubIds(data.pubIds); setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} minutes.`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } };
  
  const renderSelectedPub = () => { if (!selectedPub) return null; const avgRating = selectedPub.avg_rating ? `${Number(selectedPub.avg_rating).toFixed(1)} ★` : 'Not Rated'; const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number); return (<> <button className="back-button" onClick={handleBackToList}>← Back to Full List</button><div className="selected-pub-header"><h3>{selectedPub.name}</h3><p>{selectedPub.address || 'No address provided'}</p><div><span className={`sidebar-status ${selectedPub.is_visited ? 'status-visited' : 'status-unvisited'}`}>{selectedPub.is_visited ? 'Visited' : 'Not Visited'}</span> • Avg Rating: {avgRating}</div></div><div className="review-section"><h4>Add a Visit/Review</h4><form className="review-form" onSubmit={handleReviewSubmit}><label htmlFor="author">Your Name:</label><input type="text" name="author" required placeholder="John D." /><label htmlFor="rating">Rating:</label><select name="rating" required defaultValue="5"><option value="5">5 ★★★★★</option><option value="4">4 ★★★★</option><option value="3">3 ★★★</option><option value="2">2 ★★</option><option value="1">1 ★</option></select><label htmlFor="comment">Comment:</label><textarea name="comment" rows="3" required></textarea><button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit Visit'}</button></form></div>{!selectedPub.is_visited && (<button id="generate-crawl-btn" data-lng={lng} data-lat={lat} data-pubid={selectedPub.id} onClick={handleGenerateCrawl}>Generate Mini-Crawl</button>)}<div className="review-list"><h4>Previous Visits ({selectedPubReviews.length})</h4>{selectedPubReviews.length > 0 ? selectedPubReviews.map(r => <ReviewCard key={r.id} review={r} />) : <p>No reviews yet. Be the first!</p>}</div></>); };
  const renderPubList = () => (<><h2>All Pubs ({allPubs.length})</h2><ul className="pub-list">{allPubs.sort((a, b) => a.name.localeCompare(b.name)).map(pub => (<li key={pub.id} className="pub-list-item" onClick={() => handleSelectPubFromList(pub)}><strong>{pub.name}</strong><span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span></li>))}</ul></>);

  return (<><div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading...</div><div className="app-container"><Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} /><aside className="sidebar">{selectedPub ? renderSelectedPub() : renderPubList()}</aside><div ref={mapContainer} className="map-container" /></div></>);
}

export default App;