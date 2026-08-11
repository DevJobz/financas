const App = (() => {
  const state = {
    user: null,
    transactions: [],
    settings: null,
    months: [],
    view: 'dashboard',
    dashboardMonthKey: null,
    filterMonth: null,
    filterPerson: 'todos',
    filterType: 'todos',
    editingId: null,
  };

  function el(sel, root = document) { return root.querySelector(sel); }
  function els(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // Retorna métodos de pagamento mesclando os fixos com os cartões do casal
  function getPaymentMethods() {
    const base = [
      { id: 'dinheiro', label: 'Dinheiro/Conta' },
      { id: 'debito', label: 'Débito' },
      { id: 'pix', label: 'Pix' },
      { id: 'transferencia', label: 'Transferência' }
    ];
    const cards = (state.settings && state.settings.cards) || [];
    cards.forEach(c => base.push({ id: `card_${c.id}`, label: `Cartão: ${c.name}` }));
    return base;
  }

  // ---------- BOOTSTRAP ----------

  async function init() {
    if (!Auth.isLoggedIn()) {
      renderLogin();
      return;
    }
    state.user = Auth.getUser();
    await bootApp();
  }

  async function bootApp() {
    renderShell();
    try {
      await loadData();
      state.filterMonth = state.months.length ? state.months[state.months.length - 1].key : Utils.currentMonthKey();
      renderView();
      startPolling();
    } catch (e) {
      showToast(e.message, 'danger');
    }
  }

  async function loadData() {
    const [transactions, settings] = await Promise.all([Api.getTransactions(), Api.getSettings()]);
    state.transactions = transactions.sort((a, b) => a.date.localeCompare(b.date));
    state.settings = settings;
    state.months = Utils.buildMonthlySummary(state.transactions, state.settings);
  }

  let pollHandle = null;
  function startPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(async () => {
      try {
        await loadData();
        renderView(true);
      } catch (e) { /* silent */ }
    }, 25000);
  }

  // ---------- LOGIN ----------

  function renderLogin() {
    document.getElementById('root').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-brand">
            <div class="login-mark">
              <i class="ti ti-heart-handshake"></i>
            </div>
            <h1>Finanças a Dois</h1>
            <p>Renda conjunta, decisões juntos.</p>
          </div>
          <form id="login-form" class="login-form">
            <label>Usuário
              <input type="text" id="login-user" autocomplete="username" required />
            </label>
            <label>Senha
              <input type="password" id="login-pass" autocomplete="current-password" required />
            </label>
            <button type="submit" class="btn btn-primary btn-block">
              <span id="login-btn-text">Entrar</span>
            </button>
            <p id="login-error" class="form-error hidden"></p>
          </form>
        </div>
      </div>
    `;

    el('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = el('#login-user').value.trim();
      const password = el('#login-pass').value;
      const btnText = el('#login-btn-text');
      const errorEl = el('#login-error');
      
      errorEl.classList.add('hidden');
      btnText.textContent = 'Entrando...';
      
      try {
        const { token, user } = await Api.login(username, password);
        Auth.saveSession(token, user);
        state.user = user;
        await bootApp();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        btnText.textContent = 'Entrar';
      }
    });
  }

  // ---------- SHELL ----------

  function renderShell() {
    document.getElementById('root').innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-brand"><i class="ti ti-heart-handshake"></i> Finanças a Dois</div>
          <div class="topbar-user">
            <span class="user-chip" style="--chip-color:${state.user.color || '#0F6E56'}">${state.user.name}</span>
            <button class="icon-btn" id="btn-logout" title="Sair" aria-label="Sair"><i class="ti ti-logout"></i></button>
          </div>
        </header>

        <main id="view-container" class="view-container"></main>

        <nav class="floating-nav">
          <button class="nav-item" data-view="dashboard"><i class="ti ti-layout-dashboard"></i><span>Início</span></button>
          <button class="nav-item" data-view="lancamentos"><i class="ti ti-list-details"></i><span>Lançamentos</span></button>
          <button class="nav-item nav-fab" id="btn-add-fab"><i class="ti ti-plus"></i></button>
          <button class="nav-item" data-view="historico"><i class="ti ti-chart-line"></i><span>Histórico</span></button>
          <button class="nav-item" data-view="config"><i class="ti ti-settings"></i><span>Ajustes</span></button>
        </nav>
      </div>
      <div id="modal-root"></div>
      <div id="toast-root" class="toast-root"></div>
    `;

    el('#btn-logout').addEventListener('click', Auth.logout);
    
    els('.nav-item[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => { state.view = btn.dataset.view; renderView(); })
    );
    
    el('#btn-add-fab').addEventListener('click', () => openTransactionModal());

    // Delegador Global de Eventos
    el('#view-container').addEventListener('click', async (e) => {
      // Evento de Editar
      const btnEdit = e.target.closest('[data-edit]');
      if (btnEdit) {
          openTransactionModal(btnEdit.dataset.edit);
      }

      // Evento de Excluir
      const btnDelete = e.target.closest('[data-delete]');
      if (btnDelete) {
          if (!confirm('Tem certeza que deseja excluir este lançamento?')) return;
          try {
            await Api.deleteTransaction(btnDelete.dataset.delete);
            await loadData();
            renderView();
            showToast('Lançamento excluído.', 'success');
          } catch (err) { showToast(err.message, 'danger'); }
      }

      // Evento de Navegar para Auditoria
      const btnAuditoria = e.target.closest('#btn-ver-auditoria, #btn-ir-auditoria');
      if (btnAuditoria) {
          state.view = 'auditoria';
          renderView();
      }
    });
  }

  function setActiveNav() {
    els('.nav-item[data-view]').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === state.view));
  }

  // ---------- VIEW ROUTER ----------

  function renderView(silent) {
    setActiveNav();
    const container = el('#view-container');
    if (!container) return;
    
    const scrollY = window.scrollY;
    
    if (state.view === 'dashboard') container.innerHTML = viewDashboard();
    else if (state.view === 'lancamentos') container.innerHTML = viewLancamentos();
    else if (state.view === 'historico') container.innerHTML = viewHistorico();
    else if (state.view === 'config') container.innerHTML = viewConfig();
    else if (state.view === 'auditoria') container.innerHTML = viewAuditoria();

    if (state.view === 'config') attachConfigHandlers();
    if (state.view === 'dashboard') drawDashboardCharts();
    if (state.view === 'historico') drawHistoricoChart();
    
    if (silent) window.scrollTo(0, scrollY);
  }

  function getPeople() {
    return (state.settings && state.settings.people) || [];
  }
  
  function personName(id) {
    const p = getPeople().find((p) => p.id === id);
    return p ? p.name : 'Não identificado';
  }
  
  function personColor(id) {
    const p = getPeople().find((p) => p.id === id);
    return p ? p.color : '#888780';
  }

  // ---------- DASHBOARD ----------

  function viewDashboard() {
    if(!state.dashboardMonthKey) state.dashboardMonthKey = Utils.currentMonthKey();
    let currentIdx = state.months.findIndex(m => m.key === state.dashboardMonthKey);
    const currentMonth = currentIdx !== -1 ? state.months[currentIdx] : { key: state.dashboardMonthKey, receitas: 0, gastos: 0, saldoMes: 0, saldoFinal: 0, byPerson: {}, byPersonRenda: {}, byPersonCard: {}, acerto: {}, byCategoryPerson: {} };

    return `
      <section class="view-header" style="justify-content: center; text-align: center; flex-direction: column;">
        <h1 style="font-size: 20px; color: var(--ink-faint);">Visão Geral</h1>
        <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
          <button class="icon-btn" onclick="App.changeDashMonth(-1)"><i class="ti ti-chevron-left"></i></button>
          <h2 style="font-size: 24px; min-width: 200px;">${Utils.monthLabel(state.dashboardMonthKey)}</h2>
          <button class="icon-btn" onclick="App.changeDashMonth(1)"><i class="ti ti-chevron-right"></i></button>
        </div>
      </section>

      <section class="metrics-grid">
        <div class="metric-card ${currentMonth.saldoFinal >= 0 ? 'positive' : 'negative'}">
          <span class="metric-label">Saldo Acumulado</span>
          <span class="metric-value">${Utils.fmtBRL(currentMonth.saldoFinal)}</span>
        </div>
        <div class="metric-card ${currentMonth.saldoMes >= 0 ? 'positive' : 'negative'}">
          <span class="metric-label">Resultado do Mês</span>
          <span class="metric-value">${Utils.fmtBRL(currentMonth.saldoMes)}</span>
        </div>
      </section>

      ${currentMonth.acerto && currentMonth.acerto.valor > 0 ? `
      <section class="aviso aviso-warning" style="justify-content: center;">
        <i class="ti ti-scale"></i>
        <span><strong>Acerto:</strong> ${personName(currentMonth.acerto.devedor)} deve <strong>${Utils.fmtBRL(currentMonth.acerto.valor)}</strong> para ${personName(currentMonth.acerto.credor)}.</span>
      </section>` : ''}

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-users"></i> Desempenho Individual</h2></div>
        
        <!-- Barra de Proporção de Renda -->
        ${currentMonth.receitas > 0 ? `
        <div style="margin-bottom: 20px;">
          <p class="muted-small" style="margin-bottom: 6px;">Proporção da Renda Conjunta neste mês:</p>
          <div style="display: flex; height: 12px; border-radius: 999px; overflow: hidden; background: var(--surface-sunken);">
            ${getPeople().map(p => {
              const val = currentMonth.byPersonRenda[p.id] || 0;
              const pct = (val / currentMonth.receitas) * 100;
              return pct > 0 ? `<div style="width: ${pct}%; background: ${p.color};" title="${p.name}: ${pct.toFixed(1)}%"></div>` : '';
            }).join('')}
          </div>
        </div>` : ''}

        <div class="grid-2">
          ${getPeople().map(p => {
            const myCats = (currentMonth.byCategoryPerson && currentMonth.byCategoryPerson[p.id]) || {};
            const catHtml = Object.entries(myCats).sort((a,b) => b[1]-a[1]).map(([c, v]) => `
              <div style="display:flex; justify-content:space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed var(--line);">
                <span class="muted-small">${c}</span> <strong>${Utils.fmtBRL(v)}</strong>
              </div>
            `).join('');

            return `
            <details class="person-details" style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 16px;">
              <summary style="cursor: pointer; outline: none; display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: ${p.color};">
                ${p.name}
                <i class="ti ti-chevron-down muted-small"></i>
              </summary>
              <div style="margin-top: 12px;">
                <p style="display:flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px;">
                  <span class="muted-small">Gasto Total:</span> <strong>${Utils.fmtBRL(currentMonth.byPerson[p.id] || 0)}</strong>
                </p>
                <p style="display:flex; justify-content: space-between; font-size: 14px; margin-bottom: 16px;">
                  <span class="muted-small">Fatura Cartões:</span> <strong>${Utils.fmtBRL(currentMonth.byPersonCard[p.id] || 0)}</strong>
                </p>
                <p class="muted-small" style="text-transform: uppercase; font-size: 11px; font-weight: bold; margin-bottom: 4px;">Top Gastos</p>
                ${catHtml || '<p class="muted-small" style="font-size:12px;">Nenhum gasto registrado.</p>'}
              </div>
            </details>
          `}).join('')}
        </div>
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-chart-donut"></i> Gastos Gerais (Casal)</h2></div>
          <div class="chart-box"><canvas id="chart-categoria"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-chart-bar"></i> Receitas x Gastos</h2></div>
          <div class="chart-box"><canvas id="chart-receitas-gastos"></canvas></div>
        </div>
      </section>
    `;
  }

  function changeDashMonth(offset) {
    let d = new Date(state.dashboardMonthKey + '-01T12:00:00');
    d.setMonth(d.getMonth() + offset);
    state.dashboardMonthKey = d.toISOString().slice(0, 7);
    renderView();
  }

  function drawDashboardCharts() {
    const currentMonth = state.months.find(m => m.key === state.dashboardMonthKey) || { byCategory: {} };
    Charts.incomeExpenseChart('chart-receitas-gastos', state.months.slice(-6));
    Charts.categoryChart('chart-categoria', currentMonth.byCategory || {});
  }

  // ---------- LANÇAMENTOS ----------

  function viewLancamentos() {
    const monthOptions = state.months.map(m => m.key).reverse();
    if (!monthOptions.includes(state.filterMonth)) monthOptions.unshift(state.filterMonth);

    const filtered = state.months.find(m => m.key === state.filterMonth)?.items || [];
    const list = filtered
      .filter(t => state.filterPerson === 'todos' || t.paidBy === state.filterPerson)
      .filter(t => state.filterType === 'todos' || t.type === state.filterType)
      .sort((a, b) => b.date.localeCompare(a.date));

    return `
      <section class="view-header">
        <h1>Lançamentos</h1>
        <button class="btn btn-primary" id="btn-add-transacao"><i class="ti ti-plus"></i> Novo</button>
      </section>

      <section class="filters">
        <select id="filter-month" onchange="App.setFilter('month', this.value)">
          ${monthOptions.map((k) => `<option value="${k}" ${k === state.filterMonth ? 'selected' : ''}>${Utils.monthLabel(k)}</option>`).join('')}
        </select>
        <select id="filter-person" onchange="App.setFilter('person', this.value)">
          <option value="todos">Todos</option>
          ${getPeople().map((p) => `<option value="${p.id}" ${state.filterPerson === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
        <select id="filter-type" onchange="App.setFilter('type', this.value)">
          <option value="todos" ${state.filterType === 'todos' ? 'selected' : ''}>Todos</option>
          <option value="receita" ${state.filterType === 'receita' ? 'selected' : ''}>Receitas</option>
          <option value="gasto" ${state.filterType === 'gasto' ? 'selected' : ''}>Gastos</option>
        </select>
      </section>

      <section class="card">
        ${list.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Quem</th><th>Forma</th><th class="num">Valor</th><th class="col-actions"></th></tr>
            </thead>
            <tbody>
              ${list.map(rowTransacao).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state"><i class="ti ti-receipt-off"></i><p>Nenhum registro encontrado.</p></div>`}
      </section>
    `;
  }

  function setFilter(type, val) {
    if(type === 'month') state.filterMonth = val;
    if(type === 'person') state.filterPerson = val;
    if(type === 'type') state.filterType = val;
    renderView();
  }

  function rowTransacao(t) {
    const sign = t.type === 'receita' ? '+' : '−';
    const cls = t.type === 'receita' ? 'positive' : 'negative';
    const method = getPaymentMethods().find(m => m.id === t.paymentMethod);
    
    let desc = t.description || '—';
    if(t.installmentLabel) desc += ` <span class="muted-small">(${t.installmentLabel})</span>`;
    if(t.isThirdParty) desc += ` <br><small style="color:var(--warning)">[Terceiro: ${t.thirdPartyName || '?'} | Receber: ${Utils.fmtDate(t.thirdPartyDate)}]</small>`;
    
    const btnHtml = t.isVirtual 
      ? `<button class="icon-btn" onclick="alert('Lançamento Fixo automático. Edite em Ajustes ou adicione um lançamento manual igual para sobrescrever neste mês.')"><i class="ti ti-lock"></i></button>`
      : `<button class="icon-btn" data-edit="${t.id}" aria-label="Editar" title="Editar"><i class="ti ti-edit"></i></button>
         <button class="icon-btn" data-delete="${t.id}" aria-label="Excluir" title="Excluir"><i class="ti ti-trash"></i></button>`;

    return `
      <tr>
        <td>${Utils.fmtDate(t.date)}</td>
        <td>${t.category}</td>
        <td>${desc}</td>
        <td><span class="dot" style="background:${personColor(t.paidBy)}"></span>${personName(t.paidBy)}</td>
        <td>${method ? method.label : '—'}</td>
        <td class="num ${cls}">${sign} ${Utils.fmtBRL(t.amount)}</td>
        <td class="row-actions" style="min-width: 96px; display: flex; justify-content: flex-end; gap: 4px; border: none;">${btnHtml}</td>
      </tr>
    `;
  }

  // ---------- TRANSACTION MODAL ----------

  function openTransactionModal(editId) {
    const existing = editId ? state.transactions.find(t => t.id === editId) : null;
    const type = existing ? existing.type : 'gasto';
    const categories = (state.settings && state.settings.categories && state.settings.categories[type]) || [];

    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${existing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-transacao" class="form-grid">
            <div class="segmented" id="tipo-segmented">
              <button type="button" class="seg-btn ${type === 'gasto' ? 'active' : ''}" data-tipo="gasto">Gasto</button>
              <button type="button" class="seg-btn ${type === 'receita' ? 'active' : ''}" data-tipo="receita">Receita</button>
            </div>
            <input type="hidden" id="tx-type" value="${type}" />
            
            <label>Data
              <input type="date" id="tx-date" value="${existing ? existing.date : new Date().toISOString().slice(0, 10)}" required />
            </label>
            <label>Categoria
              <select id="tx-category">
                ${categories.map(c => `<option value="${c}" ${existing && existing.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>
            <label>Descrição
              <input type="text" id="tx-desc" value="${existing ? existing.description || '' : ''}" />
            </label>
            <label>Valor (R$)
              <input type="number" step="0.01" min="0" id="tx-amount" value="${existing ? existing.amount : ''}" required />
            </label>
            <label>Responsável
              <select id="tx-paidby">
                ${getPeople().map(p => `<option value="${p.id}" ${(existing ? existing.paidBy : state.user.id) === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </label>
            <label id="label-payment-method" style="display:${type === 'gasto' ? 'flex' : 'none'};">Forma de pagamento
              <select id="tx-method">
                ${getPaymentMethods().map(m => `<option value="${m.id}" ${existing && existing.paymentMethod === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
              </select>
            </label>
            
            ${!existing ? `
            <div style="grid-column: 1 / -1; border-top: 1px solid var(--line); margin-top: 10px; padding-top: 10px;">
              <label style="flex-direction: row; align-items: center; gap: 10px; margin-bottom: 12px;">
                <input type="checkbox" id="tx-is-third" style="width: 20px; height: 20px;" />
                É dívida ou reembolso de Terceiros?
              </label>
              <div id="third-party-fields" style="display:none; grid-template-columns: 1fr 1fr; gap: 14px; background: var(--surface-sunken); padding: 14px; border-radius: var(--radius-sm); margin-bottom: 12px;">
                <label style="margin:0">Nome do Terceiro<input type="text" id="tx-third-name" placeholder="Ex: Irmão" /></label>
                <label style="margin:0">Data prevista p/ receber<input type="date" id="tx-third-date" /></label>
              </div>
              <label id="label-installments">Parcelar em quantas vezes?
                <input type="number" min="1" max="72" id="tx-installments" value="1" />
              </label>
            </div>
            ` : ''}
            
            <div class="modal-actions" style="grid-column:1/-1;">
              ${existing ? `<button type="button" class="btn btn-danger-ghost" id="btn-delete-inline"><i class="ti ti-trash"></i> Excluir</button>` : '<span></span>'}
              <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Adicionar'}</button>
            </div>
            <p id="tx-error" class="form-error hidden" style="grid-column:1/-1;"></p>
          </form>
        </div>
      </div>
    `;

    el('#modal-close').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    if(!existing) {
      el('#tx-is-third').addEventListener('change', (e) => {
        el('#third-party-fields').style.display = e.target.checked ? 'grid' : 'none';
      });
    }

    els('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
      els('.seg-btn').forEach(b => b.classList.remove('active')); 
      btn.classList.add('active');
      
      const newType = btn.dataset.tipo; 
      el('#tx-type').value = newType;
      
      const cats = (state.settings && state.settings.categories && state.settings.categories[newType]) || [];
      el('#tx-category').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
      el('#label-payment-method').style.display = newType === 'gasto' ? 'flex' : 'none';
    }));

    if (existing) {
      el('#btn-delete-inline').addEventListener('click', async () => {
        if (!confirm('Excluir este lançamento?')) return;
        try { 
          await Api.deleteTransaction(existing.id); 
          closeModal(); 
          await loadData(); 
          renderView(); 
          showToast('Lançamento excluído.', 'success'); 
        } catch (e) { showToast(e.message, 'danger'); }
      });
    }

    el('#form-transacao').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        date: el('#tx-date').value, 
        type: el('#tx-type').value, 
        category: el('#tx-category').value,
        description: el('#tx-desc').value.trim(), 
        amount: parseFloat(el('#tx-amount').value),
        paidBy: el('#tx-paidby').value, 
        paymentMethod: el('#tx-type').value === 'gasto' ? el('#tx-method').value : null,
      };
      
      if(!existing) {
        payload.installments = parseInt(el('#tx-installments').value) || 1;
        payload.isThirdParty = el('#tx-is-third').checked;
        if(payload.isThirdParty) {
          payload.thirdPartyName = el('#tx-third-name').value.trim();
          payload.thirdPartyDate = el('#tx-third-date').value;
        }
      }

      if (!payload.date || !payload.category || isNaN(payload.amount) || payload.amount <= 0) { 
        el('#tx-error').textContent = 'Preencha os campos corretamente.'; 
        el('#tx-error').classList.remove('hidden'); 
        return; 
      }
      
      try {
        if (existing) { 
          await Api.updateTransaction({ id: existing.id, ...payload }); 
          showToast('Lançamento atualizado.', 'success'); 
        } else { 
          await Api.createTransaction(payload); 
          showToast(payload.installments > 1 ? 'Parcelas geradas!' : 'Adicionado.', 'success'); 
        }
        closeModal(); 
        await loadData(); 
        renderView();
      } catch (err) { 
        el('#tx-error').textContent = err.message; 
        el('#tx-error').classList.remove('hidden'); 
      }
    });
  }

  function closeModal() {
    el('#modal-root').innerHTML = '';
  }

  // ---------- HISTÓRICO MENSAL ----------

  function viewHistorico() {
    const rows = [...state.months].reverse();
    return `
      <section class="view-header">
        <h1>Histórico mensal</h1>
        <p class="subtitle">O saldo que sobra em um mês soma automaticamente ao próximo.</p>
      </section>

      <section class="card">
        <div class="chart-box"><canvas id="chart-historico"></canvas></div>
      </section>

      <section class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Mês</th><th class="num">Saldo inicial</th><th class="num">Receitas</th><th class="num">Gastos</th><th class="num">Saldo do mês</th><th class="num">Saldo final</th></tr>
            </thead>
            <tbody>
              ${rows.map((m) => `
                <tr>
                  <td>${Utils.monthLabel(m.key)}</td>
                  <td class="num">${Utils.fmtBRL(m.saldoInicial)}</td>
                  <td class="num positive">${Utils.fmtBRL(m.receitas)}</td>
                  <td class="num negative">${Utils.fmtBRL(m.gastos)}</td>
                  <td class="num ${m.saldoMes >= 0 ? 'positive' : 'negative'}">${Utils.fmtBRL(m.saldoMes)}</td>
                  <td class="num ${m.saldoFinal >= 0 ? 'positive' : 'negative'}"><strong>${Utils.fmtBRL(m.saldoFinal)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="view-header">
        <button class="btn btn-ghost" id="btn-ver-auditoria"><i class="ti ti-history"></i> Ver histórico de alterações do sistema</button>
      </section>
    `;
  }

  function drawHistoricoChart() {
    Charts.evolutionChart('chart-historico', state.months);
  }

  // ---------- AUDITORIA ----------

  async function viewAuditoriaAsync() {
    try {
      const log = await Api.getAudit();
      el('#view-container').innerHTML = renderAuditoria(log);
    } catch (e) {
      showToast(e.message, 'danger');
    }
  }

  function viewAuditoria() {
    setTimeout(viewAuditoriaAsync, 0);
    return `
      <section class="view-header"><h1>Histórico de alterações</h1></section>
      <section class="card"><div class="empty-state"><i class="ti ti-loader-2"></i><p>Carregando...</p></div></section>
    `;
  }

  const ACTION_LABELS = { create: 'criou', update: 'editou', delete: 'excluiu' };
  const ENTITY_LABELS = { transaction: 'um lançamento', settings: 'as configurações' };

  function renderAuditoria(log) {
    return `
      <section class="view-header">
        <h1>Histórico de alterações</h1>
        <p class="subtitle">Quem mexeu, o quê e quando.</p>
      </section>
      <section class="card">
        ${log.length ? `
        <ul class="audit-list">
          ${log.map((a) => `
            <li>
              <div class="audit-dot"></div>
              <div>
                <p><strong>${a.userName}</strong> ${ACTION_LABELS[a.action] || a.action} ${ENTITY_LABELS[a.entity] || a.entity}</p>
                <p class="muted-small">${Utils.fmtDateTime(a.timestamp)}</p>
              </div>
            </li>
          `).join('')}
        </ul>` : `<div class="empty-state"><i class="ti ti-history-off"></i><p>Nenhuma alteração registrada ainda.</p></div>`}
      </section>
    `;
  }

  // ---------- CONFIGURAÇÕES E FIXOS ----------

  function viewConfig() {
    const s = state.settings || {};
    const people = s.people || [];
    const cards = s.cards || [];
    const fixedEntries = s.fixedEntries || [];

    return `
      <section class="view-header"><h1>Ajustes</h1></section>
      
      <section class="card">
        <div class="card-header"><h2><i class="ti ti-pin"></i> Lançamentos Fixos Recorrentes</h2></div>
        <p class="muted-small" style="margin-bottom:12px;">Cadastre salários, aluguéis e contas fixas. Eles serão preenchidos automaticamente todo mês.</p>
        
        <div class="table-wrap" style="margin-bottom:16px;">
          <table class="data-table">
            <thead>
              <tr><th>Tipo</th><th>Descrição</th><th>Pessoa</th><th class="num">Valor</th><th></th></tr>
            </thead>
            <tbody>
              ${fixedEntries.map((f, i) => `
              <tr>
                <td>${f.type === 'receita' ? 'Receita' : 'Gasto'}</td>
                <td>${f.description} <small>(${f.category})</small></td>
                <td>${personName(f.person)}</td>
                <td class="num">${Utils.fmtBRL(f.amount)}</td>
                <td class="row-actions"><button type="button" class="icon-btn" onclick="App.deleteFixed(${i})"><i class="ti ti-trash"></i></button></td>
              </tr>`).join('')}
              ${fixedEntries.length === 0 ? '<tr><td colspan="5" class="empty-state">Nenhum lançamento fixo cadastrado.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        
        <form id="form-fixed" class="form-grid" style="background:var(--surface-sunken); padding:16px; border-radius:var(--radius-sm);">
          <h3 style="grid-column:1/-1; font-size:14px; margin-bottom:8px;">Novo Lançamento Fixo</h3>
          <label>Tipo
            <select id="cfg-f-type">
              <option value="receita">Receita</option>
              <option value="gasto">Gasto</option>
            </select>
          </label>
          <label>Categoria
            <select id="cfg-f-cat">
              ${(s.categories && s.categories.receita || []).map(c=>`<option value="${c}">${c}</option>`).join('')}
            </select>
          </label>
          <label>Descrição
            <input type="text" id="cfg-f-desc" required/>
          </label>
          <label>Valor (R$)
            <input type="number" step="0.01" id="cfg-f-amount" required/>
          </label>
          <label>Pessoa
            <select id="cfg-f-person">
              ${people.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </label>
          <button type="submit" class="btn btn-primary" style="align-self:end;">Adicionar Fixo</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-credit-card"></i> Cartões de Crédito</h2></div>
        <div class="table-wrap" style="margin-bottom:16px;">
          <table class="data-table">
            <thead>
              <tr><th>Cartão</th><th class="num">Limite</th><th class="num">Vencimento</th><th></th></tr>
            </thead>
            <tbody>
              ${cards.map((c, i) => `
              <tr>
                <td>${c.name}</td>
                <td class="num">${Utils.fmtBRL(c.limit)}</td>
                <td class="num">Dia ${c.closeDay}</td>
                <td class="row-actions"><button type="button" class="icon-btn" onclick="App.deleteCard(${i})"><i class="ti ti-trash"></i></button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <form id="form-card" class="form-grid" style="background:var(--surface-sunken); padding:16px; border-radius:var(--radius-sm);">
          <label>Nome do Cartão
            <input type="text" id="cfg-c-name" required/>
          </label>
          <label>Limite (R$)
            <input type="number" step="0.01" id="cfg-c-limit" required/>
          </label>
          <label>Vencimento (Dia)
            <input type="number" min="1" max="31" id="cfg-c-day" required/>
          </label>
          <button type="submit" class="btn btn-primary" style="align-self:end;">Adicionar Cartão</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-users"></i> Quem é quem</h2></div>
        <p class="muted-small">As cores e os papéis definem as etiquetas nos gráficos.</p>
        <form id="form-pessoas" class="form-grid" style="margin-top: 14px;">
          ${['u1', 'u2'].map((id, i) => {
            const p = people.find((p) => p.id === id) || { id, name: `Pessoa ${i + 1}`, role: '', color: i === 0 ? '#0F6E56' : '#D85A30' };
            return `
            <div class="person-fields">
              <label>Nome
                <input type="text" data-person-name="${id}" value="${p.name}" />
              </label>
              <label>Vínculo
                <input type="text" data-person-role="${id}" value="${p.role || ''}" />
              </label>
              <label>Cor
                <input type="color" data-person-color="${id}" value="${p.color || '#0F6E56'}" />
              </label>
            </div>`;
          }).join('')}
          <button type="submit" class="btn btn-primary" style="grid-column:1/-1">Salvar Nomes e Cores</button>
        </form>
      </section>
      
      <section class="card">
        <div class="card-header"><h2><i class="ti ti-history"></i> Auditoria</h2></div>
        <p class="muted-small">Veja tudo o que foi criado, editado ou excluído no sistema, com nome e horário.</p>
        <button class="btn btn-ghost" id="btn-ir-auditoria" style="margin-top: 10px;">
          <i class="ti ti-list-search"></i> Ver histórico de alterações
        </button>
      </section>
    `;
  }

  function attachConfigHandlers() {
    el('#cfg-f-type')?.addEventListener('change', (e) => {
      const type = e.target.value;
      const cats = (state.settings.categories && state.settings.categories[type]) || [];
      el('#cfg-f-cat').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    });
    
    el('#form-fixed')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fixedEntries = [...(state.settings.fixedEntries || [])];
      fixedEntries.push({
        id: crypto.randomUUID(), 
        type: el('#cfg-f-type').value, 
        category: el('#cfg-f-cat').value,
        description: el('#cfg-f-desc').value.trim(), 
        amount: parseFloat(el('#cfg-f-amount').value), 
        person: el('#cfg-f-person').value
      });
      await saveSettings({ fixedEntries });
    });

    el('#form-card')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cards = [...(state.settings.cards || [])];
      cards.push({
        id: crypto.randomUUID(), 
        name: el('#cfg-c-name').value.trim(),
        limit: parseFloat(el('#cfg-c-limit').value), 
        closeDay: parseInt(el('#cfg-c-day').value)
      });
      await saveSettings({ cards });
    });

    el('#form-pessoas')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const people = ['u1', 'u2'].map(id => ({
        id, 
        name: el(`[data-person-name="${id}"]`).value.trim() || id,
        role: el(`[data-person-role="${id}"]`).value.trim(), 
        color: el(`[data-person-color="${id}"]`).value,
      }));
      await saveSettings({ people });
    });
  }

  async function saveSettings(partialUpdate) {
    try {
      state.settings = await Api.updateSettings(partialUpdate);
      await loadData(); 
      renderView(); 
      showToast('Ajustes salvos com sucesso!', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  }

  async function deleteFixed(idx) {
    if (!confirm('Deseja excluir este lançamento fixo?')) return;
    const fixedEntries = [...state.settings.fixedEntries]; 
    fixedEntries.splice(idx, 1);
    await saveSettings({ fixedEntries });
  }

  async function deleteCard(idx) {
    if (!confirm('Deseja excluir este cartão?')) return;
    const cards = [...state.settings.cards]; 
    cards.splice(idx, 1);
    await saveSettings({ cards });
  }

  // ---------- TOASTS (Notificações) ----------

  function showToast(message, tone = 'success') {
    const root = el('#toast-root');
    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;
    toast.innerHTML = `<i class="ti ${tone === 'success' ? 'ti-check' : 'ti-alert-triangle'}"></i><span>${message}</span>`;
    root.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { 
      toast.classList.remove('show'); 
      setTimeout(() => toast.remove(), 300); 
    }, 3500);
  }

  // ---------- FUNÇÕES EXPOSTAS PARA O HTML ----------

  function changeDashMonth(param) {
    if (!param || param === 'null') return;
    
    if (typeof param === 'number') {
      // Quando clica nas setas do Dashboard (-1 ou 1)
      let d = new Date(state.dashboardMonthKey + '-01T12:00:00');
      d.setMonth(d.getMonth() + param);
      state.dashboardMonthKey = d.toISOString().slice(0, 7);
    } else {
      // Quando seleciona o mês direto no filtro
      state.dashboardMonthKey = param;
    }
    renderView();
  }

  // Mantenha o return fechando o módulo!
  return { init, changeDashMonth, setFilter, deleteFixed, deleteCard };
})();

document.addEventListener('DOMContentLoaded', App.init);