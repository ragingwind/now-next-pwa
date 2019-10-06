import path from 'path';
import crypto from 'crypto';
import { build as nextBuild } from '@now/next';
import { FileFsRef } from '@now/build-utils';
import { writeFile, readFile } from 'fs-extra';
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

const workboxConfigDefault = {
  globPatterns: [],
  globIgnores: [],
  globStrict: false,
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

const excludeworkboxConfigs = [
  'globDirectory',
  'importWorkboxFrom',
  'directoryIndex',
  'globFollow',
  'templatedURLs',
  'dontCacheBustURLsMatching',
  'manifestTransforms',
];

const filterworkboxConfig = opts => {
  const workboxConfig = {
    ...workboxConfigDefault,
    ...opts
  }

  excludeworkboxConfigs.forEach(e => {
    if (workboxConfig[e]) {
      console.error(`${workboxConfig[e]} option doesn't supported yet, it would be ignored`);
      delete workboxConfig[e];
    }
  })

  return workboxConfig
}
const manifestConfigDefault = {
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

const importScripts = async (buildResult, buildId, entryPath, workboxConfig, workPath) => {
  return await Promise.all(workboxConfig.importScripts.map(async s => {
    const content = await readFile(path.join(workPath, s));

    return createPage({
      output: buildResult.output,
      entryPath,
      filename: path.basename(s),
      content: content,
      buildId,
    });
  }))
}

const generatePrecache = async (buildResult, buildId, entryPath) => {
  const content = `self.__precacheManifest = ${JSON.stringify(
    Object.keys(buildResult.output).filter(o => !excludeRoutes.exec(o))
  )}`;

  const filename = `next-precache-manifest-${hash(content)}.js`;
  return await createPage({
    output: buildResult.output,
    entryPath,
    filename: filename,
    content: content,
    buildId,
  });
};

const generateSW = async (buildResult, buildId, workboxConfig, entryPath) => {
  const content = await generateSWString(workboxConfig);
  return await createPage({
    output: buildResult.output,
    entryPath,
    filename: 'sw.js',
    content: content.swString,
    buildId,
  });
};

const generateManifest = async (buildResult, buildId, manifest, entryPath) => {
  return await createPage({
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
  const workboxConfig = filterworkboxConfig(config.workbox || {});

  if (!meta.isDev) {
    const buildId = getBuildId(buildResult.output);
    const precache = await generatePrecache(buildResult, buildId, entryPath);
    const scripts = await importScripts(buildResult, buildId, entryPath, workboxConfig, workPath);

    workboxConfig.importScripts = [
      precache,
      ...scripts,
      getModuleURL('workbox-sw'),
    ];

    const swRoute = await generateSW(buildResult, buildId, workboxConfig, entryPath);
    buildResult.routes.unshift({
      src: '/sw.js',
      dest: swRoute,
    });

    const mfRoute = await generateManifest(
      buildResult,
      buildId,
      {
        ...manifestConfigDefault,
        ...manifest,
      },
      entryPath
    );

    buildResult.routes.unshift({
      src: '/manifest.json',
      dest: mfRoute,
    });
  } else {
    workboxConfig.importScripts = [
      getModuleURL('workbox-sw'),
      ...workboxConfig.importScripts,
    ];

    await generateSW(buildResult, 'development', workboxConfig, entryPath);
    buildResult.routes.unshift({
      src: '/sw.js',
      dest: 'http://localhost:5000/sw.js',
    });

    await generateManifest(
      buildResult,
      'development',
      {
        ...manifestConfigDefault,
        ...manifest,
      },
      entryPath
    );
  }

  return buildResult;
};
