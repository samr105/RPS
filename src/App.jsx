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

// Using an SVG string that we will inject into marker elements directly
const pintGlassSVGString = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18.5,3H5.5L4,21H20L18.5,3Z"/></svg>';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef({}); // To hold our DOM marker instances
  
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
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return; }
    const pubData = data.map(pub => ({ ...pub, geom: pub.geom || '' }));
    setAllPubs(pubData);
    if (selectAfter && currentSelectedId) {
      const freshPub = pubData.find(p => p.id === currentSelectedId);
      setSelectedPub(freshPub || null);
    }
  }, []);

  const clearCrawlRoute = useCallback(() => {
    if (map.current?.getSource('crawl-route')) {
      map.current.removeLayer('crawl-route');
      map.current.removeSource('crawl-route');
    }
    setCrawlPubIds([]);
    setCrawlSummary(null);
  }, []);

  const handleGenerateCrawl = useCallback(async (pub) => { /* ... implementation unchanged ... */ }, [allPubs]);
  const handlePubClick = useCallback((pub) => { /* ... implementation unchanged ... */ }, [selectedPub, clearCrawlRoute, handleGenerateCrawl]);
  
  // Hover handlers now just set state. The useEffect will handle the visual change.
  const handlePubMouseEnter = useCallback((pub) => pub && setHoveredPubId(pub.id), []);
  const handlePubMouseLeave = useCallback(() => setHoveredPubId(null), []);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
      center: [-3.53, 50.72],
      zoom: 12,
      antialias: true
    });
    map.current.on('load', () => {
      handleDataUpdate();
      setIsLoading(false);
    });
    // Cleanup map instance on component unmount
    return () => { map.current?.remove(); map.current = null; };
  }, [handleDataUpdate]);

  // *** MAJOR CHANGE: This useEffect hook synchronizes the DOM markers with the React state ***
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;

    const currentMarkers = markersRef.current;
    const pubsOnMap = Object.keys(currentMarkers).map(Number);
    const pubsInState = allPubs.map(p => p.id);

    // 1. Remove markers that are no longer in the state
    pubsOnMap.forEach(pubId => {
      if (!pubsInState.includes(pubId)) {
        currentMarkers[pubId].remove();
        delete currentMarkers[pubId];
      }
    });

    // 2. Create or Update markers for each pub
    allPubs.forEach(pub => {
      const { id, geom, is_visited } = pub;
      const match = geom.match(/POINT\s*\(([^)]+)\)/);
      if (!match?.[1]) return;
      const coords = match[1].trim().split(/\s+/).map(Number);
      if (coords.length !== 2) return;

      if (currentMarkers[id]) {
        // Marker exists, just update its classes
        const el = currentMarkers[id].getElement();
        el.className = 'pub-marker'; // reset
        if (is_visited) el.classList.add('visited');
        else el.classList.add('unvisited');

        if (selectedPub && selectedPub.id !== id) el.classList.add('marker-fade');
        if (id === selectedPub?.id) el.classList.add('selected');
        if (id === hoveredPubId) el.classList.add('hover');

      } else {
        // Marker doesn't exist, create it
        const el = document.createElement('div');
        el.innerHTML = pintGlassSVGString;
        
        // Add event listeners
        el.addEventListener('click', (e) => { e.stopPropagation(); handlePubClick(pub); });
        el.addEventListener('mouseenter', () => handlePubMouseEnter(pub));
        el.addEventListener('mouseleave', () => handlePubMouseLeave());
        
        const newMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(coords)
          .addTo(map.current);
        
        currentMarkers[id] = newMarker;
      }
    });

  }, [allPubs, selectedPub, hoveredPubId, handlePubClick, handlePubMouseEnter, handlePubMouseLeave]);


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