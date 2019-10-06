import React, { useEffect } from 'react';

export default () => {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(registration => {
          console.log('service worker registration successful');
        })
        .catch(err => {
          console.warn('service worker registration failed', err.message);
        });
    }
  }, []);

  return (
    <div>
      <p>Hello PWA with Next.js and Now Builder</p>
      <p>Check the console for the Service Worker registration status.</p>
    </div>
  );
};
