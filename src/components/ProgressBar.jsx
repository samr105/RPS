// src/components/ProgressBar.jsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ProgressBar = ({ visitedCount, totalCount }) => {
  const percentage = totalCount > 0 ? (visitedCount / totalCount) * 100 : 0;
  const isFilling = percentage > 0;

  return (
    <motion.div 
      className="progress-bar-container"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, duration: 0.5 }}
    >
      <svg className="pint-glass-svg" viewBox="0 0 100 150">
        {/* The Beer fill - a rectangle that grows in height from the bottom */}
        <rect 
          className="beer-fill" 
          x="10" y={130 - (110 * percentage / 100)} 
          width="80" height={110 * percentage / 100} 
        />
        {/* The Glass Outline */}
        <path d="M10 20 L20 130 H80 L90 20 Z" className="glass-outline" />
      </svg>
      <div className="progress-text">{visitedCount} / {totalCount}</div>

      {/* Conditionally render the bubbles so they only appear when there's progress */}
      <AnimatePresence>
        {isFilling && (
          <motion.div 
            className="bubbles"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* We create multiple bubble spans to get a random, continuous effect via CSS */}
            <span className="bubble" style={{ left: '20%' }}></span>
            <span className="bubble" style={{ left: '40%' }}></span>
            <span className="bubble" style={{ left: '60%' }}></span>
            <span className="bubble" style={{ left: '75%' }}></span>
            <span className="bubble" style={{ left: '30%' }}></span>
            <span className="bubble" style={{ left: '50%' }}></span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ProgressBar;