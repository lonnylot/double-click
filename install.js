'use strict';

const fs = require('fs');
const path = require('path');

const compiled = path.join(__dirname, 'helper', 'install.js');
if (!fs.existsSync(compiled)) {
  process.stderr.write('Run npm run build before node install.js\n');
  process.exit(1);
}

const { main } = require('./helper/install');

try {
  main();
} catch (err) {
  process.stderr.write((err.message || String(err)) + '\n');
  process.exit(1);
}
