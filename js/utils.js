const Utils = (() => {
  const fmtBRL = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (isoDate) => {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtDateTime = (isoStr) => new Date(isoStr).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const monthKey = (isoDate) => isoDate.slice(0, 7);

  const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthLabel = (key) => {
    if (!key || typeof key !== 'string') return '';
    const parts = key.split('-');
    if (parts.length < 2) return key;
    return `${MONTH_NAMES[Number(parts[1]) - 1]} de ${parts[0]}`;
  };

  const monthLabelShort = (key) => {
    if (!key || typeof key !== 'string') return '';
    const parts = key.split('-');
    if (parts.length < 2) return key;
    return `${MONTH_NAMES[Number(parts[1]) - 1].slice(0, 3)}/${parts[0].slice(2)}`;
  };
  const currentMonthKey = () => new Date().toISOString().slice(0, 7);

  // NOVO MOTOR: Calcula histórico cruzando Lançamentos Reais vs Fixos (Ajustes)
  function buildMonthlySummary(transactions, settings) {
    const groups = {};
    const fixedEntries = (settings && settings.fixedEntries) || [];
    
    // 1. Define a linha do tempo (do mês mais antigo até 6 meses pra frente)
    let minDate = new Date();
    transactions.forEach(t => { const d = new Date(t.date); if(d < minDate) minDate = d; });
    minDate.setDate(1);
    
    let maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 6);

    let curr = new Date(minDate);
    while (curr <= maxDate) {
      const k = curr.toISOString().slice(0, 7);
      groups[k] = { 
        key: k, receitas: 0, gastos: 0, 
        byCategory: {}, byPerson: {}, byPersonRenda: {}, byPersonCard: {}, 
        items: [], thirdParty: 0 
      };
      curr.setMonth(curr.getMonth() + 1);
    }

    // 2. Aloca lançamentos reais
    transactions.forEach((t) => {
      const k = monthKey(t.date);
      if (!groups[k]) return;
      groups[k].items.push(t);
      processTransactionData(groups[k], t);
    });

    // 3. Injeta Lançamentos Fixos (se não houver um real sobrescrevendo)
    Object.values(groups).forEach(g => {
      fixedEntries.forEach(fixo => {
        // Verifica se já existe um lançamento real da mesma pessoa e categoria
        const hasRealOverride = g.items.some(t => t.category === fixo.category && t.paidBy === fixo.person && t.type === fixo.type);
        if(!hasRealOverride) {
          const virtualTx = {
            id: 'virtual_' + fixo.id,
            isVirtual: true,
            date: `${g.key}-01`,
            type: fixo.type,
            category: fixo.category,
            description: `${fixo.description} (Fixo)`,
            amount: Number(fixo.amount),
            paidBy: fixo.person,
            paymentMethod: fixo.type === 'gasto' ? 'dinheiro' : null
          };
          g.items.push(virtualTx);
          processTransactionData(g, virtualTx);
        }
      });
      g.items.sort((a, b) => b.date.localeCompare(a.date)); // Reordena
    });

    // 4. Calcula saldos cumulativos
    const keys = Object.keys(groups).sort();
    let running = 0;
    return keys.map((key) => {
      const g = groups[key];
      const saldoMes = g.receitas - g.gastos;
      const saldoInicial = running;
      running += saldoMes;

      const acerto = {};
      const ids = Object.keys(g.byPerson);
      if(ids.length === 2) {
          const diff = g.byPerson[ids[0]] - g.byPerson[ids[1]];
          acerto.devedor = diff > 0 ? ids[1] : ids[0];
          acerto.credor = diff > 0 ? ids[0] : ids[1];
          acerto.valor = Math.abs(diff) / 2;
      }
      return { ...g, saldoMes, saldoInicial, saldoFinal: running, acerto };
    });
  }

  function processTransactionData(g, t) {
    if (t.type === 'receita') {
      g.receitas += t.amount;
      g.byPersonRenda[t.paidBy] = (g.byPersonRenda[t.paidBy] || 0) + t.amount;
    } else {
      g.gastos += t.amount;
    }
    
    if (t.paidBy) {
      g.byPerson[t.paidBy] = (g.byPerson[t.paidBy] || 0) + (t.type === 'gasto' ? t.amount : 0);
      if (t.type === 'gasto') {
        if (!g.byCategoryPerson) g.byCategoryPerson = {};
        if (!g.byCategoryPerson[t.paidBy]) g.byCategoryPerson[t.paidBy] = {};
        g.byCategoryPerson[t.paidBy][t.category] = (g.byCategoryPerson[t.paidBy][t.category] || 0) + t.amount;
      }
      if (t.paymentMethod && t.paymentMethod.startsWith('card_') && t.type === 'gasto') {
          g.byPersonCard[t.paidBy] = (g.byPersonCard[t.paidBy] || 0) + t.amount;
      }
    }
    if (t.isThirdParty) g.thirdParty += (t.type === 'gasto' ? t.amount : -t.amount);
    g.byCategory[t.category] = (g.byCategory[t.category] || 0) + t.amount * (t.type === 'gasto' ? 1 : 0);
  }

  return { fmtBRL, fmtDate, fmtDateTime, monthKey, monthLabel, monthLabelShort, currentMonthKey, buildMonthlySummary, MONTH_NAMES };
})();