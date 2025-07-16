// src/components/PubDetailView.jsx
import React from 'react';
import { motion } from 'framer-motion'; // This line was missing

const PubDetailView = ({ pub, onBack, onToggleVisit, onGenerateCrawl, onRemoveVisit, isToggling }) => {
    const [lng, lat] = pub.geom.replace('SRID=4326;POINT (', '').replace(')', '').split(' ').map(Number);
    
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
                {pub.is_visited && (
                    <button
                        className="action-button remove-visit-btn"
                        onClick={() => onRemoveVisit(pub.visit_history[0].id)}
                        disabled={isToggling}
                    >
                         {isToggling ? 'Removing...' : 'Remove Last Visit'}
                    </button>
                )}
                {!pub.is_visited && (
                    <button
                        className="action-button generate-crawl-btn"
                        data-lng={lng} data-lat={lat} data-pubid={pub.id}
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