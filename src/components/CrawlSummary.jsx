// src/components/CrawlSummary.jsx
import React from 'react';
import { motion } from 'framer-motion';
import { useMapContext } from '../context/MapContext';

export default function CrawlSummary() {
  const { crawl, crawlPubs, clearCrawl, markCrawlAsVisited, isProcessing } = useMapContext();

  if (!crawl || crawlPubs.length === 0) return null;

  const walkTime = Math.round(crawl.duration / 60);

  return (
    <motion.div
      className="crawl-summary-container"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
    >
      <div className="crawl-summary-header">
        <h3>Your Next Crawl</h3>
        <button className="close-btn" onClick={clearCrawl}>×</button>
      </div>
      <p className="walk-time">
        Estimated walk time: <strong>{walkTime} mins</strong>
      </p>
      <ol className="crawl-list">
        {crawlPubs.map((pub, index) => (
          <li key={pub.id}><span>{index + 1}.</span> {pub.name}</li>
        ))}
      </ol>
      <button 
        className="action-button mark-all-btn" 
        onClick={markCrawlAsVisited}
        disabled={isProcessing}
      >
        {isProcessing ? 'Saving...' : 'Mark All as Visited'}
      </button>
    </motion.div>
  );
};