const Utils = (() => {
  const fmtBRL = (value) =>
    (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmtDate = (isoDate) => {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  };

  const fmtDateTime = (isoString) => {
    const dt = new Date(isoString);
    return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const monthKey = (isoDate) => isoDate.slice(0, 7); // "YYYY-MM"

  const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];

  const monthLabel = (key) => {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} de ${y}`;
  };

  const monthLabelShort = (key) => {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)}/${y.slice(2)}`;
  };

  const currentMonthKey = () => new Date().toISOString().slice(0, 7);

  // Groups transactions by "YYYY-MM" and returns an array of month summaries
  // sorted chronologically, each carrying a running (accumulated) balance,
  // so money left over in one month automatically rolls into the next.
  function buildMonthlySummary(transactions) {
    const groups = {};
    transactions.forEach((t) => {
      const key = monthKey(t.date);
      if (!groups[key]) {
        groups[key] = { key, receitas: 0, gastos: 0, byCategory: {}, byPerson: {}, items: [] };
      }
      const g = groups[key];
      g.items.push(t);
      if (t.type === 'receita') {
        g.receitas += t.amount;
      } else {
        g.gastos += t.amount;
      }
      g.byCategory[t.category] = (g.byCategory[t.category] || 0) + t.amount * (t.type === 'gasto' ? 1 : 0);
      if (t.paidBy) {
        g.byPerson[t.paidBy] = (g.byPerson[t.paidBy] || 0) + (t.type === 'gasto' ? t.amount : 0);
      }
    });

    const keys = Object.keys(groups).sort();
    let running = 0;
    const months = keys.map((key) => {
      const g = groups[key];
      const saldoMes = g.receitas - g.gastos;
      const saldoInicial = running;
      running += saldoMes;
      return {
        ...g,
        saldoMes,
        saldoInicial,
        saldoFinal: running,
      };
    });

    return months;
  }

  function currentCreditCardUsage(transactions, monthKeyStr) {
    return transactions
      .filter((t) => t.type === 'gasto' && t.paymentMethod === 'cartao' && monthKey(t.date) === monthKeyStr)
      .reduce((sum, t) => sum + t.amount, 0);
  }

  function debounce(fn, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), wait);
    };
  }

  return {
    fmtBRL, fmtDate, fmtDateTime, monthKey, monthLabel, monthLabelShort,
    currentMonthKey, buildMonthlySummary, currentCreditCardUsage, debounce,
    MONTH_NAMES,
  };
})();
