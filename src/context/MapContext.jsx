// src/context/MapContext.jsx
import React, { createContext, useState, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const MapContext = createContext();
export const useMapContext = () => useContext(MapContext);

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

export const MapProvider = ({ children }) => {
    // --- STATE & REFS ---
    const [pubs, setPubs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [selectedPubId, setSelectedPubId] = useState(null);
    const [hoveredPubId, setHoveredPubId] = useState(null);
    const [crawl, setCrawl] = useState(null);
    const [notification, setNotification] = useState({ message: '', type: 'info' });

    const mapRef = useRef(null);
    const popupRef = useRef(null);
    const lastHoveredId = useRef(null);

    // --- DATA ---
    const fetchPubs = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase.rpc('get_all_pub_details');
        if (error) setNotification({ message: `Error fetching pubs: ${error.message}`, type: 'error' });
        else setPubs(data.map(p => ({ ...p, geom: p.geom || '' })));
        setIsLoading(false);
    }, []);

    useEffect(() => { fetchPubs(); }, [fetchPubs]);
    
    // --- DIRECT MAP COMMANDS ---
    const updateMapData = useCallback((newPubs) => {
        if (!mapRef.current) return;
        const pubSource = mapRef.current.getSource('pubs');
        if (pubSource) {
             const features = newPubs.map(p => {
                const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
                if (!match?.[1]) return null;
                const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
                return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { is_visited: p.is_visited } };
            }).filter(Boolean);
            pubSource.setData({ type: 'FeatureCollection', features });
        }
    }, []);
    
    // The hover function now issues direct commands.
    const hoverPub = (pubId) => {
        if (!mapRef.current) return;
        setHoveredPubId(pubId);

        if (lastHoveredId.current) mapRef.current.setFeatureState({ source: 'pubs', id: lastHoveredId.current }, { hovered: false });
        if (pubId) mapRef.current.setFeatureState({ source: 'pubs', id: pubId }, { hovered: true });
        lastHoveredId.current = pubId;

        popupRef.current?.remove();
        if (pubId) {
            const pub = pubs.find(p => p.id === pubId);
            const match = pub?.geom.match(/POINT\s*\(([^)]+)\)/);
            if (match?.[1]) {
                popupRef.current.setLngLat(match[1].trim().split(/\s+/).map(Number)).setHTML(`<strong>${pub.name}</strong>`).addTo(mapRef.current);
            }
        }
    };
    
    // The select function now issues direct commands.
    const selectPub = (pubId) => {
        const currentSelectedId = selectedPubId;
        setSelectedPubId(pubId);

        if (!mapRef.current) return;

        if(currentSelectedId) mapRef.current.setFeatureState({ source: 'pubs', id: currentSelectedId}, { selected: false });
        if(pubId) {
            mapRef.current.setFeatureState({ source: 'pubs', id: pubId}, { selected: true });
            const pub = pubs.find(p => p.id === pubId);
            const match = pub?.geom.match(/POINT\s*\(([^)]+)\)/);
            if (match?.[1]) {
                mapRef.current.flyTo({ center: match[1].trim().split(/\s+/).map(Number), zoom: 15 });
            }
        }
    };

    // Update map data only when pub data changes.
    useEffect(() => {
        if (mapRef.current) updateMapData(pubs);
    }, [pubs, updateMapData]);

    // --- BUSINESS LOGIC ---
    const generateCrawl = async (startPub) => {
        setIsProcessing(true);
        const match = startPub.geom.match(/POINT\s*\(([^)]+)\)/);
        if(!match?.[1]){ setNotification({message: 'Invalid pub location', type:'error'}); setIsProcessing(false); return; }
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        
        const res = await fetch(`/api/generate-crawl?lng=${lon}&lat=${lat}&start_pub_id=${startPub.id}`);
        const data = await res.json();
        
        if (res.ok) {
            setCrawl({ route: data.route, pubIds: data.pubIds, duration: data.totalDuration });
            mapRef.current?.getSource('route')?.setData(data.route);
            mapRef.current?.setPaintProperty('pubs-layer', 'circle-opacity', ['case', ['in', ['id'], ['literal', data.pubIds]], 1.0, 0.3]);
        } else {
            setNotification({ message: data.error || 'Crawl failed.', type: 'error'});
        }
        setIsProcessing(false);
    };

    const clearCrawl = () => {
        setCrawl(null);
        if(mapRef.current) {
            mapRef.current.getSource('route')?.setData(EMPTY_GEOJSON);
            mapRef.current.setPaintProperty('pubs-layer', 'circle-opacity', 1.0);
        }
    };
    
    const toggleVisit = async (pubId, currentStatus) => {
        setIsProcessing(true);
        const pub = pubs.find(p => p.id === pubId);
        let error;
        if(currentStatus){
            ({error} = await supabase.from('visits').delete().eq('id', pub.visit_history?.[0]?.id));
        } else {
            ({error} = await supabase.from('visits').insert({ pub_id: pubId, visit_date: new Date().toISOString() }));
        }
        if (error) setNotification({ message: error.message, type: 'error' });
        else await fetchPubs();
        setIsProcessing(false);
    };


    const value = {
        // State
        pubs, isLoading, isProcessing, hoveredPubId,
        selectedPub: useMemo(() => pubs.find(p => p.id === selectedPubId), [pubs, selectedPubId]),
        crawlPubs: useMemo(() => crawl?.pubIds.map(id => pubs.find(p => p.id === id)).filter(Boolean) || [], [crawl, pubs]),
        visitedCount: useMemo(() => pubs.filter(p => p.is_visited).length, [pubs]),
        notification, crawl,
        
        // Direct Actions
        selectPub, hoverPub, generateCrawl, clearCrawl, toggleVisit,
        
        // Map Refs & Setup
        mapRef, popupRef,
    };
    
    return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
};