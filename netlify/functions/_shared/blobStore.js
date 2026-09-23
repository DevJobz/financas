const { getStore } = require('@netlify/blobs');

// Deixamos o Netlify injetar as credenciais automaticamente e forçamos a consistência forte
function store(name) {
  return getStore({
    name: name,
    consistency: 'strong' // <-- A MÁGICA: Obriga a ler o dado exato em tempo real, ignorando o cache
  });
}

async function readJSON(storeName, key, fallback) {
  try {
    const s = store(storeName);
    const data = await s.get(key, { type: 'json' });
    
    // Retorna fallback apenas se o arquivo realmente não existir ainda (data === null)
    return data === null || data === undefined ? fallback : data;
  } catch (err) {
    console.error(`Erro crítico ao ler blob ${key}:`, err);
    // NUNCA retorne o fallback (array vazio) em caso de erro de rede.
    // Isso faria o sistema achar que o histórico está vazio e sobrescrever tudo.
    throw new Error(`Falha de conexão com o banco de dados (${key}).`);
  }
}

async function writeJSON(storeName, key, value) {
  const s = store(storeName);
  await s.setJSON(key, value);
}

module.exports = { store, readJSON, writeJSON };
