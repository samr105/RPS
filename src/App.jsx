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

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const allPubsRef = useRef([]); // A ref to hold the latest pub data for event handlers
  
  const [isMapReady, setIsMapReady] = useState(false);
  const [allPubs, setAllPubs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [selectedPub, setSelectedPub] = useState(null);
  const [hoveredPubId, setHoveredPubId] = useState(null);

  // Other UI state
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [crawlSummary, setCrawlSummary] = useState(null);

  // Keep the ref updated with the latest pub data
  useEffect(() => {
    allPubsRef.current = allPubs;
  }, [allPubs]);

  // Handlers for the sidebar list. Memoized for performance.
  const onPubClick = useCallback((pub) => setSelectedPub(p => p?.id === pub.id ? null : pub), []);
  const onPubEnter = useCallback((pub) => setHoveredPubId(pub.id), []);
  const onPubLeave = useCallback(() => setHoveredPubId(null), []);

  // Effect to initialize map. Runs ONCE on mount.
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
    map.current.on('load', () => setIsMapReady(true));
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Effect to set up sources, layers, and listeners. Runs ONCE when map is ready.
  useEffect(() => {
    if (!isMapReady) return;

    // Define handlers here. They will close over the `set` functions but use a ref for data access.
    const handleMouseMove = (e) => {
        if (e.features?.length) {
            map.current.getCanvas().style.cursor = 'pointer';
            setHoveredPubId(e.features[0].id);
        }
    };
    const handleMouseLeave = () => {
        map.current.getCanvas().style.cursor = '';
        setHoveredPubId(null);
    };
    const handleClick = (e) => {
        if (e.features?.length) {
            const pub = allPubsRef.current.find(p => p.id === e.features[0].id);
            setSelectedPub(p);
        }
    };

    map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
    map.current.addLayer({
        id: 'pubs-layer', type: 'circle', source: 'pubs-source',
        paint: {
            'circle-color': ['case', ['get', 'is_visited'], '#f39c12', '#FFFFFF'],
            'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, ['boolean', ['feature-state', 'hover'], false], 8, 5 ],
            'circle-stroke-width': ['case', ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 2.5, 0 ],
            'circle-stroke-color': '#0d6efd',
            'circle-opacity': 0.95,
            'circle-radius-transition': { duration: 150 },
            'circle-stroke-opacity-transition': { duration: 150 }
        }
    });

    map.current.on('mousemove', 'pubs-layer', handleMouseMove);
    map.current.on('mouseleave', 'pubs-layer', handleMouseLeave);
    map.current.on('click', 'pubs-layer', handleClick);
    
    // Initial data fetch
    const fetchData = async () => {
        const { data, error } = await supabase.rpc('get_all_pub_details');
        if (error) setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' });
        else setAllPubs(data.map(p => ({ ...p, geom: p.geom || '' })));
        setIsLoading(false);
    };
    fetchData();

  }, [isMapReady]);

  // Effect to sync map data source when allPubs state changes
  useEffect(() => {
    if (!isMapReady) return;
    const source = map.current.getSource('pubs-source');
    if (!source) return;

    const geojsonData = { type: 'FeatureCollection', features: allPubs.map(pub => {
        const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const coords = match[1].trim().split(/\s+/).map(Number);
        return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: coords }, properties: { name: pub.name, is_visited: pub.is_visited }};
    }).filter(Boolean) };
    source.setData(geojsonData);
  }, [allPubs, isMapReady]);

  // Effect to sync map hover state with React state
  useEffect(() => {
    if (!isMapReady) return;
    // We use a separate ref here to track what the map thinks is hovered
    // to prevent clearing a new hover state set by a fast mouse move.
    if (map.hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: map.hoveredPubId }, { hover: false });
    if (hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
    map.hoveredPubId = hoveredPubId;
  }, [hoveredPubId, isMapReady]);

  // Effect to sync map selected state with React state
  useEffect(() => {
    if (!isMapReady) return;
    if (map.selectedPubId) map.current.setFeatureState({ source: 'pubs-source', id: map.selectedPubId }, { selected: false });
    if (selectedPub) {
      map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
      const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
      if (match?.[1]) {
        const coords = match[1].trim().split(/\s+/).map(Number);
        if (coords.length === 2) map.current.flyTo({ center: coords, zoom: Math.max(map.current.getZoom(), 15), pitch: 30, essential: true });
      }
    }
    map.selectedPubId = selectedPub?.id;
  }, [selectedPub, isMapReady]);
  
  // Memoized derived state for rendering
  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);
  const filteredPubs = useMemo(() => allPubs
    .filter(pub => pub.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(pub => filter === 'all' ? true : (filter === 'visited' ? pub.is_visited : !pub.is_visited))
    .sort((a, b) => a.name.localeCompare(b.name)),
  [allPubs, searchTerm, filter]);

  const handleLogVisit = () => {}; const handleRemoveVisit = () => {};

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
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPub(null)} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={()=>{}} isToggling={isTogglingVisit} onClearCrawl={()=>{}}/>
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
        {crawlSummary && <CrawlSummary crawlData={crawlSummary} onClose={()=>{}} onMarkAllVisited={()=>{}} isProcessing={isTogglingVisit}/>}
      </div>
    </>
  );
}

export default App;