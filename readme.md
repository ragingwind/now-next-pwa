# now-next-pwa

> now builder for Next.js PWA. WARNING, This project is in experimental stage. APIs and others would be changed

# Getting Started

## Set up project and Install builder

```sh
now init nextjs
cd nextjs
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

## Add manifest <link> to _document.js

```js
import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    return (
      <Html>
        <Head>
          <link rel="manifest" href="/manifest.json" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
```
## Config `now.json` with manifest custom setting as you need

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "now-next-pwa",
      "config": {
        "manifest": {
          "name": "NEXT-PWA-BASIC",
          "short_name": "NEXT-PWA-BASIC",
          "icons": [
            {
              "src": "/static/icon-192x192.png",
              "sizes": "192x192",
              "type": "image/png"
            },
            {
              "src": "/static/icon-512x512.png",
              "sizes": "512x512",
              "type": "image/png"
            }
          ]
        }
      }
    }
  ]
}
```

## Deploy to now

```sh
now
```

or you can test in development mode of now

```sh
now dev
```

# License

MIT @ Jimmy Moon
