// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl'; // Using MapLibre
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(-0.1276);
  const [lat, setLat] = useState(51.5072);
  const [zoom, setZoom] = useState(11);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredPubId, setHoveredPubId] = useState(null); // State for hover effects

  const fetchPubs = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) {
      console.error('Error fetching pubs:', error);
      alert("Could not load pubs.");
      setIsLoading(false);
      return [];
    }

    const pubsForMap = data
      .map(pub => {
        if (!pub.geom) {
          console.warn(`Skipping pub with missing location: ${pub.name}`);
          return null;
        }
        try {
          const coordString = pub.geom.replace('POINT(', '').replace(')', '');
          const [lng, lat] = coordString.split(' ').map(Number);
          if (isNaN(lng) || isNaN(lat)) throw new Error("Invalid coordinates");

          return {
            type: 'Feature',
            id: pub.id, // Providing a unique ID for each feature is crucial
            geometry: {
              type: 'Point',
              coordinates: [lng, lat],
            },
            properties: { ...pub, is_visited: !!pub.last_visit_date },
          };
        } catch (e) {
          console.error(`Error processing pub: ${pub.name}`, e);
          return null;
        }
      })
      .filter(p => p !== null);

    setIsLoading(false);
    return pubsForMap;
  }, []);

  useEffect(() => {
    if (map.current) return;

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    if (!stadiaApiKey) {
      alert("Stadia Maps API Key is missing. The map cannot load.");
      return;
    }
    // THE NEW SLICK MAP STYLE
    const mapStyle = `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${stadiaApiKey}`;

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
        data: { type: 'FeatureCollection', features: pubsData },
        promoteId: 'id' // Helps MapLibre reference features by their ID faster
      });

      // === NEW SLICK MARKER LAYERS (REPLACES THE OLD ONES) ===
      const interactiveLayers = ['unvisited-pubs-layer', 'visited-pubs-layer'];

      // Unvisited pubs are two-toned: a white halo with a red core
      map.current.addLayer({
        id: 'unvisited-pubs-layer',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], // Grow on hover
          'circle-color': '#c53030', // Red core
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'map',
        },
        filter: ['==', 'is_visited', false],
      });
      
      // Visited pubs are a solid green circle that grows
      map.current.addLayer({
        id: 'visited-pubs-layer',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7], // Grow on hover
          'circle-color': '#2f855a', // Green
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'map',
        },
        filter: ['==', 'is_visited', true],
      });
      
      // The hover label that appears for any marker
      map.current.addLayer({
        id: 'pub-labels',
        type: 'symbol',
        source: 'pubs-source',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.25],
          'text-anchor': 'top',
        },
        paint: {
            'text-color': '#222',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
        },
        // Only show the label if the hover state is true
        filter: ['==', ['feature-state', 'hover'], true]
      });


      // === NEW INTERACTIVITY LOGIC (REPLACES OLD MOUSEENTER/LEAVE) ===
      
      // 1. CLICK to open a popup
      map.current.on('click', interactiveLayers, (e) => {
        const feature = e.features[0];
        const coordinates = feature.geometry.coordinates.slice();
        const props = feature.properties;
        new maplibregl.Popup({ closeOnClick: true, offset: [0, -15] })
          .setLngLat(coordinates)
          .setHTML(createPopupHTML(props, coordinates))
          .addTo(map.current);
          
        const reviewForm = document.getElementById('review-form');
        if(reviewForm) reviewForm.addEventListener('submit', (event) => handleReviewSubmit(event));

        const crawlBtn = document.getElementById('generate-crawl-btn');
        if (crawlBtn) crawlBtn.addEventListener('click', handleGenerateCrawl);
      });
      
      // 2. HOVER to show labels and enlarge markers
      let currentlyHoveredId = null;
      map.current.on('mousemove', interactiveLayers, (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (currentlyHoveredId !== null) {
            // Un-hover the old one
            map.current.setFeatureState({ source: 'pubs-source', id: currentlyHoveredId }, { hover: false });
          }
          currentlyHoveredId = e.features[0].id;
          // Hover the new one
          map.current.setFeatureState({ source: 'pubs-source', id: currentlyHoveredId }, { hover: true });
        }
      });
      
      map.current.on('mouseleave', interactiveLayers, () => {
        map.current.getCanvas().style.cursor = '';
        if (currentlyHoveredId !== null) {
          // Un-hover the last one when mouse leaves
          map.current.setFeatureState({ source: 'pubs-source', id: currentlyHoveredId }, { hover: false });
        }
        currentlyHoveredId = null;
      });
    });

  }, []); // The empty dependency array means this useEffect runs only ONCE

  const createPopupHTML = (props, coordinates) => {
    // ...
  };
  const handleReviewSubmit = async (event) => {
    // ...
  };
  const handleGenerateCrawl = async (event) => {
    // ...
  };
  
  // To avoid breaking the code, let's keep the functions we haven't modified yet
  const createPopupHTML = (props, coordinates) => {
      const avgRating = props.avg_rating ? `${Number(props.avg_rating).toFixed(1)} ★` : 'Not Rated';
      return `
        <div class="popup-header">
          <h3>${props.name}</h3>
          <p>${props.address || 'Address not available'}</p>
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
          <button id="generate-crawl-btn" data-lng="${coordinates[0]}" data-lat="${coordinates[1]}">Generate Mini-Crawl</button>
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
      visit_date: new Date().toISOString().slice(0, 10),
    };
    const { error } = await supabase.from('visits').insert(visitData);
    if (error) {
      alert('Error submitting review: ' + error.message);
      form.querySelector('button').disabled = false;
      form.querySelector('button').innerText = "Submit Visit";
    } else {
      alert('Visit submitted! Map will now reload.');
      window.location.reload();
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
      if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
      if (map.current.getLayer('crawl-route')) {
        map.current.removeLayer('crawl-route');
        map.current.removeSource('crawl-route');
      }
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