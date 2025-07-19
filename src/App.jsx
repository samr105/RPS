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

const pintUnvisitedSVG = 'data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="white"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';
const pintVisitedSVG = 'data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="%23f39c12"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';

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
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    setIsLoading(true);
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
    setIsLoading(false);
  }, []);

  // Effect to initialize the map object once.
  useEffect(() => {
    if (map.current) return; // a map has already been initialized
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
      center: [-3.53, 50.72],
      zoom: 12,
      antialias: true
    });
    map.current.on('load', () => setIsMapReady(true));
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Effect to setup layers, data, and listeners once the map is ready.
  useEffect(() => {
    if (!isMapReady) return;
    
    const setupMap = async () => {
        await Promise.all([ loadImage(pintUnvisitedSVG), loadImage(pintVisitedSVG) ])
            .then(([unvisitedImg, visitedImg]) => {
                map.current.addImage('pint-unvisited', unvisitedImg);
                map.current.addImage('pint-visited', visitedImg);
            });
            
        map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
        
        map.current.addLayer({
            id: 'pubs-layer',
            type: 'symbol',
            source: 'pubs-source',
            layout: { 'icon-image': ['case', ['get', 'is_visited'], 'pint-visited', 'pint-unvisited' ], 'icon-size': 0.8, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': [0, 1.8], 'text-anchor': 'top', },
            paint: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 1, 0.85 ], 'icon-halo-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2, 0 ], 'icon-halo-color': 'rgba(0, 123, 255, 0.5)', 'text-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 1, 0 ], 'text-color': '#FFF', 'text-halo-color': '#000', 'text-halo-width': 1, }
        });

        await handleDataUpdate();

        map.current.on('mousemove', 'pubs-layer', (e) => {
            if (e.features?.length > 0) {
                map.current.getCanvas().style.cursor = 'pointer';
                const id = e.features[0].id;
                setHoveredPubId(id);
            }
        });
        map.current.on('mouseleave', 'pubs-layer', () => {
            map.current.getCanvas().style.cursor = '';
            setHoveredPubId(null);
        });
        map.current.on('click', 'pubs-layer', (e) => {
            if (e.features?.length > 0) {
                const id = e.features[0].id;
                setSelectedPub(current => allPubs.find(p => p.id === id) === current ? null : allPubs.find(p => p.id === id));
            }
        });
    };
    setupMap();
  }, [isMapReady, allPubs, handleDataUpdate]);

  // Effect to update the GeoJSON source whenever the pub data changes.
  useEffect(() => {
    if (!isMapReady || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(pub => {
        const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const coords = match[1].trim().split(/\s+/).map(Number);
        if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) return null;
        return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: coords }, properties: { name: pub.name, is_visited: pub.is_visited } };
    }).filter(Boolean);
    
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs, isMapReady]);

  // Effect to sync map's visual hover state with React state.
  useEffect(() => {
    if (!isMapReady) return;
    if (hoveredPubIdRef.current) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubIdRef.current }, { hover: false });
    if (hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
    hoveredPubIdRef.current = hoveredPubId;
  }, [hoveredPubId, isMapReady]);
  
  // Effect to sync map's visual selected state with React state.
  useEffect(() => {
    if (!isMapReady) return;
    if (selectedPubIdRef.current) map.current.setFeatureState({ source: 'pubs-source', id: selectedPubIdRef.current }, { selected: false });
    if (selectedPub) {
        map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
        const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (match?.[1]) {
            const coords = match[1].trim().split(/\s+/).map(Number);
            map.current.flyTo({ center: coords, zoom: Math.max(map.current.getZoom(), 15), pitch: 30, essential: true, });
        }
    }
    selectedPubIdRef.current = selectedPub ? selectedPub.id : null;
  }, [selectedPub, isMapReady]);
  
  // Handlers for the UI components
  const onPubClick = useCallback((pub) => setSelectedPub(current => current === pub ? null : pub), []);
  const onPubEnter = useCallback((pub) => setHoveredPubId(pub.id), []);
  const onPubLeave = useCallback(() => setHoveredPubId(null), []);

  const handleLogVisit = async (pubId, options = {}) => { setIsTogglingVisit(true); await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); await handleDataUpdate(pubId, options.navigateOnSuccess); setIsTogglingVisit(false); };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => { setIsTogglingVisit(true); await supabase.from('visits').delete().eq('id', visitId); await handleDataUpdate(pubId, options.navigateOnSuccess); setIsTogglingVisit(false); };

  // Filtered list for the UI
  const filteredPubs = useMemo(() => {
    return allPubs.filter(pub => pub.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .filter(pub => { if (filter === 'visited') return pub.is_visited; if (filter === 'unvisited') return !pub.is_visited; return true;})
        .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPubs, searchTerm, filter]);

  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);

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
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPub(null)} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={() => {}} isToggling={isTogglingVisit} onClearCrawl={() => {}} />
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
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
        <AnimatePresence>
          {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={() => {}} onMarkAllVisited={() => {}} isProcessing={isTogglingVisit} />)}
        </AnimatePresence>
      </div>
    </>
  );
}

export default App;