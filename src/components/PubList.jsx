// src/components/PubList.jsx
import React from 'react';
import { motion } from 'framer-motion';

const PubList = ({ pubs, onSelectPub }) => {
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
          <span className={`status-indicator ${pub.is_visited ? 'indicator-visited' : 'indicator-unvisited'}`}></span>
        </motion.li>
      ))}
    </motion.ul>
  );
};

export default PubList;