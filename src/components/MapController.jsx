// src/components/MapController.jsx
import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from '../context/MapContext';

export default function MapController() {
    const mapContainerRef = useRef(null);
    const { mapRef, popupRef, selectPub, hoverPub } = useMapContext();

    useEffect(() => {
        if (mapRef.current || !mapContainerRef.current) return;
        
        const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
        mapRef.current = new maplibregl.Map({
            container: mapContainerRef.current,
            style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
            center: [-3.53, 50.72],
            zoom: 12,
            antialias: true,
        });

        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });
        const map = mapRef.current;

        map.on('load', () => {
            map.addSource('pubs', { type: 'geojson', data: null, promoteId: 'id' });
            map.addSource('route', { type: 'geojson', data: null });
            
            map.addLayer({
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
            map.addLayer({ id: 'route-layer', type: 'line', source: 'route', paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
            
            map.on('click', 'pubs-layer', e => e.features.length > 0 && selectPub(e.features[0].id));
            map.on('mouseenter', 'pubs-layer', e => e.features.length > 0 && hoverPub(e.features[0].id));
            map.on('mouseleave', 'pubs-layer', () => hoverPub(null));
        });
        
        return () => map.remove();
    }, [mapRef, popupRef, selectPub, hoverPub]);

    return <div ref={mapContainerRef} className="map-container" />;
}