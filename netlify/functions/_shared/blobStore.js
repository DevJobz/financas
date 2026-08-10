const { getStore } = require('@netlify/blobs');

function store(name) {
  return getStore(name);
}

async function readJSON(storeName, key, fallback) {
  const s = store(storeName);
  const data = await s.get(key, { type: 'json' });
  return data === null || data === undefined ? fallback : data;
}

async function writeJSON(storeName, key, value) {
  const s = store(storeName);
  await s.setJSON(key, value);
}

module.exports = { store, readJSON, writeJSON };
