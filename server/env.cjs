const path = require('node:path');

// Anchor to the repository, even when launched from another working directory.
// Node preserves existing process environment values; never log file contents.
function loadEnvironment(file = path.resolve(__dirname, '..', '.env')) {
  try { process.loadEnvFile(file); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to load the environment file. Check file access and syntax.'); }
}
module.exports = { loadEnvironment };
