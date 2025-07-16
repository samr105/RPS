import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';
import Notification from './Notification';

// This is the entire app component, refactored for the new, simplified model.
function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const allPubsRef = useRef([]);
  const previousSelectedPubId = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [hoveredPubId, setHoveredPubId] = useState(null);

  // Initialize map and listeners once.
  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({ id: 'pubs-layer', type: 'circle', source: 'pubs-source', paint: { 'circle-color': ['case', ['get', 'is_visited'], '#2f855a', '#c53030'], 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, ['boolean', ['feature-state', 'selected'], false], 9, 7], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#007bff', 'white'], 'circle-stroke-width': 2.5, 'circle-opacity-transition': { duration: 300 }, 'circle-radius-transition': { duration: 200 } } });
      map.current.addLayer({ id: 'pub-labels', type: 'symbol', source: 'pubs-source', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': ['case', ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]], 1.0, 0.0], 'text-opacity-transition': { duration: 200 } } });
      let currentHoverId = null;
      map.current.on('mousemove', 'pubs-layer', (e) => { if (e.features.length > 0) { map.current.getCanvas().style.cursor = 'pointer'; const newHoverId = e.features[0].id; if (newHoverId !== currentHoverId) { if (currentHoverId != null) map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false }); if (newHoverId != null) map.current.setFeatureState({ source: 'pubs-source', id: newHoverId }, { hover: true }); setHoveredPubId(newHoverId); currentHoverId = newHoverId; } } });
      map.current.on('mouseleave', 'pubs-layer', () => { map.current.getCanvas().style.cursor = ''; if (currentHoverId != null) { map.current.setFeatureState({ source: 'pubs-source', id: currentHoverId }, { hover: false }); setHoveredPubId(null); currentHoverId = null; } });
      map.current.on('click', 'pubs-layer', (e) => { if (e.features.length > 0 && e.features[0].id != null) { const pubData = allPubsRef.current.find(p => p.id === e.features[0].id); if (pubData) setSelectedPub(pubData); } });

      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_all_pub_details');
      setIsLoading(false);
      if (error) { setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' }); return; }
      const pubData = data.map(pub => ({ ...pub, is_visited: !!pub.last_visit_date, last_visit_date: pub.last_visit_date }));
      setAllPubs(pubData);
      allPubsRef.current = pubData;
      const pubsForMap = pubData.map(p => { if (!p.geom) return null; try { const [lng, lat] = p.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number); return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: p.name, is_visited: p.is_visited } }; } catch (e) { return null; } }).filter(i => i);
      map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to handle the visual state of the *selected* pub
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    if (previousSelectedPubId.current != null) map.current.setFeatureState({ source: 'pubs-source', id: previousSelectedPubId.current }, { selected: false });
    if (selectedPub !== null) {
      map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
      const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number);
      map.current.flyTo({ center: [lng, lat], zoom: 15, essential: true });
    }
    previousSelectedPubId.current = selectedPub ? selectedPub.id : null;
  }, [selectedPub]);

  // Effect to control map-wide dimming
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !map.current.getLayer('pubs-layer')) return;
    let opacityExpression;
    if (hoveredPubId != null) { opacityExpression = ['case', ['!=', ['id'], hoveredPubId], 0.3, 1.0]; }
    else if (crawlPubIds.length > 0) { opacityExpression = ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.3]; }
    else { opacityExpression = 1.0; }
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
  }, [hoveredPubId, crawlPubIds]);
  
  const updateMapDataSource = useCallback((updatedPubsData) => {
    allPubsRef.current = updatedPubsData;
    const pubsForMap = updatedPubsData.map(p => {
        if (!p.geom) return null;
        try {
            const [lng, lat] = p.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number);
            return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: p.name, is_visited: p.is_visited } };
        } catch (e) { return null; }
    }).filter(i => i);
    if(map.current.getSource('pubs-source')) {
      map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features: pubsForMap });
    }
  }, []);

  const handleToggleVisitStatus = async () => {
    if (!selectedPub) return;
    setIsTogglingVisit(true);

    let error;
    if (selectedPub.is_visited) {
        // UNVISIT: Delete all visits for this pub.
        ({ error } = await supabase.from('visits').delete().eq('pub_id', selectedPub.id));
    } else {
        // VISIT: Add a single visit record.
        ({ error } = await supabase.from('visits').insert({ pub_id: selectedPub.id, visit_date: new Date().toISOString() }));
    }

    if (error) {
        setNotification({ message: `Error updating status: ${error.message}`, type: 'error' });
    } else {
        const newVisitStatus = !selectedPub.is_visited;
        const newVisitDate = newVisitStatus ? new Date().toISOString() : null;
        const updatedPubs = allPubs.map(p => p.id === selectedPub.id ? { ...p, is_visited: newVisitStatus, last_visit_date: newVisitDate } : p);
        setAllPubs(updatedPubs);
        setSelectedPub(prev => ({...prev, is_visited: newVisitStatus, last_visit_date: newVisitDate}));
        updateMapDataSource(updatedPubs);
        setNotification({ message: `Pub status updated to ${newVisitStatus ? 'Visited' : 'Not Visited'}!`, type: 'success' });
    }
    setIsTogglingVisit(false);
  };

  const clearCrawlRoute = useCallback(() => { setCrawlPubIds([]); if (map.current?.getLayer('crawl-route')) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); } }, []);
  const handleBackToList = () => { clearCrawlRoute(); setSelectedPub(null); };
  const handleSelectPubFromList = (pub) => { clearCrawlRoute(); setSelectedPub(pub); };

  const handleGenerateCrawl = async (event) => { const button = event.target; button.innerText = 'Calculating...'; button.disabled = true; const { lng, lat, pubid } = button.dataset; try { const response = await fetch(`/api/generate-crawl?lng=${lng}&lat=${lat}&start_pub_id=${pubid}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); clearCrawlRoute(); map.current.addSource('crawl-route', { type: 'geojson', data: data.route }); map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', paint: { 'line-color': '#2563eb', 'line-width': 5 } }); setCrawlPubIds(data.pubIds); setNotification({ message: `Crawl found! Walking time: ${Math.round(data.totalDuration / 60)} minutes.`, type: 'success' }); } catch (err) { setNotification({ message: `Error: ${err.message}`, type: 'error' }); } finally { button.innerText = 'Generate Mini-Crawl'; button.disabled = false; } };
  
  // Renders the new, simplified, and styled view for a selected pub.
  const renderSelectedPub = () => {
    if (!selectedPub) return null;
    const [lng, lat] = selectedPub.geom.replace('POINT(', '').replace(')', '').split(' ').map(Number);
    const visitDate = selectedPub.is_visited && selectedPub.last_visit_date 
      ? `Last visited: ${new Date(selectedPub.last_visit_date).toLocaleDateString()}` 
      : 'Not visited yet.';

    return (
      <div className="selected-pub-details">
        <button className="back-button" onClick={handleBackToList}>← All Pubs</button>
        <div className="selected-pub-header">
          <h3>{selectedPub.name}</h3>
          <p>{selectedPub.address || 'Address not available'}</p>
        </div>

        <div className="action-buttons">
          <button 
            className={`action-button ${selectedPub.is_visited ? 'visited-btn' : 'unvisited-btn'}`}
            onClick={handleToggleVisitStatus}
            disabled={isTogglingVisit}
          >
            {isTogglingVisit ? 'Updating...' : (selectedPub.is_visited ? 'Mark as Unvisited' : 'Mark as Visited')}
          </button>
          
          {!selectedPub.is_visited && (
            <button 
              className="action-button generate-crawl-btn" 
              data-lng={lng} 
              data-lat={lat} 
              data-pubid={selectedPub.id} 
              onClick={handleGenerateCrawl}
            >
              Generate Mini-Crawl
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderPubList = () => (
    <>
      <h2 className="sidebar-header">Exeter Pubs</h2>
      <ul className="pub-list">
        {allPubs.sort((a, b) => a.name.localeCompare(b.name)).map(pub => (
          <li key={pub.id} className="pub-list-item" onClick={() => handleSelectPubFromList(pub)}>
            <strong>{pub.name}</strong>
            <span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      <div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>Loading Map...</div>
      <div className="app-container">
        <Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '', type: 'info' })} />
        <aside className="sidebar">
          {selectedPub ? renderSelectedPub() : renderPubList()}
        </aside>
        <div ref={mapContainer} className="map-container" />
      </div>
    </>
  );
}

export default App;