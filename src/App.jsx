import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';
import Notification from './Notification';

// Helper components remain the same.
function ReviewCard({ review }) { const visitDate = new Date(review.visit_date).toLocaleDateString(); const rating = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating); return (<div className="review-card"><div className="review-card-header"><span className="author">{review.author}</span><span>{visitDate}</span></div><p>{review.comment}</p><p>Rating: {rating}</p></div>); }

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng] = useState(-3.53);
  const [lat] = useState(50.72);
  const [zoom] = useState(12);

  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  // This ref is crucial for providing up-to-date data to the map's event listeners.
  const allPubsRef = useRef([]);

  const [selectedPub, setSelectedPub] = useState(null);
  const [selectedPubReviews, setSelectedPubReviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);

  // --- MAP INITIALIZATION AND LIFECYCLE ---

  // This effect runs EXACTLY ONCE to build the map and its permanent event listeners.
  useEffect(() => {
    if (map.current) return; // Prevent re-initialization

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`,
      center: [lng, lat],
      zoom: zoom,
      antialias: true,
    });

    // The 'load' event fires once after all essential map resources are ready.
    map.current.on('load', async () => {
      // 1. Set up data source (initially empty).
      map.current.addSource('pubs-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'id',
      });
      
      // 2. Set up the single, powerful layer for pubs.
      map.current.addLayer({
        id: 'pubs-layer',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-color': ['case', ['get', 'is_visited'], '#2f855a', '#c53030'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7],
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
          'circle-opacity-transition': { duration: 300 },
        },
      });

      // 3. Set up label layer.
      map.current.addLayer({
        id: 'pub-labels',
        type: 'symbol',
        source: 'pubs-source',
        layout: { 'text-field': ['case', ['boolean', ['feature-state', 'hover'], false], ['get', 'name'], ''], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-allow-overlap': true, },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5, }
      });

      // 4. Set up PERMANENT event listeners.
      let currentHoverId = null;
      map.current.on('mousemove', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          const newHoverId = e.features[0].id;
          if (newHoverId !== currentHoverId) {
            if (currentHoverId !== null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
            map.current.setFeatureState({ source: 'pubs-source', id: newHoverId }, { hover: true });
            currentHoverId = newHoverId;
          }
        }
      });
      
      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        if (currentHoverId !== null) {
          map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
        }
        currentHoverId = null;
      });

      map.current.on('click', 'pubs-layer', (e) => {
        if (e.features && e.features.length > 0) {
          // This now reads from the REF, which is guaranteed to have the correct data.
          const pubData = allPubsRef.current.find(p => p.id === e.features[0].id);
          if (pubData) {
            setSelectedPub(pubData);
            map.current.flyTo({ center: e.features[0].geometry.coordinates, zoom: 15, essential: true });
          }
        }
      });

      // *** THE CORE FIX: DATA LOADING AND SYNCHRONIZATION ***
      console.log('Map is loaded and all event listeners are attached.');
      
      // 5. Fetch the initial data.
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_all_pub_details');
      setIsLoading(false);

      if (error) {
        setNotification({ message: 'Error: Could not load pubs.', type: 'error' });
        return;
      }
      
      const pubData = data.map(pub => ({ ...pub, is_visited: !!pub.last_visit_date }));
      
      // 6. Synchronize data with BOTH React state and the ref.
      setAllPubs(pubData);
      allPubsRef.current = pubData;

      // 7. Update the map source with the new data.
      const pubsForMap = pubData.map(pub => {
          if (!pub.geom) return null;
          try {
              const coordString = pub.geom.replace('POINT(', '').replace(')', '');
              const [lng, lat] = coordString.split(' ').map(Number);
              return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: pub.name, is_visited: pub.is_visited }, };
          } catch (e) { return null; }
      }).filter(p => p);
      map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array is critical to ensure this runs only once.

  // This effect now correctly controls styling on a stable map instance.
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getLayer('pubs-layer')) return;

    let opacityExpression;
    if (hoveredPubId !== null) opacityExpression = ['case', ['==', ['id'], hoveredPubId], 1.0, 0.3];
    else if (crawlPubIds.length > 0) opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.3];
    else opacityExpression = 1.0;
    
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
    map.current.setPaintProperty('pub-labels', 'text-opacity', ['case', ['==', ['id'], hoveredPubId], 1.0, 0.0 ]); // Only show label for hover
  
    if(hoveredPubId) {
        map.current.setFeatureState({source: 'pubs-source', id: hoveredPubId}, {hover: true});
        const prevId = hoveredPubId; // To prevent setting state of a null feature
        return () => { // cleanup function
            if (map.current.isStyleLoaded())
             map.current.setFeatureState({source: 'pubs-source', id: prevId}, {hover: false});
        }
    }
  }, [hoveredPubId, crawlPubIds]);


  // --- DATA HANDLING AND BUSINESS LOGIC ---
  const fetchReviewsForPub = useCallback(async (pubId) => { const { data, error } = await supabase.from('visits').select('*').eq('pub_id', pubId).order('visit_date', { ascending: false }); if (error) { setNotification({ message: 'Could not fetch reviews.', type: 'error' }); setSelectedPubReviews([]); } else { setSelectedPubReviews(data); } }, []);
  useEffect(() => { if (selectedPub) fetchReviewsForPub(selectedPub.id); else setSelectedPubReviews([]); }, [selectedPub, fetchReviewsForPub]);
  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);
  const handleBackToList = () => { clearCrawlRoute(); setSelectedPub(null); };
  const handleSelectPubFromList = (pub) => { clearCrawlRoute(); setSelectedPub(pub); if (pub && map.current) { const coordString = pub.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = coordString.split(' ').map(Number); if (!isNaN(lng) && !isNaN(lat)) map.current.flyTo({ center: [lng, lat], zoom: 15, essential: true }); } };

  const handleReviewSubmit = async (event) => {
    event.preventDefault(); setIsSubmitting(true);
    // ... logic remains the same ...
    const { error } = await supabase.from('visits').insert({ pub_id: selectedPub.id, rating: parseInt(event.target.rating.value), comment: event.target.comment.value, author: event.target.author.value || 'Anonymous', visit_date: new Date().toISOString().slice(0, 10), });
    
    if (error) {
        setNotification({ message: 'Error: ' + error.message, type: 'error' });
    } else {
        event.target.reset();
        await fetchReviewsForPub(selectedPub.id);
        // Full data reload is needed to update 'is_visited' status across the app
        const updatedPubs = await supabase.rpc('get_all_pub_details');
        if (!updatedPubs.error) {
            const pubData = updatedPubs.data.map(pub => ({ ...pub, is_visited: !!pub.last_visit_date }));
            setAllPubs(pubData);
            allPubsRef.current = pubData;
             const pubsForMap = pubData.map(p=>{ if (!p.geom) return null; const cs = p.geom.replace('POINT(', '').replace(')', ''); const [lng, lat] = cs.split(' ').map(Number); return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: p.name, is_visited: p.is_visited }, }; }).filter(i=>i);
            map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
        }
        setNotification({ message: 'Visit submitted successfully!', type: 'success' });
    }
    setIsSubmitting(false);
  };
  
  const handleGenerateCrawl = async (event) => { const button = event.target; button.innerText = 'Calculating...'; button.disabled = true; const { lng, lat, pubid } = button.dataset; try { const response = await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}&start_pub_id=${pubid}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); clearCrawlRoute(); map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', paint: { 'line-color': '#2563eb', 'line-width': 5, } }); setCrawlPubIds(data.pubIds); setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} minutes.`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } };

  // --- JSX RENDER ---
  const renderSelectedPub = () => { if (!selectedPub) return null; const avgRating = selectedPub.avg_rating ? `${Number(selectedPub.avg_rating).toFixed(1)} ★` : 'Not Rated'; const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number); return (<> <button className="back-button" onClick={handleBackToList}>← Back to Full List</button><div className="selected-pub-header"><h3>{selectedPub.name}</h3><p>{selectedPub.address || 'No address provided'}</p><div><span className={`sidebar-status ${selectedPub.is_visited ? 'status-visited' : 'status-unvisited'}`}>{selectedPub.is_visited ? 'Visited' : 'Not Visited'}</span> • Avg Rating: {avgRating}</div></div><div className="review-section"><h4>Add a Visit/Review</h4><form className="review-form" onSubmit={handleReviewSubmit}><label htmlFor="author">Your Name:</label><input type="text" name="author" required placeholder="John D." /><label htmlFor="rating">Rating:</label><select name="rating" required defaultValue="5"><option value="5">5 ★★★★★</option><option value="4">4 ★★★★</option><option value="3">3 ★★★</option><option value="2">2 ★★</option><option value="1">1 ★</option></select><label htmlFor="comment">Comment:</label><textarea name="comment" rows="3" required></textarea><button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit Visit'}</button></form></div>{!selectedPub.is_visited && (<button id="generate-crawl-btn" data-lng={lng} data-lat={lat} data-pubid={selectedPub.id} onClick={handleGenerateCrawl}>Generate Mini-Crawl</button>)}<div className="review-list"><h4>Previous Visits ({selectedPubReviews.length})</h4>{selectedPubReviews.length > 0 ? selectedPubReviews.map(r => <ReviewCard key={r.id} review={r} />) : <p>No reviews yet. Be the first!</p>}</div></>); };
  const renderPubList = () => (<><h2>All Pubs ({allPubs.length})</h2><ul className="pub-list">{allPubs.sort((a, b) => a.name.localeCompare(b.name)).map(pub => (<li key={pub.id} className="pub-list-item" onClick={() => handleSelectPubFromList(pub)}><strong>{pub.name}</strong><span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span></li>))}</ul></>);

  return (<><div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading...</div><div className="app-container"><Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} /><aside className="sidebar">{selectedPub ? renderSelectedPub() : renderPubList()}</aside><div ref={mapContainer} className="map-container" /></div></>);
}

export default App;