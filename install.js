'use strict';

const { main } = require('./helper/install');

try {
  main();
} catch (err) {
  process.stderr.write((err.message || String(err)) + '\n');
  process.exit(1);
}
