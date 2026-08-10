const crypto = require('crypto');
const { readJSON, writeJSON } = require('./_shared/blobStore');
const { verifyToken, cors } = require('./_shared/authMiddleware');

const STORE = 'financas';
const KEY = 'settings.json';
const AUDIT_KEY = 'audit.json';

const DEFAULT_SETTINGS = {
  creditCardLimit: 0,
  creditCardCloseDay: 1,
  people: [
    { id: 'u1', name: 'Pessoa 1', role: 'Servidor Público', color: '#0F6E56' },
    { id: 'u2', name: 'Pessoa 2', role: 'CLT', color: '#D85A30' },
  ],
  categories: {
    receita: [
      'Salário', '13º Salário', 'Férias +1/3', 'Renda Extra',
      'Dívida de Terceiros (recebida)', 'Reembolso', 'Outros',
    ],
    gasto: [
      'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação',
      'Lazer', 'Assinaturas', 'Cartão de Crédito', 'Dívidas', 'Outros',
    ],
  },
};

exports.handler = async (event) => {
  const headers = cors();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
  }

  if (event.httpMethod === 'GET') {
    const settings = await readJSON(STORE, KEY, DEFAULT_SETTINGS);
    return { statusCode: 200, headers, body: JSON.stringify(settings) };
  }

  if (event.httpMethod === 'PUT') {
    const before = await readJSON(STORE, KEY, DEFAULT_SETTINGS);
    const data = JSON.parse(event.body || '{}');
    const updated = { ...before, ...data };
    await writeJSON(STORE, KEY, updated);

    const log = await readJSON(STORE, AUDIT_KEY, []);
    log.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: user.sub,
      userName: user.name,
      action: 'update',
      entity: 'settings',
      entityId: 'settings',
      before,
      after: updated,
    });
    await writeJSON(STORE, AUDIT_KEY, log.slice(0, 1000));

    return { statusCode: 200, headers, body: JSON.stringify(updated) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
};
