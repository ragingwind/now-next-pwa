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

const excludeRoutes = new RegExp(/_error$/);

const createPage = async ({
  buildResult,
  entryPath,
  filename,
  content,
  buildId,
  mode = 33188,
}) => {
  const route = `_next/static/${buildId}/pages/${filename}`;
  const output = path.join(
    entryPath,
    `.next/static/${buildId}/pages/${filename}`
  );

  console.log('write', output, content);
  await writeFile(output, content);

  buildResult.output[route] = await FileFsRef.fromFsPath({
    mode: mode,
    fsPath: output,
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

  // entry path
  const entryDirectory = path.dirname(entrypoint);
  const entryPath = path.join(workPath, entryDirectory);

  // extracting build id
  const buildId = getBuildId(buildResult.output);
  console.log('extracting build id', buildId);

  // generating precachese
  const swPrecacheContent = `self.__precacheManifest = ${JSON.stringify(
    Object.keys(buildResult.output).filter(o => !excludeRoutes.exec(o))
  )}`;

  const swPrecache = `next-precache-manifest-${hash(swPrecacheContent)}.js`;
  const swPrecacheRoute = await createPage({
    buildResult,
    entryPath,
    filename: swPrecache,
    content: swPrecacheContent,
    buildId,
  });

  // add imported scripts to sw
  swConfig.importScripts = [
    swPrecacheRoute,
    getModuleURL('workbox-sw'),
    ...swConfig.importScripts,
  ];

  // generating sw.js
  const swJSContent = await generateSWString(swConfig);
  const swJSRoute = await createPage({
    buildResult,
    entryPath,
    filename: 'sw.js',
    content: swJSContent.swString,
    buildId,
  });

  // add /sw.js path to routes
  buildResult.routes.unshift({
    src: '/sw.js',
    dest: swJSRoute,
  });

  console.log(buildResult);

  return buildResult;
};
