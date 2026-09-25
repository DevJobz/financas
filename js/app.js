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
    records: [],
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
    const [transactions, settings, records] = await Promise.all([Api.getTransactions(), Api.getSettings(), Api.getRecords()]);
    state.transactions = transactions.sort((a, b) => a.date.localeCompare(b.date));
    state.settings = settings;
    state.records = records || []; // Carrega o novo banco
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
          <button class="nav-item" data-view="registros"><i class="ti ti-notebook"></i><span>Diário</span></button>
          <button class="nav-item" data-view="config"><i class="ti ti-settings"></i><span>Ajustes</span></button>
        </nav>
      </div>
      <div id="modal-root"></div>
      <div id="toast-root" class="toast-root"></div>
      <div id="chat-root"></div> <!-- NOVO CONTAINER DO CHAT -->
    `;

    el('#btn-logout').addEventListener('click', Auth.logout);
    
    els('.nav-item[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => { state.view = btn.dataset.view; renderView(); })
    );
    el('#btn-add-fab').addEventListener('click', () => openTransactionModal());
    
    initChatUI(); // INICIALIZA O CHAT

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
    else if (state.view === 'registros') container.innerHTML = viewRegistros();

    if (state.view === 'config') attachConfigHandlers();
    if (state.view === 'dashboard') drawDashboardCharts();
    if (state.view === 'historico') drawHistoricoChart();
    
    if (silent) window.scrollTo(0, scrollY);
  }

  // ---------- DIÁRIO E LISTAS (LIFE HUB) ----------
  function viewRegistros() {
    const records = state.records || [];
    const listas = records.filter(r => r.type === 'shopping').sort((a, b) => b.date.localeCompare(a.date));
    const manuts = records.filter(r => r.type === 'maintenance').sort((a, b) => b.km - a.km);
    const trips = records.filter(r => r.type === 'trip').sort((a, b) => b.date.localeCompare(a.date));
    const goals = records.filter(r => r.type === 'goal');
    const subs = records.filter(r => r.type === 'subscription');

    return `
      <section class="view-header">
        <h1>Life Hub</h1>
        <p class="subtitle">Planejamento de viagens, mercado, manutenções e metas do casal.</p>
      </section>

      <!-- SEÇÃO 1: ROTEIROS DE VIAGEM -->
      <section class="card">
        <div class="card-header" style="justify-content: space-between;">
          <h2><i class="ti ti-plane-departure"></i> Roteiros e Viagens</h2>
          <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="App.openTripModal()"><i class="ti ti-plus"></i> Nova Viagem</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${trips.length === 0 ? '<p class="muted-small">Nenhuma viagem planejada no momento.</p>' : ''}
          ${trips.map(trip => {
            const places = trip.places || [];
            const estTotal = places.reduce((acc, p) => acc + (parseFloat(p.estCost) || 0), 0);
            return `
            <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                  <strong style="font-size: 16px; color: var(--teal-900);">${trip.title}</strong>
                  <span class="muted-small" style="display:block; font-size: 11px;">Mês previsto: ${Utils.monthLabel(trip.date.slice(0,7))}</span>
                </div>
                <div style="display:flex; gap: 4px;">
                  <button class="icon-btn" onclick="App.openTripPlaceModal('${trip.id}')" title="Adicionar Local"><i class="ti ti-map-pin-plus"></i></button>
                  <button class="icon-btn" onclick="App.deleteRecordEntry('${trip.id}')" title="Excluir Viagem"><i class="ti ti-trash"></i></button>
                </div>
              </div>
              
              ${places.length > 0 ? `
              <ul style="list-style:none; padding:0; margin:0 0 12px 0; font-size:13px; display:flex; flex-direction:column; gap:8px;">
                ${places.map(p => `
                  <li style="display:flex; justify-content:space-between; align-items:center; background:var(--surface-sunken); padding:8px; border-radius:4px;">
                    <div>
                      <strong>${p.name}</strong>
                      ${p.link ? `<a href="${p.link}" target="_blank" style="color:var(--teal-500); margin-left:6px;" title="Ver link"><i class="ti ti-external-link"></i></a>` : ''}
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span class="muted-small">Previsto: ${Utils.fmtBRL(p.estCost)}</span>
                      <button class="icon-btn" style="width:24px; height:24px;" onclick="App.openTripPlaceModal('${trip.id}', '${p.id}')"><i class="ti ti-edit"></i></button>
                      <button class="icon-btn" style="width:24px; height:24px;" onclick="App.deleteTripPlace('${trip.id}', '${p.id}')"><i class="ti ti-trash"></i></button>
                    </div>
                  </li>
                `).join('')}
              </ul>
              ` : '<p class="muted-small" style="font-size:12px; margin-bottom:12px;">Nenhum local adicionado ainda.</p>'}
              
              <div style="display: flex; justify-content: space-between; background: var(--teal-100); padding: 10px; border-radius: var(--radius-sm); align-items: center;">
                <span style="color: var(--teal-900); font-size: 13px;">Orçamento Total Previsto:</span>
                <strong style="color: var(--teal-700); font-size: 15px;">${Utils.fmtBRL(estTotal)}</strong>
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>

      <!-- SEÇÃO 2: METAS EM CONJUNTO -->
      <section class="card">
        <div class="card-header" style="justify-content: space-between;">
          <h2><i class="ti ti-target"></i> Metas do Casal</h2>
          <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="App.openGoalModal()"><i class="ti ti-plus"></i> Nova Meta</button>
        </div>
        <div class="grid-2">
          ${goals.length === 0 ? '<p class="muted-small" style="grid-column:1/-1;">Nenhuma meta definida.</p>' : ''}
          ${goals.map(g => {
            const pct = Math.min(100, ((g.saved / g.target) * 100)).toFixed(1);
            return `
            <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <strong style="font-size: 14px; color: var(--ink);">${g.title}</strong>
                <button class="icon-btn" onclick="App.deleteRecordEntry('${g.id}')"><i class="ti ti-trash"></i></button>
              </div>
              <div class="progress-bar" style="margin-bottom: 6px;">
                <div class="progress-fill" style="width: ${pct}%; background: var(--teal-500);"></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-size: 12px;">
                <span style="color:var(--teal-700); font-weight:bold;">${Utils.fmtBRL(g.saved)}</span>
                <span class="muted-small">Alvo: ${Utils.fmtBRL(g.target)}</span>
              </div>
              <button class="btn btn-ghost" style="width:100%; margin-top:10px; height:28px; font-size:11px;" onclick="App.openGoalModal('${g.id}')">Atualizar Valor Guardado</button>
            </div>`;
          }).join('')}
        </div>
      </section>

      <!-- SEÇÃO 3: ASSINATURAS -->
      <section class="card">
        <div class="card-header" style="justify-content: space-between;">
          <h2><i class="ti ti-repeat"></i> Gestão de Assinaturas</h2>
          <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="App.openSubModal()"><i class="ti ti-plus"></i> Nova Assinatura</button>
        </div>
        ${subs.length > 0 ? `
        <div style="background: var(--surface-sunken); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
          <span class="muted-small">Total gasto por mês (estimativa):</span>
          <strong style="color: var(--coral-700); font-size: 16px;">
            ${Utils.fmtBRL(subs.reduce((acc, s) => acc + (s.cycle.toLowerCase() === 'anual' ? (parseFloat(s.cost)/12) : parseFloat(s.cost)), 0))}
          </strong>
        </div>` : ''}
        <div class="grid-2">
          ${subs.length === 0 ? '<p class="muted-small" style="grid-column:1/-1;">Nenhuma assinatura registrada.</p>' : ''}
          ${subs.map(s => `
            <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 15px; color: var(--ink);">${s.title}</strong>
                <div class="muted-small" style="font-size: 12px; margin-top: 4px;">Ciclo: ${s.cycle}</div>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <strong style="color: var(--coral-700); font-size: 15px; margin-right: 8px;">${Utils.fmtBRL(s.cost)}</strong>
                <button class="icon-btn" onclick="App.openSubModal('${s.id}')"><i class="ti ti-edit"></i></button>
                <button class="icon-btn" onclick="App.deleteRecordEntry('${s.id}')"><i class="ti ti-trash"></i></button>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- SEÇÃO 4: MERCADO E MANUTENÇÕES -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header" style="justify-content: space-between;">
            <h2><i class="ti ti-shopping-cart"></i> Mercado</h2>
            <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="App.openListModal()"><i class="ti ti-plus"></i> Nova Lista</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${listas.length === 0 ? '<p class="muted-small">Nenhuma lista de mercado criada.</p>' : ''}
            ${listas.map(lista => {
              const items = lista.items || [];
              const totalReal = items.filter(i => i.checked).reduce((acc, i) => acc + ((parseFloat(i.price) || 0) * (parseInt(i.qty) || 1)), 0);
              return `
              <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; background: var(--surface-sunken);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <strong style="font-size: 15px; color: var(--teal-900);">${lista.title}</strong>
                  <div style="display:flex; gap:4px;">
                    <button class="icon-btn" onclick="App.openAddItemModal('${lista.id}')" title="Adicionar Item"><i class="ti ti-plus"></i></button>
                    ${!lista.linkedTxId ? `<button class="icon-btn" onclick="App.convertListToTx('${lista.id}', ${totalReal}, '${lista.title}')" title="Lançar no Financeiro"><i class="ti ti-wallet"></i></button>` : ''}
                    <button class="icon-btn" onclick="App.deleteRecordEntry('${lista.id}')" title="Excluir Lista"><i class="ti ti-trash"></i></button>
                  </div>
                </div>

                <!-- ITENS DA LISTA DIRETOS NA TELA -->
                <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">
                  ${items.length === 0 ? '<span class="muted-small" style="font-size: 12px;">Nenhum item adicionado. Clique no + para incluir.</span>' : ''}
                  ${items.map(item => `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: var(--surface); padding: 6px 10px; border-radius: 4px; font-size: 13px;">
                      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin:0;">
                        <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="App.toggleItemCheck('${lista.id}', '${item.id}')" style="width: 16px; height: 16px;" />
                        <span style="${item.checked ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${item.name} (${item.qty}x)</span>
                      </label>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="text" placeholder="R$ 0,00" value="${item.price ? item.price.toFixed(2).replace('.', ',') : ''}" onchange="App.updateItemPrice('${lista.id}', '${item.id}', this.value)" style="width: 80px; height: 28px; font-size: 12px; text-align: right; padding: 0 6px;" />
                        <button class="icon-btn" style="width:24px; height:24px;" onclick="App.deleteItemFromList('${lista.id}', '${item.id}')"><i class="ti ti-trash"></i></button>
                      </div>
                    </div>
                  `).join('')}
                </div>

                <div style="display: flex; justify-content: space-between; font-size: 13px; border-top: 1px dashed var(--line); padding-top: 6px;">
                  <span class="muted-small">Total no Carrinho:</span>
                  <strong style="color: var(--teal-700);">${Utils.fmtBRL(totalReal)}</strong>
                </div>
              </div>`;
            }).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-header" style="justify-content: space-between;">
            <h2><i class="ti ti-tool"></i> Veículos / Casa</h2>
            <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="App.openMaintenanceModal()"><i class="ti ti-plus"></i> Novo Serviço</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${manuts.length === 0 ? '<p class="muted-small">Nenhum registro de manutenção.</p>' : ''}
            ${manuts.map(m => `
              <div style="border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px; border-left: 4px solid var(--teal-500);">
                <div style="display: flex; justify-content: space-between;">
                  <strong>${m.vehicle}</strong>
                  <div style="display:flex; gap:4px;">
                    <button class="icon-btn" onclick="App.openMaintenanceModal('${m.id}')"><i class="ti ti-edit"></i></button>
                    <button class="icon-btn" onclick="App.deleteRecordEntry('${m.id}')"><i class="ti ti-trash"></i></button>
                  </div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:4px;">
                  <div class="muted-small" style="font-size:12px;">${m.service} • ${m.km.toLocaleString('pt-BR')} KM</div>
                  <strong style="font-size:13px; color:var(--coral-700);">${Utils.fmtBRL(m.cost)}</strong>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    `;
  }

// --- LIFE HUB: VIAGENS, ASSINATURAS, METAS, MERCADO E MANUTENÇÕES ---

  async function deleteRecordEntry(id) {
    if (!confirm("Tem certeza que deseja excluir este registro?")) return;
    try {
      await Api.deleteRecord(id);
      await loadData();
      renderView();
      showToast('Registro excluído com sucesso.', 'success');
    } catch (e) {
      showToast(e.message, 'danger');
    }
  }

  // 1. Viagens e Roteiros
  function openTripModal() {
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Nova Viagem / Roteiro</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-trip" class="form-grid">
            <label>Nome da Viagem<input type="text" id="trip-title" placeholder="Ex: Férias Nordeste" required /></label>
            <label>Mês Previsto<input type="month" id="trip-date" value="${Utils.currentMonthKey()}" required /></label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar Viagem</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });
    
    el('#form-trip').addEventListener('submit', async e => {
      e.preventDefault();
      const title = el('#trip-title').value.trim();
      const date = el('#trip-date').value;
      closeModal();
      await saveRecord({ type: 'trip', title, date: `${date}-01`, places: [] });
    });
  }

  function openTripPlaceModal(tripId, placeId = null) {
    const trip = state.records.find(r => r.id === tripId);
    if(!trip) return;
    const place = placeId ? trip.places.find(p => p.id === placeId) : null;

    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${place ? 'Editar Local' : 'Adicionar Local'}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-place" class="form-grid">
            <label>Nome do Local / Passeio<input type="text" id="place-name" value="${place ? place.name : ''}" required /></label>
            <label>Link de Referência (Opcional)<input type="url" id="place-link" value="${place ? (place.link || '') : ''}" placeholder="https://..." /></label>
            <label>Custo Previsto (R$)<input type="text" id="place-cost" value="${place ? place.estCost.toString().replace('.', ',') : ''}" placeholder="0,00" /></label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

    el('#form-place').addEventListener('submit', async e => {
      e.preventDefault();
      const name = el('#place-name').value.trim();
      const link = el('#place-link').value.trim();
      const estCost = parseFloat(el('#place-cost').value.replace(',', '.')) || 0;
      
      if(place) {
        trip.places = trip.places.map(p => p.id === placeId ? { ...p, name, link, estCost } : p);
      } else {
        trip.places = [...(trip.places || []), { id: crypto.randomUUID(), name, link, estCost }];
      }
      closeModal();
      await saveRecord(trip);
    });
  }

  async function deleteTripPlace(tripId, placeId) {
    if (!confirm("Tem certeza que deseja excluir este local da viagem?")) return;
    const trip = state.records.find(r => r.id === tripId);
    if (!trip) return;
    trip.places = trip.places.filter(p => p.id !== placeId);
    await saveRecord(trip);
  }

  // 2. Assinaturas
  function openSubModal(subId = null) {
    const sub = subId ? state.records.find(r => r.id === subId) : null;
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${sub ? 'Editar Assinatura' : 'Nova Assinatura'}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-sub" class="form-grid">
            <label>Nome do Serviço<input type="text" id="sub-title" value="${sub ? sub.title : ''}" required /></label>
            <label>Valor (R$)<input type="text" id="sub-cost" value="${sub ? sub.cost.toString().replace('.', ',') : ''}" placeholder="20,90" required /></label>
            <label>Ciclo
              <select id="sub-cycle">
                <option value="Mensal" ${sub && sub.cycle === 'Mensal' ? 'selected' : ''}>Mensal</option>
                <option value="Anual" ${sub && sub.cycle === 'Anual' ? 'selected' : ''}>Anual</option>
              </select>
            </label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

    el('#form-sub').addEventListener('submit', async e => {
      e.preventDefault();
      const title = el('#sub-title').value.trim();
      const cost = parseFloat(el('#sub-cost').value.replace(',', '.')) || 0;
      const cycle = el('#sub-cycle').value;
      closeModal();
      if(sub) {
        await saveRecord({ ...sub, title, cost, cycle });
      } else {
        await saveRecord({ type: 'subscription', title, cost, cycle });
      }
    });
  }

  // 3. Metas do Casal
  function openGoalModal(goalId = null) {
    const goal = goalId ? state.records.find(r => r.id === goalId) : null;
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${goal ? 'Atualizar Valor Guardado' : 'Nova Meta do Casal'}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-goal" class="form-grid">
            ${!goal ? `
              <label>O que querem alcançar?<input type="text" id="goal-title" required /></label>
              <label>Valor Alvo (R$)<input type="text" id="goal-target" required /></label>
            ` : `<label>Quanto já têm guardado para "${goal.title}"? (R$)<input type="text" id="goal-saved" value="${goal.saved.toString().replace('.', ',')}" required /></label>`}
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

        el('#form-goal').addEventListener('submit', async e => {
      e.preventDefault();

      if (goal) {
        const saved = parseFloat(el('#goal-saved').value.replace(',', '.')) || 0;
        closeModal();
        await saveRecord({ ...goal, saved });
      } else {
        const title = el('#goal-title').value.trim();
        const target = parseFloat(el('#goal-target').value.replace(',', '.')) || 0;
        closeModal();
        await saveRecord({ type: 'goal', title, target, saved: 0 });
      }
    });
  }

  // 4. Mercado / Listas
  function openListModal() {
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Nova Lista de Mercado</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-list" class="form-grid">
            <label>Nome do Mercado / Lista<input type="text" id="list-title" placeholder="Ex: Assaí Setembro" required /></label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Criar Lista</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

    el('#form-list').addEventListener('submit', async e => {
      e.preventDefault();
      const title = el('#list-title').value.trim();
      closeModal();
      await saveRecord({ type: 'shopping', title, date: new Date().toISOString().slice(0, 10), items: [] });
    });
  }

  function openAddItemModal(listId) {
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Adicionar Item à Lista</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-item" class="form-grid">
            <label>Nome do Item<input type="text" id="item-name" placeholder="Ex: Cuscuz, Arroz" required /></label>
            <label>Quantidade<input type="number" min="1" id="item-qty" value="1" required /></label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Adicionar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

    el('#form-item').addEventListener('submit', async e => {
      e.preventDefault();
      const lista = state.records.find(r => r.id === listId);
      if(!lista) return;
      
      const name = el('#item-name').value.trim();
      const qty = parseInt(el('#item-qty').value) || 1;
      
      const newItem = { id: crypto.randomUUID(), name, qty, price: 0, checked: false };
      lista.items = [...(lista.items || []), newItem];
      closeModal();
      await saveRecord(lista);
    });
  }

  async function toggleItemCheck(listId, itemId) {
    const lista = state.records.find(r => r.id === listId);
    if(!lista) return;
    lista.items = lista.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i);
    await saveRecord(lista);
  }

  async function updateItemPrice(listId, itemId, priceStr) {
    const lista = state.records.find(r => r.id === listId);
    if(!lista) return;
    const price = parseFloat(priceStr.replace(',', '.')) || 0;
    lista.items = lista.items.map(i => i.id === itemId ? { ...i, price, checked: true } : i);
    await saveRecord(lista);
  }

  async function deleteItemFromList(listId, itemId) {
    const lista = state.records.find(r => r.id === listId);
    if(!lista) return;
    lista.items = lista.items.filter(i => i.id !== itemId);
    await saveRecord(lista);
  }

  // 5. Manutenções
  function openMaintenanceModal(id = null) {
    const m = id ? state.records.find(r => r.id === id) : null;
    el('#modal-root').innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${m ? 'Editar Manutenção' : 'Novo Serviço / Manutenção'}</h2>
            <button class="icon-btn" id="modal-close"><i class="ti ti-x"></i></button>
          </div>
          <form id="form-maint" class="form-grid">
            <label>Veículo / Ativo<input type="text" id="m-vehicle" value="${m ? m.vehicle : ''}" placeholder="Ex: Moto, Carro" required /></label>
            <label>Serviço Realizado<input type="text" id="m-service" value="${m ? m.service : ''}" placeholder="Ex: Troca de óleo" required /></label>
            <label>Quilometragem (KM)<input type="number" id="m-km" value="${m ? m.km : ''}" required /></label>
            <label>Custo Total (R$)<input type="text" id="m-cost" value="${m ? m.cost.toString().replace('.', ',') : ''}" placeholder="0,00" required /></label>
            <div class="modal-actions" style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
              <button type="button" class="btn btn-ghost" id="btn-cancel">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    el('#modal-close').addEventListener('click', closeModal);
    el('#btn-cancel').addEventListener('click', closeModal);
    el('#modal-overlay').addEventListener('click', e => { if(e.target.id === 'modal-overlay') closeModal(); });

    el('#form-maint').addEventListener('submit', async e => {
      e.preventDefault();
      const vehicle = el('#m-vehicle').value.trim();
      const service = el('#m-service').value.trim();
      const km = parseInt(el('#m-km').value) || 0;
      const cost = parseFloat(el('#m-cost').value.replace(',', '.')) || 0;
      closeModal();

      if(m) {
        await saveRecord({ ...m, vehicle, service, km, cost });
      } else {
        await saveRecord({ type: 'maintenance', vehicle, service, km, cost, date: new Date().toISOString().slice(0, 10) });
      }
    });
  }

  function convertListToTx(recordId, totalAmount, title) {
    if (totalAmount <= 0) {
      showToast('O valor total está zerado. Adicione preços aos itens.', 'danger');
      return;
    }
    // Abre o modal financeiro nativo do app, preenchendo os dados automaticamente!
    openTransactionModal(null, { amount: totalAmount, description: title, category: 'Alimentação' });
    
    // Opcional: Atualizar o record no banco marcando linkedTxId após salvar o modal.
    // Para simplificar a UX agora, o usuário salva no modal e nós marcamos como lançado depois visualmente.
  }

  async function saveRecord(payload) {
    try {
      await Api.saveRecord(payload);
      await loadData();
      renderView();
    } catch(e) { showToast(e.message, 'danger'); }
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

    // 1. Calcular totais por categoria antes de renderizar
    const catTotals = {};
    list.forEach(t => {
      const cat = t.category || 'Sem categoria';
      if (!catTotals[cat]) catTotals[cat] = { total: 0, byPerson: {} };
      
      // Define o sinal (receita = positivo, gasto = negativo) para fechar o caixa líquido da categoria
      const val = t.type === 'receita' ? t.amount : -t.amount;
      catTotals[cat].total += val;
      
      if (!catTotals[cat].byPerson[t.paidBy]) catTotals[cat].byPerson[t.paidBy] = 0;
      catTotals[cat].byPerson[t.paidBy] += val;
    });

    let html = '';
    let lastCategory = null;
    
    list.forEach((t) => {
      if (t.category !== lastCategory) {
        const cat = t.category || 'Sem categoria';
        const totals = catTotals[cat];
        const isPositive = totals.total >= 0;
        const sign = isPositive ? '+' : '−';
        const colorClass = isPositive ? 'positive' : 'negative';
        const formattedTotal = Utils.fmtBRL(Math.abs(totals.total));

        let detailsHtml = '';
        // Mostrar divisão individual APENAS se o filtro estiver em "todos"
        if (state.filterPerson === 'todos' && Object.keys(totals.byPerson).length > 0) {
          const peopleInfo = getPeople().map(p => {
            const val = totals.byPerson[p.id];
            if (val === undefined) return ''; // Ignora quem não teve lançamento nesta categoria
            const vSign = val >= 0 ? '+' : '−';
            return `<span style="font-size: 11px; font-weight: 500; color: var(--ink-faint); margin-left: 12px; display: inline-flex; align-items: center; gap: 4px;">
                      <span class="dot" style="background:${p.color}; width:8px; height:8px; margin: 0;"></span>
                      ${p.name}: <span class="${val >= 0 ? 'positive' : 'negative'}">${vSign} ${Utils.fmtBRL(Math.abs(val))}</span>
                    </span>`;
          }).join('');
          
          if (peopleInfo) {
              detailsHtml = `<div style="display:flex; align-items:center; border-right: 1px solid var(--line); padding-right: 12px; margin-right: 12px;">${peopleInfo}</div>`;
          }
        }

        html += `
          <tr class="category-group-row">
            <td colspan="8" style="padding: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: var(--surface-sunken); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);">
                <strong style="color: var(--teal-900); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">${cat}</strong>
                <div style="display: flex; align-items: center;">
                  ${detailsHtml}
                  <span class="num ${colorClass}" style="font-size: 13px; font-weight: 700;">
                    ${sign} ${formattedTotal}
                  </span>
                </div>
              </div>
            </td>
          </tr>`;
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

  function openTransactionModal(editId, prefill = null) {
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

    // AQUI: Preparamos as variáveis para puxar do prefill caso seja um lançamento vindo da lista
    let defaultAmount = existing ? existing.amount : (prefill ? prefill.amount : '');
    let defaultDesc = existing ? existing.description : (prefill ? prefill.description : '');
    let defaultCat = existing ? existing.category : (prefill ? prefill.category : categories[0]);

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
                ${categories.map((c) => `<option value="${c}" ${defaultCat === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>
            <label>Descrição
              <input type="text" id="tx-desc" value="${defaultDesc}" />
            </label>
            <label>Valor (R$)
              <input type="number" step="0.01" min="0" id="tx-amount" value="${defaultAmount}" required />
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

 // ---------- INTEGRAÇÃO DE IA (GEMINI) ----------

  let currentChatId = sessionStorage.getItem('activeChatId') || null;

function setCurrentChatId(id) {
  currentChatId = id;
  if (id) sessionStorage.setItem('activeChatId', id);
  else sessionStorage.removeItem('activeChatId');
}
  let allChatsCache = [];
  let pendingAttachment = null; // { mimeType, data (base64), label }
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimeout = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatRelativeDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Ontem';
    if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function resizeImageToBase64(file, maxDim = 1024, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (ev) => { img.src = ev.target.result; };
      reader.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setPendingAttachment(att) {
    pendingAttachment = att;
    renderAttachmentPreview();
  }
  function clearPendingAttachment() {
    pendingAttachment = null;
    renderAttachmentPreview();
  }
  function renderAttachmentPreview() {
    const box = el('#chat-attachment-preview');
    if (!box) return;
    if (!pendingAttachment) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    box.innerHTML = `<span>${escapeHtml(pendingAttachment.label)}</span><i class="ti ti-x" id="btn-cancel-attachment"></i>`;
    el('#btn-cancel-attachment').addEventListener('click', clearPendingAttachment);
  }

  function initChatUI() {
    const root = el('#chat-root');
    root.innerHTML = `
      <button class="chat-fab" id="btn-toggle-chat"><i class="ti ti-sparkles"></i></button>
      <div class="chat-modal" id="chat-modal">
        <div class="chat-header">
          <div class="chat-header-left">
            <i class="ti ti-arrow-left" id="btn-back-to-list" style="display:none"></i>
            <span id="chat-header-title"><i class="ti ti-sparkles"></i> Assistente Financeiro</span>
          </div>
          <div class="chat-header-actions">
            <i class="ti ti-plus" id="btn-new-chat" title="Nova conversa"></i>
            <i class="ti ti-x" id="btn-close-chat"></i>
          </div>
        </div>

        <div class="chat-list-view" id="chat-list-view">
          <div class="chat-search">
            <i class="ti ti-search"></i>
            <input type="text" id="chat-search-input" placeholder="Buscar conversa..." autocomplete="off" />
          </div>
          <div class="chat-list" id="chat-list">
            <div class="chat-list-empty">Carregando...</div>
          </div>
        </div>

        <div class="chat-conversation-view" id="chat-conversation-view" style="display:none">
          <div class="chat-body" id="chat-messages"></div>
          <div class="chat-attachment-preview" id="chat-attachment-preview" style="display:none"></div>
          <form class="chat-input-area" id="chat-form">
            <input type="file" id="chat-image-input" accept="image/*" style="display:none" />
            <i class="ti ti-paperclip chat-icon-btn" id="btn-attach-image" title="Anexar imagem"></i>
            <i class="ti ti-microphone chat-icon-btn" id="btn-record-audio" title="Gravar áudio"></i>
            <input type="text" id="chat-input" placeholder="Pergunte algo ou registre um gasto..." autocomplete="off" />
            <button type="submit" id="chat-submit"><i class="ti ti-send"></i></button>
          </form>
        </div>
      </div>
    `;

    const chatModal = el('#chat-modal');
    el('#btn-toggle-chat').addEventListener('click', () => {
    const abrindo = !chatModal.classList.contains('open');
    chatModal.classList.toggle('open');
    if (abrindo) {
        if (currentChatId) {
            // Retoma a conversa ativa sem resetar o estado
            el('#chat-list-view').style.display = 'none';
            el('#chat-conversation-view').style.display = 'flex';
            el('#btn-back-to-list').style.display = 'inline-block';
        } else {
            showChatList();
        }
    }
});
    el('#btn-close-chat').addEventListener('click', () => chatModal.classList.remove('open'));
    el('#btn-new-chat').addEventListener('click', startNewChat);
    el('#btn-back-to-list').addEventListener('click', showChatList);
    el('#chat-search-input').addEventListener('input', (e) => renderChatList(e.target.value));

    el('#btn-attach-image').addEventListener('click', () => el('#chat-image-input').click());
    el('#chat-image-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const { base64, mimeType } = await resizeImageToBase64(file);
        setPendingAttachment({ mimeType, data: base64, label: '🖼️ Imagem anexada' });
      } catch {
        alert('Não foi possível processar essa imagem.');
      }
      e.target.value = '';
    });

    el('#btn-record-audio').addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          clearTimeout(recordingTimeout);
          el('#btn-record-audio').classList.remove('recording');
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const base64 = await blobToBase64(blob);
          setPendingAttachment({ mimeType: 'audio/webm', data: base64, label: '🎤 Áudio gravado' });
        };
        mediaRecorder.start();
        el('#btn-record-audio').classList.add('recording');
        recordingTimeout = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, 90000);
      } catch {
        alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
      }
    });

    el('#chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el('#chat-input');
      const msg = input.value.trim();
      if (!msg && !pendingAttachment) return;

      const attachmentToSend = pendingAttachment;
      const displayHtml = attachmentToSend
        ? `${escapeHtml(msg)} <span class="chat-attachment-chip">${attachmentToSend.label}</span>`
        : escapeHtml(msg);

      input.value = '';
      clearPendingAttachment();
      input.disabled = true;

      await sendChatMessage(msg, displayHtml, attachmentToSend);

      input.disabled = false;
      input.focus();
    });
  }

  async function sendChatMessage(msgToSend, displayHtml, attachmentToSend) {
    appendMessage('user', displayHtml);
    const loadingId = appendMessage('ai', '<div class="typing-indicator"><span></span><span></span><span></span></div>');

    try {
      const body = { message: msgToSend, chatId: currentChatId };
      if (attachmentToSend) body.attachment = { mimeType: attachmentToSend.mimeType, data: attachmentToSend.data };

      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.getToken()}` },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        let errMsg = 'Houve um erro de conexão com a IA.';
        try { const errData = await res.json(); if (errData.error) errMsg = errData.error; } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.chatId) setCurrentChatId(data.chatId);

      updateMessage(loadingId, marked.parse(data.text || ''));

      // É exatamente aqui que você atualiza a checagem:
      if (data.formulario) {
        if (data.formulario.tipo === 'lancamento') {
          renderLancamentoForm(loadingId, data.formulario);
        } else {
          renderLifeHubForm(loadingId, data.formulario);
        }
      }

      if (data.uiAction === 'RELOAD_DATA') {
        await loadData();
        renderView(true);
      }
    } catch (err) {
      updateMessage(loadingId, escapeHtml(err.message || 'Houve um erro de conexão com a IA.'));
    }
  }

  function renderLancamentoForm(bubbleId, formulario) {
    const bubble = el(`#${bubbleId}`);
    if (!bubble) return;
    const known = formulario.camposConhecidos || {};
    const opcoes = formulario.opcoes || {};
    const formId = 'clf_' + Date.now();

    const catsGasto = opcoes.categoriasGasto || [];
    const catsReceita = opcoes.categoriasReceita || [];

    const pessoasOpts = (opcoes.pessoas || []).map(p =>
      `<option value="${escapeHtml(p.id)}" ${known.paidBy === p.id ? 'selected' : ''}>${escapeHtml(p.name || p.id)}</option>`
    ).join('');

    // Mesmos rótulos e mesma ordem do getPaymentMethods() real do app.js
    const LABELS_FORMA = { dinheiro: 'Dinheiro/Conta', debito: 'Débito', pix: 'Pix', transferencia: 'Transferência' };
    const formasOpts = (opcoes.formasPagamento || []).map(f =>
      `<option value="${f}" ${known.paymentMethod === f ? 'selected' : ''}>${LABELS_FORMA[f] || f}</option>`
    ).join('');
    // Cartões com o rótulo "Cartão: <nome>", igual ao real (inclusive nomes duplicados, se existirem)
    const cartoesOpts = (opcoes.cartoes || []).map(c =>
      `<option value="card_${escapeHtml(c.id)}" ${known.paymentMethod === ('card_' + c.id) ? 'selected' : ''}>Cartão: ${escapeHtml(c.name)}</option>`
    ).join('');

    const tipoInicial = known.type === 'receita' ? 'receita' : 'gasto';

    const html = `
      <div class="chat-lancamento-form" id="${formId}">
        <div class="clf-row">
          <label>Tipo</label>
          <select class="clf-type">
            <option value="gasto" ${tipoInicial === 'gasto' ? 'selected' : ''}>Gasto</option>
            <option value="receita" ${tipoInicial === 'receita' ? 'selected' : ''}>Receita</option>
          </select>
        </div>
        <div class="clf-row">
          <label>Descrição</label>
          <input type="text" class="clf-description" value="${escapeHtml(known.description || '')}" placeholder="ex: Uber, Mercado..." />
        </div>
        <div class="clf-row">
          <label>Valor por parcela (R$)</label>
          <input type="number" step="0.01" class="clf-amount" value="${known.amount != null ? known.amount : ''}" placeholder="0,00" />
        </div>
        <div class="clf-row">
          <label>Parcelas</label>
          <input type="number" min="1" step="1" class="clf-installments" value="${known.installments || 1}" />
        </div>
        <div class="clf-row">
          <label>Data</label>
          <input type="date" class="clf-date" value="${known.date || new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="clf-row">
          <label>Categoria</label>
          <select class="clf-category"></select>
        </div>
        <div class="clf-row">
          <label>Quem pagou</label>
          <select class="clf-paidby">${pessoasOpts}</select>
        </div>
        <div class="clf-row clf-row-payment">
          <label>Forma de pagamento</label>
          <select class="clf-paymentmethod">${formasOpts}${cartoesOpts}</select>
        </div>
        <div class="clf-row" style="flex-direction:row; align-items:center; gap:8px;">
          <input type="checkbox" class="clf-third" id="${formId}-third" style="width:18px; height:18px;" />
          <label for="${formId}-third" style="text-transform:none; font-size:13px; font-weight:normal;">É dívida ou reembolso de terceiros?</label>
        </div>
        <div class="clf-third-fields" style="display:none; flex-direction:column; gap:8px;">
          <div class="clf-row">
            <label>Nome do terceiro</label>
            <input type="text" class="clf-third-name" placeholder="Ex: Irmão" />
          </div>
          <div class="clf-row">
            <label>Data prevista p/ receber</label>
            <input type="date" class="clf-third-date" />
          </div>
        </div>
        <button type="button" class="clf-submit">Confirmar lançamento</button>
      </div>
    `;
    bubble.insertAdjacentHTML('beforeend', html);

    const typeSelect = el(`#${formId} .clf-type`);
    const categorySelect = el(`#${formId} .clf-category`);
    const paymentRow = el(`#${formId} .clf-row-payment`);
    const thirdCheckbox = el(`#${formId} .clf-third`);
    const thirdFields = el(`#${formId} .clf-third-fields`);

    function fillCategories() {
      const lista = typeSelect.value === 'receita' ? catsReceita : catsGasto;
      categorySelect.innerHTML = lista.map(c =>
        `<option value="${escapeHtml(c)}" ${known.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`
      ).join('');
    }

    // Espelha exatamente o comportamento do modal real: some/mostra a forma de pagamento conforme o tipo
    function togglePaymentVisibility() {
      paymentRow.style.display = typeSelect.value === 'gasto' ? 'flex' : 'none';
    }

    fillCategories();
    togglePaymentVisibility();
    typeSelect.addEventListener('change', () => {
      fillCategories();
      togglePaymentVisibility();
    });

    thirdCheckbox.addEventListener('change', (e) => {
      thirdFields.style.display = e.target.checked ? 'flex' : 'none';
    });

    el(`#${formId} .clf-submit`).addEventListener('click', async () => {
      const isThird = thirdCheckbox.checked;
      const dataCompleta = {
        type: typeSelect.value,
        description: el(`#${formId} .clf-description`).value,
        amount: parseFloat(el(`#${formId} .clf-amount`).value) || 0,
        installments: parseInt(el(`#${formId} .clf-installments`).value) || 1,
        date: el(`#${formId} .clf-date`).value,
        category: categorySelect.value,
        paidBy: el(`#${formId} .clf-paidby`).value,
        paymentMethod: typeSelect.value === 'gasto' ? el(`#${formId} .clf-paymentmethod`).value : null,
        isThirdParty: isThird,
        thirdPartyName: isThird ? el(`#${formId} .clf-third-name`).value.trim() : null,
        thirdPartyDate: isThird ? el(`#${formId} .clf-third-date`).value : null
      };
      el(`#${formId}`).remove();

      const parcelaTxt = dataCompleta.installments > 1 ? ` em ${dataCompleta.installments}x` : '';
      const resumo = `Lançamento: ${dataCompleta.type} de R$ ${dataCompleta.amount.toFixed(2)}${parcelaTxt} em ${dataCompleta.category}`;
      await sendChatMessage(`[FORMULARIO_PREENCHIDO] ${JSON.stringify(dataCompleta)}`, escapeHtml(resumo), null);
    });

    const container = el('#chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  // Adicione esta função no app.js logo após a função renderLancamentoForm existente.
  // Também atualize sendChatMessage para chamar renderLifeHubForm quando o tipo não for 'lancamento'.

  function renderLifeHubForm(bubbleId, formulario) {
    const bubble = el(`#${bubbleId}`);
    if (!bubble) return;
    const tipo = formulario.tipo;
    const known = formulario.camposConhecidos || {};
    const opcoes = formulario.opcoes || {};
    const formId = 'clhf_' + Date.now();

    const pessoasOpts = (opcoes.pessoas || []).map(p =>
      `<option value="${escapeHtml(p.id)}" ${known.paidBy === p.id ? 'selected' : ''}>${escapeHtml(p.name || p.id)}</option>`
    ).join('');

    let fieldsHtml = '';
    let titleLabel = '';

    if (tipo === 'goal') {
      titleLabel = 'Nova Meta do Casal';
      fieldsHtml = `
        <div class="clf-row"><label>O que querem alcançar?</label><input type="text" class="clhf-title" value="${escapeHtml(known.title || '')}" placeholder="Ex: Viagem para o litoral" /></div>
        <div class="clf-row"><label>Valor Alvo (R$)</label><input type="number" step="0.01" class="clhf-target" value="${known.target || ''}" placeholder="5000" /></div>
        <div class="clf-row"><label>Já guardado (R$)</label><input type="number" step="0.01" class="clhf-saved" value="${known.saved || 0}" /></div>
      `;
    } else if (tipo === 'trip') {
      titleLabel = 'Nova Viagem / Roteiro';
      fieldsHtml = `
        <div class="clf-row"><label>Nome da viagem</label><input type="text" class="clhf-title" value="${escapeHtml(known.title || '')}" placeholder="Ex: Férias Nordeste" /></div>
        <div class="clf-row"><label>Mês previsto</label><input type="month" class="clhf-date" value="${known.date ? known.date.slice(0,7) : ''}" /></div>
      `;
    } else if (tipo === 'subscription') {
      titleLabel = 'Nova Assinatura';
      fieldsHtml = `
        <div class="clf-row"><label>Nome do serviço</label><input type="text" class="clhf-title" value="${escapeHtml(known.title || '')}" placeholder="Ex: Netflix, Spotify" /></div>
        <div class="clf-row"><label>Valor (R$)</label><input type="number" step="0.01" class="clhf-cost" value="${known.cost || ''}" placeholder="29,90" /></div>
        <div class="clf-row"><label>Ciclo</label>
          <select class="clhf-cycle">
            <option value="Mensal" ${known.cycle === 'Mensal' ? 'selected' : ''}>Mensal</option>
            <option value="Anual" ${known.cycle === 'Anual' ? 'selected' : ''}>Anual</option>
          </select>
        </div>
      `;
    } else if (tipo === 'shopping') {
      titleLabel = 'Nova Lista de Mercado';
      fieldsHtml = `
        <div class="clf-row"><label>Nome do mercado / lista</label><input type="text" class="clhf-title" value="${escapeHtml(known.title || '')}" placeholder="Ex: Assaí Outubro" /></div>
      `;
    } else if (tipo === 'maintenance') {
      titleLabel = 'Novo Serviço / Manutenção';
      fieldsHtml = `
        <div class="clf-row"><label>Veículo / Ativo</label><input type="text" class="clhf-vehicle" value="${escapeHtml(known.vehicle || '')}" placeholder="Ex: Moto, Carro" /></div>
        <div class="clf-row"><label>Serviço realizado</label><input type="text" class="clhf-service" value="${escapeHtml(known.service || '')}" placeholder="Ex: Troca de óleo" /></div>
        <div class="clf-row"><label>Quilometragem (KM)</label><input type="number" class="clhf-km" value="${known.km || ''}" /></div>
        <div class="clf-row"><label>Custo (R$)</label><input type="number" step="0.01" class="clhf-cost" value="${known.cost || ''}" /></div>
        <div class="clf-row"><label>Data</label><input type="date" class="clhf-date" value="${known.date || new Date().toISOString().slice(0,10)}" /></div>
      `;
    }

    const html = `
      <div class="chat-lancamento-form" id="${formId}">
        <div style="font-size:12px; font-weight:700; color:var(--teal-700); text-transform:uppercase; margin-bottom:4px;">${titleLabel}</div>
        ${fieldsHtml}
        <button type="button" class="clf-submit">Confirmar</button>
      </div>
    `;
    bubble.insertAdjacentHTML('beforeend', html);

    el(`#${formId} .clf-submit`).addEventListener('click', async () => {
      let dados = {};
      const today = new Date().toISOString().slice(0, 10);

      if (tipo === 'goal') {
        dados = {
          title: el(`#${formId} .clhf-title`).value.trim(),
          target: parseFloat(el(`#${formId} .clhf-target`).value) || 0,
          saved: parseFloat(el(`#${formId} .clhf-saved`).value) || 0
        };
      } else if (tipo === 'trip') {
        const monthVal = el(`#${formId} .clhf-date`).value;
        dados = {
          title: el(`#${formId} .clhf-title`).value.trim(),
          date: monthVal ? `${monthVal}-01` : today,
          places: []
        };
      } else if (tipo === 'subscription') {
        dados = {
          title: el(`#${formId} .clhf-title`).value.trim(),
          cost: parseFloat(el(`#${formId} .clhf-cost`).value) || 0,
          cycle: el(`#${formId} .clhf-cycle`).value
        };
      } else if (tipo === 'shopping') {
        dados = {
          title: el(`#${formId} .clhf-title`).value.trim(),
          date: today,
          items: []
        };
      } else if (tipo === 'maintenance') {
        dados = {
          vehicle: el(`#${formId} .clhf-vehicle`).value.trim(),
          service: el(`#${formId} .clhf-service`).value.trim(),
          km: parseInt(el(`#${formId} .clhf-km`).value) || 0,
          cost: parseFloat(el(`#${formId} .clhf-cost`).value) || 0,
          date: el(`#${formId} .clhf-date`).value || today
        };
      }

      el(`#${formId}`).remove();

      const tipoLabels = { goal: 'Meta', trip: 'Viagem', subscription: 'Assinatura', shopping: 'Lista de Mercado', maintenance: 'Manutenção' };
      const resumo = `Criar ${tipoLabels[tipo] || tipo}: ${dados.title || dados.vehicle || ''}`;
      await sendChatMessage(
        `[FORMULARIO_LIFEHUB_PREENCHIDO] tipo:${tipo} dados:${JSON.stringify(dados)}`,
        escapeHtml(resumo),
        null
      );
    });

    el('#chat-messages').scrollTop = el('#chat-messages').scrollHeight;
  }

  async function fetchChatList() {
    try {
      const res = await fetch('/.netlify/functions/chatSessions', {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async function showChatList() {
    clearPendingAttachment();
    el('#chat-header-title').innerHTML = '<i class="ti ti-sparkles"></i> Assistente Financeiro';
    el('#btn-back-to-list').style.display = 'none';
    el('#chat-list-view').style.display = 'flex';
    el('#chat-conversation-view').style.display = 'none';
    setCurrentChatId(null);

    el('#chat-list').innerHTML = '<div class="chat-list-empty">Carregando...</div>';
    allChatsCache = await fetchChatList();
    renderChatList('');
  }

  function renderChatList(filter) {
    const container = el('#chat-list');
    const term = (filter || '').toLowerCase();
    const filtered = allChatsCache.filter(c => (c.title || '').toLowerCase().includes(term));

    if (filtered.length === 0) {
      container.innerHTML = `<div class="chat-list-empty">${
        allChatsCache.length === 0 ? 'Nenhuma conversa ainda. Toque em + para começar.' : 'Nenhuma conversa encontrada.'
      }</div>`;
      return;
    }

    container.innerHTML = filtered.map(c => `
      <div class="chat-list-item" data-id="${c.id}">
        <div class="chat-list-item-main">
          <div class="chat-list-item-title">${escapeHtml(c.title)}</div>
          <div class="chat-list-item-preview">${escapeHtml(c.preview)}</div>
        </div>
        <div class="chat-list-item-side">
          <span class="chat-list-item-date">${formatRelativeDate(c.updatedAt)}</span>
          <i class="ti ti-trash chat-list-item-delete" data-id="${c.id}" title="Excluir conversa"></i>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.chat-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('chat-list-item-delete')) return;
        openChat(item.dataset.id);
      });
    });

    container.querySelectorAll('.chat-list-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Excluir esta conversa? Isso não pode ser desfeito.')) return;
        await fetch(`/.netlify/functions/chatSessions?id=${btn.dataset.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        allChatsCache = allChatsCache.filter(c => c.id !== btn.dataset.id);
        renderChatList(el('#chat-search-input').value);
      });
    });
  }

  async function openChat(id) {
    clearPendingAttachment();
    setCurrentChatId(id);
    el('#btn-back-to-list').style.display = 'inline-block';
    el('#chat-list-view').style.display = 'none';
    el('#chat-conversation-view').style.display = 'flex';

    const chatInfo = allChatsCache.find(c => c.id === id);
    el('#chat-header-title').textContent = chatInfo ? chatInfo.title : 'Conversa';

    const messagesEl = el('#chat-messages');
    messagesEl.innerHTML = '<div class="chat-list-empty">Carregando conversa...</div>';

    try {
      const res = await fetch(`/.netlify/functions/chatSessions?id=${id}`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      const session = await res.json();

      messagesEl.innerHTML = '';
      (session.messages || []).forEach(m => {
        if (m.role === 'model') {
          appendMessage('ai', marked.parse(m.text || ''));
        } else {
          appendMessage('user', escapeHtml(m.text || ''));
        }
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch {
      messagesEl.innerHTML = '<div class="chat-list-empty">Não foi possível carregar essa conversa.</div>';
    }

    el('#chat-input').focus();
  }

  function startNewChat() {
    clearPendingAttachment();
    setCurrentChatId(null);
    el('#chat-header-title').textContent = 'Nova conversa';
    el('#btn-back-to-list').style.display = 'inline-block';
    el('#chat-list-view').style.display = 'none';
    el('#chat-conversation-view').style.display = 'flex';

    el('#chat-messages').innerHTML = '';
    appendMessage('ai', 'Olá! Posso te ajudar a registrar gastos, conferir balanços ou excluir lançamentos se algo deu errado. Você também pode me mandar uma foto de comprovante ou um áudio. O que manda hoje?');
    el('#chat-input').focus();
  }

  function appendMessage(role, html) {
    const container = el('#chat-messages');
    const div = document.createElement('div');
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    div.id = id;
    div.className = `chat-bubble ${role}`;
    div.innerHTML = html;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  function updateMessage(id, html) {
    const div = el(`#${id}`);
    if (div) {
      div.innerHTML = html;
      const container = el('#chat-messages');
      container.scrollTop = container.scrollHeight;
    }
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
    skipFixedMonth,
    openListModal,
    openAddItemModal,
    toggleItemCheck,
    updateItemPrice,
    deleteItemFromList,
    openMaintenanceModal,
    deleteRecordEntry,
    convertListToTx,
    openTripModal,
    openTripPlaceModal,
    deleteTripPlace,
    openGoalModal,
    openSubModal
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
