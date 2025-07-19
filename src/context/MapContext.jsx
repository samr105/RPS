// src/context/MapContext.jsx
import React, { createContext, useState, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const MapContext = createContext();
export const useMapContext = () => useContext(MapContext);

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

export const MapProvider = ({ children }) => {
    // --- MAP REF & STATE ---
    const mapRef = useRef(null); // The ref to the MapLibre instance itself
    const popupRef = useRef(null); // The ref to the MapLibre popup instance
    const lastSelectedId = useRef(null);
    const lastHoveredId = useRef(null);

    const [pubs, setPubs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [selectedPubId, setSelectedPubId] = useState(null);
    const [hoveredPubId, setHoveredPubId] = useState(null);
    
    const [crawl, setCrawl] = useState(null);
    const [notification, setNotification] = useState({ message: '', type: 'info' });

    // --- DERIVED STATE ---
    const selectedPub = useMemo(() => pubs.find(p => p.id === selectedPubId), [pubs, selectedPubId]);
    const crawlPubs = useMemo(() => crawl?.pubIds.map(id => pubs.find(p => p.id === id)).filter(Boolean) || [], [crawl, pubs]);
    const visitedCount = useMemo(() => pubs.filter(p => p.is_visited).length, [pubs]);

    // --- DATA FETCHING & DIRECT MAP UPDATE ---
    const fetchPubs = useCallback(async (selectIdAfter = null) => {
        setIsLoading(true);
        const { data, error } = await supabase.rpc('get_all_pub_details');
        if (error) setNotification({ message: `Error fetching pubs: ${error.message}`, type: 'error' });
        else {
            const pubData = data.map(p => ({ ...p, geom: p.geom || '' }));
            setPubs(pubData);
            if(selectIdAfter) selectPub(selectIdAfter);
        }
        setIsLoading(false);
    }, []); // Removed `selectPub` from deps to break loop

    // --- DIRECT MAP COMMAND FUNCTIONS ---

    const updateMapData = useCallback((pubData) => {
        if (!mapRef.current) return;
        const features = pubData.map(p => {
            const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
            if (!match?.[1]) return null;
            const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
            return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { is_visited: p.is_visited, name: p.name } };
        }).filter(Boolean);
        mapRef.current.getSource('pubs')?.setData({ type: 'FeatureCollection', features });
    }, []);

    const hoverPub = useCallback((pubId) => {
        setHoveredPubId(pubId); // Set React state
        if (!mapRef.current) return;

        // Clear previous hover state from the map
        if (lastHoveredId.current) {
            mapRef.current.setFeatureState({ source: 'pubs', id: lastHoveredId.current }, { hovered: false });
        }

        popupRef.current.remove();
        
        // Apply new hover state to the map
        if (pubId !== null) {
            mapRef.current.setFeatureState({ source: 'pubs', id: pubId }, { hovered: true });
            const pub = pubs.find(p => p.id === pubId);
            if (pub) {
                const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
                if (match?.[1]) {
                    const coords = match[1].trim().split(/\s+/).map(Number);
                    popupRef.current.setLngLat(coords).setHTML(`<strong>${pub.name}</strong>`).addTo(mapRef.current);
                }
            }
        }
        lastHoveredId.current = pubId;
    }, [pubs]);

    const selectPub = useCallback((pubId) => {
        setSelectedPubId(pubId); // Set React state
        if (!mapRef.current) return;

        // Clear previous selection from the map
        if (lastSelectedId.current) {
             mapRef.current.setFeatureState({ source: 'pubs', id: lastSelectedId.current }, { selected: false });
        }
       
        // Apply new selection state to the map
        if (pubId !== null) {
            mapRef.current.setFeatureState({ source: 'pubs', id: pubId }, { selected: true });
            const pub = pubs.find(p => p.id === pubId);
            if (pub) {
                 const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
                 if (match?.[1]) {
                    mapRef.current.flyTo({ center: match[1].trim().split(/\s+/).map(Number), zoom: 15 });
                 }
            }
        }
        lastSelectedId.current = pubId;
    }, [pubs]);

    const clearCrawlVisuals = useCallback(() => {
        mapRef.current?.getSource('route')?.setData(EMPTY_GEOJSON);
        // Reset opacity of all pins
        pubs.forEach(pub => {
            mapRef.current?.setFeatureState({ source: 'pubs', id: pub.id }, { crawl: false });
        });
        mapRef.current?.setPaintProperty('pubs-layer', 'circle-opacity', 1.0);
    }, [pubs]);
    
    // Initial fetch
    useEffect(() => { fetchPubs(); }, [fetchPubs]);

    // Update map when pub data arrives from DB
    useEffect(() => { updateMapData(pubs); }, [pubs, updateMapData]);

    // --- BUSINESS LOGIC ---
    const toggleVisit = async (pubId, currentStatus) => {
        setIsProcessing(true);
        const pub = pubs.find(p => p.id === pubId);
        if (!pub) { setIsProcessing(false); return; }
        
        const action = currentStatus 
            ? supabase.from('visits').delete().eq('id', pub.visit_history?.[0]?.id)
            : supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() });

        const { error } = await action;
        if(error) setNotification({message: error.message, type: 'error' });
        else setNotification({ message: `Visit for ${pub.name} updated.`, type: 'success' });
        
        await fetchPubs(pubId);
        setIsProcessing(false);
    };

    const generateCrawl = async (startPub) => {
        setIsProcessing(true);
        clearCrawlVisuals();
        // ... (API call logic remains the same)
        const match = startPub.geom.match(/POINT\s*\(([^)]+)\)/);
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        const res = await fetch(`/api/generate-crawl?lng=${lon}&lat=${lat}&start_pub_id=${startPub.id}`);
        const data = await res.json();
        
        if (!res.ok) {
             setNotification({ message: data.error || 'Crawl failed', type: 'error' });
        } else {
            setCrawl({ route: data.route, pubIds: data.pubIds, duration: data.totalDuration });
            mapRef.current?.getSource('route')?.setData(data.route);
            mapRef.current?.setPaintProperty('pubs-layer', 'circle-opacity', ['case', ['in', ['id'], ['literal', data.pubIds]], 1.0, 0.3]);
            setNotification({ message: 'Crawl Generated!', type: 'success' });
        }
        setIsProcessing(false);
    };
    
    const clearCrawl = () => {
        setCrawl(null);
        clearCrawlVisuals();
        selectPub(null); // Also deselect the pub
        setNotification({ message: 'Crawl cleared.', type: 'info' });
    }

    const value = {
        pubs, isLoading, isProcessing, selectedPub, hoveredPubId, crawlPubs, visitedCount, notification,
        selectPub, hoverPub, clearCrawl, generateCrawl, toggleVisit,
        mapRef, popupRef, // Provide refs to MapController
        clearNotification: () => setNotification({ message: '', type: 'info' }),
    };
    
    return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
};