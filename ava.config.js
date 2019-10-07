export default {
  compileEnhancements: false,
  extensions: ["ts"],
  babel: false,
  verbose: true,
  files: ["tests/**/*.test.ts"],
  require: ["ts-node/register"],
}
