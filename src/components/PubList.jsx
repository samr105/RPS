// src/components/PubList.jsx
import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PubList = ({ pubs, onSelectPub, onLogVisit, onRemoveVisit, isTogglingVisit, onMouseEnter, onMouseLeave, hoveredPubId, selectedPubId }) => {
  const listItemsRef = useRef({});

  useEffect(() => {
    let pubIdToScroll = null;
    // Prefer highlighting the hovered pub for smooth scrolling feel
    if(hoveredPubId !== null) {
      pubIdToScroll = hoveredPubId;
    } else if (selectedPubId !== null) {
      // Fallback to selected pub if nothing is hovered
      pubIdToScroll = selectedPubId;
    }
    
    if (pubIdToScroll !== null) {
      const element = listItemsRef.current[pubIdToScroll];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [hoveredPubId, selectedPubId]);
  
  const handleQuickToggle = (event, pub) => {
    event.stopPropagation();
    if (isTogglingVisit) return;
    if (pub.is_visited) {
      const lastVisitId = pub.visit_history?.[0]?.id;
      if (lastVisitId) {
        onRemoveVisit(pub.id, lastVisitId, { navigateOnSuccess: false });
      }
    } else {
      onLogVisit(pub.id, { navigateOnSuccess: false });
    }
  };
  
  return (
    <motion.ul className="pub-list" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.02 } }, hidden: {}, }}>
      {pubs.map(pub => {
        const isHighlighted = hoveredPubId === pub.id || selectedPubId === pub.id;
        return (
          <motion.li
            ref={el => listItemsRef.current[pub.id] = el}
            key={pub.id}
            className={`pub-list-item ${isHighlighted ? 'highlighted' : ''}`}
            onClick={() => onSelectPub(pub)}
            onMouseEnter={() => onMouseEnter(pub)}
            onMouseLeave={onMouseLeave}
            variants={{ visible: { opacity: 1, y: 0 }, hidden: { opacity: 0, y: 20 } }}
            layout
          >
            <strong>{pub.name}</strong>
            <span 
              className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'} ${isTogglingVisit ? 'disabled' : ''}`}
              onClick={(e) => handleQuickToggle(e, pub)}
              title={pub.is_visited ? `Quick-unvisit ${pub.name}` : `Quick-visit ${pub.name}`}
            ></span>
          </motion.li>
        )
      })}
    </motion.ul>
  );
};

export default PubList;