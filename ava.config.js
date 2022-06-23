export default {
  verbose: true,
  extensions: { 'ts': 'module' },
  nodeArguments: [
    '--loader=ts-node/esm',
    '--experimental-specifier-resolution=node',
    '--no-warnings'
  ],
  files: ['test/**/*.test.ts'],
  timeout: '20s',
}
