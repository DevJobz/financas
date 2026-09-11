const crypto = require('crypto');
const { readJSON, writeJSON } = require('./_shared/blobStore');
const { verifyToken, cors } = require('./_shared/authMiddleware');

const STORE = 'financas';

exports.handler = async (event) => {
  const headers = cors();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const user = verifyToken(event);
  if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };

  try {
    let records = await readJSON(STORE, 'records.json', []);

    // LER REGISTROS
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers, body: JSON.stringify(records) };
    }

    // CRIAR OU ATUALIZAR REGISTRO (Lista de Compras ou Manutenção)
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      
      if (data.id) {
        // Atualiza
        const idx = records.findIndex(r => r.id === data.id);
        if (idx > -1) {
          records[idx] = { ...records[idx], ...data, updatedAt: new Date().toISOString() };
        } else {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registro não encontrado' }) };
        }
      } else {
        // Cria novo
        const newRecord = {
          id: crypto.randomUUID(),
          ...data,
          createdBy: user.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        records.push(newRecord);
      }
      
      await writeJSON(STORE, 'records.json', records);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // DELETAR REGISTRO
    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters.id;
      records = records.filter(r => r.id !== id);
      await writeJSON(STORE, 'records.json', records);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: 'Método não permitido' };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};