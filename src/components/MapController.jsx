// src/components/MapController.jsx
import React, { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from '../context/MapContext';

export default function MapController() {
    // FIX: Get setMapIsReady from the context
    const { mapRef, popupRef, selectPub, hoverPub, setMapIsReady } = useMapContext();

    useEffect(() => {
        if (mapRef.current) return;
        
        const mapContainer = document.getElementById('map');
        if (!mapContainer) return;

        const stadiaApiKey = import.meta.env.VITE_STADIA_API_KEY;
        mapRef.current = new maplibregl.Map({
            container: mapContainer,
            style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`,
            center: [-3.53, 50.72],
            zoom: 12,
            antialias: true,
        });

        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });

        mapRef.current.on('load', () => {
            mapRef.current.addSource('pubs', { type: 'geojson', data: null, promoteId: 'id' });
            mapRef.current.addSource('route', { type: 'geojson', data: null });
            
            mapRef.current.addLayer({
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
            mapRef.current.addLayer({ id: 'route-layer', type: 'line', source: 'route', paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
            
            mapRef.current.on('click', 'pubs-layer', e => e.features.length > 0 && selectPub(e.features[0].id));
            mapRef.current.on('mouseenter', 'pubs-layer', e => e.features.length > 0 && hoverPub(e.features[0].id));
            mapRef.current.on('mouseleave', 'pubs-layer', () => hoverPub(null));

            // FIX: This is the handshake. The map tells the context it's ready for commands.
            setMapIsReady(true);
        });
        
        return () => {
            mapRef.current?.remove();
            setMapIsReady(false);
        }
    }, [mapRef, popupRef, selectPub, hoverPub, setMapIsReady]);

    return <div id="map" className="map-container" />;
}