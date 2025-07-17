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
import ProgressBar from './components/ProgressBar';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const popupRef = useRef(null); // Create a ref to hold the popup instance
  const allPubsRef = useRef([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [hoveredPubId, setHoveredPubId] = useState(null); // Central state for hover ID
  const [crawlPubIds, setCrawlPubIds] = useState([]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(p => { if (!p || typeof p.geom !== 'string' || p.id == null) return null; const match = p.geom.match(/POINT\s*\(([^)]+)\)/); if (!match || !match[1]) return null; const parts = match[1].trim().split(/\s+/); const lon = parseFloat(parts[0]); const lat = parseFloat(parts[1]); if (parts.length !== 2 || isNaN(lon) || isNaN(lat)) return null; return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited }}; }).filter(Boolean);
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);

  const handleDataUpdate = useCallback(async (currentSelectedId = null) => {
    const { data, error } = await supabase.rpc('get_all_pub_details'); if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return; } const pubData = data.map(pub => ({...pub, geom: pub.geom || ''})); allPubsRef.current = pubData; setAllPubs(pubData); if (currentSelectedId) { setSelectedPub(pubData.find(p => p.id === currentSelectedId) || null); }
  }, []);
  
  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current?.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);

  const handlePubMouseEnter = (pub) => {
    setHoveredPubId(pub.id);
    const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) return;
    const coords = match[1].trim().split(/\s+/).map(Number);
    if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      popupRef.current
        .setLngLat(coords)
        .setHTML(`<strong>${pub.name}</strong>`)
        .addClassName(pub.is_visited ? 'visited-popup' : 'unvisited-popup')
        .removeClassName(pub.is_visited ? 'unvisited-popup' : 'visited-popup')
        .addTo(map.current);
    }
  };

  const handlePubMouseLeave = () => {
    setHoveredPubId(null);
    popupRef.current?.remove();
  };

  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15, });
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({ id: 'pubs-layer', type: 'circle', source: 'pubs-source', paint: { 'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'], 'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#FFFFFF'], 'circle-stroke-width': 2 } });
      map.current.addLayer({ id: 'pub-labels-zoomed', type: 'symbol', source: 'pubs-source', minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': [0, 1.25], 'text-anchor': 'top' }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5, 'text-halo-blur': 1 } });
      
      map.current.on('mouseenter', 'pubs-layer', (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
        const feature = e.features[0];
        if (feature?.id != null) { const pub = allPubsRef.current.find(p => p.id === feature.id); if(pub) handlePubMouseEnter(pub); }
      });
      map.current.on('mouseleave', 'pubs-layer', () => { map.current.getCanvas().style.cursor = ''; handlePubMouseLeave(); });
      map.current.on('click', 'pubs-layer', (e) => { if (e.features.length > 0 && e.features[0].id != null) { const pub = allPubsRef.current.find(p => p.id === e.features[0].id); if (pub) { clearCrawlRoute(); setSelectedPub(pub); } } });
      setIsLoading(true); await handleDataUpdate(); setIsLoading(false);
    });
    // eslint-disable-next-line
  }, []);
  
  useEffect(() => {
    if (!map.current?.isStyleLoaded() || !map.current.getLayer('pubs-layer')) return;
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', crawlPubIds.length > 0 ? 0.3 : 1.0);
  }, [crawlPubIds]);

  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      allPubsRef.current.forEach(pub => map.current.setFeatureState({ source: 'pubs-source', id: pub.id }, { selected: false }));
      if (selectedPub) {
        map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
        const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (match?.[1]) { const coords = match[1].trim().split(/\s+/).map(Number); if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) map.current.flyTo({ center: [coords[0], coords[1]], zoom: 15 }); }
      }
    }
  }, [selectedPub]);

  const handleLogVisit = async (pubId, options = {}) => {
    const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); if (error) { setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' }); } else { const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; await handleDataUpdate(navigateOnSuccess ? pubId : null); setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' }); } setIsTogglingVisit(false);
  };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => {
    const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').delete().eq('id', visitId); if (error) { setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' }); } else { const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; await handleDataUpdate(navigateOnSuccess ? pubId : null); setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' }); } setIsTogglingVisit(false);
  };

  const handleGenerateCrawl = async () => {
    if (!selectedPub) return; const button = document.querySelector('.generate-crawl-btn'); button.innerText = 'Calculating...'; button.disabled = true; const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/); if (!match?.[1]) { setNotification({message: 'Pub location is invalid.', type: 'error'}); return; } const coords = match[1].trim().split(/\s+/).map(Number); try { const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${selectedPub.id}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.'); clearCrawlRoute(); map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5 } }); setCrawlPubIds(data.pubIds); setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} mins.`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; }
  };
  
  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);
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
              {selectedPub ? ( <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => { clearCrawlRoute(); setSelectedPub(null); }} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={handleGenerateCrawl} isToggling={isTogglingVisit}/> ) : ( <motion.div key="list"><h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2> <PubList pubs={filteredPubs} onSelectPub={(pub) => { clearCrawlRoute(); setSelectedPub(pub); }} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={handlePubMouseEnter} onMouseLeave={handlePubMouseLeave} hoveredPubId={hoveredPubId}/></motion.div> )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
      </div>
    </>
  );
}

export default App;