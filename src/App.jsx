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
  // --- STATE MANAGEMENT ---
  const [allPubs, setAllPubs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPubId, setSelectedPubId] = useState(null);
  const [hoveredPubId, setHoveredPubId] = useState(null);
  
  const [crawlRoute, setCrawlRoute] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  // --- REFS FOR IMPERATIVE MAP LOGIC ---
  const mapContainer = useRef(null);
  const map = useRef(null);
  const popup = useRef(null);
  const lastSelectedId = useRef(null);
  const lastHoveredId = useRef(null);
  
  // --- DERIVED STATE ---
  const selectedPub = useMemo(() => allPubs.find(p => p.id === selectedPubId), [allPubs, selectedPubId]);
  
  // --- DATA FETCHING & EVENT HANDLERS ---
  const refetchPubs = useCallback(async (selectIdAfterFetch = null) => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) {
      setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' });
    } else if (data) {
      setAllPubs(data.map(p => ({ ...p, geom: p.geom || '' })));
      if (selectIdAfterFetch) {
        setSelectedPubId(selectIdAfterFetch);
      }
    }
  }, []);

  const clearCrawl = useCallback(() => {
    setCrawlRoute(null);
    setCrawlPubIds([]);
    setCrawlSummary(null);
  }, []);

  const handleClearCrawlAndSelection = useCallback(() => {
    clearCrawl();
    setSelectedPubId(null);
    setNotification({ message: 'Crawl cleared.', type: 'info' });
  }, [clearCrawl]);

  // --- CORE MAP LOGIC: EFFECTS ---

  // Effect 1: Initialize map instance (runs only ONCE)
  useEffect(() => {
    if (map.current) return; // Initialize map only once

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
      center: [-3.53, 50.72],
      zoom: 12,
      antialias: true,
    });

    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });

    map.current.on('load', () => {
      // Add sources and layers for pubs
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({
          id: 'pubs-layer', type: 'circle', source: 'pubs-source',
          paint: {
              'circle-radius': ['case', ['boolean', ['feature-state', 'hovered'], false], 11, ['boolean', ['feature-state', 'selected'], false], 10, 7],
              'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#FFFFFF'],
              // Add transitions for smooth animations
              'circle-radius-transition': { duration: 200 },
              'circle-opacity-transition': { duration: 300 },
              'circle-stroke-opacity-transition': { duration: 300 }
          }
      });
      map.current.addLayer({
          id: 'pub-labels-zoomed', type: 'symbol', source: 'pubs-source', minzoom: 14,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': [0, 1.25], 'text-anchor': 'top' },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5, 'text-halo-blur': 1 }
      });
      
      // Define map event listeners that only set React state
      map.current.on('click', 'pubs-layer', e => e.features.length > 0 && setSelectedPubId(e.features[0].id));
      map.current.on('mouseenter', 'pubs-layer', e => { if (e.features.length > 0) { map.current.getCanvas().style.cursor = 'pointer'; setHoveredPubId(e.features[0].id); } });
      map.current.on('mouseleave', 'pubs-layer', () => { map.current.getCanvas().style.cursor = ''; setHoveredPubId(null); });
      
      // Fetch initial data now that map is ready
      setIsLoading(true);
      refetchPubs().finally(() => setIsLoading(false));
    });
    
    // Cleanup on unmount
    return () => map.current.remove();
  }, [refetchPubs]);

  // Effect 2: Sync allPubs data to map source
  useEffect(() => {
    if (!map.current?.isStyleLoaded() || !map.current.getSource('pubs-source')) return;

    const features = allPubs.map(p => {
        const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited }};
    }).filter(Boolean);
    
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);

  // Effect 3: The "Reactor". Syncs hover, select, popup, and fly-to from state changes.
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;

    // Clear previous state
    if (lastHoveredId.current) map.current.setFeatureState({ source: 'pubs-source', id: lastHoveredId.current }, { hovered: false });
    if (lastSelectedId.current) map.current.setFeatureState({ source: 'pubs-source', id: lastSelectedId.current }, { selected: false });
    popup.current.remove();

    // Apply new hover state
    if (hoveredPubId) {
        map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hovered: true });
        const pub = allPubs.find(p => p.id === hoveredPubId);
        if (pub) {
            const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
            if(match?.[1]) {
              const coords = match[1].trim().split(/\s+/).map(Number);
              popup.current.setLngLat(coords).setHTML(`<strong>${pub.name}</strong>`).addClassName(pub.is_visited ? 'visited-popup' : 'unvisited-popup').removeClassName(pub.is_visited ? 'unvisited-popup' : 'visited-popup').addTo(map.current);
            }
        }
    }

    // Apply new selected state
    if (selectedPub) {
        map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
        // Fly to the pub only if the selection changes
        if (selectedPub.id !== lastSelectedId.current) {
          const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
          if (match?.[1]) {
            const coords = match[1].trim().split(/\s+/).map(Number);
            map.current.flyTo({ center: coords, zoom: 15, duration: 1200 });
          }
        }
    }
    
    // Update refs for next render
    lastHoveredId.current = hoveredPubId;
    lastSelectedId.current = selectedPubId;
  }, [hoveredPubId, selectedPub, selectedPubId, allPubs]);

  // Effect 4: Manages crawl route visibility on the map
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const source = map.current.getSource('crawl-route');
    if (crawlRoute) {
        if (source) source.setData(crawlRoute);
        else {
            map.current.addSource('crawl-route', { type: 'geojson', data: crawlRoute });
            map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0d6efd', 'line-width': 5 } }, 'pubs-layer');
        }
    } else {
        if (source) {
            map.current.removeLayer('crawl-route');
            map.current.removeSource('crawl-route');
        }
    }
  }, [crawlRoute]);
  
  // Effect 5: Manages pub pin opacity for focus effect on hover and crawl
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;

    let opacityExpression;

    if (crawlPubIds.length > 0) {
      // If a crawl is active, only show crawl pubs
      opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.3];
    } else if (hoveredPubId !== null) {
      // If hovering, show the hovered and selected pub, dim others
      const visibleIds = [hoveredPubId];
      if (selectedPubId) visibleIds.push(selectedPubId);
      opacityExpression = ['case', ['in', ['id'], ['literal', visibleIds]], 1.0, 0.3];
    } else {
      // No interaction, all pubs fully visible
      opacityExpression = 1.0;
    }
      
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
    map.current.setPaintProperty('pubs-layer', 'circle-stroke-opacity', opacityExpression);
      
  }, [crawlPubIds, hoveredPubId, selectedPubId]);


  useEffect(() => {
    if(selectedPubId && crawlPubIds.length > 0 && !crawlPubIds.includes(selectedPubId)) {
        clearCrawl();
    }
  }, [selectedPubId, crawlPubIds, clearCrawl]);

  // --- BUSINESS LOGIC HANDLERS ---
  const handleGenerateCrawl = async (pub) => {
    setIsProcessing(true);
    clearCrawl();
    const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) {
      setNotification({ message: 'Pub location is invalid.', type: 'error' });
      setIsProcessing(false);
      return;
    }
    const coords = match[1].trim().split(/\s+/).map(Number);
    try {
      const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${pub.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
      
      setCrawlRoute(data.route);
      setCrawlPubIds(data.pubIds);
      const summaryPubs = data.pubIds.map(id => allPubs.find(p => p.id === id)).filter(Boolean);
      setCrawlSummary({ pubs: summaryPubs, duration: data.totalDuration });
      setNotification({ message: 'Crawl found!', type: 'success' });
    } catch (err) {
      setNotification({ message: `Error: ${err.message}`, type: 'error' });
      clearCrawl();
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleLogVisit = async (pubId, options = {}) => {
    setIsProcessing(true);
    const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() });
    const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub';
    if (error) setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' });
    else {
      await refetchPubs(options.navigateOnSuccess ? pubId : null);
      setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' });
    }
    setIsProcessing(false);
  };

  const handleRemoveVisit = async (pubId, visitId, options = {}) => {
    setIsProcessing(true);
    const { error } = await supabase.from('visits').delete().eq('id', visitId);
    const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub';
    if (error) setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' });
    else {
      await refetchPubs(options.navigateOnSuccess ? pubId : null);
      setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' });
    }
    setIsProcessing(false);
  };
  
  const handleMarkCrawlVisited = async () => {
    if (!crawlPubIds?.length) return;
    setIsProcessing(true);
    const visitsToInsert = crawlPubIds.map(id => ({ pub_id: id, visit_date: new Date().toISOString() }));
    const { error } = await supabase.from('visits').insert(visitsToInsert);
    if (error) setNotification({ message: `Error saving crawl visits: ${error.message}`, type: 'error' });
    else {
      setNotification({ message: 'Crawl completed and saved!', type: 'success' });
      await refetchPubs();
      handleClearCrawlAndSelection();
    }
    setIsProcessing(false);
  };

  const filteredPubs = useMemo(() => {
    return allPubs.filter(pub => {
      const matchesSearch = pub.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (filter === 'visited') return matchesSearch && pub.is_visited;
      if (filter === 'unvisited') return matchesSearch && !pub.is_visited;
      return matchesSearch;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [allPubs, searchTerm, filter]);

  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);

  // --- RENDER ---
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
                <PubDetailView
                  key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPubId(null)}
                  onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit}
                  onGenerateCrawl={handleGenerateCrawl} isToggling={isProcessing}
                  isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={handleClearCrawlAndSelection}
                />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList
                    pubs={filteredPubs}
                    onSelectPub={(pub) => setSelectedPubId(pub.id)}
                    onLogVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit} isTogglingVisit={isProcessing}
                    onMouseEnter={(pub) => setHoveredPubId(pub.id)} onMouseLeave={() => setHoveredPubId(null)}
                    hoveredPubId={hoveredPubId} selectedPubId={selectedPubId}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <AnimatePresence>
          {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={handleClearCrawlAndSelection} onMarkAllVisited={handleMarkCrawlVisited} isProcessing={isProcessing} />)}
        </AnimatePresence>
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
      </div>
    </>
  );
}

export default App;