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
  const popupRef = useRef(null);
  const allPubsRef = useRef([]);

  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);

  const handleDataUpdate = useCallback(async (currentSelectedId = null, selectAfter = false) => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) {
      setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' });
      return;
    }
    const pubData = data.map(pub => ({ ...pub, geom: pub.geom || '' }));
    allPubsRef.current = pubData;
    setAllPubs(pubData);
    if (selectAfter && currentSelectedId) {
      setSelectedPub(pubData.find(p => p.id === currentSelectedId) || null);
    }
  }, []);

  // One-time map setup
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
      center: [-3.53, 50.72],
      zoom: 12,
      antialias: true
    });

    map.current.on('load', async () => {
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      
      map.current.addLayer({
        id: 'pubs-layer',
        type: 'circle',
        source: 'pubs-source',
        paint: {
          'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'],
          'circle-radius': ['case', 
            ['boolean', ['feature-state', 'hovered'], false], 11, 
            ['boolean', ['feature-state', 'selected'], false], 10, 
            7
          ],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['case', 
            ['boolean', ['feature-state', 'selected'], false], '#0d6efd',
            '#FFFFFF'
          ],
          'circle-opacity': 1.0,
          'circle-stroke-opacity': 1.0,
        }
      });
      
      map.current.addLayer({
        id: 'pub-labels-zoomed', type: 'symbol', source: 'pubs-source', minzoom: 14,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': [0, 1.25], 'text-anchor': 'top' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5, 'text-halo-blur': 1 }
      });

      map.current.on('mouseenter', 'pubs-layer', (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) setHoveredPubId(e.features[0].id);
      });
      map.current.on('mouseleave', 'pubs-layer', () => {
        map.current.getCanvas().style.cursor = '';
        setHoveredPubId(null);
      });
      map.current.on('click', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
          const pub = allPubsRef.current.find(p => p.id === e.features[0].id);
          if (pub) setSelectedPub(pub);
        }
      });

      setIsLoading(true);
      await handleDataUpdate();
      setIsLoading(false);
    });

    return () => {
        map.current?.remove();
        map.current = null;
    }
  }, [handleDataUpdate]);

  // Update map source data when pubs change
  useEffect(() => {
    if (!map.current?.isStyleLoaded() || !map.current.getSource('pubs-source')) return;
    
    const features = allPubs.map(p => {
        if (!p || typeof p.geom !== 'string' || p.id == null) return null;
        const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        if (isNaN(lon) || isNaN(lat)) return null;
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited } };
    }).filter(Boolean);
    
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);

  const lastSelectedId = useRef(null);
  const lastHoveredId = useRef(null);

  // Sync map state (selection, hover, popup) with React state
  useEffect(() => {
      if (!map.current?.isStyleLoaded()) return;

      // Deselect previous feature
      if (lastSelectedId.current && lastSelectedId.current !== selectedPub?.id) {
          map.current.setFeatureState({ source: 'pubs-source', id: lastSelectedId.current }, { selected: false });
      }
      // Unhover previous feature
      if (lastHoveredId.current && lastHoveredId.current !== hoveredPubId) {
          map.current.setFeatureState({ source: 'pubs-source', id: lastHoveredId.current }, { hovered: false });
      }

      // Handle hover
      if (hoveredPubId) {
          map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hovered: true });
      }

      // Handle selection and fly-to
      if (selectedPub) {
          map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
          const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
          if (match?.[1] && selectedPub.id !== lastSelectedId.current) {
              const coords = match[1].trim().split(/\s+/).map(Number);
              if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                  map.current.flyTo({ center: coords, zoom: 15 });
              }
          }
      }
      
      // Update popup
      popupRef.current?.remove();
      const pubForPopup = allPubsRef.current.find(p => p.id === hoveredPubId);
      if(pubForPopup) {
          const match = pubForPopup.geom.match(/POINT\s*\(([^)]+)\)/);
          if (!match?.[1]) return;
          const coords = match[1].trim().split(/\s+/).map(Number);
          if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
              popupRef.current.setLngLat(coords)
                  .setHTML(`<strong>${pubForPopup.name}</strong>`)
                  .addClassName(pubForPopup.is_visited ? 'visited-popup' : 'unvisited-popup')
                  .removeClassName(pubForPopup.is_visited ? 'unvisited-popup' : 'visited-popup')
                  .addTo(map.current);
          }
      }
      
      lastSelectedId.current = selectedPub?.id;
      lastHoveredId.current = hoveredPubId;
  }, [selectedPub, hoveredPubId]);

  const clearCrawlRoute = useCallback(() => {
    if (map.current?.getLayer('crawl-route')) {
      map.current.removeLayer('crawl-route');
      map.current.removeSource('crawl-route');
    }
    setCrawlPubIds([]);
    setCrawlSummary(null);
  }, []);

  const handleClearCrawlAndSelection = useCallback(() => {
    clearCrawlRoute();
    setSelectedPub(null);
    setNotification({message: 'Crawl cleared.', type: 'info'});
  }, [clearCrawlRoute]);
  
  // Handle crawl state changes
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;

    const crawlInProgress = crawlPubIds.length > 0;
    const opacityExpression = crawlInProgress 
      ? ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.4] 
      : 1.0;
    const strokeOpacityExpression = crawlInProgress 
      ? ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.4] 
      : 1.0;

    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
    map.current.setPaintProperty('pubs-layer', 'circle-stroke-opacity', strokeOpacityExpression);
  }, [crawlPubIds]);


  const handleGenerateCrawl = async (pub) => {
    setIsTogglingVisit(true); // Re-use for loading state
    const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) { setNotification({message: 'Pub location is invalid.', type: 'error'}); return; }
    const coords = match[1].trim().split(/\s+/).map(Number);
    try {
        const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${pub.id}`);
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
        if(map.current?.getLayer('crawl-route')) clearCrawlRoute();
        map.current.addSource('crawl-route', { type: 'geojson', data: data.route });
        map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
        setCrawlPubIds(data.pubIds);
        const summaryPubs = data.pubIds.map(id => allPubsRef.current.find(p => p.id === id)).filter(Boolean); setCrawlSummary({ pubs: summaryPubs, duration: data.totalDuration });
        setNotification({ message: `Crawl found!`, type: 'success' });
    } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' });
    } finally { setIsTogglingVisit(false); }
  };
  
  const handleLogVisit = async (pubId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleRemoveVisit = async (pubId, visitId, options = {}) => { const { navigateOnSuccess = true } = options; setIsTogglingVisit(true); const { error } = await supabase.from('visits').delete().eq('id', visitId); const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub'; if (error) { setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' }); } else { await handleDataUpdate(pubId, navigateOnSuccess); setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' }); } setIsTogglingVisit(false); };
  const handleMarkCrawlVisited = async () => { if (!crawlPubIds || crawlPubIds.length === 0) return; setIsTogglingVisit(true); const visitsToInsert = crawlPubIds.map(id => ({ pub_id: id, visit_date: new Date().toISOString(), })); const { error } = await supabase.from('visits').insert(visitsToInsert); if (error) { setNotification({ message: `Error saving crawl visits: ${error.message}`, type: 'error' }); } else { setNotification({ message: 'Crawl completed and saved!', type: 'success' }); await handleDataUpdate(); handleClearCrawlAndSelection(); } setIsTogglingVisit(false); };

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
                <PubDetailView
                  key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPub(null) }
                  onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit}
                  onGenerateCrawl={handleGenerateCrawl} isToggling={isTogglingVisit}
                  isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={handleClearCrawlAndSelection}
                />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList 
                    pubs={filteredPubs} 
                    onSelectPub={setSelectedPub} 
                    onLogVisit={handleLogVisit} 
                    onRemoveVisit={handleRemoveVisit} 
                    isTogglingVisit={isTogglingVisit} 
                    onMouseEnter={(pub) => setHoveredPubId(pub.id)} 
                    onMouseLeave={() => setHoveredPubId(null)} 
                    hoveredPubId={hoveredPubId}
                    selectedPubId={selectedPub?.id} 
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
        <AnimatePresence>
          {crawlSummary && (<CrawlSummary crawlData={crawlSummary} onClose={handleClearCrawlAndSelection} onMarkAllVisited={handleMarkCrawlVisited} isProcessing={isTogglingVisit} />)}
        </AnimatePresence>
        <ProgressBar visitedCount={visitedCount} totalCount={allPubs.length} />
      </div>
    </>
  );
}

export default App;