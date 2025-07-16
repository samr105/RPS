// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css'; 
import { supabase } from './supabaseClient';


function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(-0.1276); // Default to London's longitude
  const [lat, setLat] = useState(51.5072); // Default to London's latitude
  const [zoom, setZoom] = useState(11);
  const [isLoading, setIsLoading] = useState(true);

  // Re-usable function to fetch all pubs and their statuses
  const fetchPubs = useCallback(async () => {
    setIsLoading(true);
    // Call our database function
    const { data, error } = await supabase.rpc('get_all_pub_details');

    if (error) {
      console.error('Error fetching pubs:', error);
      alert("Could not load pubs from the database. Check console for details.");
      setIsLoading(false);
      return [];
    }
    
    // Process the data for the map
    const pubsForMap = data.map(pub => {
      // The geom comes back as 'POINT(lng lat)', we need to parse it
      const coordString = pub.geom.replace('POINT(', '').replace(')', '');
      const [lng, lat] = coordString.split(' ').map(Number);
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        properties: {
          ...pub, // id, name, address, etc.
          is_visited: !!pub.last_visit_date,
        },
      };
    });
    setIsLoading(false);
    return pubsForMap;
  }, []);

  // Main effect to initialize and update the map
  useEffect(() => {
    if (map.current) return; // If map already exists, do nothing

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    if (!stadiaApiKey) {
        alert("Stadia Maps API Key is missing. The map cannot load.");
        return;
    }
    const mapStyle = `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${stadiaApiKey}`;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [lng, lat],
      zoom: zoom,
    });

    map.current.on('load', async () => {
      const pubsData = await fetchPubs();

      map.current.addSource('pubs-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: pubsData,
        },
      });

      // Layer for unvisited pubs (red circles)
      map.current.addLayer({
        id: 'unvisited-pubs',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-color': '#c53030', // Red
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
        filter: ['==', 'is_visited', false],
      });

      // Layer for visited pubs (green circles)
      map.current.addLayer({
        id: 'visited-pubs',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-color': '#2f855a', // Green
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
        filter: ['==', 'is_visited', true],
      });

      // When a pub is clicked, show a popup
      map.current.on('click', ['visited-pubs', 'unvisited-pubs'], (e) => {
        const feature = e.features[0];
        const coordinates = feature.geometry.coordinates.slice();
        const props = feature.properties;
        
        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(createPopupHTML(props))
          .addTo(map.current)
          .getElement().addEventListener('submit', (event) => {
              if (event.target.id === 'review-form') handleReviewSubmit(event);
          });
        
        document.getElementById('generate-crawl-btn')?.addEventListener('click', handleGenerateCrawl);
      });

      // Change cursor to a pointer when hovering over a pub
      map.current.on('mouseenter', ['visited-pubs', 'unvisited-pubs'], () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', ['visited-pubs', 'unvisited-pubs'], () => {
        map.current.getCanvas().style.cursor = '';
      });
    });
  }, [fetchPubs, lat, lng, zoom]); // Re-run effect if these change

  const createPopupHTML = (props) => {
      const avgRating = props.avg_rating ? `${Number(props.avg_rating).toFixed(1)} ★` : 'Not Rated';
      return `
        <div class="popup-header">
          <h3>${props.name}</h3>
          <p>${props.address}</p>
          <span class="popup-status ${props.is_visited ? 'status-visited' : 'status-unvisited'}">
            ${props.is_visited ? 'Visited' : 'Not Visited'}
          </span>
          <div>Avg Rating: ${avgRating}</div>
        </div>
        <div class="popup-section">
          <h4>Add a Visit/Review</h4>
          <form id="review-form">
            <input type="hidden" name="pub_id" value="${props.id}">
            <label for="author">Your Name:</label>
            <input type="text" name="author" required placeholder="John D.">
            <label for="rating">Rating:</label>
            <select name="rating" required>
              <option value="5">5 ★★★★★</option>
              <option value="4">4 ★★★★</option>
              <option value="3">3 ★★★</option>
              <option value="2">2 ★★</option>
              <option value="1">1 ★</option>
            </select>
            <label for="comment">Comment:</label>
            <textarea name="comment" rows="3" required></textarea>
            <button type="submit">Submit Visit</button>
          </form>
        </div>
        ${!props.is_visited ? `
        <div class="popup-section">
          <button id="generate-crawl-btn" data-lng="${props.geom.replace('POINT(', '').split(' ')[0]}" data-lat="${props.geom.replace(')', '').split(' ')[1]}">Generate Mini-Crawl</button>
        </div>` : ''}
      `;
  };

  const handleReviewSubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    form.querySelector('button').disabled = true;
    form.querySelector('button').innerText = "Submitting...";
    
    const formData = new FormData(form);
    const visitData = {
      pub_id: formData.get('pub_id'),
      rating: parseInt(formData.get('rating')),
      comment: formData.get('comment'),
      author: formData.get('author') || 'Anonymous',
      visit_date: new Date().toISOString().slice(0, 10), // Today's date
    };

    const { error } = await supabase.from('visits').insert(visitData);

    if (error) {
      alert('Error submitting review: ' + error.message);
      form.querySelector('button').disabled = false;
      form.querySelector('button').innerText = "Submit Visit";
    } else {
      alert('Visit submitted! Map will now reload.');
      window.location.reload(); // Simple way to refresh the map with new data
    }
  };

  const handleGenerateCrawl = async (event) => {
    const button = event.target;
    button.innerText = 'Calculating...';
    button.disabled = true;

    const { lng, lat } = button.dataset;

    try {
      const response = await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate crawl.');
      }
      
      // Remove old route layer if it exists
      if (map.current.getLayer('crawl-route')) {
        map.current.removeLayer('crawl-route');
        map.current.removeSource('crawl-route');
      }

      // Add new route source and layer
      map.current.addSource('crawl-route', { type: 'geojson', data: data.route });
      map.current.addLayer({
        id: 'crawl-route',
        type: 'line',
        source: 'crawl-route',
        paint: {
          'line-color': '#2563eb',
          'line-width': 5,
          'line-opacity': 0.8,
        },
      });
      alert(`Found a crawl! Total walk time: ${Math.round(data.totalDuration / 60)} minutes.`);

    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
        button.innerText = 'Generate Mini-Crawl';
        button.disabled = false;
    }
  };
  
  return (
    <>
      {isLoading && <div className="loading-overlay">Loading Pubs...</div>}
      <div ref={mapContainer} className="map-container" />
    </>
  );
}

export default App;