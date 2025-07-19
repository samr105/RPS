// src/components/MapController.jsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from '../context/MapContext';

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

export default function MapController() {
    // FIX: Use useRef to reliably get the container DOM element.
    const mapContainer = useRef(null);
    const map = useRef(null);
    const popup = useRef(null);
    const lastSelectedId = useRef(null);

    const { 
        pubs,
        selectedPub,
        selectedPubId,
        hoveredPubId,
        crawl,
        setSelectedPubId,
        setHoveredPubId 
    } = useMapContext();
    
    const [mapIsLoaded, setMapIsLoaded] = useState(false);

    // --- EFFECT 1: Initialize map instance (runs only once) ---
    useEffect(() => {
        if (map.current || !mapContainer.current) return;
        
        const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
        map.current = new maplibregl.Map({
            // FIX: Use the ref's current property for the container.
            container: mapContainer.current,
            style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
            center: [-3.53, 50.72],
            zoom: 12,
            antialias: true,
        });
        
        popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });

        map.current.on('load', () => {
            map.current.addSource('pubs', { type: 'geojson', data: EMPTY_GEOJSON, promoteId: 'id' });
            map.current.addSource('route', { type: 'geojson', data: EMPTY_GEOJSON });
            
            map.current.addLayer({
                id: 'pubs-layer', type: 'circle', source: 'pubs',
                paint: {
                    'circle-radius': ['case', ['boolean', ['feature-state', 'hovered'], false], 11, ['boolean', ['feature-state', 'selected'], false], 10, 7],
                    'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'],
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#FFFFFF'],
                    'circle-radius-transition': { duration: 200 },
                    'circle-opacity-transition': { duration: 300 },
                }
            });
            map.current.addLayer({ id: 'route-layer', type: 'line', source: 'route', paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
            
            map.current.on('click', 'pubs-layer', e => e.features.length > 0 && setSelectedPubId(e.features[0].id));
            map.current.on('mouseenter', 'pubs-layer', e => e.features.length > 0 && setHoveredPubId(e.features[0].id));
            map.current.on('mouseleave', 'pubs-layer', () => setHoveredPubId(null));
            
            // This flag solves all timing issues.
            setMapIsLoaded(true);
        });
        
        return () => map.current?.remove();
    }, [setSelectedPubId, setHoveredPubId]);
    

    // Memoize the pub GeoJSON data to avoid re-calculating on every render.
    const pubGeoJSON = useMemo(() => ({
        type: 'FeatureCollection',
        features: pubs.map(p => {
            const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
            if (!match?.[1]) return null;
            const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
            return {
                type: 'Feature',
                id: p.id,
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: { // Only include primitive values for map expressions.
                    is_visited: p.is_visited,
                    name: p.name,
                }
            };
        }).filter(Boolean)
    }), [pubs]);

    // --- EFFECT 2: The single "Reactor" Effect ---
    // This consolidated effect syncs all state changes to the map visuals.
    useEffect(() => {
        if (!mapIsLoaded || !map.current.getSource('pubs')) return;
        
        // 1. Update main pub data
        map.current.getSource('pubs').setData(pubGeoJSON);

        // 2. Update feature states for hover and selection
        pubs.forEach(pub => {
            map.current.setFeatureState({ source: 'pubs', id: pub.id }, {
                hovered: pub.id === hoveredPubId,
                selected: pub.id === selectedPubId,
            });
        });

        // 3. Update pin opacity based on context (crawl or hover)
        let opacityExpression = 1.0;
        if (crawl) {
            opacityExpression = ['case', ['in', ['id'], ['literal', crawl.pubIds]], 1.0, 0.3];
        } else if (hoveredPubId !== null) {
            const visibleIds = [hoveredPubId, selectedPubId].filter(Boolean);
            opacityExpression = ['case', ['in', ['id'], ['literal', visibleIds]], 1.0, 0.3];
        }
        map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);

        // 4. Update the crawl route visuals
        map.current.getSource('route').setData(crawl?.route || EMPTY_GEOJSON);

        // 5. Update the popup for hover
        popup.current.remove();
        if(hoveredPubId) {
            const pub = pubs.find(p => p.id === hoveredPubId);
            if(pub && pub.geom){
                const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
                if (match?.[1]) {
                    popup.current.setLngLat(match[1].trim().split(/\s+/).map(Number))
                        .setHTML(`<strong>${pub.name}</strong>`)
                        .addTo(map.current);
                }
            }
        }
        
        // 6. Fly to newly selected pubs
        if (selectedPub && selectedPubId !== lastSelectedId.current) {
             const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
             if (match?.[1]) {
                map.current.flyTo({ center: match[1].trim().split(/\s+/).map(Number), zoom: 15 });
             }
        }
        lastSelectedId.current = selectedPubId;
        
    }, [mapIsLoaded, pubGeoJSON, pubs, selectedPub, selectedPubId, hoveredPubId, crawl]);

    // FIX: Assign the ref to the div element.
    return <div ref={mapContainer} className="map-container" />;
}