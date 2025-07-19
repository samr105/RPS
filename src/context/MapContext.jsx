// src/context/MapContext.jsx
import React, { createContext, useState, useContext, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const MapContext = createContext();

export const useMapContext = () => useContext(MapContext);

export const MapProvider = ({ children }) => {
    // --- STATE ---
    const [pubs, setPubs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    const [selectedPubId, setSelectedPubId] = useState(null);
    const [hoveredPubId, setHoveredPubId] = useState(null);
    
    const [crawl, setCrawl] = useState(null); // { route: GeoJSON, pubIds: [], duration: 0 }
    const [notification, setNotification] = useState({ message: '', type: 'info' });

    // --- DERIVED STATE ---
    const selectedPub = useMemo(() => pubs.find(p => p.id === selectedPubId), [pubs, selectedPubId]);
    const crawlPubs = useMemo(() => {
        if (!crawl) return [];
        return crawl.pubIds.map(id => pubs.find(p => p.id === id)).filter(Boolean);
    }, [crawl, pubs]);
    const visitedCount = useMemo(() => pubs.filter(p => p.is_visited).length, [pubs]);

    // --- DATA FETCHING ---
    const fetchPubs = useCallback(async (selectIdAfter = null) => {
        setIsLoading(true);
        const { data, error } = await supabase.rpc('get_all_pub_details');
        if (error) {
            setNotification({ message: `Error fetching pubs: ${error.message}`, type: 'error' });
        } else {
            setPubs(data.map(p => ({ ...p, geom: p.geom || '' })));
            if(selectIdAfter) setSelectedPubId(selectIdAfter);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchPubs();
    }, [fetchPubs]);
    
    // --- CORE ACTIONS ---
    const clearCrawl = useCallback(() => {
        setCrawl(null);
        setSelectedPubId(null);
        setNotification({ message: 'Crawl cleared.', type: 'info' });
    }, []);

    const generateCrawl = async (startPub) => {
        setIsProcessing(true);
        const match = startPub.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) {
            setNotification({ message: 'Pub location invalid.', type: 'error' });
            setIsProcessing(false);
            return;
        }
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        
        try {
            const res = await fetch(`/api/generate-crawl?lng=${lon}&lat=${lat}&start_pub_id=${startPub.id}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate crawl');
            setCrawl({ route: data.route, pubIds: data.pubIds, duration: data.totalDuration });
            setNotification({ message: '3-Pub Crawl Generated!', type: 'success' });
        } catch (err) {
            setNotification({ message: err.message, type: 'error' });
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleVisit = async (pubId, currentStatus) => {
        setIsProcessing(true);
        const pub = pubs.find(p => p.id === pubId);
        if (!pub) return setIsProcessing(false);
        
        if (currentStatus) { // Is visited, so we are removing the last visit
            const lastVisitId = pub.visit_history?.[0]?.id;
            if (lastVisitId) {
                const { error } = await supabase.from('visits').delete().eq('id', lastVisitId);
                if (error) setNotification({ message: error.message, type: 'error' });
                else setNotification({ message: `Visit removed for ${pub.name}.`, type: 'success' });
            }
        } else { // Is unvisited, so we add a visit
            const { error } = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() });
            if (error) setNotification({ message: error.message, type: 'error' });
            else setNotification({ message: `Visit logged for ${pub.name}!`, type: 'success' });
        }
        await fetchPubs(pubId);
        setIsProcessing(false);
    };

    const markCrawlAsVisited = async () => {
        if (!crawl) return;
        setIsProcessing(true);
        const visitsToInsert = crawl.pubIds.map(id => ({ pub_id: id, visit_date: new Date().toISOString() }));
        const { error } = await supabase.from('visits').insert(visitsToInsert);
        
        if (error) setNotification({ message: error.message, type: 'error' });
        else setNotification({ message: 'Crawl marked as visited!', type: 'success' });
        
        await fetchPubs();
        clearCrawl();
        setIsProcessing(false);
    };
    
    const value = {
        // State
        pubs,
        isLoading,
        isProcessing,
        selectedPub,
        selectedPubId,
        hoveredPubId,
        crawl,
        crawlPubs,
        visitedCount,
        notification,

        // Actions
        setSelectedPubId,
        setHoveredPubId,
        clearNotification: () => setNotification({ message: '', type: 'info'}),
        toggleVisit,
        generateCrawl,
        clearCrawl,
        markCrawlAsVisited,
    };
    
    return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
};