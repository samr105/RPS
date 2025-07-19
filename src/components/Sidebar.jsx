// src/components/Sidebar.jsx
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMapContext } from '../context/MapContext';

import PubList from './PubList';
import PubDetailView from './PubDetailView';

const FilterButton = ({ value, currentFilter, setFilter }) => (
    <button 
        className={`filter-btn ${currentFilter === value ? 'active' : ''}`}
        onClick={() => setFilter(value)}>
        {value.charAt(0).toUpperCase() + value.slice(1)}
    </button>
);

export default function Sidebar() {
    const { pubs, selectedPub, visitedCount } = useMapContext();
    const [filter, setFilter] = useState('all');

    const filteredPubs = useMemo(() => {
        return pubs.filter(pub => {
            if (filter === 'visited') return pub.is_visited;
            if (filter === 'unvisited') return !pub.is_visited;
            return true;
        }).sort((a,b) => a.name.localeCompare(b.name));
    }, [pubs, filter]);

    return (
        <aside className="sidebar">
            <div className="filter-container">
                <h2 className="sidebar-header">Pub Crawl Exeter</h2>
                <div className="filter-buttons">
                    <FilterButton value="all" currentFilter={filter} setFilter={setFilter} />
                    <FilterButton value="visited" currentFilter={filter} setFilter={setFilter} />
                    <FilterButton value="unvisited" currentFilter={filter} setFilter={setFilter} />
                </div>
            </div>

            <div className="sidebar-content">
                <AnimatePresence mode="wait">
                    {selectedPub ? (
                        <PubDetailView key={selectedPub.id} pub={selectedPub} />
                    ) : (
                        <motion.div key="list">
                            <h3 className="list-summary-header">
                                {`Showing ${filteredPubs.length} of ${pubs.length} pubs`}
                            </h3>
                            <PubList pubs={filteredPubs} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
             <div className="progress-bar-container">
                <svg className="pint-glass-svg" viewBox="0 0 100 150">
                    <defs><clipPath id="pint-glass-mask"><path d="M10 20 L20 130 H80 L90 20 Z" /></clipPath></defs>
                    <rect className="beer-fill" x="0" y={130 - (110 * (visitedCount / pubs.length))} width="100" height={110 * (visitedCount / pubs.length)} clipPath="url(#pint-glass-mask)" />
                    <path d="M10 20 L20 130 H80 L90 20 Z" className="glass-outline" />
                </svg>
                <div className="progress-text">{visitedCount} / {pubs.length}</div>
            </div>
        </aside>
    );
}