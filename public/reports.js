// Four-week reporting and live Supabase capacity panel.
(function () {
  const CATEGORY_LABELS = {
    GLDU: 'GL/DU Copper', GLDUFTTH: 'GL/DU FTTH',
    UNWHAR: 'UNW/HAR Copper', UNWHARIMFTTH: 'UNW/HAR/IM FTTH',
    UMNF: 'UM/NF', IM: 'IM', '4G': '4G', UG: 'UG Fault'
  };
  const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

  // Replace the one-day snapshot loader with a rolling four-week history loader.
  window.loadDailySnapshots = async function () {
    const selector = document.getElementById('snapshotVersion');
    if (!selector) return;
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 28);
    try {
      const response = await fetch('/api/cloud/snapshots?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString()), {
        credentials: 'include', cache: 'no-store'
      });
      const result = await response.json().catch(() => []);
      if (!response.ok) throw new Error(result.error || 'Unable to load four-week history.');
      dailySnapshots = (Array.isArray(result) ? result : []).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
      selector.replaceChildren();
      if (!dailySnapshots.length) {
        selector.add(new Option('No saved versions in last 4 weeks', ''));
        selector.disabled = true;
      } else {
        dailySnapshots.forEach((snapshot, index) => selector.add(new Option(formatSnapshotLabel(snapshot, index), String(snapshot.id))));
        selector.disabled = false;
        selector.value = String(dailySnapshots[dailySnapshots.length - 1].id);
        viewingHistoricalSnapshot = false;
        csvModifiedAt = dailySnapshots[dailySnapshots.length - 1].csv_modified_at || null;
        updateCsvModifiedDisplay(csvModifiedAt);
      }
      if (Array.isArray(fullData) && fullData.length) updateDashboard(fullData);
      renderWorkloadChart();
    } catch (error) {
      dailySnapshots = [];
      selector.replaceChildren(new Option('History unavailable', ''));
      selector.disabled = true;
      console.error('Four-week history unavailable:', error);
      renderWorkloadChart();
    }
  };

  window.renderWorkloadChart = function () {
    const chart = document.getElementById('workloadTrendChart');
    const body = document.getElementById('trendReportBody');
    const title = document.getElementById('workload-trend-title');
    const message = document.getElementById('workload-trend-message');
    if (!chart || !body || !title || !message) return;
    if (!dailySnapshots || !dailySnapshots.length) {
      title.textContent = 'Four-Week Workload Trend';
      message.textContent = 'No saved snapshots are available for the last four weeks.';
      body.innerHTML = '<tr><td colspan="5">No four-week history available.</td></tr>';
      return;
    }
    const selected = document.getElementById('trendCategorySelect')?.value || 'ALL';
    const category = selected === 'ALL' ? null : selected;
    title.textContent = category ? CATEGORY_LABELS[category] + ' — Four-Week Trend' : 'All Categories — Four-Week Trend';
    message.textContent = 'Each point represents a saved CSV snapshot. Completed is cumulative from tickets disappearing between consecutive snapshots.';
    const totals = { Open: 0, Ack: 0, Clear: 0 };
    let cumulativeCompleted = 0;
    const rows = dailySnapshots.map((snapshot, index) => {
      const counts = updateDashboard(snapshot.tickets || [], false);
      const selectedCounts = category ? (counts[category] || totals) : CATEGORY_KEYS.reduce((sum, key) => {
        sum.Open += counts[key].Open || 0;
        sum.Ack += counts[key].Ack || 0;
        sum.Clear += counts[key].Clear || 0;
        return sum;
      }, { Open: 0, Ack: 0, Clear: 0 });
      if (index > 0) {
        const previousTickets = dailySnapshots[index - 1].tickets || [];
        const currentIds = new Set((snapshot.tickets || []).map(normalizeTicketId).filter(Boolean));
        const completed = Object.fromEntries(CATEGORY_KEYS.map(key => [key, 0]));
        previousTickets.forEach(ticket => {
          const id = normalizeTicketId(ticket);
          const oldStatus = String(ticket.Status || '').trim().toUpperCase();
          if (!id || currentIds.has(id) || oldStatus.includes('CLOSED') || oldStatus.includes('RESOLVED') || oldStatus.includes('CLEARED')) return;
          const type = String(ticket.SA_SERVICE_TYPE || '').trim().toUpperCase();
          const lea = String(ticket.SA_LEA || '').trim().toUpperCase();
          const isUG = String(ticket['Assigned WG'] || '').toUpperCase().includes('CDM');
          const assigned = String(ticket['Assigned WG'] || '').toUpperCase();
          const circuit = String(ticket['Circuit Display Name'] || '').toUpperCase();
          const dp = String(ticket.SA_DP_LOOP || '').trim().toUpperCase();
          const copper = getIsCopperService(type);
          const ftth = type.includes('FTTH');
          const is4G = !copper && (assigned.includes('LTE') || circuit.includes('0913') || circuit.includes('94913'));
          const unwHarDp = dp.startsWith('UNW') || dp.startsWith('HAR');
          let key = null;
          if (ftth) {
            if (unwHarDp || ['UNW', 'HAR', 'IM'].includes(lea)) key = 'UNWHARIMFTTH';
            else if (['GL', 'DU'].includes(lea)) key = 'GLDUFTTH';
          } else if (unwHarDp && !isUG && copper) key = 'UNWHAR';
          else if (['GL', 'DU'].includes(lea) && !isUG && !is4G && copper) key = 'GLDU';
          else if (['UM', 'NF'].includes(lea) && !isUG && !is4G && copper) key = 'UMNF';
          else if (lea === 'IM' && !isUG && !is4G && copper) key = 'IM';
          else if (is4G) key = '4G';
          else if (isUG && ['GL', 'DU', 'HAR', 'UNW', 'UM', 'NF', 'IM'].includes(lea)) key = 'UG';
          if (key) completed[key]++;
        });
        cumulativeCompleted += category ? (completed[category] || 0) : CATEGORY_KEYS.reduce((sum, key) => sum + completed[key], 0);
      }
      const stamp = new Date(snapshot.captured_at);
      const label = stamp.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return [label, selectedCounts.Open, selectedCounts.Ack, selectedCounts.Clear, cumulativeCompleted];
    });
    if (window.google?.visualization) {
      const data = google.visualization.arrayToDataTable([
        ['Snapshot', 'Open', 'Acknowledged', 'Cleared', 'Completed (cumulative)'],
        ...rows
      ]);
      new google.visualization.LineChart(chart).draw(data, {
        backgroundColor: 'transparent',
        colors: ['#38bdf8', '#fbbf24', '#10b981', '#a78bfa'],
        chartArea: { left: 58, top: 20, width: '86%', height: '70%' },
        hAxis: { textStyle: { color: '#cbd5e1' }, slantedText: true, maxTextLines: 2 },
        vAxis: { minValue: 0, textStyle: { color: '#cbd5e1' }, gridlines: { color: '#334155' } },
        legend: { position: 'bottom', textStyle: { color: '#e2e8f0' } },
        pointSize: 4
      });
    }
    body.replaceChildren();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach(value => {
        const td = document.createElement('td');
        td.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  };

  window.loadSupabaseUsage = async function () {
    const status = document.getElementById('supabase-capacity-status');
    const usedEl = document.getElementById('supabase-used');
    const remainingEl = document.getElementById('supabase-remaining');
    const bar = document.getElementById('supabase-capacity-bar');
    const note = document.getElementById('supabase-capacity-note');
    if (!status || !usedEl || !remainingEl || !bar) return;
    try {
      const response = await fetch('/api/cloud/usage', { credentials: 'include', cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Usage unavailable');
      const used = Number(result.used_bytes), limit = Number(result.limit_bytes);
      if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) throw new Error('Invalid usage response');
      const remaining = Math.max(0, limit - used), pct = Math.min(100, used / limit * 100);
      const fmt = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
      usedEl.textContent = fmt(used) + ' used';
      remainingEl.textContent = fmt(remaining) + ' remaining';
      bar.style.width = pct.toFixed(1) + '%';
      bar.classList.toggle('near-limit', pct >= 80);
      status.textContent = pct >= 90 ? 'Near limit' : 'Healthy';
      status.classList.toggle('capacity-warning', pct >= 80);
      if (note) note.textContent = pct.toFixed(1) + '% of the 500 MB database allowance used';
    } catch (error) {
      status.textContent = 'Unavailable';
      usedEl.textContent = '—';
      remainingEl.textContent = 'Remaining: —';
      bar.style.width = '0%';
      if (note) note.textContent = 'Could not retrieve live database usage.';
      console.warn('Supabase usage check failed:', error);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.dashboard-tab').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-tab').forEach(tab => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.dashboard-tab-panel').forEach(panel => { panel.hidden = panel.id !== button.dataset.tab; });
      if (button.dataset.tab === 'reportsTab') {
        renderWorkloadChart();
        setTimeout(renderWorkloadChart, 80);
      }
    }));
    document.getElementById('trendCategorySelect')?.addEventListener('change', renderWorkloadChart);
    // Login may complete after this script runs, so retry while the dashboard session is active.
    loadSupabaseUsage();
    setInterval(() => {
      if (document.querySelector('.app-shell')?.style.display !== 'none') loadSupabaseUsage();
    }, 60000);
  });
})();
