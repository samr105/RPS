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
import CrawlSummary from './components/CrawlSummary';

// Use a more robust base64 encoded SVG. All styling will be handled by the map layer.
const pintSVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTE4LjUgM2gtMTNMNCAyMWgxNkwxOC41IDNaIi8+PC9zdmc+';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const allPubsRef = useRef([]);
  const eventHandlersRef = useRef({});
  const selectedPubIdRef = useRef(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);

  useEffect(() => {
    allPubsRef.current = allPubs; // Keep the ref in sync with the state
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(p => { if (!p || typeof p.geom !== 'string' || p.id == null) return null; const match = p.geom.match(/POINT\s*\(([^)]+)\)/); if (!match || !match[1]) return null; const parts = match[1].trim().split(/\s+/); const lon = parseFloat(parts[0]); const lat = parseFloat(parts[1]); if (parts.length !== 2 || isNaN(lon) || isNaN(lat)) return null; return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited }}; }).filter(Boolean);
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);
  
  const clearCrawlRoute = useCallback(() => { if (map.current?.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } setCrawlPubIds([]); setCrawlSummary(null); setNotification({message: 'Crawl cleared.', type: 'info'}) }, []);

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    const { data, error } = await supabase.rpc('get_all_pub_details'); if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return []; } const pubData = data.map(pub => ({...pub, geom: pub.geom || ''}));
    setAllPubs(pubData);
    if (selectAfter && currentSelectedId) { const freshPub = pubData.find(p => p.id === currentSelectedId); setSelectedPub(freshPub || null); }
    return pubData;
  }, []);

  eventHandlersRef.current.handleGenerateCrawl = async (pub) => { const button = document.querySelector('.generate-crawl-btn'); if (button) { button.innerText = 'Calculating...'; button.disabled = true; } const match = pub.geom.match(/POINT\s*\(([^)]+)\)/); if (!match?.[1]) { setNotification({message: 'Pub location is invalid.', type: 'error'}); return; } const coords = match[1].trim().split(/\s+/).map(Number); try { const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${pub.id}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.'); if(map.current?.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route');} map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5 } }); setCrawlPubIds(data.pubIds); const summaryPubs = data.pubIds.map(id => allPubsRef.current.find(p => p.id === id)).filter(Boolean); setCrawlSummary({ pubs: summaryPubs, duration: data.totalDuration }); setNotification({ message: `Crawl found!`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { if (button) { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } } };
  eventHandlersRef.current.handlePubClick = (pub) => { if (!pub) return; if (pub.is_visited) { clearCrawlRoute(); setSelectedPub(pub); return; } if (crawlPubIds.length > 0 && crawlPubIds[0] === pub.id) { clearCrawlRoute(); setSelectedPub(null); } else { setSelectedPub(pub); eventHandlersRef.current.handleGenerateCrawl(pub); }};

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      const image = await map.current.loadImage(pintSVG);
      if(image.data) map.current.addImage('pint-glass', image.data);
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({ id: 'pubs-halo-layer', type: 'symbol', source: 'pubs-source', layout: { 'icon-image': 'pint-glass', 'icon-allow-overlap': true, 'icon-size': 1.8 }, paint: { 'icon-color': '#0d6efd', 'icon-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.35, 0], 'icon-translate-anchor': 'viewport' }});
      map.current.addLayer({ id: 'pubs-icons-layer', type: 'symbol', source: 'pubs-source', layout: { 'icon-image': 'pint-glass', 'icon-size': ['case', ['boolean', ['feature-state', 'pulse'], false], 1.4, ['boolean', ['feature-state', 'hover'], false], 1.2, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': ['case', ['get', 'is_visited'], '#f39c12', '#999999'], 'icon-halo-color': '#FFFFFF', 'icon-halo-width': ['case', ['get', 'is_visited'], 2, 0], 'icon-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, ['==', ['id'], selectedPubIdRef.current], 1, 0.5], 'icon-opacity-transition': { duration: 200 } } });
      map.current.addLayer({ id: 'pubs-labels-layer', type: 'symbol', source: 'pubs-source', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': ['case', ['boolean', ['feature-state', 'hover'], false], ['literal', [0, -2.5]], ['literal', [0, -2]]], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 1.5, 'text-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0], 'text-opacity-transition': { duration: 200 } } });

      let currentHoverId = null;
      map.current.on('mousemove', 'pubs-icons-layer', (e) => {
        if (e.features.length > 0) { const newHoverId = e.features[0].id; map.current.getCanvas().style.cursor = 'pointer'; if (newHoverId !== currentHoverId) { if (currentHoverId !== null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false }); currentHoverId = newHoverId; map.current.setFeatureState({ source: 'pubs-source', id: newHoverId }, { hover: true }); setHoveredPubId(newHoverId); } }
      });
      map.current.on('mouseleave', 'pubs-icons-layer', () => { if (currentHoverId !== null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false }); map.current.getCanvas().style.cursor = ''; currentHoverId = null; setHoveredPubId(null); });
      map.current.on('click', 'pubs-icons-layer', (e) => { if (e.features.length > 0) { const clickedPub = allPubsRef.current.find(p => p.id === e.features[0].id); eventHandlersRef.current.handlePubClick(clickedPub); } });
      
      setIsLoading(true); await handleDataUpdate(); setIsLoading(false);
    });
  // NOTE THE EMPTY DEPENDENCY ARRAY. This ensures the hook runs only ONCE.
  }, []);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const previousSelectedId = selectedPubIdRef.current;
    if (previousSelectedId !== null) map.current.setFeatureState({ source: 'pubs-source', id: previousSelectedId }, { selected: false });
    if (selectedPub) { const { id, geom } = selectedPub; selectedPubIdRef.current = id; map.current.setFeatureState({ source: 'pubs-source', id }, { selected: true }); map.current.setFeatureState({ source: 'pubs-source', id }, { pulse: true }); setTimeout(() => { map.current.setFeatureState({ source: 'pubs-source', id }, { pulse: false }) }, 250); const match = geom.match(/POINT\s*\(([^)]+)\)/); if (match?.[1]) { const coords = match[1].trim().split(/\s+/).map(Number); if (coords.length === 2) { map.current.flyTo({ center: coords, zoom: 15, pitch: 30, essential: true }); } }
    } else { selectedPubIdRef.current = null; }
  }, [selectedPub]);
  
  const handleLogVisit = async (pubId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').delete().eq('id', visitId); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleMarkCrawlVisited = async () => { if (!crawlPubIds || crawlPubIds.length === 0) return; setIsTogglingVisit(true); const visitsToInsert = crawlPubIds.map(id => ({ pub_id: id, visit_date: new Date().toISOString() })); const { error } = await supabase.from('visits').insert(visitsToInsert); if (error) { setNotification({ message: `Error saving crawl visits: ${error.message}`, type: 'error' }); } else { setNotification({ message: 'Crawl completed and saved!', type: 'success' }); await handleDataUpdate(); clearCrawlRoute(); } setIsTogglingVisit(false); };
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
              {selectedPub ? (
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => { clearCrawlRoute(); setSelectedPub(null); }} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={eventHandlersRef.current.handleGenerateCrawl} isToggling={isTogglingVisit} isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={clearCrawlRoute} />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs} onSelectPub={eventHandlersRef.current.handlePubClick} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={(pub) => eventHandlersRef.current.handlePubMouseEnter && eventHandlersRef.current.handlePubMouseEnter(pub)} onMouseLeave={() => eventHandlersRef.current.handlePubMouseLeave && eventHandlersRef.current.handlePubMouseLeave()} hoveredPubId={hoveredPubId} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <AnimatePresence>
          {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={clearCrawlRoute} onMarkAllVisited={handleMarkCrawlVisited} isProcessing={isTogglingVisit} />)}
        </AnimatePresence>
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
      </div>
    </>
  );
}

export default App;