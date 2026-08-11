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

  // MOTOR DE MESES: Calcula histórico, saldos acumulados (geral e individual) e separa gastos por pessoa
  function buildMonthlySummary(transactions, settings) {
    const groups = {};
    const fixedEntries = (settings && settings.fixedEntries) || [];
    const people = (settings && settings.people) || [];
    
    let minDate = new Date();
    let maxDate = new Date();
    
    transactions.forEach(t => { 
      const d = new Date(t.date); 
      if (d < minDate) minDate = d; 
      if (d > maxDate) maxDate = d;
    });
    
    minDate.setDate(1);
    
    let futureLimit = new Date();
    futureLimit.setMonth(futureLimit.getMonth() + 6);
    
    if (maxDate < futureLimit) {
      maxDate = futureLimit;
    } else {
      maxDate.setMonth(maxDate.getMonth() + 1);
    }

    let curr = new Date(minDate);
    while (curr <= maxDate) {
      const k = curr.toISOString().slice(0, 7);
      groups[k] = { 
        key: k, 
        receitas: 0, 
        gastos: 0, 
        byCategory: {}, 
        byPerson: {}, 
        byPersonRenda: {}, 
        byPersonCard: {}, 
        items: [], 
        thirdParty: 0 
      };
      curr.setMonth(curr.getMonth() + 1);
    }

    transactions.forEach((t) => {
      const k = monthKey(t.date);
      if (!groups[k]) return;
      groups[k].items.push(t);
      processTransactionData(groups[k], t);
    });

    Object.values(groups).forEach(g => {
      fixedEntries.forEach(fixo => {
        const hasRealOverride = g.items.some(t => t.category === fixo.category && t.paidBy === fixo.person && t.type === fixo.type);
        if (!hasRealOverride) {
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
      g.items.sort((a, b) => b.date.localeCompare(a.date));
    });

    const keys = Object.keys(groups).sort();
    let runningTotal = 0;
    const runningByPerson = {};
    people.forEach(p => { runningByPerson[p.id] = 0; });
    
    return keys.map((key) => {
      const g = groups[key];
      
      // Cálculo Geral do Casal
      const saldoInicial = runningTotal;
      const entradasTotais = saldoInicial + g.receitas;
      const despesasTotais = g.gastos;
      const saldoRestante = entradasTotais - despesasTotais;
      runningTotal = saldoRestante;

      // Cálculo Individual por Pessoa (Permite filtrar os cards no Início)
      const personMetrics = {};
      people.forEach(p => {
        const pId = p.id;
        const pSaldoInicial = runningByPerson[pId] || 0;
        const pReceitas = g.byPersonRenda[pId] || 0;
        const pGastos = g.byPerson[pId] || 0;
        const pEntradasTotais = pSaldoInicial + pReceitas;
        const pSaldoRestante = pEntradasTotais - pGastos;
        
        runningByPerson[pId] = pSaldoRestante;

        personMetrics[pId] = {
          saldoInicial: pSaldoInicial,
          receitas: pReceitas,
          gastos: pGastos,
          entradasTotais: pEntradasTotais,
          despesasTotais: pGastos,
          saldoRestante: pSaldoRestante
        };
      });

      return { 
        ...g, 
        saldoInicial,
        entradasTotais,
        despesasTotais,
        saldoRestante,
        personMetrics,
        saldoMes: g.receitas - g.gastos, 
        saldoFinal: runningTotal 
      };
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

  // CÁLCULO REAL DO CARTÃO: Soma todas as dívidas pendentes do mês visualizado EM DIANTE (incluindo parcelas futuras)
  function getCardsUsage(transactions, monthKeyStr, settings) {
    const cards = (settings && settings.cards) || [];
    const usageMap = {};
    
    cards.forEach(c => {
      usageMap[c.id] = {
        id: c.id,
        name: c.name,
        owner: c.owner || 'u1',
        limit: Number(c.limit) || 0,
        used: 0,
        available: Number(c.limit) || 0,
        pct: 0
      };
    });

    const targetDateStart = `${monthKeyStr}-01`;

    transactions
      .filter(t => t.type === 'gasto' && t.date >= targetDateStart)
      .forEach(t => {
        if (t.paymentMethod && t.paymentMethod.startsWith('card_')) {
          const cardId = t.paymentMethod.replace('card_', '');
          if (usageMap[cardId]) {
            usageMap[cardId].used += t.amount;
            usageMap[cardId].available = Math.max(0, usageMap[cardId].limit - usageMap[cardId].used);
            usageMap[cardId].pct = usageMap[cardId].limit > 0 
              ? Math.min(100, Math.round((usageMap[cardId].used / usageMap[cardId].limit) * 100)) 
              : 0;
          }
        }
      });

    return Object.values(usageMap);
  }

  function getMonthsUpTo(months, targetKey, count = 6) {
    const idx = months.findIndex(m => m.key === targetKey);
    if (idx === -1) return months.slice(-count);
    const start = Math.max(0, idx - count + 1);
    return months.slice(start, idx + 1);
  }

  return { 
    fmtBRL, 
    fmtDate, 
    fmtDateTime, 
    monthKey, 
    monthLabel, 
    monthLabelShort, 
    currentMonthKey, 
    buildMonthlySummary, 
    getCardsUsage,
    getMonthsUpTo,
    MONTH_NAMES 
  };
})();
