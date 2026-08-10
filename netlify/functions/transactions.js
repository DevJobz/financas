const crypto = require('crypto');
const { readJSON, writeJSON } = require('./_shared/blobStore');
const { verifyToken, cors } = require('./_shared/authMiddleware');

const STORE = 'financas';
const KEY = 'transactions.json';
const AUDIT_KEY = 'audit.json';

async function appendAudit(user, action, entity, entityId, before, after) {
  const log = await readJSON(STORE, AUDIT_KEY, []);
  log.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: user.sub,
    userName: user.name,
    action,
    entity,
    entityId,
    before,
    after,
  });
  await writeJSON(STORE, AUDIT_KEY, log.slice(0, 1000));
}

exports.handler = async (event) => {
  const headers = cors();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
  }

  const list = await readJSON(STORE, KEY, []);

  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers, body: JSON.stringify(list) };
  }

  if (event.httpMethod === 'POST') {
    const data = JSON.parse(event.body || '{}');
    if (!data.date || !data.type || !data.category || data.amount === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios faltando' }) };
    }
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      date: data.date,
      type: data.type,
      category: data.category,
      description: data.description || '',
      amount: Number(data.amount),
      paidBy: data.paidBy || user.sub,
      paymentMethod: data.paymentMethod || 'outro',
      installments: data.installments || null,
      createdBy: user.name,
      createdAt: now,
      updatedAt: now,
    };
    list.push(item);
    await writeJSON(STORE, KEY, list);
    await appendAudit(user, 'create', 'transaction', item.id, null, item);
    return { statusCode: 201, headers, body: JSON.stringify(item) };
  }

  if (event.httpMethod === 'PUT') {
    const data = JSON.parse(event.body || '{}');
    const idx = list.findIndex((t) => t.id === data.id);
    if (idx === -1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Lançamento não encontrado' }) };
    }
    const before = { ...list[idx] };
    list[idx] = {
      ...list[idx],
      ...data,
      amount: data.amount !== undefined ? Number(data.amount) : list[idx].amount,
      updatedBy: user.name,
      updatedAt: new Date().toISOString(),
    };
    await writeJSON(STORE, KEY, list);
    await appendAudit(user, 'update', 'transaction', data.id, before, list[idx]);
    return { statusCode: 200, headers, body: JSON.stringify(list[idx]) };
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Lançamento não encontrado' }) };
    }
    const before = list[idx];
    list.splice(idx, 1);
    await writeJSON(STORE, KEY, list);
    await appendAudit(user, 'delete', 'transaction', id, before, null);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
};
