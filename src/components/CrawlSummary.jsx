// src/components/CrawlSummary.jsx
import React from 'react';
import { motion } from 'framer-motion';

const CrawlSummary = ({ crawlData, onClose, onMarkAllVisited, isProcessing }) => {
  if (!crawlData) return null;

  const { pubs, duration } = crawlData;
  const walkTime = Math.round(duration / 60);

  return (
    <motion.div
      className="crawl-summary-container"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="crawl-summary-header">
        <h3>Your Next Crawl</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      <p className="walk-time">
        Estimated walking time: <strong>{walkTime} minutes</strong>
      </p>
      <ol className="crawl-list">
        {pubs.map((pub, index) => (
          <li key={pub.id}>
            <span>{index + 1}.</span> {pub.name}
          </li>
        ))}
      </ol>
      <button 
        className="action-button mark-all-btn" 
        onClick={onMarkAllVisited}
        disabled={isProcessing}
      >
        {isProcessing ? 'Saving...' : 'Mark All as Visited'}
      </button>
    </motion.div>
  );
};

export default CrawlSummary;