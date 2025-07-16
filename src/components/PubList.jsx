// src/components/PubList.jsx
import React from 'react';
import { motion } from 'framer-motion';

const PubList = ({ pubs, onSelectPub, onLogVisit, onRemoveVisit, isTogglingVisit }) => {

  const handleQuickToggle = (event, pub) => {
    // Stop the click from "bubbling up" to the parent <li>, which would trigger onSelectPub.
    event.stopPropagation();
    
    // Prevent multiple rapid clicks while a request is in flight.
    if (isTogglingVisit) return;

    if (pub.is_visited) {
      // Find the most recent visit ID to remove.
      const lastVisitId = pub.visit_history?.[0]?.id;
      if (lastVisitId) {
        onRemoveVisit(pub.id, lastVisitId);
      }
    } else {
      // If unvisited, simply log a new visit.
      onLogVisit(pub.id);
    }
  };
  
  return (
    <motion.ul
      className="pub-list"
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.02 } },
        hidden: {},
      }}
    >
      {pubs.map(pub => (
        <motion.li
          key={pub.id}
          className="pub-list-item"
          onClick={() => onSelectPub(pub)}
          variants={{ visible: { opacity: 1, y: 0 }, hidden: { opacity: 0, y: 20 } }}
          layout
        >
          <strong>{pub.name}</strong>
          <span 
            className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'} ${isTogglingVisit ? 'disabled' : ''}`}
            onClick={(e) => handleQuickToggle(e, pub)}
            title={pub.is_visited ? "Click to remove last visit" : "Click to log a visit"}
          ></span>
        </motion.li>
      ))}
    </motion.ul>
  );
};

export default PubList;