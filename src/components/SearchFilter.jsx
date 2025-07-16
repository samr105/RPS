// src/components/SearchFilter.jsx
import React from 'react';

const SearchFilter = ({ searchTerm, setSearchTerm, filter, setFilter }) => {
  return (
    <div className="filter-container">
      <input
        type="text"
        placeholder="Search for a pub..."
        className="search-input"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      <div className="filter-buttons">
        <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`filter-btn ${filter === 'visited' ? 'active' : ''}`} onClick={() => setFilter('visited')}>Visited</button>
        <button className={`filter-btn ${filter === 'unvisited' ? 'active' : ''}`} onClick={() => setFilter('unvisited')}>Unvisited</button>
      </div>
    </div>
  );
};

export default SearchFilter;