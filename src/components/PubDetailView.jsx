// src/components/PubDetailView.jsx
import React from 'react';
import { motion } from 'framer-motion';
import { useMapContext } from '../context/MapContext';

export default function PubDetailView({ pub }) {
    // FIX: Using simplified, direct functions from context
    const { selectPub, toggleVisit, generateCrawl, isProcessing } = useMapContext();

    const handleVisitClick = () => {
        toggleVisit(pub.id, pub.is_visited);
    };

    return (
        <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }}>
            {/* FIX: The "All Pubs" button now correctly deselects the pub */}
            <button className="back-button" onClick={() => selectPub(null)}>← All Pubs</button>
            <div className="selected-pub-header">
                <h3>{pub.name}</h3>
                <p>{pub.address || 'Address not available'}</p>
            </div>
            <div className="action-buttons">
                <button 
                    className={`action-button ${pub.is_visited ? 'remove-visit-btn' : 'visited-btn'}`}
                    onClick={handleVisitClick}
                    disabled={isProcessing}
                >
                    {isProcessing ? 'Saving...' : (pub.is_visited ? 'Remove Last Visit' : 'Log a New Visit')}
                </button>
                 {!pub.is_visited && (
                    <button 
                        className="action-button generate-crawl-btn"
                        onClick={() => generateCrawl(pub)}
                        disabled={isProcessing}
                    >
                        {isProcessing ? '...' : 'Crawl from here'}
                    </button>
                )}
            </div>
            <div className="visit-history">
                <h4>Visit History ({pub.visit_history?.length || 0})</h4>
                {pub.visit_history && pub.visit_history.length > 0 ? (
                    <ul className="visit-list">
                        {pub.visit_history.map(visit => (
                            <li key={visit.id} className="visit-item">
                                Visited on: <span>{new Date(visit.visit_date).toLocaleString()}</span>
                            </li>
                        ))}
                    </ul>
                ) : <p>No visits logged yet.</p>}
            </div>
        </motion.div>
    );
};