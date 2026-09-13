// netlify/functions/_shared/financeEngine.js
// Porta EXATA da lógica de netlify/functions/js/utils.js (Utils.buildMonthlySummary),
// só trocando a IIFE do browser por exports ESM para uso nas Netlify Functions.

export function monthKey(isoDate) {
  return isoDate.slice(0, 7);
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

// MOTOR DE MESES: Calcula histórico, saldos acumulados e separa gastos por pessoa
// (idêntico ao buildMonthlySummary do utils.js do frontend)
export function buildMonthlySummary(transactions, settings) {
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

  fixedEntries.forEach(fixo => {
    if (fixo.startsAt) {
      const dStart = new Date(fixo.startsAt + '-01T12:00:00');
      if (dStart < minDate) minDate = dStart;
    }
    if (fixo.expiresAt) {
      const dExp = new Date(fixo.expiresAt + '-01T12:00:00');
      if (dExp > maxDate) maxDate = dExp;
    }
  });

  minDate.setDate(1);

  let futureLimit = new Date();
  futureLimit.setMonth(futureLimit.getMonth() + 12);

  fixedEntries.forEach(fixo => {
    if (fixo.expiresAt) {
      const dExp = new Date(fixo.expiresAt + '-01T12:00:00');
      if (dExp > futureLimit) futureLimit = dExp;
    }
  });

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
      if (fixo.startsAt && g.key < fixo.startsAt) return;
      if (fixo.expiresAt && g.key > fixo.expiresAt) return;
      if (fixo.skippedMonths && fixo.skippedMonths.includes(g.key)) return;

      const hasRealOverride = g.items.some(t =>
        t.fixedRefId === fixo.id ||
        (!t.fixedRefId && t.category === fixo.category && t.paidBy === fixo.person && t.type === fixo.type && Number(t.amount) === Number(fixo.amount))
      );
      if (!hasRealOverride) {
        const dueDay = fixo.dueDay ? String(fixo.dueDay).padStart(2, '0') : '01';
        const virtualTx = {
          id: 'virtual_' + fixo.id + '_' + g.key,
          isVirtual: true,
          fixedRefId: fixo.id,
          date: `${g.key}-${dueDay}`,
          type: fixo.type,
          category: fixo.category,
          description: `${fixo.description} (Fixo)`,
          amount: Number(fixo.amount),
          paidBy: fixo.person,
          paymentMethod: fixo.type === 'gasto' ? 'dinheiro' : null,
          status: 'aberto'
        };
        g.items.push(virtualTx);
        processTransactionData(g, virtualTx);
      }
    });
    g.items.sort((a, b) => a.date.localeCompare(b.date));
  });

  const keys = Object.keys(groups).sort();
  let runningTotal = 0;
  const runningByPerson = {};
  people.forEach(p => { runningByPerson[p.id] = 0; });

  return keys.map((key) => {
    const g = groups[key];

    const saldoInicial = runningTotal;
    const entradasTotais = saldoInicial + g.receitas;
    const despesasTotais = g.gastos;
    const saldoRestante = entradasTotais - despesasTotais;
    runningTotal = saldoRestante;

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

// Cálculo de uso de cartões (idêntico ao getCardsUsage do utils.js)
export function getCardsUsage(transactions, monthKeyStr, settings) {
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