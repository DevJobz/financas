const Charts = (() => {
  const instances = {};

  function destroy(id) {
    if (instances[id]) {
      instances[id].destroy();
      delete instances[id];
    }
  }

  const palette = {
    teal: '#0F6E56',
    tealLight: '#5DCAA5',
    coral: '#D85A30',
    coralLight: '#F0997B',
    amber: '#BA7517',
    gray: '#888780',
    grid: 'rgba(0,0,0,0.06)',
  };

  function evolutionChart(canvasId, months) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map((m) => Utils.monthLabelShort(m.key)),
        datasets: [
          {
            label: 'Saldo acumulado',
            data: months.map((m) => m.saldoFinal),
            borderColor: palette.teal,
            backgroundColor: 'rgba(15,110,86,0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: palette.teal,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: palette.grid }, ticks: { callback: (v) => Utils.fmtBRL(v) } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function incomeExpenseChart(canvasId, months) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const recent = months.slice(-6);
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: recent.map((m) => Utils.monthLabelShort(m.key)),
        datasets: [
          { label: 'Receitas', data: recent.map((m) => m.receitas), backgroundColor: palette.tealLight, borderRadius: 6 },
          { label: 'Gastos', data: recent.map((m) => m.gastos), backgroundColor: palette.coralLight, borderRadius: 6 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
        scales: {
          y: { grid: { color: palette.grid }, ticks: { callback: (v) => Utils.fmtBRL(v) } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function categoryChart(canvasId, byCategory) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const entries = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const colors = ['#0F6E56', '#D85A30', '#BA7517', '#5DCAA5', '#F0997B', '#7F77DD', '#D4537E', '#888780', '#378ADD', '#639922'];
    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => k),
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, usePointStyle: true } } },
      },
    });
  }

  function personChart(canvasId, byPerson, people) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = people.map((p) => p.name);
    const data = people.map((p) => byPerson[p.id] || 0);
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: people.map((p) => p.color || palette.teal), borderRadius: 8 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: palette.grid }, ticks: { callback: (v) => Utils.fmtBRL(v) } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  return { evolutionChart, incomeExpenseChart, categoryChart, personChart };
})();
