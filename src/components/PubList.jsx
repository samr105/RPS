// src/components/PubList.jsx
import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PubList = ({ pubs, onSelectPub, onLogVisit, onRemoveVisit, isTogglingVisit, onMouseEnter, onMouseLeave, hoveredPubId }) => {
  
  // Create a ref to hold the DOM nodes of the list items
  const listItemsRef = useRef({});

  // This effect watches for changes to the hoveredPubId (from the map)
  // and smoothly scrolls the corresponding list item into view.
  useEffect(() => {
    if (hoveredPubId !== null) {
      const element = listItemsRef.current[hoveredPubId];
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [hoveredPubId]);
  
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
          // Assign the DOM element to our ref map when it renders
          ref={el => listItemsRef.current[pub.id] = el}
          key={pub.id}
          // Add a 'highlighted' class if this item is being hovered on the map
          className={`pub-list-item ${hoveredPubId === pub.id ? 'highlighted' : ''}`}
          onClick={() => onSelectPub(pub)}
          // Add mouse enter/leave handlers for sidebar-to-map communication
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
      ))}
    </motion.ul>
  );
};

export default PubList;