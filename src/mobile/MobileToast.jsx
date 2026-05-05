import React from 'react';

export function MobileToast({ message, onDismiss, duration = 2800 }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, onDismiss, duration]);

  if (!message) return null;
  return (
    <div className="mobile-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
