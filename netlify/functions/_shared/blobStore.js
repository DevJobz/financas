const { getStore } = require('@netlify/blobs');

// Agora passamos as chaves explicitamente para não depender do ambiente automático
function store(name) {
  return getStore({
    name: name,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN
  });
}

async function readJSON(storeName, key, fallback) {
  try {
    const s = store(storeName);
    const data = await s.get(key, { type: 'json' });
    return data === null || data === undefined ? fallback : data;
  } catch (err) {
    console.error(`Erro ao ler blob ${key}:`, err);
    return fallback; // Impede o erro 502 devolvendo o fallback seguro
  }
}

async function writeJSON(storeName, key, value) {
  const s = store(storeName);
  await s.setJSON(key, value);
}

module.exports = { store, readJSON, writeJSON };