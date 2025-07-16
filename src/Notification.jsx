import { useEffect } from 'react';

function Notification({ message, type = 'info', onClose }) {
  // Automatically close the notification after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000); // 5 seconds

    // Cleanup the timer if the component unmounts or onClose changes
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!message) {
    return null;
  }

  return (
    <div className={`notification ${type}`}>
      <span>{message}</span>
      <button className="notification-close" onClick={onClose}>×</button>
    </div>
  );
}

export default Notification;