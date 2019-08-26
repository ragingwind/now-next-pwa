const path = require('path');
const { glob } = require('@now/build-utils');
const fs = require('fs-extra');


async function mktmp(inputPath) {
  const tmp = path.join(__dirname, '../../.tmp', path.basename(inputPath));

  await fs.remove(tmp);
  await fs.mkdirs(tmp);

  return tmp
}

it('should build', async () => {
  const inputPath = path.join(__dirname, 'fixture');
  const inputFiles = await glob('**', inputPath);
  const nowJsonRef = inputFiles['now.json'];
  const nowJson = require(nowJsonRef.fsPath);
  const build = nowJson.builds[0];
  const entrypoint = build.src.replace(/^\//, '');

  inputFiles[entrypoint].digest = 'temp-digest';

  const builder = require(build.use);
  const workPath = await mktmp(inputPath);
  const buildResult = await builder.build({
    files: inputFiles,
    entrypoint,
    workPath,
    config: build.config
  });

  expect(buildResult.output[entrypoint]).toBeDefined();
});
