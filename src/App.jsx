// src/App.jsx
import { useState, useCallback, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { supabase } from './supabaseClient';
import { usePubs } from './hooks/usePubs';
import { useMap } from './hooks/useMap';

import './App.css';
import Notification from './Notification';
import PubList from './components/PubList';
import PubDetailView from './components/PubDetailView';
import SearchFilter from './components/SearchFilter';
import ProgressBar from './components/ProgressBar';
import CrawlSummary from './components/CrawlSummary';

function App() {
  const { pubs: allPubs, isLoading, setPubs, refetchPubs } = usePubs();

  const [selectedPubId, setSelectedPubId] = useState(null);
  const [hoveredPubId, setHoveredPubId] = useState(null);
  const [crawlRoute, setCrawlRoute] = useState(null);
  const [crawlPubIds, setCrawlPubIds] = useState([]);
  const [crawlSummary, setCrawlSummary] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: 'info' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  const selectedPub = useMemo(() => allPubs.find(p => p.id === selectedPubId) || null, [allPubs, selectedPubId]);
  
  const { mapContainer } = useMap({
    allPubs,
    selectedPub,
    hoveredPubId,
    crawlPubIds,
    crawlRoute,
    onSelectPubById: setSelectedPubId,
    onHoverPubById: setHoveredPubId
  });

  const clearCrawl = useCallback(() => {
    setCrawlRoute(null);
    setCrawlPubIds([]);
    setCrawlSummary(null);
  }, []);

  const handleClearCrawlAndSelection = useCallback(() => {
    clearCrawl();
    setSelectedPubId(null);
    setNotification({message: 'Crawl cleared.', type: 'info'});
  }, [clearCrawl]);

  useEffect(() => {
    // If a pub is selected that is not part of the current crawl, clear the crawl.
    if(selectedPubId && crawlPubIds.length > 0 && !crawlPubIds.includes(selectedPubId)) {
        clearCrawl();
    }
  }, [selectedPubId, crawlPubIds, clearCrawl]);

  const handleGenerateCrawl = async (pub) => {
    setIsProcessing(true);
    const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
    if (!match?.[1]) { setNotification({ message: 'Pub location is invalid.', type: 'error' }); return; }
    const coords = match[1].trim().split(/\s+/).map(Number);
    try {
      const response = await fetch(`/api/generate-crawl?lng=${coords[0]}&lat=${coords[1]}&start_pub_id=${pub.id}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Failed to generate crawl.');
      
      setCrawlRoute(data.route);
      setCrawlPubIds(data.pubIds);
      const summaryPubs = data.pubIds.map(id => allPubs.find(p => p.id === id)).filter(Boolean);
      setCrawlSummary({ pubs: summaryPubs, duration: data.totalDuration });
      setNotification({ message: 'Crawl found!', type: 'success' });
    } catch (err) {
      setNotification({ message: `Error: ${err.message}`, type: 'error' });
      clearCrawl();
    } finally { setIsProcessing(false); }
  };
  
  const handleDataUpdate = async (pubIdToSelect = null) => {
      const { data, error } = await refetchPubs();
      if (!error && pubIdToSelect && data) {
        setSelectedPubId(data.find(p => p.id === pubIdToSelect) ? pubIdToSelect : null);
      }
  };
  
  const handleLogVisit = async (pubId, options = {}) => {
    const { navigateOnSuccess = true } = options;
    setIsProcessing(true);
    const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() });
    const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub';
    if (error) setNotification({ message: `Error logging visit: ${error.message}`, type: 'error' });
    else {
      await handleDataUpdate(navigateOnSuccess ? pubId : null);
      setNotification({ message: `Visit logged for ${pubName}!`, type: 'success' });
    }
    setIsProcessing(false);
  };

  const handleRemoveVisit = async (pubId, visitId, options = {}) => {
    const { navigateOnSuccess = true } = options;
    setIsProcessing(true);
    const { error } = await supabase.from('visits').delete().eq('id', visitId);
    const pubName = allPubs.find(p => p.id === pubId)?.name || 'that pub';
    if (error) setNotification({ message: `Error removing visit: ${error.message}`, type: 'error' });
    else {
      await handleDataUpdate(navigateOnSuccess ? pubId : null);
      setNotification({ message: `Last visit removed for ${pubName}.`, type: 'success' });
    }
    setIsProcessing(false);
  };
  
  const handleMarkCrawlVisited = async () => {
    if (!crawlPubIds || crawlPubIds.length === 0) return;
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
  
  const visitedCount = useMemo(() => allPubs.filter(p => p.is_visited).length, [allPubs]);
  const filteredPubs = useMemo(() => {
    return allPubs.filter(pub => {
      const matchesSearch = pub.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (filter === 'visited') return matchesSearch && pub.is_visited;
      if (filter === 'unvisited') return matchesSearch && !pub.is_visited;
      return matchesSearch;
    }).sort((a, b) => a.name.localeCompare(b.name));
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
                  key={selectedPub.id} pub={selectedPub} onBack={() => setSelectedPubId(null)}
                  onToggleVisit={handleLogVisit} onRemoveVisit={handleRemoveVisit}
                  onGenerateCrawl={handleGenerateCrawl} isToggling={isProcessing}
                  isCrawlOrigin={crawlPubIds[0] === selectedPub.id} onClearCrawl={handleClearCrawlAndSelection}
                />
              ) : (
                <motion.div key="list">
                  <h2 className="sidebar-header">Exeter Pubs ({filteredPubs.length})</h2>
                  <PubList pubs={filteredPubs}
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