const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { cors } = require('./_shared/authMiddleware');

function getUsers() {
  return [
    {
      id: 'u1',
      name: process.env.USER1_NAME || '',
      passHash: process.env.USER1_PASS_HASH || '',
      role: process.env.USER1_ROLE || 'Servidor Público',
      color: '#0F6E56',
    },
    {
      id: 'u2',
      name: process.env.USER2_NAME || '',
      passHash: process.env.USER2_PASS_HASH || '',
      role: process.env.USER2_ROLE || 'CLT',
      color: '#993C1D',
    },
  ];
}

exports.handler = async (event) => {
  const headers = cors();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    if (!process.env.JWT_SECRET) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'JWT_SECRET não configurado no servidor' }) };
    }

    const { username, password } = JSON.parse(event.body || '{}');
    const users = getUsers();
    const user = users.find(
      (u) => u.name && u.name.toLowerCase() === String(username || '').toLowerCase()
    );

    if (!user || !user.passHash) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Usuário ou senha inválidos' }) };
    }

    const ok = await bcrypt.compare(String(password || ''), user.passHash);
    if (!ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Usuário ou senha inválidos' }) };
    }

    const token = jwt.sign(
      { sub: user.id, name: user.name, role: user.role, color: user.color },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token,
        user: { id: user.id, name: user.name, role: user.role, color: user.color },
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno no login' }) };
  }
};
