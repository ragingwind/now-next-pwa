# now-next-pwa

> now builder for Next.js PWA. WARNING, This project is in experimental stage. APIs and others would be changed

# Getting Started

## Set up project and Install builder

```sh
now init nextjs
cd nextjs
npm install --save-dev now-next-pwa
```

## Add service worker register code at pages/index.js

```js
import React, { useEffect } from 'react';

function Index() {
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
    ...
  );
}

```
## Update `now.json`

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "now-next-pwa"
    }
  ]
}
```

## Deploy to now

```sh
now
```

# License

MIT @ Jimmy Moon
