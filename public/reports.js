async function loadSupabaseUsage() {
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
    const remaining = Math.max(0, limit - used), percent = Math.min(100, used / limit * 100);
    const fmt = bytes => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : (bytes / 1024 ** 2).toFixed(1) + ' MB';
    usedEl.textContent = fmt(used) + ' used'; remainingEl.textContent = fmt(remaining) + ' remaining';
    bar.style.width = percent.toFixed(1) + '%'; bar.classList.toggle('near-limit', percent >= 80);
    status.textContent = percent >= 90 ? 'Near limit' : 'Healthy'; status.classList.toggle('capacity-warning', percent >= 80);
    if (note) note.textContent = percent.toFixed(1) + '% of the 500 MB database allowance used';
  } catch (error) {
    status.textContent = 'Unavailable'; usedEl.textContent = '—'; remainingEl.textContent = 'Remaining: —'; bar.style.width = '0%';
    if (note) note.textContent = 'Could not retrieve live database usage.';
    console.warn('Supabase usage check failed:', error);
  }
}
document.addEventListener('DOMContentLoaded', () => {
  loadSupabaseUsage();
  const shell = document.querySelector('.app-shell');
  if (shell && window.MutationObserver) {
    const observer = new MutationObserver(() => { if (shell.style.display !== 'none') loadSupabaseUsage(); });
    observer.observe(shell, { attributes: true, attributeFilter: ['style'] });
  }
  setInterval(() => { if (document.querySelector('.app-shell')?.style.display !== 'none') loadSupabaseUsage(); }, 60000);
});
