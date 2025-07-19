// src/App.jsx
import React from 'react';
import { MapProvider, useMapContext } from './context/MapContext';
import MapController from './components/MapController';
import Sidebar from './components/Sidebar';
import CrawlSummary from './components/CrawlSummary';
import Notification from './Notification';

import './App.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Main layout component that can access the context
function AppLayout() {
  const { isLoading, notification, clearNotification, crawlPubs } = useMapContext();

  return (
    <>
      <div className="loading-overlay" style={{ display: isLoading ? 'flex' : 'none' }}>
        Loading Map & Pubs...
      </div>
      <div className="app-container">
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={clearNotification}
        />
        <Sidebar />
        <MapController />
        {crawlPubs.length > 0 && <CrawlSummary />}
      </div>
    </>
  );
}

// The main App component wraps everything in the provider
function App() {
  return (
    <MapProvider>
      <AppLayout />
    </MapProvider>
  );
}

export default App;