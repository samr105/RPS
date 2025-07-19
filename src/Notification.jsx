// src/Notification.jsx
import { useEffect } from 'react';
import { useMapContext } from './context/MapContext';

function Notification() {
  const { notification, clearNotification } = useMapContext();
  const { message, type } = notification;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      clearNotification();
    }, 5000);

    return () => clearTimeout(timer);
  }, [message, clearNotification]);

  if (!message) {
    return null;
  }

  return (
    <div className={`notification ${type}`}>
      <span>{message}</span>
      <button className="notification-close" onClick={clearNotification}>×</button>
    </div>
  );
}

export default Notification;