/* ============================================================
   Instagram Meme Bot – Dashboard Frontend
   ============================================================ */

const API = '';
let refreshTimer = null;

/* ---------- Bootstrap ---------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  refresh();
  refreshTimer = setInterval(refresh, 10000); // every 10 s
});

async function refresh() {
  try {
    const [status, logs] = await Promise.all([
      fetch(`${API}/api/status`).then((r) => r.json()),
      fetch(`${API}/api/logs`).then((r) => r.json()),
    ]);
    renderStatus(status);
    renderLogs(logs.logs || []);
  } catch (err) {
    console.error('Dashboard refresh error:', err);
  }
}

/* ---------- Render functions --------------------------------- */

function renderStatus(data) {
  // badge
  const badge = document.getElementById('statusBadge');
  badge.textContent = data.status || 'idle';
  badge.className = 'badge badge-' + (data.status === 'running' ? 'running' : data.status === 'error' ? 'error' : 'idle');

  // stat cards
  const a = data.analytics || {};
  setText('postsToday', a.postsToday ?? 0);
  setText('postsWeek', a.postsThisWeek ?? 0);
  setText('successRate', (a.successRate ?? 100) + '%');
  setText('uptime', formatMs(a.uptimeMs || 0));

  // schedule
  renderSchedule(data.scheduler || {});

  // safety
  renderSafety(data.accountGuard || {}, data.rateLimiter || {});

  // recent posts
  renderRecentPosts(a.recentPosts || []);

  // chart
  renderChart(a.dailyCounts || {});

  // settings form defaults
  const s = data.scheduler || {};
  const rl = data.rateLimiter || {};
  setVal('setPostsPerDay', s.postsPerDay);
  if (s.activeWindow) {
    const parts = s.activeWindow.split('–').map((x) => parseInt(x));
    if (parts.length === 2) {
      setVal('setActiveStart', parts[0]);
      setVal('setActiveEnd', parts[1]);
    }
  }
  if (s.postTypes) setVal('setPostTypes', s.postTypes.join(','));
  if (rl.limits) setVal('setMaxPosts', rl.limits.postsPerDay);
}

function renderSchedule(sched) {
  const el = document.getElementById('scheduleList');
  const slots = sched.todaysSlots || [];
  if (!slots.length) {
    el.innerHTML = '<p class="muted">No slots remaining today</p>';
    return;
  }
  el.innerHTML = slots
    .map(
      (s) =>
        `<div class="slot"><span class="time">${pad(s.hour)}:${pad(s.minute)}</span><span class="type">${s.postType || 'auto'}</span></div>`
    )
    .join('');
}

function renderSafety(guard, rl) {
  const el = document.getElementById('safetyInfo');
  const rows = [
    ['Active Hours', guard.isActiveHour ? 'Yes' : 'No', guard.isActiveHour ? 'ok' : 'warn'],
    ['Safe Mode', guard.safeModeActive ? 'ACTIVE' : 'Off', guard.safeModeActive ? 'bad' : 'ok'],
    ['Consecutive Errors', guard.consecutiveErrors ?? 0, (guard.consecutiveErrors || 0) > 2 ? 'bad' : 'ok'],
    ['Warm-up', Math.round((guard.warmUpMultiplier || 1) * 100) + '%', (guard.warmUpMultiplier || 1) < 1 ? 'warn' : 'ok'],
    ['Cooldown', rl.cooldownActive ? formatMs(rl.cooldownRemaining || 0) : 'None', rl.cooldownActive ? 'warn' : 'ok'],
    ['Posts Today / Limit', `${rl.postsToday || 0} / ${(rl.limits || {}).postsPerDay || 5}`, 'ok'],
    ['Total Posts', guard.totalPosts ?? 0, 'ok'],
    ['Checkpoints', guard.checkpointCount ?? 0, (guard.checkpointCount || 0) > 0 ? 'bad' : 'ok'],
    ['Weekend', guard.isWeekend ? 'Yes' : 'No', 'ok'],
  ];
  el.innerHTML = rows
    .map(
      ([label, value, cls]) =>
        `<div class="safety-row"><span class="safety-label">${label}</span><span class="safety-value ${cls}">${value}</span></div>`
    )
    .join('');
}

function renderRecentPosts(posts) {
  const el = document.getElementById('recentPosts');
  if (!posts.length) {
    el.innerHTML = '<p class="muted">No posts yet</p>';
    return;
  }
  el.innerHTML = posts
    .map(
      (p) =>
        `<div class="post-item"><span class="post-time">${new Date(p.timestamp).toLocaleString()}</span><span class="post-type">${p.postType || '?'}</span><br/>${p.keyword || ''}</div>`
    )
    .join('');
}

function renderChart(counts) {
  const el = document.getElementById('weeklyChart');
  const dates = Object.keys(counts).sort();
  if (!dates.length) {
    el.innerHTML = '<p class="muted">No data yet</p>';
    return;
  }
  const max = Math.max(...Object.values(counts), 1);
  el.innerHTML = dates
    .map((d) => {
      const h = Math.max(4, (counts[d] / max) * 130);
      const label = d.slice(5); // MM-DD
      return `<div class="bar-group"><span class="bar-count">${counts[d]}</span><div class="bar" style="height:${h}px"></div><span class="bar-label">${label}</span></div>`;
    })
    .join('');
}

function renderLogs(lines) {
  const el = document.getElementById('logsPanel');
  el.textContent = lines.slice(-60).join('\n') || 'No logs yet';
  el.scrollTop = el.scrollHeight;
}

/* ---------- Actions ------------------------------------------ */

async function startBot() {
  try {
    await fetch(`${API}/api/bot/start`, { method: 'POST' });
    refresh();
  } catch (err) {
    alert('Failed to start bot: ' + err.message);
  }
}

async function stopBot() {
  try {
    await fetch(`${API}/api/bot/stop`, { method: 'POST' });
    refresh();
  } catch (err) {
    alert('Failed to stop bot: ' + err.message);
  }
}

async function postNow() {
  if (!confirm('Post a meme right now?')) return;
  try {
    const res = await fetch(`${API}/api/post-now`, { method: 'POST' });
    const data = await res.json();
    if (data.error) alert('Error: ' + data.error);
    else alert('Post sent!');
    refresh();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const body = {
    postsPerDay: parseInt(document.getElementById('setPostsPerDay').value, 10),
    activeHoursStart: parseInt(document.getElementById('setActiveStart').value, 10),
    activeHoursEnd: parseInt(document.getElementById('setActiveEnd').value, 10),
    postTypes: document.getElementById('setPostTypes').value.split(',').map((s) => s.trim()).filter(Boolean),
    maxPostsPerDay: parseInt(document.getElementById('setMaxPosts').value, 10),
    enableWeekendPause: document.getElementById('setWeekendPause').checked,
  };
  try {
    await fetch(`${API}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    alert('Settings saved!');
    refresh();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

/* ---------- Helpers ------------------------------------------ */
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el && v !== undefined) el.value = v;
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function formatMs(ms) {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  return (ms / 3600000).toFixed(1) + 'h';
}
