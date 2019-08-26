const { FileBlob } = require('@now/build-utils');
const fs = require('fs-extra');

exports.version = 2;

exports.analyze = ({files, entrypoint}) => {
  return files[entrypoint].digest
}

exports.build = async ({files, entrypoint, config}) => {
  const data = await fs.readFile(files[entrypoint].fsPath);
  const result = new FileBlob({ data: data });

  return {
    output: {
      [entrypoint]: result
    },
    watch: [],
    routes: {}
  }
}
