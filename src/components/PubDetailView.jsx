// src/components/PubDetailView.jsx
import React from 'react';
import { motion } from 'framer-motion';

const PubDetailView = ({ pub, onBack, onToggleVisit, onGenerateCrawl, onRemoveVisit, isToggling }) => {
    // Note: The original geom parsing was here, but it's better handled in the main component.
    
    return (
        <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }}>
            <button className="back-button" onClick={onBack}>← All Pubs</button>

            <div className="selected-pub-header">
                <h3>{pub.name}</h3>
                <p>{pub.address || 'Address not available'}</p>
            </div>
            
            <div className="action-buttons">
                <button
                    className="action-button visited-btn"
                    onClick={() => onToggleVisit(pub.id)}
                    disabled={isToggling}
                >
                    {isToggling ? 'Logging Visit...' : 'Log a New Visit'}
                </button>
                {pub.is_visited && pub.visit_history && pub.visit_history[0] && (
                    <button
                        className="action-button remove-visit-btn"
                        onClick={() => onRemoveVisit(pub.id, pub.visit_history[0].id)}
                        disabled={isToggling}
                    >
                         {isToggling ? 'Removing...' : 'Remove Last Visit'}
                    </button>
                )}
                {!pub.is_visited && (
                    <button
                        className="action-button generate-crawl-btn"
                        // Pass the entire event to the handler
                        onClick={onGenerateCrawl}
                    >
                        Generate Mini-Crawl
                    </button>
                )}
            </div>

            <div className="visit-history">
                <h4>Visit History</h4>
                {pub.visit_history && pub.visit_history.length > 0 ? (
                    <ul className="visit-list">
                        {pub.visit_history.map(visit => (
                            <li key={visit.id} className="visit-item">
                                Visited on: <span>{new Date(visit.visit_date).toLocaleDateString()}</span>
                            </li>
                        ))}
                    </ul>
                ) : <p>No visits logged yet.</p>}
            </div>
        </motion.div>
    );
};

export default PubDetailView;