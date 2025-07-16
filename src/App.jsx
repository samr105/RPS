// src/App.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { supabase } from './supabaseClient';
import { AnimatePresence, motion } from 'framer-motion'; // Added `motion` to this import

import Notification from './Notification';
import PubList from './components/PubList';
import PubDetailView from './components/PubDetailView';
import SearchFilter from './components/SearchFilter';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [isTogglingVisit, setIsTogglingVisit] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  
  // State for search and filter
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  const fetchAllPubData = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_all_pub_details');
    if (error) {
        setNotification({ message: `Error loading pubs: ${error.message}`, type: 'error' });
        return [];
    }
    const pubData = data.map(pub => ({...pub, geom: pub.geom || 'SRID=4326;POINT (0 0)'}));
    setAllPubs(pubData);
    return pubData;
  }, []);

  useEffect(() => {
    if (map.current) return;
    const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
    map.current = new maplibregl.Map({ container: mapContainer.current, style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`, center: [-3.53, 50.72], zoom: 12, antialias: true });

    map.current.on('load', async () => {
      map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      map.current.addLayer({ id: 'pubs-layer', type: 'circle', source: 'pubs-source', paint: { 'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'], 'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7], 'circle-stroke-color': '#0d6efd', 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0] }});

      map.current.on('click', 'pubs-layer', (e) => {
        if (e.features.length > 0) {
            const pubId = e.features[0].id;
            const pub = allPubs.find(p => p.id === pubId);
            if(pub) setSelectedPub(pub);
        }
      });

      setIsLoading(true);
      const initialPubs = await fetchAllPubData();
      updateMapDataSource(initialPubs);
      setIsLoading(false);
    });
    // eslint-disable-next-line
  }, [fetchAllPubData]);
  
  const updateMapDataSource = (pubs) => {
    const features = pubs.map(p => {
        if (!p.geom.includes('POINT')) return null;
        const coords = p.geom.replace('SRID=4326;POINT (', '').replace(')', '').split(' ');
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [parseFloat(coords[0]), parseFloat(coords[1])] }, properties: { name: p.name, is_visited: p.is_visited } };
    }).filter(Boolean);
    const source = map.current.getSource('pubs-source');
    if (source) source.setData({ type: 'FeatureCollection', features });
  };
  
  useEffect(() => {
    updateMapDataSource(allPubs);
    // Logic for selected pub marker
    if (map.current?.isStyleLoaded()) {
        allPubs.forEach(p => map.current.setFeatureState({ source: 'pubs-source', id: p.id }, { selected: false }));
        if(selectedPub) {
            map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
            const coords = selectedPub.geom.replace('SRID=4326;POINT (', '').replace(')', '').split(' ');
            map.current.flyTo({ center: [parseFloat(coords[0]), parseFloat(coords[1])], zoom: 15 });
        }
    }
  }, [selectedPub, allPubs]);

  // Handle adding a new visit
  const handleToggleVisit = async (pubId) => {
    setIsTogglingVisit(true);
    const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() });
    if (error) {
        setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' });
    } else {
        const freshData = await fetchAllPubData();
        setNotification({ message: 'Visit logged successfully!', type: 'success' });
        // Manually update the selectedPub to refresh detail view immediately
        setSelectedPub(prev => {
          const updatedPub = freshData.find(p => p.id === prev.id);
          return updatedPub || null;
        });
    }
    setIsTogglingVisit(false);
  };
  
  // Handle removing the latest visit
  const handleRemoveVisit = async (visitId) => {
    setIsTogglingVisit(true);
    const { error } = await supabase.from('visits').delete().eq('id', visitId);
    if (error) {
        setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' });
    } else {
        const freshData = await fetchAllPubData();
        setNotification({ message: 'Last visit removed.', type: 'success' });
        setSelectedPub(prev => {
          const updatedPub = freshData.find(p => p.id === prev.id);
          return updatedPub || null;
        });
    }
    setIsTogglingVisit(false);
  };
  
  // Memoized filtered pubs for performance
  const filteredPubs = useMemo(() => {
    return allPubs
        .filter(pub => {
            const matchesSearch = pub.name.toLowerCase().includes(searchTerm.toLowerCase());
            if (filter === 'visited') return matchesSearch && pub.is_visited;
            if (filter === 'unvisited') return matchesSearch && !pub.is_visited;
            return matchesSearch;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPubs, searchTerm, filter]);

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
                  key={selectedPub.id}
                  pub={selectedPub}
                  onBack={() => setSelectedPub(null)}
                  onToggleVisit={handleToggleVisit}
                  onRemoveVisit={handleRemoveVisit}
                  onGenerateCrawl={() => {/* To be implemented */}}
                  isToggling={isTogglingVisit}
                />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs} onSelectPub={setSelectedPub} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
        <div ref={mapContainer} className="map-container" />
      </div>
    </>
  );
}

export default App;