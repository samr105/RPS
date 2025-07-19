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

// Two distinct, pre-colored SVGs as data URLs for reliability.
const pintUnvisitedSVG = 'data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="white"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';
const pintVisitedSVG = 'data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="%23f39c12"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';

// Helper to load an image.
const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
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
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); } 
    else {
      const pubData = data.map(pub => ({ ...pub, geom: pub.geom || '' }));
      setAllPubs(pubData);
      if (selectAfter && currentSelectedId) {
        const freshPub = pubData.find(p => p.id === currentSelectedId);
        setSelectedPub(freshPub || null);
      }
    }
  }, []);

  // Map Initialization Effect (runs once)
  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
      center: [-3.53, 50.72],
      zoom: 12,
      antialias: true
    });

    map.current.on('load', async () => {
      try {
        const [unvisitedImg, visitedImg] = await Promise.all([ loadImage(pintUnvisitedSVG), loadImage(pintVisitedSVG) ]);
        map.current.addImage('pint-unvisited', unvisitedImg);
        map.current.addImage('pint-visited', visitedImg);
      } catch (e) {
        console.error("Failed to load map icons", e);
        setNotification({ message: 'Error loading map icons.', type: 'error' });
      }

      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      
      map.current.addLayer({
        id: 'pubs-layer',
        type: 'symbol',
        source: 'pubs-source',
        layout: {
          'icon-image': ['case', ['get', 'is_visited'], 'pint-visited', 'pint-unvisited'],
          'icon-size': 0.8,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 14, 'text-offset': [0, 1.8], 'text-anchor': 'top',
        },
        paint: {
          'icon-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 1, 0.85],
          'icon-halo-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2, 0],
          'icon-halo-color': 'rgba(0, 123, 255, 0.5)',
          'text-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 1, 0],
          'text-color': '#FFF', 'text-halo-color': '#000', 'text-halo-width': 1,
          'icon-halo-width-transition': { duration: 150 },
          'icon-opacity-transition': { duration: 150 },
          'text-opacity-transition': { duration: 150 },
        }
      });
      setIsMapLoaded(true);
    });

    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Effect to load data and set up event listeners once map is ready.
  useEffect(() => {
    if (!isMapLoaded) return;
    
    setIsLoading(true);
    handleDataUpdate().finally(() => setIsLoading(false));

    const onMouseMove = (e) => {
      if (e.features.length > 0) { map.current.getCanvas().style.cursor = 'pointer'; setHoveredPubId(e.features[0].id); } 
      else { map.current.getCanvas().style.cursor = ''; setHoveredPubId(null); }
    };
    const onMouseLeave = () => { map.current.getCanvas().style.cursor = ''; setHoveredPubId(null); };
    const onClick = (e) => { if (e.features.length > 0) { const pub = allPubs.find(p => p.id === e.features[0].id); if(pub) setSelectedPub(current => current?.id === pub.id ? null : pub); }};

    map.current.on('mousemove', 'pubs-layer', onMouseMove);
    map.current.on('mouseleave', 'pubs-layer', onMouseLeave);
    map.current.on('click', 'pubs-layer', onClick);

    return () => {
      map.current.off('mousemove', 'pubs-layer', onMouseMove);
      map.current.off('mouseleave', 'pubs-layer', onMouseLeave);
      map.current.off('click', 'pubs-layer', onClick);
    };
  }, [isMapLoaded, allPubs, handleDataUpdate]);

  // Update GeoJSON source when `allPubs` data changes.
  useEffect(() => {
    if (!isMapLoaded || !map.current.getSource('pubs-source')) return;
    const geojsonData = { type: 'FeatureCollection', features: allPubs.map(pub => { const match = pub.geom.match(/POINT\s*\(([^)]+)\)/); if (!match?.[1]) return null; const coords = match[1].trim().split(/\s+/).map(Number); if (coords.length !== 2) return null; return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: coords }, properties: { name: pub.name, is_visited: pub.is_visited } }; }).filter(Boolean)};
    map.current.getSource('pubs-source').setData(geojsonData);
  }, [allPubs, isMapLoaded]);

  // Handle hover state changes
  useEffect(() => {
    if (!isMapLoaded) return;
    if (hoveredPubIdRef.current) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubIdRef.current }, { hover: false });
    if (hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
    hoveredPubIdRef.current = hoveredPubId;
  }, [hoveredPubId, isMapLoaded]);
  
  // Handle selected state changes and fly-to
  useEffect(() => {
    if (!isMapLoaded) return;
    if (selectedPubIdRef.current) map.current.setFeatureState({ source: 'pubs-source', id: selectedPubIdRef.current }, { selected: false });
    if (selectedPub) {
      map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
      selectedPubIdRef.current = selectedPub.id;
      const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
      if (match?.[1]) { const coords = match[1].trim().split(/\s+/).map(Number); map.current.flyTo({ center: coords, zoom: Math.max(map.current.getZoom(), 15), pitch: 30, essential: true, }); }
    } else { selectedPubIdRef.current = null; }
  }, [selectedPub, isMapLoaded]);

  const onPubClick = useCallback((pub) => setSelectedPub(current => current?.id === pub.id ? null : pub), []);
  const onPubEnter = useCallback((pub) => setHoveredPubId(pub.id), []);
  const onPubLeave = useCallback(() => setHoveredPubId(null), []);

  const { handleGenerateCrawl, onClearCrawl, handleLogVisit, handleRemoveVisit, handleMarkCrawlVisited, clearCrawlRoute, visitedCount, filteredPubs } = useMemo(() => {
      // Logic for all functions goes here to keep render clean.
      // Most of these are just stubs for now.
      const handleGenerateCrawl = () => {};
      const onClearCrawl = () => {};
      const handleLogVisit = () => {};
      const handleRemoveVisit = () => {};
      const handleMarkCrawlVisited = () => {};
      const clearCrawlRoute = () => {};
      const visitedCount = allPubs.filter(p => p.is_visited).length;
      const filteredPubs = allPubs.filter(pub => { const matchesSearch = pub.name.toLowerCase().includes(searchTerm.toLowerCase()); if (filter === 'visited') return matchesSearch && pub.is_visited; if (filter === 'unvisited') return matchesSearch && !pub.is_visited; return matchesSearch; }).sort((a, b) => a.name.localeCompare(b.name));
      return { handleGenerateCrawl, onClearCrawl, handleLogVisit, handleRemoveVisit, handleMarkCrawlVisited, clearCrawlRoute, visitedCount, filteredPubs };
  }, [allPubs, searchTerm, filter]);

  return (
    <>
      <div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading...</div>
      <div className="app-container">
        <Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} />
        <aside className="sidebar">
          <SearchFilter searchTerm={searchTerm} setSearchTerm={setSearchTerm} filter={filter} setFilter={setFilter} />
          <div className="sidebar-content">
            <AnimatePresence mode="wait">
              {selectedPub ? (
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPub(null)} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={handleGenerateCrawl} isToggling={isTogglingVisit} isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={onClearCrawl} />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs} onSelectPub={onPubClick} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={onPubEnter} onMouseLeave={onPubLeave} hoveredPubId={hoveredPubId} />
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