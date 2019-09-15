import path from 'path';
import { parse } from 'url';
import { createServer } from 'http';
import getPort from 'get-port';
import resolveFrom from 'resolve-from';
import intersectJson from 'intersect-json';

process.on('unhandledRejection', err => {
  console.error('Exiting builder due to build error:');
  console.error(err);
  process.exit(1);
});

async function main(cwd: string) {
  const next = require(resolveFrom(cwd, 'next'));
  const app = next({ dev: true, dir: cwd });
  const handler = app.getRequestHandler();

  await app.prepare();

  const openPort = await getPort({
    port: [5000, 4000],
  });
  const url = `http://localhost:${openPort}`;

  const runtimeEnv = JSON.parse(
    Buffer.from(process.argv[2], 'base64').toString()
  );

  process.env = intersectJson(process.env, runtimeEnv);

  const pwaRoutes = [
    '/sw.js',
    '/manifest.json'
  ]

  createServer((req, res) => {
    const parsedUrl = parse(req.url || '', true);
    if (pwaRoutes.find(r => r === parsedUrl.pathname)) {
      app.serveStatic(
        req,
        res,
        path.resolve(`./.next/static/development/pages${parsedUrl.pathname}`)
      );
    } else {
      handler(req, res, parsedUrl);
    }
  }).listen(openPort, () => {
    if (process.send) {
      process.send(url);
    }
  });
}

main(process.cwd());
