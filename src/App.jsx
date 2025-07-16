import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';

// Helper component for rendering a single review
function ReviewCard({ review }) {
  const visitDate = new Date(review.visit_date).toLocaleDateString();
  const rating = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  return (
    <div className="review-card">
      <div className="review-card-header">
        <span className="author">{review.author}</span>
        <span>{visitDate}</span>
      </div>
      <p>{review.comment}</p>
      <p>Rating: {rating}</p>
    </div>
  );
}

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(-3.53);
  const [lat, setLat] = useState(50.72);
  const [zoom, setZoom] = useState(12);
  const [isLoading, setIsLoading] = useState(true);
  
  // NEW STATE: Store all pubs for the sidebar list
  const [allPubs, setAllPubs] = useState([]);
  // NEW STATE: Track the selected pub for the detail view
  const [selectedPub, setSelectedPub] = useState(null);
  // NEW STATE: Store reviews for the selected pub
  const [selectedPubReviews, setSelectedPubReviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Memoized fetch function for all pub locations and basic details
  const fetchPubs = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { 
      console.error('Error fetching pubs:', error);
      alert("Could not load pubs."); 
      setIsLoading(false);
      return; 
    }

    const transformedData = data.map(pub => ({
        ...pub,
        is_visited: !!pub.last_visit_date,
    }));
    setAllPubs(transformedData); // Save raw data for the sidebar
    
    // Process for the map
    const pubsForMap = transformedData
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
            properties: { name: pub.name, is_visited: pub.is_visited }, // Only need name/status for map interactions
          };
        } catch (e) { console.error("Error parsing pub geometry:", pub.name, e); return null; }
      })
      .filter(p => p !== null);
    
    if (map.current.getSource('pubs-source')) {
      map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
    } else {
        map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: pubsForMap }, promoteId: 'id' });
    }
    setIsLoading(false);
  }, []);

  // NEW FUNCTION: Fetch reviews for a specific pub
  const fetchReviewsForPub = useCallback(async (pubId) => {
    const { data, error } = await supabase
      .from('visits')
      .select('*')
      .eq('pub_id', pubId)
      .order('visit_date', { ascending: false });
    
    if (error) {
      console.error("Error fetching reviews:", error);
      setSelectedPubReviews([]);
    } else {
      setSelectedPubReviews(data);
    }
  }, []);

  // When a pub is selected, fetch its reviews
  useEffect(() => {
    if (selectedPub) {
      fetchReviewsForPub(selectedPub.id);
    } else {
      setSelectedPubReviews([]); // Clear reviews if no pub is selected
    }
  }, [selectedPub, fetchReviewsForPub]);

  // Main map initialization effect
  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    const mapStyle = `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: mapStyle, center: [lng, lat], zoom: zoom, antialias: true });

    map.current.on('load', async () => {
      // Data will be added via fetchPubs now
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      fetchPubs(); // Initial fetch
      
      const interactiveLayers = ['unvisited-pubs-layer', 'visited-pubs-layer'];

      map.current.addLayer({
        id: 'unvisited-pubs-layer', type: 'circle', source: 'pubs-source',
        paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], 'circle-color': '#c53030', 'circle-stroke-color': 'white', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map'},
        filter: ['==', 'is_visited', false],
      });
      map.current.addLayer({
        id: 'visited-pubs-layer', type: 'circle', source: 'pubs-source',
        paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], 'circle-color': '#2f855a', 'circle-stroke-color': 'white', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map'},
        filter: ['==', 'is_visited', true],
      });
      map.current.addLayer({
        id: 'pub-labels', type: 'symbol', source: 'pubs-source',
        layout: { 'text-field': ['case', ['boolean', ['feature-state', 'hover'], false], ['get', 'name'], ''], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5, }
      });
      let hoveredPubId = null;
      map.current.on('mousemove', interactiveLayers, (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (hoveredPubId !== null) { map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: false }); }
          hoveredPubId = e.features[0].id;
          map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
        }
      });
      map.current.on('mouseleave', interactiveLayers, () => {
        map.current.getCanvas().style.cursor = '';
        if (hoveredPubId !== null) { map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: false }); }
        hoveredPubId = null;
      });

      // CLICK HANDLER: now sets the selected pub instead of showing a complex popup
      map.current.on('click', interactiveLayers, (e) => {
        const featureId = e.features[0].id;
        const pubData = allPubs.find(p => p.id === featureId);
        setSelectedPub(pubData);
        map.current.flyTo({ center: e.features[0].geometry.coordinates, zoom: 15, essential: true });
      });
    });
  }, [fetchPubs, lng, lat, zoom, allPubs]);


  // UPDATED: handles review submit without reloading the page
  const handleReviewSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    const form = event.target;
    const formData = new FormData(form);
    const visitData = { pub_id: selectedPub.id, rating: parseInt(formData.get('rating')), comment: formData.get('comment'), author: formData.get('author') || 'Anonymous', visit_date: new Date().toISOString().slice(0, 10), };
    
    const { error } = await supabase.from('visits').insert(visitData);
    if (error) {
      alert('Error: ' + error.message);
    } else {
      form.reset();
      // Refresh reviews and overall pub data without a page reload
      await fetchReviewsForPub(selectedPub.id);
      await fetchPubs(); // Refetches all pub data to update "visited" status
      alert('Visit submitted!');
    }
    setIsSubmitting(false);
  };
  
  // Handlers for sidebar interactions
  const handleSelectPubFromList = (pub) => {
    setSelectedPub(pub);
    if (pub && map.current) {
        const coordString = pub.geom.replace('POINT(', '').replace(')', '');
        const [lng, lat] = coordString.split(' ').map(Number);
        if(!isNaN(lng) && !isNaN(lat)) {
             map.current.flyTo({ center: [lng, lat], zoom: 15, essential: true });
        }
    }
  };

  const handleGenerateCrawl = async(event)=>{/* This function remains the same for now, but is attached in the sidebar */ const button=event.target;button.innerText='Calculating...';button.disabled=true;const {lng,lat}=button.dataset;try{const response=await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}`);const data=await response.json();if(!response.ok)throw new Error(data.error);if(map.current.getLayer('crawl-route')){map.current.removeLayer('crawl-route');map.current.removeSource('crawl-route');}map.current.addSource('crawl-route',{type:'geojson',data:data.route});map.current.addLayer({id:'crawl-route',type:'line',source:'crawl-route',paint:{'line-color':'#2563eb','line-width':5,'line-opacity':0.8,},});alert(`Crawl found! Walking time: ${Math.round(data.totalDuration/60)} minutes.`);}catch(err){alert(`Error: ${err.message}`);}finally{button.innerText='Generate Mini-Crawl';button.disabled=false;}};
  
  // Render function for the detail view in the sidebar
  const renderSelectedPub = () => {
    if (!selectedPub) return null;
    const avgRating = selectedPub.avg_rating ? `${Number(selectedPub.avg_rating).toFixed(1)} ★` : 'Not Rated';
    const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number);
    
    return (
        <>
            <button className="back-button" onClick={() => setSelectedPub(null)}>← Back to Full List</button>
            <div className="selected-pub-header">
                <h3>{selectedPub.name}</h3>
                <p>{selectedPub.address || 'No address provided'}</p>
                <div>
                  <span className={`sidebar-status ${selectedPub.is_visited ? 'status-visited' : 'status-unvisited'}`}>
                    {selectedPub.is_visited ? 'Visited' : 'Not Visited'}
                  </span>
                   • Avg Rating: {avgRating}
                </div>
            </div>
            
            <div className="review-section">
                <h4>Add a Visit/Review</h4>
                <form className="review-form" onSubmit={handleReviewSubmit}>
                    <label htmlFor="author">Your Name:</label>
                    <input type="text" name="author" required placeholder="John D."/>
                    <label htmlFor="rating">Rating:</label>
                    <select name="rating" required defaultValue="5">
                        <option value="5">5 ★★★★★</option><option value="4">4 ★★★★</option><option value="3">3 ★★★</option><option value="2">2 ★★</option><option value="1">1 ★</option>
                    </select>
                    <label htmlFor="comment">Comment:</label>
                    <textarea name="comment" rows="3" required></textarea>
                    <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit Visit'}</button>
                </form>
            </div>

            {!selectedPub.is_visited && (
                 <button id="generate-crawl-btn" data-lng={lng} data-lat={lat} onClick={handleGenerateCrawl}>
                     Generate Mini-Crawl
                 </button>
            )}

            <div className="review-list">
                <h4>Previous Visits ({selectedPubReviews.length})</h4>
                {selectedPubReviews.length > 0
                    ? selectedPubReviews.map(r => <ReviewCard key={r.id} review={r} />)
                    : <p>No reviews yet. Be the first!</p>
                }
            </div>
        </>
    );
  };
  
  // Render function for the main list view in the sidebar
  const renderPubList = () => (
    <>
      <h2>All Pubs ({allPubs.length})</h2>
      <ul className="pub-list">
        {allPubs.sort((a,b) => a.name.localeCompare(b.name)).map(pub => (
          <li key={pub.id} className="pub-list-item" onClick={() => handleSelectPubFromList(pub)}>
            <strong>{pub.name}</strong>
            <span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      {isLoading && <div className="loading-overlay">Loading...</div>}
      <div className="app-container">
        <aside className="sidebar">
            {selectedPub ? renderSelectedPub() : renderPubList()}
        </aside>
        <div ref={mapContainer} className="map-container"/>
      </div>
    </>
  );
}

export default App;