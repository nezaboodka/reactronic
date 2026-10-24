export default {
  verbose: true,
  extensions: ['ts'],
  nodeArguments: [
    '--import=tsimp',
    '--no-warnings'
  ],
  files: ['test/**/*.test.ts'],
  timeout: '20s',
  environmentVariables: {
    TSIMP_DIAG: 'ignore',
  }
}
