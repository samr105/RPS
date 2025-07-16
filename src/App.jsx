// src/App.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';
import { AnimatePresence, motion } from 'framer-motion';

import Notification from './Notification';
import PubList from './components/PubList';
import PubDetailView from './components/PubDetailView';
import SearchFilter from './components/SearchFilter';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const allPubsRef = useRef([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);

  // THIS IS THE SINGLE SOURCE OF TRUTH FOR UPDATING THE MAP'S VISUAL DATA
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getSource('pubs-source')) return;

    const features = allPubs.map(p => {
        if (!p || typeof p.geom !== 'string' || p.id == null) return null;
        const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match || !match[1]) return null;
        const parts = match[1].trim().split(/\s+/);
        if (parts.length !== 2) return null;
        const lon = parseFloat(parts[0]); const lat = parseFloat(parts[1]);
        if (isNaN(lon) || isNaN(lat)) return null;
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited }, };
    }).filter(Boolean);
    
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });

  }, [allPubs]); // This effect runs ONLY when the main allPubs data array changes.

  const handleDataUpdate = useCallback(async (currentSelectedId = null) => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return; }
    const pubData = data.map(pub => ({...pub, geom: pub.geom || ''}));
    allPubsRef.current = pubData;
    setAllPubs(pubData); // This will trigger the useEffect above to update the map
    if (currentSelectedId) { setSelectedPub(pubData.find(p => p.id === currentSelectedId) || null); }
  }, []);
  
  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current?.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);

  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({ id: 'pubs-layer', type: 'circle', source: 'pubs-source', paint: { 'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'], 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, ['boolean', ['feature-state', 'selected'], false], 9, 7], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#FFFFFF'], 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 2], 'circle-opacity-transition': {duration: 200}, 'circle-radius-transition': { duration: 150 }, 'circle-color-transition': { duration: 300 } }});
      map.current.addLayer({ id: 'pub-labels', type: 'symbol', source: 'pubs-source', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.9)', 'text-halo-width': 1.5, 'text-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.0], 'text-opacity-transition': { duration: 200 } } });
      
      let currentHoverId = null;
      map.current.on('mousemove', 'pubs-layer', (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0 && e.features[0].id != null) {
          if (e.features[0].id !== currentHoverId) {
            if (currentHoverId != null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
            currentHoverId = e.features[0].id;
            map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: true });
            // The hover visual is now entirely handled by the map. We only set React state for the dimming effect.
            setHoveredPubId(currentHoverId);
          }
        }
      });
      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        if (currentHoverId != null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false });
        currentHoverId = null;
        setHoveredPubId(null);
      });
      
      map.current.on('click', 'pubs-layer', (e) => { if (e.features.length > 0 && e.features[0].id != null) { const pub = allPubsRef.current.find(p => p.id === e.features[0].id); if (pub) { clearCrawlRoute(); setSelectedPub(pub); } } });
      
      setIsLoading(true);
      await handleDataUpdate();
      setIsLoading(false);
    });
    // eslint-disable-next-line
  }, []);
  
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    let opacityExpression = 1.0; // Default is fully opaque
    if (hoveredPubId != null) { opacityExpression = ['case', ['==', ['id'], hoveredPubId], 1.0, 0.4]; }
    else if (crawlPubIds.length > 0) { opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.4]; }
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
  }, [hoveredPubId, crawlPubIds]);
  
  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      allPubsRef.current.forEach(p => map.current.setFeatureState({ source: 'pubs-source', id: p.id }, { selected: false }));
      if (selectedPub) {
        map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
        const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (match?.[1]) { const coords = match[1].trim().split(/\s+/).map(Number); if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) map.current.flyTo({ center: [coords[0], coords[1]], zoom: 15 }); }
      }
    }
  }, [selectedPub]);

  const handleLogVisit = async (pubId) => { setIsTogglingVisit(true); const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); if (error) { setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId); setNotification({ message: 'Visit logged successfully!', type: 'success' }); } setIsTogglingVisit(false); };
  const handleRemoveVisit = async (pubId, visitId) => { setIsTogglingVisit(true); const { error } = await supabase.from('visits').delete().eq('id', visitId); if (error) { setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId); setNotification({ message: 'Last visit removed.', type: 'success' }); } setIsTogglingVisit(false); };

  const handleGenerateCrawl = async () => {
    if (!selectedPub) return;
    const button = document.querySelector('.generate-crawl-btn');
    button.innerText = 'Calculating...'; button.disabled = true;
    const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) { setNotification({message: 'Pub location is invalid.', type: 'error'}); return; }
    const coords = match[1].trim().split(/\s+/).map(Number);
    
    try {
        const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${selectedPub.id}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
        clearCrawlRoute();
        map.current.addSource('crawl-route', { type: 'geojson', data: data.route });
        map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
        setCrawlPubIds(data.pubIds);
        setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} mins.`, type: 'success' });
    } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); }
    finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; }
  };

  const filteredPubs = useMemo(() => { return allPubs.filter(pub => { const matchesSearch = pub.name.toLowerCase().includes(searchTerm.toLowerCase()); if (filter === 'visited') return matchesSearch && pub.is_visited; if (filter === 'unvisited') return matchesSearch && !pub.is_visited; return matchesSearch; }).sort((a, b) => a.name.localeCompare(b.name)); }, [allPubs, searchTerm, filter]);

  return (
    <>
      <div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading Map...</div>
      <div className="app-container">
        <Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} />
        <aside className="sidebar">
          <SearchFilter searchTerm={searchTerm} setSearchTerm={setSearchTerm} filter={filter} setFilter={setFilter} />
          <div className="sidebar-content">
            <AnimatePresence mode="wait">
              {selectedPub ? ( <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => { clearCrawlRoute(); setSelectedPub(null); }} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={handleGenerateCrawl} isToggling={isTogglingVisit}/> ) : ( <motion.div key="list"><h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2> <PubList pubs={filteredPubs} onSelectPub={ (pub) => { clearCrawlRoute(); setSelectedPub(pub); }} /></motion.div> )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
      </div>
    </>
  );
}

export default App;