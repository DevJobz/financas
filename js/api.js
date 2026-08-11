const Api = (() => {
  // Mantemos a chamada direta às funções serverless para máxima compatibilidade
  const BASE = '/.netlify/functions';

  function getToken() {
    return localStorage.getItem('fc_token');
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = { 
      'Content-Type': 'application/json', 
      ...(options.headers || {}) 
    };
    
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE}${path}`, { ...options, headers });

    // RESTAURADO: Se o token expirar (401), desloga o usuário na hora
    if (res.status === 401) {
      if (typeof Auth !== 'undefined' && Auth.logout) {
        Auth.logout();
      }
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      throw new Error((data && data.error) || `Erro na requisição (${res.status})`);
    }
    return data;
  }

  return {
    login: (username, password) =>
      request('/auth', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),

    getTransactions: () => request('/transactions'),
    
    createTransaction: (payload) =>
      request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    
    updateTransaction: (payload) =>
      request('/transactions', { method: 'PUT', body: JSON.stringify(payload) }),
    
    // ADICIONADO: Suporte a exclusão individual ou em cascata (todo o grupo)
    deleteTransaction: (id, deleteGroup = false) =>
      request(`/transactions?id=${encodeURIComponent(id)}&deleteGroup=${deleteGroup}`, { method: 'DELETE' }),

    getSettings: () => request('/settings'),
    
    updateSettings: (payload) =>
      request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),

    getAudit: () => request('/audit'),
  };
})();
