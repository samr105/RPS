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
  
  // Refs to store the IDs of the hovered and selected pubs to avoid stale closures in event handlers
  const hoveredPubIdRef = useRef(null);
  const selectedPubIdRef = useRef(null);

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

  // Memoize handlers passed to child components to prevent unnecessary re-renders
  const onPubClick = useCallback((pub) => setSelectedPub(current => (current?.id === pub.id ? null : pub)), []);
  const onPubEnter = useCallback((pub) => setHoveredPubId(pub.id), []);
  const onPubLeave = useCallback(() => setHoveredPubId(null), []);
  
  // Data fetching and state update logic
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

  // Effect for initializing the map instance. Runs only once.
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

  // Effect to set up map layers and event listeners. Runs once map is ready.
  useEffect(() => {
    if (!isMapReady) return;
    
    map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
    
    // Using a reliable 'circle' layer instead of custom icons
    map.current.addLayer({
        id: 'pubs-layer',
        type: 'circle',
        source: 'pubs-source',
        paint: {
            'circle-color': ['case', ['get', 'is_visited'], '#f39c12', '#FFFFFF'], // Orange for visited, white for unvisited
            'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, ['boolean', ['feature-state', 'hover'], false], 9, 6 ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#0d6efd', // Blue outline for interaction
            'circle-stroke-opacity': ['case', ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1, 0],
            'circle-opacity': 0.85,
            'circle-radius-transition': { duration: 200 },
            'circle-stroke-opacity-transition': { duration: 200 },
        }
    });

    const handleMouseMove = (e) => {
      map.current.getCanvas().style.cursor = 'pointer';
      if (e.features?.length > 0) onPubEnter(e.features[0]);
    };
    const handleMouseLeave = () => {
      map.current.getCanvas().style.cursor = '';
      onPubLeave();
    };
    const handleClick = (e) => {
        if (e.features?.length > 0) {
            const pub = allPubs.find(p => p.id === e.features[0].id);
            if (pub) onPubClick(pub);
        }
    };

    map.current.on('mousemove', 'pubs-layer', handleMouseMove);
    map.current.on('mouseleave', 'pubs-layer', handleMouseLeave);
    map.current.on('click', 'pubs-layer', handleClick);
    
    handleDataUpdate();
    setIsLoading(false);

    // Cleanup listeners on unmount
    return () => {
        if(map.current) {
            map.current.off('mousemove', 'pubs-layer', handleMouseMove);
            map.current.off('mouseleave', 'pubs-layer', handleMouseLeave);
            map.current.off('click', 'pubs-layer', handleClick);
        }
    };

  }, [isMapReady, handleDataUpdate, allPubs, onPubClick, onPubEnter, onPubLeave]);

  // Syncs the GeoJSON data source with the `allPubs` state
  useEffect(() => {
    if (!isMapReady || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(pub => {
        const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const coords = match[1].trim().split(/\s+/).map(Number);
        if (coords.length !== 2) return null;
        return { type: 'Feature', id: pub.id, geometry: { type: 'Point', coordinates: coords }, properties: { name: pub.name, is_visited: pub.is_visited } };
    }).filter(Boolean);
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs, isMapReady]);
  
  // Syncs map visual state with hoveredPubId
  useEffect(() => {
    if (!isMapReady) return;
    if (hoveredPubIdRef.current) map.current.removeFeatureState({ source: 'pubs-source', id: hoveredPubIdRef.current }, 'hover');
    if (hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hover: true });
    hoveredPubIdRef.current = hoveredPubId;
  }, [hoveredPubId, isMapReady]);

  // Syncs map visual state with selectedPub
  useEffect(() => {
    if (!isMapReady) return;
    if (selectedPubIdRef.current) map.current.removeFeatureState({ source: 'pubs-source', id: selectedPubIdRef.current }, 'selected');
    if (selectedPub) {
      map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
      const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
      if (match?.[1]) {
        const coords = match[1].trim().split(/\s+/).map(Number);
        map.current.flyTo({ center: coords, zoom: Math.max(map.current.getZoom(), 15), pitch: 30, essential: true });
      }
    }
    selectedPubIdRef.current = selectedPub ? selectedPub.id : null;
  }, [selectedPub, isMapReady]);

  // Memos for performance
  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);
  const filteredPubs = useMemo(() => {
    return allPubs
      .filter(pub => pub.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter(pub => {
        if (filter === 'visited') return pub.is_visited;
        if (filter === 'unvisited') return !pub.is_visited;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPubs, searchTerm, filter]);

  // Placeholder handlers for features not yet re-implemented
  const handleLogVisit = async () => {}; const handleRemoveVisit = async () => {};

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
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPub(null)} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={() => {}} isToggling={isTogglingVisit} onClearCrawl={() => {}}/>
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs} onSelectPub={onPubClick} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={onPubEnter} onMouseLeave={onPubLeave} hoveredPubId={hoveredPubId}/>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
        {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={() => setCrawlSummary(null)} onMarkAllVisited={()=>{}} isProcessing={isTogglingVisit}/>)}
      </div>
    </>
  );
}

export default App;