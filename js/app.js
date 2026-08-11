const App = (() => {
  const state = {
    user: null,
    transactions: [],
    settings: null,
    months: [],
    view: 'dashboard',
    dashboardMonthKey: null, // Controle de navegação de meses no Início
    filterMonth: null,
    filterPerson: 'todos',
    filterType: 'todos',
    editingId: null,
  };

  const PAYMENT_METHODS = [
    { id: 'dinheiro', label: 'Dinheiro' },
    { id: 'debito', label: 'Débito' },
    { id: 'cartao', label: 'Cartão de crédito' },
    { id: 'pix', label: 'Pix' },
    { id: 'transferencia', label: 'Transferência' },
  ];

  function el(sel, root = document) { return root.querySelector(sel); }
  function els(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

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
    state.months = Utils.buildMonthlySummary(state.transactions);
  }

  let pollHandle = null;
  function startPolling() {
    if (pollHandle) clearInterval(pollHandle);
    // Near-live sync: since two people may be using the app at once,
    // refresh quietly every 25s so entries made on the other phone show up.
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

    // COLE O DELEGADOR AQUI!
    // Agora ele funciona porque o view-container já foi criado no innerHTML acima.
    el('#view-container').addEventListener('click', async (e) => {
      const btnEdit = e.target.closest('[data-edit]');
      if(btnEdit) {
          openTransactionModal(btnEdit.dataset.edit);
      }

      const btnDelete = e.target.closest('[data-delete]');
      if(btnDelete) {
          if (!confirm('Tem certeza que deseja excluir?')) return;
          try {
            await Api.deleteTransaction(btnDelete.dataset.delete);
            await loadData();
            renderView();
            showToast('Lançamento excluído.', 'success');
          } catch (err) { showToast(err.message, 'danger'); }
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

    attachViewHandlers();
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
    const months = state.months;
    // Lógica de navegação de meses
    if(!state.dashboardMonthKey) state.dashboardMonthKey = Utils.currentMonthKey();
    let currentIdx = months.findIndex(m => m.key === state.dashboardMonthKey);
    
    // Se não tem lançamentos nesse mês ainda, cria um mês virtual zerado
    const currentMonth = currentIdx !== -1 ? months[currentIdx] : { key: state.dashboardMonthKey, receitas: 0, gastos: 0, saldoMes: 0, saldoFinal: 0, byPerson: {}, byPersonCard: {}, acerto: {} };
    
    const prevKey = currentIdx > 0 ? months[currentIdx - 1].key : null;
    const nextKey = currentIdx !== -1 && currentIdx < months.length - 1 ? months[currentIdx + 1].key : null;

    const limite = (state.settings && state.settings.creditCardLimit) || 0;
    const usoCartao = Utils.currentCreditCardUsage(state.transactions, state.dashboardMonthKey);
    const disponivel = limite - usoCartao;

    return `
      <section class="view-header" style="justify-content: center; text-align: center; flex-direction: column;">
        <h1 style="font-size: 20px; color: var(--ink-faint);">Visão Geral</h1>
        <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
          <button class="icon-btn" onclick="App.changeDashMonth('${prevKey}')" ${!prevKey ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>
          <h2 style="font-size: 24px; min-width: 200px;">${Utils.monthLabel(state.dashboardMonthKey)}</h2>
          <button class="icon-btn" onclick="App.changeDashMonth('${nextKey}')" ${!nextKey ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>
        </div>
      </section>

      <section class="metrics-grid">
        <div class="metric-card ${currentMonth.saldoFinal >= 0 ? 'positive' : 'negative'}">
          <span class="metric-label">Saldo Acumulado (Total)</span>
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
        <span><strong>Acerto de contas:</strong> ${personName(currentMonth.acerto.devedor)} deve <strong>${Utils.fmtBRL(currentMonth.acerto.valor)}</strong> para ${personName(currentMonth.acerto.credor)} referente às contas em comum deste mês.</span>
      </section>` : ''}

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-users"></i> Desempenho Individual</h2></div>
        <div class="grid-2">
          ${getPeople().map(p => `
            <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 16px;">
              <h3 style="margin-bottom: 12px; color: ${p.color};">${p.name}</h3>
              <p style="display:flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px;">
                <span class="muted-small">Total pago:</span> <strong>${Utils.fmtBRL(currentMonth.byPerson[p.id] || 0)}</strong>
              </p>
              <p style="display:flex; justify-content: space-between; font-size: 14px;">
                <span class="muted-small">Fatura (Cartão):</span> <strong>${Utils.fmtBRL(currentMonth.byPersonCard[p.id] || 0)}</strong>
              </p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-chart-donut"></i> Gastos por categoria</h2></div>
          <div class="chart-box"><canvas id="chart-categoria"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-credit-card"></i> Cartão Geral</h2><span class="muted-small">Limite: ${Utils.fmtBRL(limite)}</span></div>
          <div class="chart-box"><canvas id="chart-receitas-gastos"></canvas></div>
        </div>
      </section>
    `;
  }

  function buildAvisos(currentMonth, saldoAtual, limite, usoCartao) {
    const avisos = [];
    if (saldoAtual < 0) {
      avisos.push({ icon: 'ti-alert-triangle', tone: 'danger', text: 'O saldo acumulado do casal está negativo. Vale revisar os gastos do mês.' });
    }
    if (limite > 0 && usoCartao / limite >= 0.9) {
      avisos.push({ icon: 'ti-credit-card-off', tone: 'danger', text: 'Vocês já usaram mais de 90% do limite do cartão de crédito neste mês.' });
    } else if (limite > 0 && usoCartao / limite >= 0.7) {
      avisos.push({ icon: 'ti-alert-circle', tone: 'warning', text: 'O uso do cartão de crédito já passou de 70% do limite.' });
    }
    if (currentMonth && currentMonth.receitas === 0) {
      avisos.push({ icon: 'ti-cash-off', tone: 'warning', text: 'Nenhuma receita lançada este mês ainda. Não esqueçam de registrar o salário.' });
    }
    if (currentMonth && currentMonth.saldoMes < 0) {
      avisos.push({ icon: 'ti-trending-down', tone: 'warning', text: 'Os gastos deste mês já superaram as receitas registradas até agora.' });
    }
    return avisos;
  }

  function avisoCard(a) {
    return `<div class="aviso aviso-${a.tone}"><i class="ti ${a.icon}"></i><span>${a.text}</span></div>`;
  }

  function drawDashboardCharts() {
    const currentKey = Utils.currentMonthKey();
    const currentMonth = state.months.find((m) => m.key === currentKey) || { byCategory: {}, byPerson: {} };
    Charts.evolutionChart('chart-evolucao', state.months);
    Charts.incomeExpenseChart('chart-receitas-gastos', state.months);
    Charts.categoryChart('chart-categoria', currentMonth.byCategory || {});
    Charts.personChart('chart-pessoa', currentMonth.byPerson || {}, getPeople());
  }

  // ---------- LANÇAMENTOS ----------

  function viewLancamentos() {
    const monthOptions = state.months.map((m) => m.key).reverse();
    if (!monthOptions.includes(state.filterMonth)) monthOptions.unshift(state.filterMonth);

    const filtered = state.transactions
      .filter((t) => Utils.monthKey(t.date) === state.filterMonth)
      .filter((t) => state.filterPerson === 'todos' || t.paidBy === state.filterPerson)
      .filter((t) => state.filterType === 'todos' || t.type === state.filterType)
      .sort((a, b) => b.date.localeCompare(a.date));

    return `
      <section class="view-header">
        <h1>Lançamentos</h1>
        <button class="btn btn-primary" id="btn-add-transacao"><i class="ti ti-plus"></i> Novo lançamento</button>
      </section>

      <section class="filters">
        <select id="filter-month">
          ${monthOptions.map((k) => `<option value="${k}" ${k === state.filterMonth ? 'selected' : ''}>${Utils.monthLabel(k)}</option>`).join('')}
        </select>
        <select id="filter-person">
          <option value="todos">Todos</option>
          ${getPeople().map((p) => `<option value="${p.id}" ${state.filterPerson === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
        <select id="filter-type">
          <option value="todos" ${state.filterType === 'todos' ? 'selected' : ''}>Todos</option>
          <option value="receita" ${state.filterType === 'receita' ? 'selected' : ''}>Receitas</option>
          <option value="gasto" ${state.filterType === 'gasto' ? 'selected' : ''}>Gastos</option>
        </select>
      </section>

      <section class="card">
        ${filtered.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Quem</th><th>Forma</th><th class="num">Valor</th><th></th></tr>
            </thead>
            <tbody>
              ${filtered.map(rowTransacao).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state"><i class="ti ti-receipt-off"></i><p>Nenhum lançamento neste mês ainda.</p></div>`}
      </section>
    `;
  }

  function rowTransacao(t) {
    const sign = t.type === 'receita' ? '+' : '−';
    const cls = t.type === 'receita' ? 'positive' : 'negative';
    const method = PAYMENT_METHODS.find((m) => m.id === t.paymentMethod);
    return `
      <tr>
        <td>${Utils.fmtDate(t.date)}</td>
        <td>${t.category}</td>
        <td>${t.description || '—'}</td>
        <td><span class="dot" style="background:${personColor(t.paidBy)}"></span>${personName(t.paidBy)}</td>
        <td>${method ? method.label : '—'}</td>
        <td class="num ${cls}">${sign} ${Utils.fmtBRL(t.amount)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${t.id}" aria-label="Editar"><i class="ti ti-edit"></i></button>
          <button class="icon-btn" data-delete="${t.id}" aria-label="Excluir"><i class="ti ti-trash"></i></button>
        </td>
      </tr>
    `;
  }

  // ---------- HISTÓRICO ----------

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
    // placeholder while async log loads
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
      <section class="view-header"><h1>Histórico de alterações</h1><p class="subtitle">Quem mexeu, o quê e quando.</p></section>
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

  // ---------- CONFIGURAÇÕES ----------

  function viewConfig() {
    const s = state.settings || {};
    const people = s.people || [];
    return `
      <section class="view-header"><h1>Ajustes</h1></section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-credit-card"></i> Cartão de crédito</h2></div>
        <form id="form-cartao" class="form-grid">
          <label>Limite total do cartão
            <input type="number" step="0.01" min="0" id="cfg-limite" value="${s.creditCardLimit || 0}" />
          </label>
          <label>Dia de fechamento da fatura
            <input type="number" min="1" max="31" id="cfg-fechamento" value="${s.creditCardCloseDay || 1}" />
          </label>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-users"></i> Quem é quem</h2></div>
        <p class="muted-small">Cada pessoa faz login com seu próprio usuário; aqui você só define nome, papel e cor de identificação usados nos gráficos.</p>
        <form id="form-pessoas" class="form-grid">
          ${['u1', 'u2'].map((id, i) => {
            const p = people.find((p) => p.id === id) || { id, name: `Pessoa ${i + 1}`, role: '', color: i === 0 ? '#0F6E56' : '#D85A30' };
            return `
              <div class="person-fields">
                <label>Nome ${i === 0 ? state.user.id === id ? '(você)' : '' : ''}
                  <input type="text" data-person-name="${id}" value="${p.name}" />
                </label>
                <label>Vínculo
                  <input type="text" data-person-role="${id}" value="${p.role || ''}" placeholder="Ex: Servidor público, CLT" />
                </label>
                <label>Cor
                  <input type="color" data-person-color="${id}" value="${p.color || '#0F6E56'}" />
                </label>
              </div>
            `;
          }).join('')}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-history"></i> Auditoria</h2></div>
        <p class="muted-small">Veja tudo o que foi criado, editado ou excluído no sistema, com nome e horário.</p>
        <button class="btn btn-ghost" id="btn-ir-auditoria"><i class="ti ti-list-search"></i> Ver histórico de alterações</button>
      </section>
    `;
  }

  // ---------- TRANSACTION MODAL ----------

  function openTransactionModal(editId) {
    const existing = editId ? state.transactions.find(t => t.id === editId) : null;
    state.editingId = existing ? existing.id : null;
    const type = existing ? existing.type : 'gasto';
    const categories = (state.settings && state.settings.categories && state.settings.categories[type]) || [];

    const modalRoot = el('#modal-root');
    modalRoot.innerHTML = `
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
                ${categories.map((c) => `<option value="${c}" ${existing && existing.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>

            <label>Descrição (Ex: Luz, Mercado, Gasolina Irmão)
              <input type="text" id="tx-desc" value="${existing ? existing.description || '' : ''}" />
            </label>

            <label>Valor (R$)
              <input type="number" step="0.01" min="0" id="tx-amount" value="${existing ? existing.amount : ''}" required />
            </label>

            <label>Responsável (${type === 'receita' ? 'Recebeu' : 'Pagou'})
              <select id="tx-paidby">
                ${getPeople().map((p) => `<option value="${p.id}" ${(existing ? existing.paidBy : state.user.id) === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </label>

            <label id="label-payment-method">Forma de pagamento
              <select id="tx-method">
                ${PAYMENT_METHODS.map((m) => `<option value="${m.id}" ${existing && existing.paymentMethod === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
              </select>
            </label>
            
            ${!existing ? `
            <label style="flex-direction: row; align-items: center; gap: 10px; grid-column: 1 / -1;">
              <input type="checkbox" id="tx-is-fixed" style="width: 20px; height: 20px;" />
              Despesa/Receita Mensal Fixa (Salário, Aluguel, etc)
            </label>

            <label style="flex-direction: row; align-items: center; gap: 10px; grid-column: 1 / -1;">
              <input type="checkbox" id="tx-is-third" style="width: 20px; height: 20px;" />
              Dívida/Reembolso de Terceiros
            </label>

            <label id="label-installments" style="grid-column: 1 / -1;">Parcelar em quantas vezes?
              <input type="number" min="1" max="72" id="tx-installments" value="1" />
            </label>
            ` : ''}

            <div class="modal-actions">
              ${existing ? `<button type="button" class="btn btn-danger-ghost" id="btn-delete-inline"><i class="ti ti-trash"></i> Excluir</button>` : '<span></span>'}
              <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Adicionar'}</button>
            </div>
            <p id="tx-error" class="form-error hidden"></p>
          </form>
        </div>
      </div>
    `;

    // ... (Mantenha os event listeners do modal-close e segmented buttons originais) ...
    el('#modal-close').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
    els('.seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      els('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const newType = btn.dataset.tipo;
      el('#tx-type').value = newType;
      const cats = (state.settings && state.settings.categories && state.settings.categories[newType]) || [];
      el('#tx-category').innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');
      el('#label-payment-method').style.display = newType === 'gasto' ? '' : 'none';
    }));
    
    // Tratamento de exclusão
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
          payload.isFixed = el('#tx-is-fixed').checked;
          payload.isThirdParty = el('#tx-is-third').checked;
      }

      if (!payload.date || !payload.category || isNaN(payload.amount) || payload.amount <= 0) {
        el('#tx-error').textContent = 'Preencha data, categoria e valor.';
        el('#tx-error').classList.remove('hidden');
        return;
      }
      try {
        if (existing) {
          await Api.updateTransaction({ id: existing.id, ...payload });
          showToast('Atualizado.', 'success');
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
    state.editingId = null;
  }

  // ---------- TOASTS ----------

  function showToast(message, tone = 'success') {
    const root = el('#toast-root');
    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;
    toast.innerHTML = `<i class="ti ${tone === 'success' ? 'ti-check' : 'ti-alert-triangle'}"></i><span>${message}</span>`;
    root.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
  }

  // ---------- EVENT WIRING PER VIEW ----------

  function attachViewHandlers() {
    const addBtn = el('#btn-add-transacao');
    if (addBtn) addBtn.addEventListener('click', () => openTransactionModal());

    const fMonth = el('#filter-month');
    if (fMonth) fMonth.addEventListener('change', () => { state.filterMonth = fMonth.value; renderView(); });
    const fPerson = el('#filter-person');
    if (fPerson) fPerson.addEventListener('change', () => { state.filterPerson = fPerson.value; renderView(); });
    const fType = el('#filter-type');
    if (fType) fType.addEventListener('change', () => { state.filterType = fType.value; renderView(); });

    const verAuditoria = el('#btn-ver-auditoria') || el('#btn-ir-auditoria');
    if (verAuditoria) verAuditoria.addEventListener('click', () => { state.view = 'auditoria'; renderView(); });

    const formCartao = el('#form-cartao');
    if (formCartao) formCartao.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const updated = await Api.updateSettings({
          creditCardLimit: parseFloat(el('#cfg-limite').value) || 0,
          creditCardCloseDay: parseInt(el('#cfg-fechamento').value, 10) || 1,
        });
        state.settings = updated;
        showToast('Configurações do cartão salvas.', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
    });

    const formPessoas = el('#form-pessoas');
    if (formPessoas) formPessoas.addEventListener('submit', async (e) => {
      e.preventDefault();
      const people = ['u1', 'u2'].map((id) => ({
        id,
        name: el(`[data-person-name="${id}"]`).value.trim() || id,
        role: el(`[data-person-role="${id}"]`).value.trim(),
        color: el(`[data-person-color="${id}"]`).value,
      }));
      try {
        const updated = await Api.updateSettings({ people });
        state.settings = updated;
        renderView();
        showToast('Informações do casal salvas.', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }
  
  // Expõe a função de trocar o mês para o HTML chamar no onClick
  function changeDashMonth(key) {
      if(key && key !== 'null') {
          state.dashboardMonthKey = key;
          renderView();
      }
  }

  return { init, changeDashMonth };
})();

document.addEventListener('DOMContentLoaded', App.init);
