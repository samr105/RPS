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
        <defs>
          {/* Define a clipping path that has the exact shape of our glass outline */}
          <clipPath id="pint-glass-mask">
            <path d="M10 20 L20 130 H80 L90 20 Z" />
          </clipPath>
        </defs>

        {/* The Beer fill - a rectangle that grows in height from the bottom */}
        {/* We apply the clip-path here to ensure the fill is constrained to the glass shape */}
        <rect 
          className="beer-fill" 
          x="0" // Set x to 0 and width to 100% to ensure it fills the whole potential area to be clipped
          y={130 - (110 * percentage / 100)} 
          width="100" 
          height={110 * percentage / 100}
          clipPath="url(#pint-glass-mask)" // Apply the mask
        />
        
        {/* The Glass Outline - this remains unclipped and visible */}
        <path d="M10 20 L20 130 H80 L90 20 Z" className="glass-outline" />
      </svg>
      <div className="progress-text">{visitedCount} / {totalCount}</div>

      <AnimatePresence>
        {isFilling && (
          <motion.div 
            className="bubbles"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
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