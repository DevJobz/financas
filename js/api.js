const Api = (() => {
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

    // Se o token expirar (401), desloga o usuário na hora
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

  // TUDO QUE É EXPORTADO VAI AQUI DENTRO DO RETURN
  return {
    login: (username, password) => request('/auth', { method: 'POST', body: JSON.stringify({ username, password }) }),

    // Lançamentos Financeiros
    getTransactions: () => request('/transactions'),
    createTransaction: (payload) => request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    updateTransaction: (payload) => request('/transactions', { method: 'PUT', body: JSON.stringify(payload) }),
    deleteTransaction: (id, deleteGroup = false) => request(`/transactions?id=${encodeURIComponent(id)}&deleteGroup=${deleteGroup}`, { method: 'DELETE' }),

    // Configurações e Auditoria
    getSettings: () => request('/settings'),
    updateSettings: (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
    getAudit: () => request('/audit'),

    // --- MÓDULO DE REGISTROS, LISTAS E LIFE HUB ---
    getRecords: () => request('/records'),
    saveRecord: (payload) => request('/records', { method: 'POST', body: JSON.stringify(payload) }),
    deleteRecord: (id) => request(`/records?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  };
})();