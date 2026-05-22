/* ============================================================
   Instagram Meme Bot – Dashboard Frontend
   ============================================================ */

const API = '';
let refreshTimer = null;
let serverTimezone = 'Asia/Kolkata';

/* ---------- Bootstrap ---------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  refresh();
  refreshTimer = setInterval(refresh, 10000);
  setInterval(updateClock, 1000);
  updateClock();
});

async function refresh() {
  try {
    const [status, logs] = await Promise.all([
      fetch(API + '/api/status').then(function(r) { return r.json(); }),
      fetch(API + '/api/logs').then(function(r) { return r.json(); }),
    ]);
    renderStatus(status);
    renderLogs(logs.logs || []);
  } catch (err) {
    console.error('Dashboard refresh error:', err);
  }
}

/* ---------- Clock -------------------------------------------- */

function updateClock() {
  var el = document.getElementById('currentTime');
  if (!el) return;
  try {
    var now = new Date().toLocaleString('en-IN', {
      timeZone: serverTimezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    el.textContent = 'Current Time (' + serverTimezone + '): ' + now;
  } catch (e) {
    el.textContent = 'Current Time: ' + new Date().toLocaleTimeString();
  }
}

/* ---------- Render functions --------------------------------- */

function renderStatus(data) {
  var badge = document.getElementById('statusBadge');
  badge.textContent = data.status || 'idle';
  badge.className = 'badge badge-' + (data.status === 'running' ? 'running' : data.status === 'error' ? 'error' : 'idle');

  var a = data.analytics || {};
  setText('postsToday', a.postsToday != null ? a.postsToday : 0);
  setText('postsWeek', a.postsThisWeek != null ? a.postsThisWeek : 0);
  setText('successRate', (a.successRate != null ? a.successRate : 100) + '%');
  setText('uptime', formatMs(a.uptimeMs || 0));

  var sched = data.scheduler || {};
  if (sched.timezone) serverTimezone = sched.timezone;
  renderSchedule(sched);
  renderSafety(data.accountGuard || {}, data.rateLimiter || {});
  renderRecentPosts(a.recentPosts || []);
  renderChart(a.dailyCounts || {});

  setVal('setPostsPerDay', sched.postsPerDay);
  if (sched.timezone) setVal('setTimezone', sched.timezone);
  if (sched.activeWindow) {
    var parts = sched.activeWindow.split('\u2013').map(function(x) { return parseInt(x); });
    if (parts.length === 2) {
      setVal('setActiveStart', parts[0]);
      setVal('setActiveEnd', parts[1]);
    }
  }
  if (sched.postTypes) setVal('setPostTypes', sched.postTypes.join(','));
  var rl = data.rateLimiter || {};
  if (rl.limits) setVal('setMaxPosts', rl.limits.postsPerDay);
}

function renderSchedule(sched) {
  var el = document.getElementById('scheduleList');
  var slots = sched.todaysSlots || [];
  if (!slots.length) {
    el.innerHTML = '<p class="muted">No slots remaining today</p>';
    return;
  }

  var now;
  try {
    var nowStr = new Date().toLocaleString('en-US', { timeZone: serverTimezone });
    now = new Date(nowStr);
  } catch (e) {
    now = new Date();
  }
  var currentHour = now.getHours();
  var currentMinute = now.getMinutes();

  el.innerHTML = slots
    .map(function(s) {
      var slotMin = s.hour * 60 + s.minute;
      var nowMin = currentHour * 60 + currentMinute;
      var cls = 'slot';
      if (slotMin < nowMin - 1) cls += ' done';
      else if (Math.abs(slotMin - nowMin) <= 1) cls += ' active';
      return '<div class="' + cls + '"><span class="time">' + pad(s.hour) + ':' + pad(s.minute) + '</span><span class="type">' + (s.postType || 'auto') + '</span></div>';
    })
    .join('');
}

function renderSafety(guard, rl) {
  var el = document.getElementById('safetyInfo');
  var rows = [
    ['Active Hours', guard.isActiveHour ? 'Yes' : 'No', guard.isActiveHour ? 'ok' : 'warn'],
    ['Safe Mode', guard.safeModeActive ? 'ACTIVE' : 'Off', guard.safeModeActive ? 'bad' : 'ok'],
    ['Consecutive Errors', guard.consecutiveErrors != null ? guard.consecutiveErrors : 0, (guard.consecutiveErrors || 0) > 2 ? 'bad' : 'ok'],
    ['Warm-up', Math.round((guard.warmUpMultiplier || 1) * 100) + '%', (guard.warmUpMultiplier || 1) < 1 ? 'warn' : 'ok'],
    ['Cooldown', rl.cooldownActive ? formatMs(rl.cooldownRemaining || 0) : 'None', rl.cooldownActive ? 'warn' : 'ok'],
    ['Posts Today / Limit', (rl.postsToday || 0) + ' / ' + ((rl.limits || {}).postsPerDay || 5), 'ok'],
    ['Total Posts', guard.totalPosts != null ? guard.totalPosts : 0, 'ok'],
    ['Checkpoints', guard.checkpointCount != null ? guard.checkpointCount : 0, (guard.checkpointCount || 0) > 0 ? 'bad' : 'ok'],
    ['Weekend', guard.isWeekend ? 'Yes' : 'No', 'ok'],
  ];
  el.innerHTML = rows
    .map(function(r) {
      return '<div class="safety-row"><span class="safety-label">' + r[0] + '</span><span class="safety-value ' + r[2] + '">' + r[1] + '</span></div>';
    })
    .join('');
}

function renderRecentPosts(posts) {
  var el = document.getElementById('recentPosts');
  if (!posts.length) {
    el.innerHTML = '<p class="muted">No posts yet</p>';
    return;
  }
  el.innerHTML = posts
    .map(function(p) {
      return '<div class="post-item"><span class="post-time">' + new Date(p.timestamp).toLocaleString() + '</span><span class="post-type">' + (p.postType || '?') + '</span><br/>' + (p.keyword || '') + '</div>';
    })
    .join('');
}

function renderChart(counts) {
  var el = document.getElementById('weeklyChart');
  var dates = Object.keys(counts).sort();
  if (!dates.length) {
    el.innerHTML = '<p class="muted">No data yet</p>';
    return;
  }
  var max = Math.max.apply(null, dates.map(function(d) { return counts[d]; }).concat([1]));
  el.innerHTML = dates
    .map(function(d) {
      var h = Math.max(4, (counts[d] / max) * 130);
      var label = d.slice(5);
      return '<div class="bar-group"><span class="bar-count">' + counts[d] + '</span><div class="bar" style="height:' + h + 'px"></div><span class="bar-label">' + label + '</span></div>';
    })
    .join('');
}

function renderLogs(lines) {
  var el = document.getElementById('logsPanel');
  el.textContent = lines.slice(-60).join('\n') || 'No logs yet';
  el.scrollTop = el.scrollHeight;
}

/* ---------- Actions ------------------------------------------ */

function startBot() {
  fetch(API + '/api/bot/start', { method: 'POST' })
    .then(function() { refresh(); })
    .catch(function(err) { alert('Failed to start bot: ' + err.message); });
}

function stopBot() {
  fetch(API + '/api/bot/stop', { method: 'POST' })
    .then(function() { refresh(); })
    .catch(function(err) { alert('Failed to stop bot: ' + err.message); });
}

function postNow() {
  if (!confirm('Post a random meme right now? (bypasses schedule restrictions)')) return;
  setQuickStatus('Posting random meme...', 'posting');

  fetch(API + '/api/post-now', { method: 'POST' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        setQuickStatus('Error: ' + data.error, 'error');
      } else {
        setQuickStatus('Posted successfully! Type: ' + (data.result && data.result.type || 'unknown'), 'success');
      }
      refresh();
    })
    .catch(function(err) {
      setQuickStatus('Failed: ' + err.message, 'error');
    });
}

function quickPost() {
  var term = document.getElementById('searchTerm').value.trim();
  var postType = document.getElementById('quickPostType').value;

  if (!term && !postType) {
    alert('Please enter a search term or select a post type');
    return;
  }

  var msg = term ? 'Search & post "' + term + '"' : 'Post a "' + postType + '" meme';
  if (!confirm(msg + ' right now?')) return;

  setQuickStatus('Searching and posting...', 'posting');

  fetch(API + '/api/post-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: term, postType: postType }),
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        setQuickStatus('Error: ' + data.error, 'error');
      } else {
        setQuickStatus('Posted! Keyword: ' + (data.result && data.result.keyword || term) + ', Type: ' + (data.result && data.result.type || postType || 'auto'), 'success');
      }
      refresh();
    })
    .catch(function(err) {
      setQuickStatus('Failed: ' + err.message, 'error');
    });
}

function saveSettings(e) {
  e.preventDefault();
  var body = {
    postsPerDay: parseInt(document.getElementById('setPostsPerDay').value, 10),
    activeHoursStart: parseInt(document.getElementById('setActiveStart').value, 10),
    activeHoursEnd: parseInt(document.getElementById('setActiveEnd').value, 10),
    timezone: document.getElementById('setTimezone').value.trim(),
    postTypes: document.getElementById('setPostTypes').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    maxPostsPerDay: parseInt(document.getElementById('setMaxPosts').value, 10),
    enableWeekendPause: document.getElementById('setWeekendPause').checked,
  };
  fetch(API + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function() {
      alert('Settings saved!');
      refresh();
    })
    .catch(function(err) {
      alert('Failed: ' + err.message);
    });
}

/* ---------- Helpers ------------------------------------------ */

function setQuickStatus(msg, cls) {
  var el = document.getElementById('quickPostStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'quick-status ' + (cls || '');
}

function setText(id, v) {
  var el = document.getElementById(id);
  if (el) el.textContent = v;
}
function setVal(id, v) {
  var el = document.getElementById(id);
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
