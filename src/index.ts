import { ChildProcess } from 'child_process';
import path from 'path';
import fs, { readFile, pathExists, writeFile } from 'fs-extra';
import os from 'os';
import resolveFrom from 'resolve-from';
import createServerlessConfig from './create-serverless-config';
import {
  BuildOptions,
  FileBlob,
  Files,
  Config,
  Route,
  download,
  getNodeVersion,
  getSpawnOptions,
  runNpmInstall,
  runPackageJsonScript,
  Lambda,
  FileFsRef,
  glob,
  createLambda,
} from '@now/build-utils';

exports.version = 2;
const name = '[@now/next]';

function validateEntrypoint(entrypoint: string) {
  if (
    !/package\.json$/.exec(entrypoint) &&
    !/next\.config\.js$/.exec(entrypoint)
  ) {
    throw new Error(
      'Specified "src" for "@now/next" has to be "package.json" or "next.config.js"'
    );
  }
}

async function readPackageJson(entryPath: string) {
  const packagePath = path.join(entryPath, 'package.json');

  try {
    return JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (err) {
    console.log('package.json not found in entry');
    return {};
  }
}

async function writePackageJson(workPath: string, packageJson: Object) {
  await writeFile(
    path.join(workPath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
}

function getNextVersion(packageJson: {
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
}) {
  let nextVersion;
  if (packageJson.dependencies && packageJson.dependencies.next) {
    nextVersion = packageJson.dependencies.next;
  } else if (packageJson.devDependencies && packageJson.devDependencies.next) {
    nextVersion = packageJson.devDependencies.next;
  }
  return nextVersion;
}

async function getNextConfig(workPath: string, entryPath: string) {
  const entryConfig = path.join(entryPath, './next.config.js');
  if (await fs.pathExists(entryConfig)) {
    return fs.readFile(entryConfig, 'utf8');
  }

  const workConfig = path.join(workPath, './next.config.js');
  if (await fs.pathExists(workConfig)) {
    return fs.readFile(workConfig, 'utf8');
  }

  return null;
}

function excludeFiles(
  files: Files,
  matcher: (filePath: string) => boolean
): Files {
  return Object.keys(files).reduce((newFiles, filePath) => {
    if (matcher(filePath)) {
      return newFiles;
    }
    return {
      ...newFiles,
      [filePath]: files[filePath],
    };
  }, {});
}

function includeOnlyEntryDirectory(
  files: Files,
  entryDirectory: string
): Files {
  if (entryDirectory === '.') {
    return files;
  }

  function matcher(filePath: string) {
    return !filePath.startsWith(entryDirectory);
  }

  return excludeFiles(files, matcher);
}

function getDynamicRoutes(
  entryPath: string,
  entryDirectory: string,
  dynamicPages: string[],
  isDev?: boolean
): { src: string; dest: string }[] {
  if (!dynamicPages.length) {
    return [];
  }

  let getRouteRegex:
    | ((pageName: string) => { re: RegExp })
    | undefined = undefined;

  let getSortedRoutes: ((normalizedPages: string[]) => string[]) | undefined;

  try {
    ({ getRouteRegex, getSortedRoutes } = require(resolveFrom(
      entryPath,
      'next-server/dist/lib/router/utils'
    )));
    if (typeof getRouteRegex !== 'function') {
      getRouteRegex = undefined;
    }
  } catch (_) {}

  if (!getRouteRegex || !getSortedRoutes) {
    throw new Error(
      'Found usage of dynamic routes but not on a new enough version of Next.js.'
    );
  }

  const pageMatchers = getSortedRoutes(dynamicPages).map(pageName => ({
    pageName,
    matcher: getRouteRegex!(pageName).re,
  }));

  const routes: { src: string; dest: string }[] = [];
  pageMatchers.forEach(pageMatcher => {
    // in `now dev` we don't need to prefix the destination
    const dest = !isDev
      ? path.join('/', entryDirectory, pageMatcher.pageName)
      : pageMatcher.pageName;

    routes.push({
      src: pageMatcher.matcher.source,
      dest,
    });
  });
  return routes;
}

// Identify /[param]/ in route string
const TEST_DYNAMIC_ROUTE = /\/\[[^\/]+?\](?=\/|$)/;

function isDynamicRoute(route: string): boolean {
  route = route.startsWith('/') ? route : `/${route}`;
  return TEST_DYNAMIC_ROUTE.test(route);
}

function normalizePage(page: string): string {
  // remove '/index' from the end
  page = page.replace(/\/index$/, '/');
  // Resolve on anything that doesn't start with `/`
  if (!page.startsWith('/')) {
    page = `/${page}`;
  }
  return page;
}

function filesFromDirectory(files: Files, dir: string): Files {
  function matcher(filePath: string) {
    return !filePath.startsWith(dir.replace(/\\/g, '/'));
  }

  return excludeFiles(files, matcher);
}

export interface EnvConfig {
  [name: string]: string | undefined;
}

interface BuildParamsMeta {
  isDev: boolean | undefined;
  env?: EnvConfig;
  buildEnv?: EnvConfig;
}

interface BuildParamsType extends BuildOptions {
  files: Files;
  entrypoint: string;
  workPath: string;
  meta: BuildParamsMeta;
}

export const build = async ({
  files,
  workPath,
  entrypoint,
  config = {} as Config,
  meta = {} as BuildParamsMeta,
}: BuildParamsType): Promise<{
  routes: Route[];
  output: Files;
  watch?: string[];
  childProcesses: ChildProcess[];
}> => {
  validateEntrypoint(entrypoint);

  const entryDirectory = path.dirname(entrypoint);
  const entryPath = path.join(workPath, entryDirectory);
  const dotNextStatic = path.join(entryPath, '.next/static');

  console.log(`${name} Downloading user files...`);
  await download(files, workPath, meta);

  const pkg = await readPackageJson(entryPath);
  const nextVersion = getNextVersion(pkg);

  const nodeVersion = await getNodeVersion(entryPath, undefined, config);
  const spawnOpts = getSpawnOptions(meta, nodeVersion);

  if (!nextVersion) {
    throw new Error(
      'No Next.js version could be detected in "package.json". Make sure `"next"` is installed in "dependencies" or "devDependencies"'
    );
  }

  if (await pathExists(dotNextStatic)) {
    console.warn(
      'WARNING: You should not upload the `.next` directory. See https://zeit.co/docs/v2/deployments/official-builders/next-js-now-next/ for more details.'
    );
  }

  console.warn(
    "WARNING: your application is being deployed in @now/next's legacy mode. http://err.sh/zeit/now-builders/now-next-legacy-mode"
  );

  pkg.scripts = {
    'now-build': 'next build',
    ...(pkg.scripts || {}),
  };
  await writePackageJson(entryPath, pkg);

  console.log('installing dependencies...');
  await runNpmInstall(entryPath, ['--prefer-offline'], spawnOpts);

  let realNextVersion: string | undefined;
  try {
    realNextVersion = require(resolveFrom(entryPath, 'next/package.json'))
      .version;

    console.log(`detected Next.js version: ${realNextVersion}`);
  } catch (_ignored) {
    console.warn(`could not identify real Next.js version, that's OK!`);
  }

  console.log('running user script...');
  const memoryToConsume = Math.floor(os.totalmem() / 1024 ** 2) - 128;
  const env = { ...spawnOpts.env } as any;
  env.NODE_OPTIONS = `--max_old_space_size=${memoryToConsume}`;
  await runPackageJsonScript(entryPath, 'now-build', { ...spawnOpts, env });

  const exportedPageRoutes: Route[] = [];
  const lambdas: { [key: string]: Lambda } = {};
  const staticPages: { [key: string]: FileFsRef } = {};
  const dynamicPages: string[] = [];

  console.log('preparing lambda files...');
  const pagesDir = path.join(entryPath, '.next', 'serverless', 'pages');

  const pages = await glob('**/*.js', pagesDir);
  const staticPageFiles = await glob('**/*.html', pagesDir);

  Object.keys(staticPageFiles).forEach((page: string) => {
    const staticRoute = path.join(entryDirectory, page);
    staticPages[staticRoute] = staticPageFiles[page];

    const pathname = page.replace(/\.html$/, '');

    if (isDynamicRoute(pathname)) {
      dynamicPages.push(normalizePage(pathname));
      return;
    }

    exportedPageRoutes.push({
      src: `^${path.join('/', entryDirectory, pathname)}$`,
      dest: path.join('/', staticRoute),
    });
  });

  const pageKeys = Object.keys(pages);

  if (pageKeys.length === 0) {
    const nextConfig = await getNextConfig(workPath, entryPath);

    if (nextConfig != null) {
      console.info('Found next.config.js:');
      console.info(nextConfig);
      console.info();
    }

    throw new Error(
      'No serverless pages were built. https://err.sh/zeit/now-builders/now-next-no-serverless-pages-built'
    );
  }

  let assets:
    | {
        [filePath: string]: FileFsRef;
      }
    | undefined;
  const tracedFiles: {
    [filePath: string]: FileFsRef;
  } = {};
  assets = await glob('assets/**', path.join(entryPath, '.next', 'serverless'));

  const assetKeys = Object.keys(assets!);
  if (assetKeys.length > 0) {
    console.log('detected (legacy) assets to be bundled with lambda:');
    assetKeys.forEach(assetFile => console.log(`\t${assetFile}`));
    console.log(
      '\nPlease upgrade to Next.js 9.1 to leverage modern asset handling.'
    );
  }

  const launcherPath = path.join(__dirname, 'templated-launcher.js');
  const launcherData = await readFile(launcherPath, 'utf8');

  await Promise.all(
    pageKeys.map(async page => {
      // These default pages don't have to be handled as they'd always 404
      if (['_app.js', '_document.js'].includes(page)) {
        return;
      }

      const pathname = page.replace(/\.js$/, '');

      if (isDynamicRoute(pathname)) {
        dynamicPages.push(normalizePage(pathname));
      }

      const label = `Creating lambda for page: "${page}"...`;
      console.time(label);

      const pageFileName = path.normalize(
        path.relative(workPath, pages[page].fsPath)
      );
      const launcher = launcherData.replace(
        /__LAUNCHER_PAGE_PATH__/g,
        JSON.stringify('./page')
      );

      const launcherFiles = {
        // 'now__bridge.js': new FileFsRef({ fsPath: require('@now/node-bridge') }),
        'now__launcher.js': new FileBlob({ data: launcher }),
      };

      lambdas[path.join(entryDirectory, pathname)] = await createLambda({
        files: {
          ...launcherFiles,
          ...assets,
          ...tracedFiles,
          ['page.js']: pages[page],
        },
        handler: 'now__launcher.launcher',
        runtime: nodeVersion.runtime,
      });
      console.timeEnd(label);
    })
  );

  const nextStaticFiles = await glob(
    '**',
    path.join(entryPath, '.next', 'static')
  );
  const staticFiles = Object.keys(nextStaticFiles).reduce(
    (mappedFiles, file) => ({
      ...mappedFiles,
      [path.join(entryDirectory, `_next/static/${file}`)]: nextStaticFiles[
        file
      ],
    }),
    {}
  );

  const entryDirectoryFiles = includeOnlyEntryDirectory(files, entryDirectory);
  const staticDirectoryFiles = filesFromDirectory(
    entryDirectoryFiles,
    path.join(entryDirectory, 'static')
  );
  const publicDirectoryFiles = filesFromDirectory(
    entryDirectoryFiles,
    path.join(entryDirectory, 'public')
  );
  const publicFiles = Object.keys(publicDirectoryFiles).reduce(
    (mappedFiles, file) => ({
      ...mappedFiles,
      [file.replace(/public[/\\]+/, '')]: publicDirectoryFiles[file],
    }),
    {}
  );
  let dynamicPrefix = path.join('/', entryDirectory);
  dynamicPrefix = dynamicPrefix === '/' ? '' : dynamicPrefix;

  let dynamicRoutes = getDynamicRoutes(
    entryPath,
    entryDirectory,
    dynamicPages
  ).map(route => {
    if (staticPages[`${route.dest}.html`.substr(1)]) {
      route.dest = `${route.dest}.html`;
    }
    route.src = route.src.replace('^', `^${dynamicPrefix}`);
    return route;
  });

  return {
    output: {
      ...publicFiles,
      ...lambdas,
      ...staticPages,
      ...staticFiles,
      ...staticDirectoryFiles,
    },
    routes: [
      ...exportedPageRoutes,
      {
        src: '/_next/static/(?:[^/]+/pages|chunks|runtime)/.+',
        headers: { 'cache-control': 'public,max-age=31536000,immutable' },
        continue: true,
      },
      { handle: 'filesystem' },
      ...dynamicRoutes,
      ...[
        {
          src: path.join('/', entryDirectory, '.*'),
          dest: path.join('/', entryDirectory, '_error'),
          status: 404,
        },
      ],
    ],
    watch: [],
    childProcesses: [],
  };
};
