const { getStore } = require('@netlify/blobs');

// 1. Restauramos as chaves explícitas para o banco voltar a conectar
// 2. Adicionamos a consistência forte para o Netlify parar de usar cache no chat
function store(name) {
  return getStore({
    name: name,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
    consistency: 'strong' // <-- A mágica que resolve a fragmentação do chat
  });
}

async function readJSON(storeName, key, fallback) {
  try {
    const s = store(storeName);
    const data = await s.get(key, { type: 'json' });
    return data === null || data === undefined ? fallback : data;
  } catch (err) {
    console.error(`Erro ao ler blob ${key}:`, err);
    // 3. Restauramos o fallback para evitar o erro 502 fatal e manter a tela funcionando
    return fallback; 
  }
}

async function writeJSON(storeName, key, value) {
  const s = store(storeName);
  await s.setJSON(key, value);
}

module.exports = { store, readJSON, writeJSON };
