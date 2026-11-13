'use strict';

const fs = require('fs');
const path = require('path');
const { createState } = require('../src/parse-util');

function feed(adapter, file) {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8').split('\n');
  const state = createState();
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    events.push(...adapter.parseLine(line, state));
  }
  return { state, events };
}

function textOf(events) {
  let text = '';
  for (const event of events) {
    if (event.kind === 'delta') text += event.text;
    if (event.kind === 'text') text = event.text;
  }
  const done = events.find((event) => event.kind === 'done');
  return { text, done: done ? done.text : null, events };
}

module.exports = { feed, textOf };
