// src/components/PubList.jsx
import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMapContext } from '../context/MapContext';

export default function PubList({ pubs }) {
    const { 
        selectedPubId, hoveredPubId, isProcessing, selectPub, hoverPub, toggleVisit,
    } = useMapContext();
    const listItemsRef = useRef({});

    useEffect(() => {
        const idToScroll = hoveredPubId || selectedPubId;
        if (idToScroll) {
            listItemsRef.current[idToScroll]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [hoveredPubId, selectedPubId]);
  
    const handleQuickToggle = (event, pub) => {
        event.stopPropagation(); // <-- FIX: Prevents the click from triggering the parent li's onClick.
        if (isProcessing) return;
        toggleVisit(pub.id, pub.is_visited);
    };
  
    return (
        <motion.ul className="pub-list" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.02 }}}}>
        {pubs.map(pub => (
            <motion.li
                ref={el => listItemsRef.current[pub.id] = el}
                key={pub.id}
                className={`pub-list-item ${hoveredPubId === pub.id || selectedPubId === pub.id ? 'highlighted' : ''}`}
                onClick={() => selectPub(pub.id)}
                onMouseEnter={() => hoverPub(pub.id)}
                onMouseLeave={() => hoverPub(null)}
                variants={{ visible: { opacity: 1, y: 0 }, hidden: { opacity: 0, y: 20 } }}
                layout
            >
                <strong>{pub.name}</strong>
                <button 
                    className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}
                    onClick={(e) => handleQuickToggle(e, pub)}
                    title={pub.is_visited ? `Mark ${pub.name} as unvisited` : `Mark ${pub.name} as visited`}
                    disabled={isProcessing}
                ></button>
            </motion.li>
        ))}
        </motion.ul>
    );
};