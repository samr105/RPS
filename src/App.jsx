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

const pintSVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23FFF"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';

const loadImage = (src, width = 48, height = 48) => {
  return new Promise((resolve, reject) => {
    const img = new Image(width, height);
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
};

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const eventHandlersRef = useRef({});
  const selectedPubIdRef = useRef(null);
  const hoveredPubIdRef = useRef(null);
  
  const [allPubs, setAllPubs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(p => {
        if (!p || typeof p.geom !== 'string' || p.id == null) return null;
        const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match || !match[1]) return null;
        const parts = match[1].trim().split(/\s+/);
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (parts.length !== 2 || isNaN(lon) || isNaN(lat)) return null;
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited } };
    }).filter(Boolean);
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);
  
  const clearCrawlRoute = useCallback(() => {
    if (map.current?.getSource('crawl-route')) {
      map.current.removeLayer('crawl-route');
      map.current.removeSource('crawl-route');
    }
    setCrawlPubIds([]);
    setCrawlSummary(null);
    setNotification({message: 'Crawl cleared.', type: 'info'})
  }, []);

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return []; }
    const pubData = data.map(pub => ({ ...pub, geom: pub.geom || '' }));
    setAllPubs(pubData);
    if (selectAfter && currentSelectedId) {
      const freshPub = pubData.find(p => p.id === currentSelectedId);
      setSelectedPub(freshPub || null);
    }
    return pubData;
  }, []);

  const handleGenerateCrawl = useCallback(async (pub) => {
    const button = document.querySelector('.generate-crawl-btn');
    if (button) { button.innerText = 'Calculating...'; button.disabled = true; }
    const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) { setNotification({message: 'Pub location is invalid.', type: 'error'}); return; }
    const coords = match[1].trim().split(/\s+/).map(Number);
    try {
      const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${pub.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
      if(map.current?.getSource('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route');}
      map.current.addSource('crawl-route', { type: 'geojson', data: data.route });
      map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5, 'line-opacity': 0.8 } });
      setCrawlPubIds(data.pubIds);
      const summaryPubs = data.pubIds.map(id => allPubs.find(p => p.id === id)).filter(Boolean);
      setCrawlSummary({ pubs: summaryPubs, duration: data.totalDuration });
      setNotification({ message: `Crawl found!`, type: 'success' });
    } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { if (button) { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } }
  }, [allPubs]);

  const handlePubClick = useCallback((pub) => {
    if (!pub) return;
    if (selectedPub?.id === pub.id) { clearCrawlRoute(); setSelectedPub(null); return; }
    setSelectedPub(pub);
    if (!pub.is_visited) { handleGenerateCrawl(pub); } else { clearCrawlRoute(); }
  }, [selectedPub, clearCrawlRoute, handleGenerateCrawl]);

  const handlePubMouseEnter = useCallback((pub) => {
    const pubId = pub.id;
    if (hoveredPubIdRef.current !== pubId) {
        if (hoveredPubIdRef.current !== null) { map.current?.setFeatureState({ source: 'pubs-source', id: hoveredPubIdRef.current }, { hover: false }); }
        map.current?.setFeatureState({ source: 'pubs-source', id: pubId }, { hover: true });
        setHoveredPubId(pubId);
        hoveredPubIdRef.current = pubId;
    }
  }, []);
    
  const handlePubMouseLeave = useCallback(() => {
    if (hoveredPubIdRef.current !== null) {
        map.current?.setFeatureState({ source: 'pubs-source', id: hoveredPubIdRef.current }, { hover: false });
        setHoveredPubId(null);
        hoveredPubIdRef.current = null;
    }
  }, []);

  eventHandlersRef.current = { handlePubClick, handleGenerateCrawl, handlePubMouseEnter, handlePubMouseLeave };
  
  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      try {
        const pintImage = await loadImage(pintSVG);
        map.current.addImage('pint-glass', pintImage, { sdf: true });
      } catch(error) {
        console.error("CRITICAL: Failed to load map icon.", error);
        setNotification({ message: 'Error loading map icons.', type: 'error' });
      }

      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      
      // FIX: Consolidated into a single, robust layer definition.
      map.current.addLayer({
        id: 'pubs-layer',
        type: 'symbol',
        source: 'pubs-source',
        layout: {
            'icon-image': 'pint-glass',
            'icon-size': 0.9, // Constant size, does not use feature-state.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': 14,
            'text-offset': [0, 1.8],
            'text-anchor': 'top',
        },
        paint: {
            'icon-color': ['case',
                ['==', ['get', 'is_visited'], true], '#f39c12', // Visited color
                '#FFFFFF' // Unvisited color
            ],
            'icon-opacity': ['case',
                ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1.0,
                0.75 // Default opacity
            ],
            // Use a halo to "enlarge" the icon on hover/select.
            'icon-halo-width': ['case',
                ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 2,
                0 // No halo by default
            ],
            'icon-halo-color': "rgba(23, 110, 253, 0.4)", // Accent blue halo
            'text-color': '#FFFFFF',
            'text-halo-color': '#000000',
            'text-halo-width': 1.5,
            // Show text only on hover or select.
            'text-opacity': ['case',
                ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1.0,
                0.0
            ],
            // Add smooth transitions for all dynamic properties.
            'icon-opacity-transition': { duration: 200 },
            'text-opacity-transition': { duration: 200 },
            'icon-halo-width-transition': { duration: 200 }
        }
      });
      
      // FIX: Event listeners now correctly point to the single 'pubs-layer'.
      map.current.on('mousemove', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          eventHandlersRef.current.handlePubMouseEnter(e.features[0]);
        }
      });
      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        eventHandlersRef.current.handlePubMouseLeave();
      });
      map.current.on('click', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          const clickedPub = allPubs.find(p => p.id === e.features[0].id);
          eventHandlersRef.current.handlePubClick(clickedPub);
        }
      });
      
      setIsLoading(true);
      await handleDataUpdate();
      setIsLoading(false);
    });
  }, [handleDataUpdate, handleGenerateCrawl, handlePubClick, handlePubMouseEnter, handlePubMouseLeave]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const previousSelectedId = selectedPubIdRef.current;
    if (previousSelectedId !== null) { map.current.setFeatureState({ source: 'pubs-source', id: previousSelectedId }, { selected: false }); }
    if (selectedPub) {
      const { id, geom } = selectedPub;
      selectedPubIdRef.current = id;
      map.current.setFeatureState({ source: 'pubs-source', id }, { selected: true });
      const match = geom.match(/POINT\s*\(([^)]+)\)/);
      if (match?.[1]) { const coords = match[1].trim().split(/\s+/).map(Number); if (coords.length === 2) { map.current.flyTo({ center: coords, zoom: 15, pitch: 30, essential: true }); } }
    } else { selectedPubIdRef.current = null; }
  }, [selectedPub]);
  
  const handleLogVisit = async (pubId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').delete().eq('id', visitId); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleMarkCrawlVisited = async () => { if (!crawlPubIds || crawlPubIds.length === 0) return; setIsTogglingVisit(true); const visitsToInsert = crawlPubIds.map(id => ({ pub_id: id, visit_date: new Date().toISOString() })); const { error } = await supabase.from('visits').insert(visitsToInsert); if (error) { setNotification({ message: `Error saving crawl visits: ${error.message}`, type: 'error' }); } else { setNotification({ message: 'Crawl completed and saved!', type: 'success' }); await handleDataUpdate(); clearCrawlRoute(); setSelectedPub(null); } setIsTogglingVisit(false); };
  
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
                  <PubList pubs={filteredPubs} onSelectPub={eventHandlersRef.current.handlePubClick} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={eventHandlersRef.current.handlePubMouseEnter} onMouseLeave={eventHandlersRef.current.handlePubMouseLeave} hoveredPubId={hoveredPubId} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <AnimatePresence>
          {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={() => { clearCrawlRoute(); setSelectedPub(null); }} onMarkAllVisited={handleMarkCrawlVisited} isProcessing={isTogglingVisit} />)}
        </AnimatePresence>
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
      </div>
    </>
  );
}

export default App;