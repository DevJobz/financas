const { getStore } = require('@netlify/blobs');

function store(name) {
  return getStore(name);
}

// Substitua a função readJSON inteira por esta versão protegida:
async function readJSON(storeName, key, fallback) {
  try {
    const s = store(storeName);
    const data = await s.get(key, { type: 'json' });
    return data === null || data === undefined ? fallback : data;
  } catch (err) {
    console.error(`Erro ao ler blob ${key}:`, err);
    return fallback;
  }
}

async function writeJSON(storeName, key, value) {
  const s = store(storeName);
  await s.setJSON(key, value);
}

module.exports = { store, readJSON, writeJSON };
