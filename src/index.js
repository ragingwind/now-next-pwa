import path from 'path';
import crypto from 'crypto';
import { build as nextBuild } from '@now/next';
import { FileFsRef } from '@now/build-utils';
import { writeFile } from 'fs-extra';
import {
  generateSWString,
  copyWorkboxLibraries,
  getModuleURL,
} from 'workbox-build';

const hash = ctx =>
  crypto
    .createHash('md5')
    .update(ctx, 'utf8')
    .digest('hex');

const swConfig = {
  globPatterns: [],
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /^http[s|]?.*/,
      handler: 'StaleWhileRevalidate',
    },
  ],
  importScripts: [],
};

const manifestConfig = {
  name: 'NEXT-PWA',
  short_name: 'NEXT-PWA',
  start_url: './?utm_source=web_app_manifest',
  display: 'standalone',
  background_color: '#EFEFEF',
  theme_color: '#FFEEFF',
  icons: [
    {
      src: '/static/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: '/static/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
    },
  ],
};

const excludeRoutes = new RegExp(/_error$/);

const createPage = async ({
  output,
  entryPath,
  filename,
  content,
  buildId,
  mode = 33188,
}) => {
  const route = `_next/static/${buildId}/pages/${filename}`;
  const page = path.join(
    entryPath,
    `.next/static/${buildId}/pages/${filename}`
  );

  await writeFile(page, content);

  output[route] = await FileFsRef.fromFsPath({
    mode: mode,
    fsPath: page,
  });

  return route;
};

const getBuildId = output => {
  let buildId;

  for (let o in output) {
    if (o.match(/index.js$/)) {
      buildId = /_next\/static\/(.+)\/pages\/.*/.exec(o)[1];
      return buildId;
    }
  }

  return buildId;
};

const generatePrecache = async (buildResult, buildId, swConfig, entryPath) => {
  const content = `self.__precacheManifest = ${JSON.stringify(
    Object.keys(buildResult.output).filter(o => !excludeRoutes.exec(o))
  )}`;

  const filename = `next-precache-manifest-${hash(content)}.js`;
  const routes = await createPage({
    output: buildResult.output,
    entryPath,
    filename: filename,
    content: content,
    buildId,
  });

  // add imported scripts to sw
  swConfig.importScripts = [
    routes,
    getModuleURL('workbox-sw'),
    ...swConfig.importScripts,
  ];
};

const generateSW = async (buildResult, buildId, swConfig, entryPath) => {
  const content = await generateSWString(swConfig);
  return await createPage({
    output: buildResult.output,
    entryPath,
    filename: 'sw.js',
    content: content.swString,
    buildId,
  });
};

const generateManifest = async (buildResult, buildId, manifest, entryPath) => {
  await createPage({
    output: buildResult.output,
    entryPath,
    filename: 'manifest.json',
    content: JSON.stringify(manifest, null, 2),
    buildId,
  });
};

export const build = async ({
  files,
  workPath,
  entrypoint,
  config = {},
  meta = {},
}) => {
  const buildResult = await nextBuild({
    files,
    workPath,
    entrypoint,
    config,
    meta,
  });

  const entryPath = path.join(workPath, path.dirname(entrypoint));
  const manifest = config.manifest || {};

  if (!meta.isDev) {
    const buildId = getBuildId(buildResult.output);
    await generatePrecache(buildResult, buildId, swConfig, entryPath);

    const swRoute = await generateSW(buildResult, buildId, swConfig, entryPath);
    buildResult.routes.unshift({
      src: '/sw.js',
      dest: swRoute,
    });

    generateManifest(
      buildResult,
      buildId,
      {
        ...manifestConfig,
        ...manifest,
      },
      entryPath
    );
  } else {
    swConfig.importScripts = [
      getModuleURL('workbox-sw'),
      ...swConfig.importScripts,
    ];

    await generateSW(buildResult, 'development', swConfig, entryPath);
    buildResult.routes.unshift({
      src: '/sw.js',
      dest: 'http://localhost:5000/sw.js',
    });

    generateManifest(
      buildResult,
      'development',
      {
        ...manifestConfig,
        ...manifest,
      },
      entryPath
    );
  }

  return buildResult;
};
