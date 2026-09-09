const App = (() => {
  const state = {
    user: null,
    transactions: [],
    settings: null,
    months: [],
    view: 'dashboard',
    dashboardMonthKey: null,
    dashFilterPerson: 'todos',
    filterMonth: null,
    filterPerson: 'todos',
    filterType: 'todos',
        filterStatus: 'todos', // NOVO: Filtro de OK/Aberto
    filterSort: 'date_desc', // NOVO: Ordenação da lista de lançamentos
    selectedTxs: [],       // NOVO: Guarda os lançamentos selecionados em massa
    editingId: null,
  };

  function el(sel, root = document) { return root.querySelector(sel); }
  function els(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

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

    // DELEGADOR GLOBAL DE EVENTOS
    el('#view-container').addEventListener('click', async (e) => {
      
      // 1. Marca/Desmarca Todos os Checkboxes
      const checkAll = e.target.closest('#check-all-txs');
      if (checkAll) {
         const visibleTxs = Array.from(document.querySelectorAll('.tx-check')).map(cb => cb.dataset.checkId);
         if (checkAll.checked) {
             visibleTxs.forEach(id => { if (!state.selectedTxs.includes(id)) state.selectedTxs.push(id); });
         } else {
             state.selectedTxs = state.selectedTxs.filter(id => !visibleTxs.includes(id));
         }
         renderView(true);
      }

      // 2. Clica em um Checkbox Individual
      const txCheck = e.target.closest('.tx-check');
      if (txCheck) {
         const id = txCheck.dataset.checkId;
         if (txCheck.checked) {
             if (!state.selectedTxs.includes(id)) state.selectedTxs.push(id);
         } else {
             state.selectedTxs = state.selectedTxs.filter(txId => txId !== id);
         }
         renderView(true);
      }

      // 3. Status Rápido Direto no Botão Redondo (OK/Aberto)
      const btnToggle = e.target.closest('[data-toggle-status]');
      if (btnToggle) {
          const tId = btnToggle.dataset.toggleStatus;
          const t = state.transactions.find(tx => tx.id === tId);
          if (t) {
              const newStatus = t.status === 'ok' ? 'aberto' : 'ok';
              try {
                  await Api.updateTransaction({ id: tId, status: newStatus });
                  await loadData();
                  renderView(true);
              } catch (err) { showToast(err.message, 'danger'); }
          }
      }

      // 4. Ações em Massa (Os Botões da Barra Azul)
      const btnBulkOk = e.target.closest('#btn-bulk-ok');
      const btnBulkAberto = e.target.closest('#btn-bulk-aberto');
      if (btnBulkOk || btnBulkAberto) {
          const status = btnBulkOk ? 'ok' : 'aberto';
          try {
              // CORREÇÃO: Utilizando a rota oficial do app (que já injeta o token blindado)
              await Api.updateTransaction({ bulkUpdate: true, ids: state.selectedTxs, status });
              
              state.selectedTxs = [];
              await loadData();
              renderView(true);
              showToast(status === 'ok' ? 'Lançamentos cruzados como OK!' : 'Lançamentos reabertos!', 'success');
          } catch(err) { showToast(err.message, 'danger'); }
      }

      // 5. Ações Específicas para Lançamentos Fixos (Materialização)
      const btnVirtualOk = e.target.closest('[data-virtual-ok]');
      if (btnVirtualOk) {
          const vId = btnVirtualOk.dataset.virtualOk;
          const vTx = state.months.flatMap(m => m.items).find(tx => tx.id === vId);
          if (vTx) {
              try {
                  // Cria o lançamento real instantaneamente como OK
                  await Api.createTransaction({
    date: vTx.date, type: vTx.type, category: vTx.category,
    description: vTx.description.replace(' (Fixo)', ''), amount: vTx.amount,
    paidBy: vTx.paidBy, paymentMethod: vTx.paymentMethod || 'dinheiro',
    installments: 1, isThirdParty: false, status: 'ok',
    fixedRefId: vTx.fixedRefId
});
                  await loadData(); renderView(true);
                  showToast('Lançamento fixo confirmado e salvo!', 'success');
              } catch (err) { showToast(err.message, 'danger'); }
          }
      }

      const btnVirtualDelete = e.target.closest('[data-virtual-delete]');
      if (btnVirtualDelete) {
          const vId = btnVirtualDelete.dataset.virtualDelete;
          const vTx = state.months.flatMap(m => m.items).find(tx => tx.id === vId);
          if (vTx) App.skipFixedMonth(vTx.fixedRefId, vTx.date.slice(0, 7));
      }

      const btnVirtualEdit = e.target.closest('[data-virtual-edit]');
      if (btnVirtualEdit) {
          const vId = btnVirtualEdit.dataset.virtualEdit;
          // Abre o modal de confirmação existente que permite mudar o valor apenas daquele mês
          App.openConfirmFixedModal(vId); 
      }

      const btnEdit = e.target.closest('[data-edit]');
        if (btnEdit) openTransactionModal(btnEdit.dataset.edit);

        // --- NOVO TRECHO: GATILHO DO HISTÓRICO ---
        const btnHistory = e.target.closest('[data-history]');
        if (btnHistory) openTransactionHistoryModal(btnHistory.dataset.history);
        // -----------------------------------------

        const btnDelete = e.target.closest('[data-delete]');
      if (btnDelete) {
        const t = state.transactions.find((tx) => tx.id === btnDelete.dataset.delete);
        let deleteGroup = false;

        if (t && t.groupId) {
          const choice = confirm(
            `Este lançamento faz parte do parcelamento "${t.description}".\n\nDeseja excluir TODAS AS PARCELAS deste parcelamento?\n\n• OK: Excluir TODAS as parcelas de uma vez\n• Cancelar: Excluir apenas esta parcela (mês atual)`
          );
          if (choice) {
            deleteGroup = true;
          } else {
            if (!confirm('Deseja realmente excluir APENAS esta parcela do mês atual?')) return;
          }
        } else {
          if (!confirm('Tem certeza que deseja excluir este lançamento?')) return;
        }

        try {
          await Api.deleteTransaction(btnDelete.dataset.delete, deleteGroup);
          await loadData();
          renderView();
          showToast(deleteGroup ? 'Todas as parcelas foram excluídas!' : 'Lançamento excluído.', 'success');
        } catch (err) {
          showToast(err.message, 'danger');
        }
      }

      const btnAddTx = e.target.closest('#btn-add-transacao');
      if (btnAddTx) openTransactionModal();

      const btnDashNav = e.target.closest('[data-dash-nav]');
      if (btnDashNav) changeDashMonth(parseInt(btnDashNav.dataset.dashNav));

      const btnLancNav = e.target.closest('[data-lanc-nav]');
      if (btnLancNav) changeLancamentosMonth(parseInt(btnLancNav.dataset.lancNav));

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

  // ---------- DASHBOARD (Página Inicial com Filtro por Pessoa) ----------

  function viewDashboard() {
    if (!state.dashboardMonthKey) state.dashboardMonthKey = Utils.currentMonthKey();
    let currentIdx = state.months.findIndex((m) => m.key === state.dashboardMonthKey);
    
    const currentMonth = currentIdx !== -1 ? state.months[currentIdx] : { 
      key: state.dashboardMonthKey, 
      receitas: 0, 
      gastos: 0, 
      saldoInicial: 0,
      entradasTotais: 0,
      despesasTotais: 0,
      saldoRestante: 0,
      personMetrics: {},
      saldoMes: 0, 
      saldoFinal: 0, 
      byPerson: {}, 
      byPersonRenda: {}, 
      byPersonCard: {}, 
      byCategoryPerson: {} 
    };

    const cardsUsage = Utils.getCardsUsage(state.transactions, state.dashboardMonthKey, state.settings);

    let saldoAnt, recMes, entTotais, despTotais, saldoRest;
    if (state.dashFilterPerson === 'todos' || !currentMonth.personMetrics[state.dashFilterPerson]) {
      saldoAnt = currentMonth.saldoInicial;
      recMes = currentMonth.receitas;
      entTotais = currentMonth.entradasTotais;
      despTotais = currentMonth.despesasTotais;
      saldoRest = currentMonth.saldoRestante;
    } else {
      const pm = currentMonth.personMetrics[state.dashFilterPerson];
      saldoAnt = pm.saldoInicial;
      recMes = pm.receitas;
      entTotais = pm.entradasTotais;
      despTotais = pm.despesasTotais;
      saldoRest = pm.saldoRestante;
    }

    return `
      <section class="view-header" style="justify-content: center; text-align: center; flex-direction: column;">
        <h1 style="font-size: 20px; color: var(--ink-faint);">Visão Geral</h1>
        <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
          <button class="icon-btn" data-dash-nav="-1" style="background: var(--surface-sunken);"><i class="ti ti-chevron-left"></i></button>
          <h2 style="font-size: 24px; min-width: 200px;">${Utils.monthLabel(state.dashboardMonthKey)}</h2>
          <button class="icon-btn" data-dash-nav="1" style="background: var(--surface-sunken);"><i class="ti ti-chevron-right"></i></button>
        </div>
        
        <div style="margin-top: 14px;">
          <select id="dash-filter-person" onchange="App.setDashPerson(this.value)" style="height: 38px; font-size: 13px; padding: 0 14px; border-radius: 999px; background: var(--surface); border: 1.5px solid var(--line); font-weight: 600;">
            <option value="todos" ${state.dashFilterPerson === 'todos' ? 'selected' : ''}>Métricas: Casal (Todos)</option>
            ${getPeople().map(p => `<option value="${p.id}" ${state.dashFilterPerson === p.id ? 'selected' : ''}>Métricas: ${p.name}</option>`).join('')}
          </select>
        </div>
      </section>

      <!-- 3 CARDS ESTILO PLANILHA: ENTRADAS TOTAIS | DESPESAS | SALDO RESTANTE -->
      <section class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div class="metric-card positive">
          <span class="metric-label">Total de Entradas (Mês + Acumulado)</span>
          <span class="metric-value">${Utils.fmtBRL(entTotais)}</span>
          <span class="muted-small" style="font-size: 11px; margin-top: 2px;">
            Saldo Anterior: ${Utils.fmtBRL(saldoAnt)} + Receitas: ${Utils.fmtBRL(recMes)}
          </span>
        </div>
        <div class="metric-card negative">
          <span class="metric-label">Total de Despesas (Saídas)</span>
          <span class="metric-value">${Utils.fmtBRL(despTotais)}</span>
          <span class="muted-small" style="font-size: 11px; margin-top: 2px;">Gastos registrados no mês</span>
        </div>
        <div class="metric-card ${saldoRest >= 0 ? 'positive' : 'negative'}">
          <span class="metric-label">Saldo Restante (Disponível)</span>
          <span class="metric-value">${Utils.fmtBRL(saldoRest)}</span>
          <span class="muted-small" style="font-size: 11px; margin-top: 2px;">Entradas − Despesas</span>
        </div>
      </section>

      <!-- FEEDBACK VISUAL DOS CARTÕES DE CRÉDITO -->
      <section class="card">
        <div class="card-header">
          <h2><i class="ti ti-credit-card"></i> Cartões de Crédito (Limite Retido vs. Disponível)</h2>
        </div>
        ${cardsUsage.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${cardsUsage.map(c => `
            <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div>
                  <strong style="font-size: 15px; color: var(--teal-900);">${c.name}</strong>
                  <span class="user-chip" style="--chip-color:${personColor(c.owner)}; margin-left: 8px; font-size: 11px; padding: 2px 8px;">${personName(c.owner)}</span>
                </div>
                <span class="muted-small">Limite Total: <strong>${Utils.fmtBRL(c.limit)}</strong></span>
              </div>
              
              <div class="progress-bar">
                <div class="progress-fill ${c.pct >= 90 ? 'danger' : c.pct >= 70 ? 'warning' : ''}" style="width: ${c.pct}%"></div>
              </div>
              
              <div class="progress-legend" style="margin-top: 8px; font-size: 13px;">
                <span style="color: var(--coral-700);">Retido / Usado: <strong>${Utils.fmtBRL(c.used)}</strong> (${c.pct}%)</span>
                <span style="color: var(--teal-700);">Disponível: <strong>${Utils.fmtBRL(c.available)}</strong></span>
              </div>
            </div>
          `).join('')}
        </div>
        ` : `<p class="muted-small">Nenhum cartão de crédito cadastrado na aba Ajustes ainda.</p>`}
      </section>

      <!-- DESEMPENHO INDIVIDUAL -->
      <section class="card">
        <div class="card-header"><h2><i class="ti ti-users"></i> Desempenho Individual</h2></div>
        
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

      <!-- DOIS GRÁFICOS LADO A LADO -->
      <section class="grid-2">
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-chart-donut"></i> Gastos por Categoria (Geral)</h2></div>
          <div class="chart-box"><canvas id="chart-categoria"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h2><i class="ti ti-users"></i> Gastos por Pessoa (Comparativo)</h2></div>
          <div class="chart-box"><canvas id="chart-pessoa"></canvas></div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2><i class="ti ti-chart-bar"></i> Evolução: Receitas x Gastos</h2>
          <span class="muted-small">Últimos 6 meses até ${Utils.monthLabel(state.dashboardMonthKey)}</span>
        </div>
        <div class="chart-box"><canvas id="chart-receitas-gastos"></canvas></div>
      </section>
    `;
  }

  function setDashPerson(val) {
    state.dashFilterPerson = val;
    renderView();
  }

  function changeDashMonth(offset) {
    let d = new Date(state.dashboardMonthKey + '-01T12:00:00');
    d.setMonth(d.getMonth() + offset);
    state.dashboardMonthKey = d.toISOString().slice(0, 7);
    renderView();
  }

  function drawDashboardCharts() {
    const currentMonth = state.months.find(m => m.key === state.dashboardMonthKey) || { byCategory: {}, byPerson: {} };
    const visibleMonths = Utils.getMonthsUpTo(state.months, state.dashboardMonthKey, 6);
    
    Charts.incomeExpenseChart('chart-receitas-gastos', visibleMonths);
    Charts.categoryChart('chart-categoria', currentMonth.byCategory || {});
    Charts.personChart('chart-pessoa', currentMonth.byPerson || {}, getPeople());
  }

  // ---------- LANÇAMENTOS ----------

  // ---------- LANÇAMENTOS ----------

  function viewLancamentos() {
        if (!state.filterMonth) state.filterMonth = Utils.currentMonthKey();
    if (!state.filterSort) state.filterSort = 'date_desc';
    
    const monthOptions = state.months.map(m => m.key).reverse();
    if (!monthOptions.includes(state.filterMonth)) monthOptions.unshift(state.filterMonth);

    const currentMonthData = state.months.find(m => m.key === state.filterMonth) || { saldoInicial: 0, items: [] };
    
    // Captura o Saldo Restante que sobrou do mês anterior (Dinâmico por pessoa ou casal)
    let saldoAnterior = currentMonthData.saldoInicial;
    if (state.filterPerson !== 'todos' && currentMonthData.personMetrics) {
      saldoAnterior = currentMonthData.personMetrics[state.filterPerson]?.saldoInicial || 0;
    }

        const filtered = currentMonthData.items || [];
    const list = sortLancamentos(
      filtered
        .filter(t => state.filterPerson === 'todos' || t.paidBy === state.filterPerson)
        .filter(t => state.filterType === 'todos' || t.type === state.filterType)
        .filter(t => state.filterStatus === 'todos' || (state.filterStatus === 'ok' ? t.status === 'ok' : t.status !== 'ok')),
      state.filterSort
    );

    // Lógica para marcar "Check All"
    const allIds = list.filter(t => !t.isVirtual).map(t => t.id);
    const isAllChecked = allIds.length > 0 && allIds.every(id => state.selectedTxs.includes(id));

    return `
      <section class="view-header" style="justify-content: center; text-align: center; flex-direction: column; margin-bottom: 12px;">
        <h1 style="font-size: 20px; color: var(--ink-faint);">Lançamentos</h1>
        <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
          <button class="icon-btn" data-lanc-nav="-1" style="background: var(--surface-sunken);"><i class="ti ti-chevron-left"></i></button>
          <h2 style="font-size: 24px; min-width: 200px;">${Utils.monthLabel(state.filterMonth)}</h2>
          <button class="icon-btn" data-lanc-nav="1" style="background: var(--surface-sunken);"><i class="ti ti-chevron-right"></i></button>
        </div>
      </section>

      <section class="filters" style="justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <select id="filter-month" onchange="App.setFilter('month', this.value)">
            ${monthOptions.map((k) => `<option value="${k}" ${k === state.filterMonth ? 'selected' : ''}>${Utils.monthLabel(k)}</option>`).join('')}
          </select>
          <select id="filter-person" onchange="App.setFilter('person', this.value)">
            <option value="todos">Pessoas: Todas</option>
            ${getPeople().map((p) => `<option value="${p.id}" ${state.filterPerson === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
          <select id="filter-type" onchange="App.setFilter('type', this.value)">
            <option value="todos" ${state.filterType === 'todos' ? 'selected' : ''}>Tipos: Todos</option>
            <option value="receita" ${state.filterType === 'receita' ? 'selected' : ''}>Receitas</option>
            <option value="gasto" ${state.filterType === 'gasto' ? 'selected' : ''}>Gastos</option>
          </select>
                    <select id="filter-status" onchange="App.setFilter('status', this.value)">
            <option value="todos" ${state.filterStatus === 'todos' ? 'selected' : ''}>Status: Todos</option>
            <option value="aberto" ${state.filterStatus === 'aberto' ? 'selected' : ''}>Status: Abertos (Pendentes)</option>
            <option value="ok" ${state.filterStatus === 'ok' ? 'selected' : ''}>Status: Concluídos (OK)</option>
          </select>
          <select id="filter-sort" onchange="App.setFilter('sort', this.value)">
            <option value="date_desc" ${state.filterSort === 'date_desc' ? 'selected' : ''}>Data: Mais recente</option>
            <option value="date_asc" ${state.filterSort === 'date_asc' ? 'selected' : ''}>Data: Mais antiga</option>
            <option value="category" ${state.filterSort === 'category' ? 'selected' : ''}>Categoria (agrupado)</option>
            <option value="value_desc" ${state.filterSort === 'value_desc' ? 'selected' : ''}>Valor: Maior primeiro</option>
            <option value="value_asc" ${state.filterSort === 'value_asc' ? 'selected' : ''}>Valor: Menor primeiro</option>
          </select>
        </div>
        <button class="btn btn-primary" id="btn-add-transacao"><i class="ti ti-plus"></i> Novo Lançamento</button>
      </section>

      ${state.selectedTxs.length > 0 ? `
      <div style="background: var(--teal-100); padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; border: 1px solid var(--teal-500);">
        <span style="color: var(--teal-900); font-weight: 600;"><i class="ti ti-checkbox"></i> ${state.selectedTxs.length} lançamento(s) selecionado(s)</span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary" style="height: 36px; padding: 0 14px; font-size: 13px;" id="btn-bulk-ok"><i class="ti ti-check"></i> Marcar como OK</button>
          <button class="btn btn-ghost" style="height: 36px; padding: 0 14px; font-size: 13px; background: white;" id="btn-bulk-aberto"><i class="ti ti-arrow-back-up"></i> Reabrir</button>
        </div>
      </div>
      ` : ''}

      <section class="card">
        ${list.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;"><input type="checkbox" id="check-all-txs" ${isAllChecked ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;" /></th>
                <th>Data</th><th>Categoria</th><th>Descrição</th><th>Quem</th><th>Forma</th><th class="num">Valor</th><th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr style="background: var(--surface-sunken);">
                <td colspan="6" style="text-align: right; color: var(--ink-faint); font-size: 13px;">Saldo acumulado e vindo do mês anterior:</td>
                <td class="num ${saldoAnterior >= 0 ? 'positive' : 'negative'}" style="font-weight: 600;">${Utils.fmtBRL(saldoAnterior)}</td>
                <td class="col-actions" style="background: var(--surface-sunken);"></td>
              </tr>
                            ${renderLancamentosRows(list)}
            </tbody>
          </table>
        </div>` : `<div class="empty-state"><i class="ti ti-receipt-off"></i><p>Nenhum registro encontrado para este filtro.</p></div>`}
      </section>
    `;
  }

  function changeLancamentosMonth(offset) {
    let d = new Date(state.filterMonth + '-01T12:00:00');
    d.setMonth(d.getMonth() + offset);
    state.filterMonth = d.toISOString().slice(0, 7);
    renderView();
  }

    function setFilter(type, val) {
    if (type === 'month') state.filterMonth = val;
    if (type === 'person') state.filterPerson = val;
    if (type === 'type') state.filterType = val;
    if (type === 'status') state.filterStatus = val;
    if (type === 'sort') state.filterSort = val;
    state.selectedTxs = []; // Limpa caixas de seleção ao mudar de filtro
    renderView();
  }

    function sortLancamentos(list, sortKey) {
    const arr = [...list];
    switch (sortKey) {
      case 'date_asc':
        return arr.sort((a, b) => a.date.localeCompare(b.date));
      case 'value_desc':
        return arr.sort((a, b) => b.amount - a.amount);
      case 'value_asc':
        return arr.sort((a, b) => a.amount - b.amount);
      case 'category':
        return arr.sort((a, b) => (a.category || '').localeCompare(b.category || '') || b.date.localeCompare(a.date));
      default: // 'date_desc'
        return arr.sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  function renderLancamentosRows(list) {
    if (state.filterSort !== 'category') return list.map(rowTransacao).join('');

    let html = '';
    let lastCategory = null;
    list.forEach((t) => {
      if (t.category !== lastCategory) {
        html += `<tr class="category-group-row"><td colspan="8">${t.category || 'Sem categoria'}</td></tr>`;
        lastCategory = t.category;
      }
      html += rowTransacao(t);
    });
    return html;
  }

  function rowTransacao(t) {
    const sign = t.type === 'receita' ? '+' : '−';
    const isOk = t.status === 'ok';
    const rowStyle = isOk ? 'text-decoration: line-through; opacity: 0.55;' : '';
    const cls = t.type === 'receita' ? 'positive' : 'negative';
    const method = getPaymentMethods().find(m => m.id === t.paymentMethod);
    
    let desc = t.description || '—';
    if (t.installmentLabel) desc += ` <span class="muted-small">(${t.installmentLabel})</span>`;
    if (t.isThirdParty) desc += ` <br><small style="color:var(--warning)">[Terceiro: ${t.thirdPartyName || '?'} | Receber: ${Utils.fmtDate(t.thirdPartyDate)}]</small>`;
    
    const isVirtual = t.isVirtual;
    // Lançamentos virtuais usam seletores de dados exclusivos para interceptarmos o clique
    const btnToggleId = isVirtual ? `data-virtual-ok="${t.id}"` : `data-toggle-status="${t.id}"`;
    const btnEditId = isVirtual ? `data-virtual-edit="${t.id}"` : `data-edit="${t.id}"`;
    const btnDeleteId = isVirtual ? `data-virtual-delete="${t.id}"` : `data-delete="${t.id}"`;

    const btnHtml = `
      <button class="icon-btn" ${btnToggleId} title="${isOk ? 'Reabrir' : (isVirtual ? 'Confirmar Fixo Rápido (Marcar OK)' : 'Marcar como OK')}">
        <i class="ti ${isOk ? 'ti-circle-check-filled' : 'ti-circle'}" style="color: ${isOk || isVirtual ? 'var(--teal-500)' : 'inherit'}"></i>
      </button>
      ${!isVirtual ? `<button class="icon-btn" data-history="${t.id}" title="Ver Histórico"><i class="ti ti-history"></i></button>` : `<button class="icon-btn" disabled style="opacity:0.3; cursor:not-allowed;" title="Histórico disponível após confirmação do fixo"><i class="ti ti-history"></i></button>`}
      <button class="icon-btn" ${btnEditId} title="${isVirtual ? 'Editar valor deste mês' : 'Editar'}"><i class="ti ti-edit"></i></button>
      <button class="icon-btn" ${btnDeleteId} title="${isVirtual ? 'Ocultar fixo apenas deste mês' : 'Excluir'}"><i class="ti ti-trash"></i></button>
    `;

    return `
      <tr style="${rowStyle}">
        <td style="text-align: center;">
          ${!t.isVirtual ? `<input type="checkbox" class="tx-check" data-check-id="${t.id}" ${state.selectedTxs.includes(t.id) ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;" />` : ''}
        </td>
        <td>${Utils.fmtDate(t.date)}</td>
        <td>${t.category}</td>
        <td>${desc}</td>
        <td><span class="dot" style="background:${personColor(t.paidBy)}"></span>${personName(t.paidBy)}</td>
        <td>${method ? method.label : '—'}</td>
        <td class="num ${cls}">${sign} ${Utils.fmtBRL(t.amount)}</td>
        <td class="row-actions col-actions" style="min-width: 140px; display: flex; justify-content: flex-end; gap: 4px; border: none;">${btnHtml}</td>
      </tr>
    `;
  }

  // ---------- TRANSACTION MODAL ----------

  function openTransactionModal(editId) {
    const existing = editId ? state.transactions.find((t) => t.id === editId) : null;
    const type = existing ? existing.type : 'gasto';
    const categories = (state.settings && state.settings.categories && state.settings.categories[type]) || [];

    let defaultDate = new Date().toISOString().slice(0, 10);
    if (!existing && state.view === 'lancamentos' && state.filterMonth) {
      if (state.filterMonth === Utils.currentMonthKey()) {
        defaultDate = new Date().toISOString().slice(0, 10);
      } else {
        defaultDate = `${state.filterMonth}-01`;
      }
    }

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

            ${existing && existing.groupId ? `
            <div style="grid-column: 1 / -1; background: var(--teal-100); color: var(--teal-900); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--teal-700); margin-bottom: 8px;">
              <label style="flex-direction: row; align-items: center; gap: 10px; margin: 0; font-weight: 600; color: var(--teal-900); cursor: pointer;">
                <input type="checkbox" id="tx-update-group" checked style="width: 18px; height: 18px;" />
                Aplicar alteração a todas as parcelas deste parcelamento
              </label>
              <p class="muted-small" style="margin: 4px 0 0 28px; font-size: 12px; color: var(--teal-900);">
                Ao salvar, a forma de pagamento, categoria, descrição, responsável e valor serão atualizados em todos os meses da série.
              </p>
            </div>
            ` : ''}
            
            <label>Data
              <input type="date" id="tx-date" value="${existing ? existing.date : defaultDate}" required />
            </label>
            <label>Categoria
              <select id="tx-category">
                ${categories.map((c) => `<option value="${c}" ${existing && existing.category === c ? 'selected' : ''}>${c}</option>`).join('')}
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
                ${getPeople().map((p) => `<option value="${p.id}" ${(existing ? existing.paidBy : state.user.id) === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </label>
            <label id="label-payment-method" style="display:${type === 'gasto' ? 'flex' : 'none'};">Forma de pagamento
              <select id="tx-method">
                ${getPaymentMethods().map((m) => `<option value="${m.id}" ${existing && existing.paymentMethod === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
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
            
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              ${existing ? (existing.groupId ? `
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-danger-ghost" id="btn-delete-inline" title="Excluir apenas esta parcela do mês"><i class="ti ti-trash"></i> Esta Parcela</button>
                  <button type="button" class="btn btn-danger-ghost" id="btn-delete-group-inline" style="background:#fcebeb; border:1px solid #a32d2d;" title="Excluir todo o parcelamento"><i class="ti ti-trash-x"></i> Todo Parcelamento</button>
                </div>
              ` : `<button type="button" class="btn btn-danger-ghost" id="btn-delete-inline"><i class="ti ti-trash"></i> Excluir</button>`) : '<span></span>'}
              <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Adicionar'}</button>
            </div>
            <p id="tx-error" class="form-error hidden" style="grid-column:1/-1;"></p>
          </form>
        </div>
      </div>
    `;

    el('#modal-close').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    if (!existing) {
      el('#tx-is-third').addEventListener('change', (e) => {
        el('#third-party-fields').style.display = e.target.checked ? 'grid' : 'none';
      });
    }

    els('.seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      els('.seg-btn').forEach((b) => b.classList.remove('active')); 
      btn.classList.add('active');
      
      const newType = btn.dataset.tipo; 
      el('#tx-type').value = newType;
      
      const cats = (state.settings && state.settings.categories && state.settings.categories[newType]) || [];
      el('#tx-category').innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');
      el('#label-payment-method').style.display = newType === 'gasto' ? 'flex' : 'none';
    }));

    if (existing) {
      el('#btn-delete-inline')?.addEventListener('click', async () => {
        const msg = existing.groupId 
          ? 'Deseja excluir APENAS ESTA PARCELA do mês atual?' 
          : 'Excluir este lançamento?';
        if (!confirm(msg)) return;
        try { 
          await Api.deleteTransaction(existing.id, false); 
          closeModal(); 
          await loadData(); 
          renderView(); 
          showToast('Lançamento excluído.', 'success'); 
        } catch (e) { showToast(e.message, 'danger'); }
      });

      el('#btn-delete-group-inline')?.addEventListener('click', async () => {
        if (!confirm(`Deseja excluir TODAS AS PARCELAS do parcelamento "${existing.description}"?`)) return;
        try {
          await Api.deleteTransaction(existing.id, true);
          closeModal();
          await loadData();
          renderView();
          showToast('Todo o parcelamento foi excluído!', 'success');
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
      
      if (!existing) {
        payload.installments = parseInt(el('#tx-installments').value) || 1;
        payload.isThirdParty = el('#tx-is-third').checked;
        if (payload.isThirdParty) {
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
          const updateGroup = el('#tx-update-group')?.checked || false;
          await Api.updateTransaction({ id: existing.id, updateGroup, ...payload }); 
          showToast(updateGroup ? 'Todas as parcelas foram atualizadas!' : 'Lançamento atualizado.', 'success'); 
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

  // ---------- MODAL RÁPIDO: CONFIRMAR FIXO NO MÊS ----------
  function openConfirmFixedModal(txId) {
    const vTx = state.months.flatMap(m => m.items).find(t => t.id === txId);
    if (!vTx) return;

    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet" style="max-width: 420px;">
          <div class="modal-header">
            <h2>Confirmar: ${vTx.category}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-confirm-fixed" class="form-grid">
            <p class="muted-small" style="grid-column: 1/-1; margin-bottom: 10px;">Preencha o valor exato deste mês. Ao salvar, ele se tornará um lançamento oficial e resolvido.</p>
            <label>Data Efetiva (Pagamento/Recebimento)
              <input type="date" id="cf-date" value="${vTx.date}" required />
            </label>
            <label>Valor Real (R$)
              <input type="number" step="0.01" min="0" id="cf-amount" value="${vTx.amount}" required />
            </label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; margin-top: 10px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Confirmar e Lançar</button>
            </div>
          </form>
        </div>
      </div>
    `;

    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel-modal').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    el('#form-confirm-fixed').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        date: el('#cf-date').value,
        type: vTx.type,
        category: vTx.category,
        description: vTx.description.replace(' (Fixo)', ''),
        amount: parseFloat(el('#cf-amount').value),
        paidBy: vTx.paidBy,
                paymentMethod: vTx.paymentMethod || 'dinheiro',
        installments: 1,
        isThirdParty: false,
        status: 'ok', // Entra marcado como OK para facilitar!
        fixedRefId: vTx.fixedRefId
      };
      
      try {
        await Api.createTransaction(payload);
        closeModal();
        await loadData();
        renderView();
        showToast('Lançamento fixo confirmado para este mês!', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  // ---------- MODAL DE HISTÓRICO DE LANÇAMENTO ----------
  
  async function openTransactionHistoryModal(txId) {
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Buscando histórico...</h2>
          </div>
          <div class="empty-state"><i class="ti ti-loader-2"></i></div>
        </div>
      </div>
    `;

    try {
      const log = await Api.getAudit();
      const tx = state.transactions.find(t => t.id === txId);
      
      // Busca logs pelo ID do lançamento ou pelo ID do grupo de parcelas
      const targetIds = [txId];
      if (tx && tx.groupId) targetIds.push(tx.groupId);

      const txLog = log.filter(a => {
        if (targetIds.includes(a.entityId)) return true;
        if (a.after && targetIds.includes(a.after.groupId)) return true;
        if (a.before && targetIds.includes(a.before.groupId)) return true;
        return false;
      });

      el('#modal-root').innerHTML = `
        <div class="modal-overlay" id="modal-overlay">
          <div class="modal-sheet">
            <div class="modal-header">
              <h2>Linha do Tempo</h2>
              <button class="icon-btn" id="modal-close-hist"><i class="ti ti-x"></i></button>
            </div>
            <div style="max-height: 60vh; overflow-y: auto; padding-right: 8px;">
              ${txLog.length ? `
              <ul class="audit-list">
                 ${txLog.map(a => `
                   <li>
                     <div class="audit-dot"></div>
                     <div style="flex: 1;">
                       <p><strong>${a.userName}</strong> ${ACTION_LABELS[a.action] || a.action}</p>
                       <p class="muted-small">${Utils.fmtDateTime(a.timestamp)}</p>
                       ${formatAuditDetails(a)}
                     </div>
                   </li>
                 `).join('')}
              </ul>` : '<p class="muted-small" style="text-align:center; padding: 20px;">Nenhum histórico estrutural encontrado para este item.</p>'}
            </div>
          </div>
        </div>
      `;

      el('#modal-close-hist').addEventListener('click', closeModal);
      el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    } catch (e) {
      showToast('Erro ao buscar histórico: ' + e.message, 'danger');
      closeModal();
    }
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

  const ACTION_LABELS = { create: 'criou', update: 'editou', delete: 'excluiu', update_group: 'atualizou em cascata', delete_group: 'excluiu o parcelamento' };
  const ENTITY_LABELS = { transaction: 'um lançamento', transaction_group: 'uma série parcelada', settings: 'as configurações' };

// --- FUNÇÃO AUXILIAR: COMPARA E FORMATA O ANTES/DEPOIS ---
  function formatAuditDetails(a) {
    if (!a.before && !a.after) return '';

    if (a.before && a.before.action === 'Transferência de Titularidade') {
      return `<div style="margin-top: 8px; font-size: 13px; background: var(--surface-sunken); padding: 10px; border-radius: var(--radius-sm); border: 1px dashed var(--teal-500); color: var(--teal-900);">
        <strong>Transferência de Titularidade em Lote</strong><br>
        <span class="muted-small">Novo Responsável:</span> ${personName(a.after.newOwner)}<br>
        <span class="muted-small">Lançamentos afetados:</span> ${a.after.updatedCount}
      </div>`;
    }

    if (a.before && a.before.action === 'Atualização em Massa (Status)') {
      return `<div style="margin-top: 8px; font-size: 13px; background: var(--surface-sunken); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--line); color: var(--ink);">
        <strong>Alteração de Status em Lote</strong><br>
        <span class="muted-small">Novo Status Aplicado:</span> ${a.after.status === 'ok' ? 'Concluído (OK)' : 'Em Aberto (Pendente)'}<br>
        <span class="muted-small">Lançamentos selecionados:</span> ${a.after.count}
      </div>`;
    }

    const fieldMap = {
      amount: 'Valor', description: 'Descrição', category: 'Categoria', date: 'Data', 
      paidBy: 'Responsável', paymentMethod: 'Forma de Pagto', type: 'Tipo', status: 'Status (OK/Aberto)',
      fixedEntries: 'Lançamentos Fixos', cards: 'Cartões', people: 'Pessoas'
    };

    const formatVal = (key, val) => {
      if (val === null || val === undefined || val === '') return '—';
      if (typeof val === 'object') {
        if (Array.isArray(val)) return `${val.length} item(ns) configurado(s)`;
        return JSON.stringify(val).replace(/[{}]/g, '').replace(/"/g, '');
      }
      if (key === 'amount') return Utils.fmtBRL(val);
      if (key === 'date') return Utils.fmtDate(val);
      if (key === 'paidBy') return personName(val) || val;
      if (key === 'status') return val === 'ok' ? 'OK (Resolvido)' : 'Em Aberto';
      if (key === 'paymentMethod') {
        const pm = getPaymentMethods().find(m => m.id === val);
        return pm ? pm.label : val;
      }
      return val;
    };

    let html = '<div style="margin-top: 8px; font-size: 13px; background: var(--surface-sunken); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--line);">';

    const txDate = (a.after && a.after.date) || (a.before && a.before.date);
    if (txDate) {
      html += `<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed var(--line);">
        <span class="muted-small">Data Ref. do Lançamento:</span> <strong style="color:var(--teal-900); font-size: 14px;">${Utils.fmtDate(txDate)}</strong>
      </div>`;
    }

    if (a.action === 'create' || a.action === 'delete' || a.action === 'delete_group') {
      const data = (a.action === 'create' ? a.after : a.before) || {};
      if (data.description) html += `<div style="margin-bottom:4px"><span class="muted-small">Lançamento:</span> <strong>${data.description}</strong></div>`;
      if (data.amount !== undefined) html += `<div style="margin-bottom:4px"><span class="muted-small">Valor:</span> <strong>${Utils.fmtBRL(data.amount)}</strong></div>`;
      if (data.category) html += `<div style="margin-bottom:4px"><span class="muted-small">Categoria:</span> <strong>${data.category}</strong></div>`;
    } else {
      const b = a.before || {};
      const af = a.after || {};
      let changes = 0;
      
      for (const key in af) {
        if (['id', 'groupId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'isVirtual'].includes(key)) continue;
        if (JSON.stringify(b[key]) !== JSON.stringify(af[key])) {
          changes++;
          html += `<div style="margin-bottom: 6px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
            <span class="muted-small" style="min-width: 90px;">${fieldMap[key] || key}:</span>
            <s style="color: var(--coral-700);">${formatVal(key, b[key])}</s>
            <i class="ti ti-arrow-right muted-small"></i>
            <span style="color: var(--teal-700); font-weight: 600;">${formatVal(key, af[key])}</span>
          </div>`;
        }
      }
      if (changes === 0) html += '<span class="muted-small">Atualização de ajustes gerais do sistema.</span>';
    }

    html += '</div>';
    return html;
  }

  function renderAuditoria(log) {
    return `
      <section class="view-header">
        <h1>Histórico de alterações</h1>
        <p class="subtitle">Quem mexeu, o quê, quando e como estava antes.</p>
      </section>
      <section class="card">
        ${log.length ? `
        <ul class="audit-list">
          ${log.map((a) => `
            <li>
              <div class="audit-dot"></div>
              <div style="flex: 1;">
                <p><strong>${a.userName}</strong> ${ACTION_LABELS[a.action] || a.action} ${ENTITY_LABELS[a.entity] || a.entity}</p>
                <p class="muted-small">${Utils.fmtDateTime(a.timestamp)}</p>
                ${formatAuditDetails(a)}
              </div>
            </li>
          `).join('')}
        </ul>` : `<div class="empty-state"><i class="ti ti-history-off"></i><p>Nenhuma alteração registrada ainda.</p></div>`}
      </section>
    `;
  }

  // ---------- CONFIGURAÇÕES E FIXOS (COM EDIÇÃO DE CARTÃO E FIXO) ----------

  function viewConfig() {
    const s = state.settings || {};
    const people = s.people || [];
    const cards = s.cards || [];
    const fixedEntries = s.fixedEntries || [];

    return `
      <section class="view-header"><h1>Ajustes</h1></section>
      
      <section class="card">
        <div class="card-header"><h2><i class="ti ti-pin"></i> Lançamentos Fixos Recorrentes</h2></div>
        <p class="muted-small" style="margin-bottom:12px;">Defina o período de vigência (Início e Fim). Se apagar a regra, os itens já marcados como OK continuarão salvos nos lançamentos.</p>
        
        <div class="table-wrap" style="margin-bottom:16px;">
          <table class="data-table">
            <thead>
              <tr><th>Tipo</th><th>Descrição</th><th>Pessoa</th><th class="num">Valor M.</th><th>Início</th><th>Fim</th><th></th></tr>
            </thead>
            <tbody>
              ${fixedEntries.map((f, i) => `
              <tr>
                <td>${f.type === 'receita' ? 'Receita' : 'Gasto'}</td>
                <td>${f.description} <small>(${f.category})</small></td>
                <td>${personName(f.person)}</td>
                <td class="num">${Utils.fmtBRL(f.amount)}</td>
                <td>${f.startsAt ? Utils.monthLabelShort(f.startsAt) : 'Início'}</td>
                <td>${f.expiresAt ? Utils.monthLabelShort(f.expiresAt) : 'Indeterminado'}</td>
                <td class="row-actions">
                  <button type="button" class="icon-btn" onclick="App.openFixedModal(${i})" title="Editar Fixo"><i class="ti ti-edit"></i></button>
                  <button type="button" class="icon-btn" onclick="App.deleteFixed(${i})" title="Excluir Fixo"><i class="ti ti-trash"></i></button>
                </td>
              </tr>`).join('')}
              ${fixedEntries.length === 0 ? '<tr><td colspan="7" class="empty-state">Nenhum lançamento fixo cadastrado.</td></tr>' : ''}
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
          <label>Valor Médio (R$)
            <input type="number" step="0.01" id="cfg-f-amount" required/>
          </label>
          <label>Pessoa
            <select id="cfg-f-person">
              ${people.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </label>
          <label>Dia Venc.
            <input type="number" min="1" max="31" id="cfg-f-day" value="1" required/>
          </label>
          <label>Mês Início
            <input type="month" id="cfg-f-starts" value="${Utils.currentMonthKey()}" required/>
          </label>
          <label>Mês Fim (Opcional)
            <input type="month" id="cfg-f-expires" title="Deixe em branco para repetir sem prazo final"/>
          </label>
          <button type="submit" class="btn btn-primary" style="align-self:end;">Adicionar Fixo</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-credit-card"></i> Cartões de Crédito</h2></div>
        <div class="table-wrap" style="margin-bottom:16px;">
          <table class="data-table">
            <thead>
              <tr><th>Cartão</th><th>Dono</th><th class="num">Limite</th><th class="num">Vencimento</th><th></th></tr>
            </thead>
            <tbody>
              ${cards.map((c, i) => `
              <tr>
                <td>${c.name}</td>
                <td><span class="user-chip" style="--chip-color:${personColor(c.owner)}; font-size: 11px; padding: 2px 8px;">${personName(c.owner || 'u1')}</span></td>
                <td class="num">${Utils.fmtBRL(c.limit)}</td>
                <td class="num">Dia ${c.closeDay}</td>
                <td class="row-actions">
                  <button type="button" class="icon-btn" onclick="App.openCardModal(${i})" title="Editar Cartão"><i class="ti ti-edit"></i></button>
                  <button type="button" class="icon-btn" onclick="App.deleteCard(${i})" title="Excluir Cartão"><i class="ti ti-trash"></i></button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <form id="form-card" class="form-grid" style="background:var(--surface-sunken); padding:16px; border-radius:var(--radius-sm);">
          <label>Nome do Cartão
            <input type="text" id="cfg-c-name" required/>
          </label>
          <label>Dono do Cartão
            <select id="cfg-c-owner">
              ${people.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
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

      <section class="card">
        <div class="card-header"><h2><i class="ti ti-download"></i> Backup e Exportação</h2></div>
        <p class="muted-small" style="margin-bottom: 12px;">Baixe todos os seus lançamentos em formato Excel (CSV) para guardar como segurança ou criar análises externas.</p>
        <button type="button" class="btn btn-ghost" id="btn-export-csv" style="border: 1px solid var(--line);"><i class="ti ti-file-spreadsheet"></i> Exportar Dados (CSV)</button>
      </section>
    `;
  }

// ---------- MODAL DE EDIÇÃO DE CARTÃO DE CRÉDITO ----------
  
  function openCardModal(idx) {
    const c = state.settings.cards[idx];
    if (!c) return;
    const people = (state.settings && state.settings.people) || [];
    const oldOwner = c.owner || 'u1'; // Guarda o dono atual para comparação

    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Editar Cartão de Crédito</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-edit-card" class="form-grid">
            <label>Nome do Cartão
              <input type="text" id="edit-c-name" value="${c.name || ''}" required />
            </label>
            <label>Dono do Cartão
              <select id="edit-c-owner">
                ${people.map(p => `<option value="${p.id}" ${oldOwner === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </label>
            <label>Limite (R$)
              <input type="number" step="0.01" id="edit-c-limit" value="${c.limit || 0}" required />
            </label>
            <label>Vencimento (Dia)
              <input type="number" min="1" max="31" id="edit-c-day" value="${c.closeDay || 1}" required />
            </label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="btn-save-card">Salvar Alterações</button>
            </div>
          </form>
        </div>
      </div>
    `;

    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel-modal').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    el('#form-edit-card').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const newOwner = el('#edit-c-owner').value;

      // --- NOVA VALIDAÇÃO DE SEGURANÇA ---
      if (oldOwner !== newOwner) {
        const oldPerson = people.find(p => p.id === oldOwner)?.name || 'o dono atual';
        const newPerson = people.find(p => p.id === newOwner)?.name || 'o novo dono';
        
        const msg = `ATENÇÃO: Você está mudando a titularidade deste cartão de ${oldPerson} para ${newPerson}.\n\nIsso transferirá AUTOMATICAMENTE todos os lançamentos passados e futuros deste cartão para ${newPerson}.\n\nTem certeza que deseja continuar?`;
        
        if (!confirm(msg)) {
          return; // Para a execução aqui e mantém o modal aberto se o usuário cancelar
        }
      }
      // -----------------------------------

      const btn = el('#btn-save-card');
      btn.textContent = 'Salvando...';
      btn.disabled = true;

      const cards = [...(state.settings.cards || [])];
      
      cards[idx] = {
        ...cards[idx],
        name: el('#edit-c-name').value.trim(),
        owner: newOwner,
        limit: parseFloat(el('#edit-c-limit').value) || 0,
        closeDay: parseInt(el('#edit-c-day').value, 10) || 1
      };
      
      try {
        // 1. Atualiza as configurações do cartão (limite, nome, dono)
        await saveSettings({ cards });

        // 2. Se a titularidade mudou, transfere todos os lançamentos retroativamente
        if (oldOwner !== newOwner) {
          btn.textContent = 'Transferindo...';
          const cardId = 'card_' + c.id;
          
          // Dispara a transferência em lote no backend
          await Api.updateTransaction({
            updateCardOwner: true,
            targetPaymentMethod: cardId,
            newOwner: newOwner
          });
          
          // Recarrega os dados e a interface
          await loadData();
          renderView();
          showToast('Titularidade e histórico transferidos com sucesso!', 'success');
        }
        
        closeModal();
      } catch (err) {
        btn.textContent = 'Salvar Alterações';
        btn.disabled = false;
        showToast(err.message, 'danger');
      }
    });
  }

  // ---------- MODAL DE EDIÇÃO DE LANÇAMENTO FIXO ----------

  function openFixedModal(idx) {
    const f = state.settings.fixedEntries[idx];
    if (!f) return;
    const people = (state.settings && state.settings.people) || [];
    const categories = (state.settings && state.settings.categories && state.settings.categories[f.type]) || [];

    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Editar Lançamento Fixo</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-edit-fixed" class="form-grid">
            <label>Tipo
              <select id="edit-f-type">
                <option value="receita" ${f.type === 'receita' ? 'selected' : ''}>Receita</option>
                <option value="gasto" ${f.type === 'gasto' ? 'selected' : ''}>Gasto</option>
              </select>
            </label>
            <label>Categoria
              <select id="edit-f-cat">
                ${categories.map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>
            <label>Descrição
              <input type="text" id="edit-f-desc" value="${f.description || ''}" required />
            </label>
            <label>Valor (R$)
              <input type="number" step="0.01" id="edit-f-amount" value="${f.amount || 0}" required />
            </label>
            <label>Pessoa
              <select id="edit-f-person">
                ${people.map(p => `<option value="${p.id}" ${(f.person || 'u1') === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </label>
            <label>Dia Venc.
              <input type="number" min="1" max="31" id="edit-f-day" value="${f.dueDay || 1}" required />
            </label>
            <label>Mês Início
              <input type="month" id="edit-f-starts" value="${f.startsAt || Utils.currentMonthKey()}" required />
            </label>
            <label>Mês Fim (Opcional)
              <input type="month" id="edit-f-expires" value="${f.expiresAt || ''}" title="Deixe em branco para repetir sem prazo final" />
            </label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar Alterações</button>
            </div>
          </form>
        </div>
      </div>
    `;

    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel-modal').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    el('#edit-f-type').addEventListener('change', (e) => {
      const type = e.target.value;
      const cats = (state.settings.categories && state.settings.categories[type]) || [];
      el('#edit-f-cat').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    });

    el('#form-edit-fixed').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fixedEntries = [...(state.settings.fixedEntries || [])];
      fixedEntries[idx] = {
        ...fixedEntries[idx],
        type: el('#edit-f-type').value,
        category: el('#edit-f-cat').value,
        description: el('#edit-f-desc').value.trim(),
        amount: parseFloat(el('#edit-f-amount').value) || 0,
        person: el('#edit-f-person').value,
        dueDay: parseInt(el('#edit-f-day').value) || 1,
        startsAt: el('#edit-f-starts').value || f.startsAt, // Erro de sintaxe corrigido aqui
        expiresAt: el('#edit-f-expires').value || null // Pode ser alterado e estendido livremente aqui
      };
      await saveSettings({ fixedEntries });
      closeModal();
    });
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
        person: el('#cfg-f-person').value,
        dueDay: parseInt(el('#cfg-f-day').value) || 1,
        startsAt: el('#cfg-f-starts').value || Utils.currentMonthKey(),
        expiresAt: el('#cfg-f-expires').value || null
      });
      await saveSettings({ fixedEntries });
    });

    el('#btn-export-csv')?.addEventListener('click', () => {
      const rows = [ ['Data', 'Tipo', 'Categoria', 'Descrição', 'Quem', 'Forma Pagto', 'Valor', 'Status'] ];
      state.transactions.forEach(t => {
        rows.push([
          t.date, t.type, t.category, 
          `"${(t.description || '').replace(/"/g, '""')}"`, 
          personName(t.paidBy), t.paymentMethod || '', 
          t.amount, t.status === 'ok' ? 'OK' : 'Aberto'
        ]);
      });
      // \uFEFF força ferramentas como o Excel a ler os acentos brasileiros perfeitamente
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.join(";")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `financas_backup_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    el('#form-card')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cards = [...(state.settings.cards || [])];
      cards.push({
        id: crypto.randomUUID(), 
        name: el('#cfg-c-name').value.trim(),
        owner: el('#cfg-c-owner').value,
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

  async function skipFixedMonth(fixedRefId, monthKeyStr) {
    if (!confirm(`Deseja remover este lançamento fixo apenas para o mês de ${Utils.monthLabel(monthKeyStr)}?`)) return;
    const fixedEntries = [...(state.settings.fixedEntries || [])];
    const idx = fixedEntries.findIndex(f => f.id === fixedRefId);
    if (idx !== -1) {
      const skipped = fixedEntries[idx].skippedMonths || [];
      if (!skipped.includes(monthKeyStr)) skipped.push(monthKeyStr);
      fixedEntries[idx].skippedMonths = skipped;
      await saveSettings({ fixedEntries });
    }
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

  function setDashPerson(val) {
    state.dashFilterPerson = val;
    renderView();
  }

  function changeDashMonth(param) {
    if (!param || param === 'null') return;
    
    if (typeof param === 'number') {
      let d = new Date(state.dashboardMonthKey + '-01T12:00:00');
      d.setMonth(d.getMonth() + param);
      state.dashboardMonthKey = d.toISOString().slice(0, 7);
    } else {
      state.dashboardMonthKey = param;
    }
    renderView();
  }

  return { 
    init, 
    changeDashMonth, 
    setDashPerson, 
    setFilter, 
    deleteFixed, 
    deleteCard, 
    openCardModal, 
    openFixedModal,
    openConfirmFixedModal,
    skipFixedMonth
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
