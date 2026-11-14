'use strict';

const { codex } = require('./codex');
const { copilot } = require('./copilot');
const { agy } = require('./agy');
const { grok } = require('./grok');
const { cursor } = require('./cursor');
const { claude } = require('./claude');
const { mock } = require('./mock');

const ADAPTERS = [codex, copilot, agy, grok, cursor, claude, mock];

function getAdapter(id) {
  return ADAPTERS.find((adapter) => adapter.id === id) || null;
}

module.exports = {
  ADAPTERS,
  getAdapter,
};
