const Api = (() => {
  const BASE = '/api';

  function getToken() {
    return localStorage.getItem('fc_token');
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, { ...options, headers });

    if (res.status === 401) {
      Auth.logout();
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
      fetch(`${BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha no login');
        return data;
      }),

    getTransactions: () => request('/transactions'),
    createTransaction: (payload) =>
      request('/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    updateTransaction: (payload) =>
      request('/transactions', { method: 'PUT', body: JSON.stringify(payload) }),
    deleteTransaction: (id) =>
      request(`/transactions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

    getSettings: () => request('/settings'),
    updateSettings: (payload) =>
      request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),

    getAudit: () => request('/audit'),
  };
})();
