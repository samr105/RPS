// src/hooks/useMap.js
import { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';

export function useMap({
  allPubs,
  selectedPub,
  hoveredPubId,
  crawlPubIds,
  crawlRoute,
  onSelectPubById,
  onHoverPubById,
}) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const popup = useRef(null);
  const lastSelectedId = useRef(null);
  const lastHoveredId = useRef(null);

  // Initialize map instance one time
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
        map.current.addSource('pubs-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
        map.current.addLayer({
            id: 'pubs-layer', type: 'circle', source: 'pubs-source',
            paint: {
                'circle-radius': ['case', ['boolean', ['feature-state', 'hovered'], false], 11, ['boolean', ['feature-state', 'selected'], false], 10, 7],
                'circle-color': ['case', ['get', 'is_visited'], '#198754', '#dc3545'],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0d6efd', '#FFFFFF'],
            }
        });
        map.current.addLayer({
            id: 'pub-labels-zoomed', type: 'symbol', source: 'pubs-source', minzoom: 14,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 14, 'text-offset': [0, 1.25], 'text-anchor': 'top' },
            paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5, 'text-halo-blur': 1 }
        });

        map.current.on('click', 'pubs-layer', e => e.features.length > 0 && onSelectPubById(e.features[0].id));
        map.current.on('mouseenter', 'pubs-layer', e => { map.current.getCanvas().style.cursor = 'pointer'; if(e.features.length > 0) onHoverPubById(e.features[0].id); });
        map.current.on('mouseleave', 'pubs-layer', () => { map.current.getCanvas().style.cursor = ''; onHoverPubById(null); });
    });
  }, [onSelectPubById, onHoverPubById]);

  // Update pub features when data changes
  useEffect(() => {
    if (!map.current?.isStyleLoaded() || !map.current.getSource('pubs-source')) return;
    const features = allPubs.map(p => {
        const match = p.geom.match(/POINT\s*\(([^)]+)\)/);
        if (!match?.[1]) return null;
        const [lon, lat] = match[1].trim().split(/\s+/).map(Number);
        return { type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: p.name, is_visited: p.is_visited }};
    }).filter(Boolean);
    map.current.getSource('pubs-source').setData({ type: 'FeatureCollection', features });
  }, [allPubs]);

  // Sync map state (hover, select, popup) from React state
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;

    if (lastHoveredId.current && lastHoveredId.current !== hoveredPubId) map.current.setFeatureState({ source: 'pubs-source', id: lastHoveredId.current }, { hovered: false });
    if (lastSelectedId.current && lastSelectedId.current !== selectedPub?.id) map.current.setFeatureState({ source: 'pubs-source', id: lastSelectedId.current }, { selected: false });

    popup.current.remove();
    
    if (hoveredPubId) {
        map.current.setFeatureState({ source: 'pubs-source', id: hoveredPubId }, { hovered: true });
        const pub = allPubs.find(p => p.id === hoveredPubId);
        if(pub) {
            const match = pub.geom.match(/POINT\s*\(([^)]+)\)/);
            if(match?.[1]) {
              const coords = match[1].trim().split(/\s+/).map(Number);
              popup.current.setLngLat(coords).setHTML(`<strong>${pub.name}</strong>`).addClassName(pub.is_visited ? 'visited-popup' : 'unvisited-popup').removeClassName(pub.is_visited ? 'unvisited-popup' : 'visited-popup').addTo(map.current);
            }
        }
    }
    if (selectedPub) {
        map.current.setFeatureState({ source: 'pubs-source', id: selectedPub.id }, { selected: true });
        if (selectedPub.id !== lastSelectedId.current) {
          const match = selectedPub.geom.match(/POINT\s*\(([^)]+)\)/);
          if (match?.[1]) {
            const coords = match[1].trim().split(/\s+/).map(Number);
            map.current.flyTo({ center: coords, zoom: 15 });
          }
        }
    }
    lastHoveredId.current = hoveredPubId;
    lastSelectedId.current = selectedPub?.id;
  }, [selectedPub, hoveredPubId, allPubs]);

  // Handle crawl route drawing
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const source = map.current.getSource('crawl-route');
    if (crawlRoute) {
      if(source) source.setData(crawlRoute);
      else {
        map.current.addSource('crawl-route', { type: 'geojson', data: crawlRoute });
        map.current.addLayer({ id: 'crawl-route', type: 'line', source: 'crawl-route', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: { 'line-color': '#0d6efd', 'line-width': 5 } });
      }
    } else {
      if (source) { map.current.removeLayer('crawl-route'); map.current.removeSource('crawl-route'); }
    }
  }, [crawlRoute]);

  // Handle pub visibility when a crawl is active
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const crawlInProgress = crawlPubIds.length > 0;
    const opacityExpression = crawlInProgress ? ['case', ['in', ['id'], ['literal', crawlPubIds]], 1.0, 0.4] : 1.0;
    map.current.setPaintProperty('pubs-layer', 'circle-opacity', opacityExpression);
    map.current.setPaintProperty('pubs-layer', 'circle-stroke-opacity', opacityExpression);
  }, [crawlPubIds]);

  return { mapContainer };
}