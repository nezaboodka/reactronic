export default {
  verbose: true,
  extensions: { 'ts': 'module' },
  nodeArguments: [
    '--loader=ts-node/esm',
    '--no-warnings'
  ],
  files: ['test/**/*.test.ts'],
  timeout: '20s',
}
