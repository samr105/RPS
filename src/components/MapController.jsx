// src/components/MapController.jsx
import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from '../context/MapContext';

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

export default function MapController() {
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
    
    // FIX: State flag to solve race condition.
    const [mapIsLoaded, setMapIsLoaded] = useState(false);

    // Effect 1: Initialize map instance (runs only once)
    useEffect(() => {
        if (map.current) return;
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
            
            // Set the loaded flag to true ONLY when the 'load' event fires.
            setMapIsLoaded(true);
        });
    }, [setSelectedPubId, setHoveredPubId]);
    

    // Effect 2: THE SINGLE REACTOR - Syncs all visual state with the map
    useEffect(() => {
        // FIX: The effect will not run until the map is confirmed to be loaded.
        if (!mapIsLoaded || !map.current) return;

        // Sync pub data
        const pubSource = map.current.getSource('pubs');
        const features = pubs.map(p => {
            const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
            if (!match?.[1]) return null;
            const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
            return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { is_visited: p.is_visited }};
        }).filter(Boolean);
        pubSource.setData({ type: 'FeatureCollection', features });

        // Sync route data
        const routeSource = map.current.getSource('route');
        routeSource.setData(crawl?.route || EMPTY_GEOJSON);

        // Update feature states and opacity
        let opacityExpression;
        if (crawl) {
            opacityExpression = ['case', ['in', ['id'], ['literal', crawl.pubIds]], 1.0, 0.3];
        } else if (hoveredPubId) {
            const visibleIds = [hoveredPubId];
            if(selectedPubId) visibleIds.push(selectedPubId);
            opacityExpression = ['case', ['in', ['id'], ['literal', visibleIds]], 1.0, 0.3];
        } else {
            opacityExpression = 1.0;
        }
        map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
        
        pubs.forEach(pub => {
            map.current.setFeatureState({ source: 'pubs', id: pub.id }, {
                hovered: pub.id === hoveredPubId,
                selected: pub.id === selectedPubId,
            });
        });

        // Update popup
        popup.current.remove();
        if(hoveredPubId){
            const pub = pubs.find(p => p.id === hoveredPubId);
            if (pub) {
                const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
                if (match?.[1]) {
                    const coords = match[1].trim().split(/\s+/).map(Number);
                    popup.current.setLngLat(coords).setHTML(`<strong>${pub.name}</strong>`).addTo(map.current);
                }
            }
        }
        
        // Fly-to animation
        if(selectedPub && selectedPubId !== lastSelectedId.current){
             const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
             if (match?.[1]) {
                map.current.flyTo({ center: match[1].trim().split(/\s+/).map(Number), zoom: 15 });
             }
        }
        lastSelectedId.current = selectedPubId;
        
    }, [pubs, selectedPub, selectedPubId, hoveredPubId, crawl, mapIsLoaded]); // <-- mapIsLoaded is a dependency

    return <div ref={mapContainer} className="map-container" />;
}