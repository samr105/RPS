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

const pintGlassSVGString = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef({});

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

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) {
      setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' });
    } else {
      const pubData = data.map(pub => ({ ...pub, geom: pub.geom || '' }));
      setAllPubs(pubData);
      if (selectAfter && currentSelectedId) {
        const freshPub = pubData.find(p => p.id === currentSelectedId);
        setSelectedPub(freshPub || null);
      }
    }
    setIsLoading(false);
  }, []);

  const clearCrawlRoute = useCallback(() => {
    if (map.current?.getSource('crawl-route')) {
      try {
        map.current.removeLayer('crawl-route');
        map.current.removeSource('crawl-route');
      } catch (e) {
        console.warn("Could not remove crawl route:", e);
      }
    }
    setCrawlPubIds([]);
    setCrawlSummary(null);
  }, []);

  const handleGenerateCrawl = useCallback(async (pub) => {
    // Unchanged implementation...
  }, [allPubs]);

  const handlePubClick = useCallback((pub) => {
    if (!pub) return;
    if (selectedPub?.id === pub.id) {
      clearCrawlRoute();
      setSelectedPub(null);
      return;
    }
    setSelectedPub(pub);
    if (!pub.is_visited) {
      handleGenerateCrawl(pub);
    } else {
      clearCrawlRoute();
    }
  }, [selectedPub, clearCrawlRoute, handleGenerateCrawl]);

  const handlePubMouseEnter = useCallback((pub) => pub && setHoveredPubId(pub.id), []);
  const handlePubMouseLeave = useCallback(() => setHoveredPubId(null), []);

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
    map.current.on('load', () => handleDataUpdate());
    return () => { map.current?.remove(); map.current = null; };
  }, [handleDataUpdate]);
  
  // *** FIX: Effect 1 - Create and destroy markers ***
  // Runs ONLY when `allPubs` changes.
  useEffect(() => {
    if (!map.current?.isStyleLoaded() || !allPubs) return;
    const currentMarkers = markersRef.current;
    
    allPubs.forEach(pub => {
      if (!currentMarkers[pub.id]) {
        const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return;
        const coords = match[1].trim().split(/\s+/).map(Number);
        if (coords.length !== 2) return;
        
        const el = document.createElement('div');
        el.innerHTML = pintGlassSVGString;

        el.addEventListener('click', (e) => { e.stopPropagation(); handlePubClick(pub); });
        el.addEventListener('mouseenter', () => handlePubMouseEnter(pub));
        el.addEventListener('mouseleave', () => handlePubMouseLeave());
        
        currentMarkers[pub.id] = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(coords)
          .addTo(map.current);
      }
    });

  }, [allPubs, handlePubClick, handlePubMouseEnter, handlePubMouseLeave]);
  
  // *** FIX: Effect 2 - Update marker styles ***
  // Runs when interaction state changes.
  useEffect(() => {
    Object.keys(markersRef.current).forEach(id => {
        const marker = markersRef.current[id];
        const pub = allPubs.find(p => p.id === Number(id));
        const el = marker.getElement();
        
        if (pub) {
            el.className = 'pub-marker'; // Reset
            el.classList.add(pub.is_visited ? 'visited' : 'unvisited');
            
            if (selectedPub && pub.id !== selectedPub.id) {
                el.classList.add('marker-fade');
            }
            if (pub.id === selectedPub?.id) el.classList.add('selected');
            if (pub.id === hoveredPubId) el.classList.add('hover');
        }
    });
  }, [allPubs, hoveredPubId, selectedPub]);


  useEffect(() => {
    if (!map.current || !selectedPub) return;
    const { geom } = selectedPub;
    const match = geom.match(/POINT\s*\(([^)]+)\)/);
    if (match?.[1]) {
      const coords = match[1].trim().split(/\s+/).map(Number);
      if (coords.length === 2) {
        map.current.flyTo({ center: coords, zoom: Math.max(map.current.getZoom(), 15), pitch: 30, essential: true });
      }
    }
  }, [selectedPub]);

  const handleLogVisit = async (pubId, options = {}) => { /* ... unchanged ... */ };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => { /* ... unchanged ... */ };
  const handleMarkCrawlVisited = async () => { /* ... unchanged ... */ };

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
                <PubDetailView key={selectedPub.id} pub={selectedPub} onBack={() => { clearCrawlRoute(); setSelectedPub(null); }} onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} onGenerateCrawl={handleGenerateCrawl} isToggling={isTogglingVisit} isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={clearCrawlRoute} />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs} onSelectPub={handlePubClick} onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isTogglingVisit} onMouseEnter={handlePubMouseEnter} onMouseLeave={handlePubMouseLeave} hoveredPubId={hoveredPubId} />
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