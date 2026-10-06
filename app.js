(function () {
  'use strict';

  var cfg = window.HUB_CONFIG;
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var COLORS = ['#1F5FD1', '#B4530A', '#0B6B62', '#6D3FC4', '#B3261E', '#3E4756'];
  var SAFE_URL = /^(https?:|sms:|tel:|mailto:|message:)/i;

  var S = { session: null, jobs: [], items: [], loaded: false, authMode: 'in', msg: '', msgOk: false, busy: false, showDone: false, push: 'unknown' };
  var sheet = null;
  var app = document.getElementById('app');
  var sheetEl = document.getElementById('sheet');

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function color(c) { return COLORS.indexOf(c) >= 0 ? c : COLORS[5]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function endOfToday() { var d = new Date(); d.setHours(23, 59, 59, 999); return d; }
  function dueLabel(iso) {
    if (!iso) return null;
    var d = new Date(iso), now = new Date();
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400000);
    if (d < now) return { text: 'Overdue, was ' + (diff === 0 ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' })), late: true };
    if (diff === 0) return { text: 'Today ' + time, late: false };
    if (diff === 1) return { text: 'Tomorrow ' + time, late: false };
    return { text: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time, late: false };
  }
  function byDue(a, b) {
    var x = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    var y = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return x - y || (a.created_at < b.created_at ? -1 : 1);
  }
  function openTodos(jobId) {
    return S.items.filter(function (i) { return i.job_id === jobId && i.kind === 'todo' && !i.done; }).sort(byDue);
  }
  function needsYou(jobId) {
    var end = endOfToday();
    return openTodos(jobId).filter(function (i) { return i.due_at && new Date(i.due_at) <= end; });
  }
  function job(id) { return S.jobs.filter(function (j) { return j.id === id; })[0]; }
  function uid() { return S.session.user.id; }
  var ICON = {
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16L16 8M9 8h7v7"/></svg>',
    today: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></svg>',
    gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.500 2 8 6"/></svg>'
  };

  // ---------- data ----------
  async function load() {
    var r = await Promise.all([
      sb.from('jobs').select('*').order('sort').order('created_at'),
      sb.from('items').select('*').order('created_at')
    ]);
    if (r[0].error || r[1].error) { S.msg = 'Could not load your data. Check your connection and reopen the app.'; }
    S.jobs = r[0].data || [];
    S.items = r[1].data || [];
    S.loaded = true;
    setBadge();
    render();
  }
  function setBadge() {
    if (!navigator.setAppBadge) return;
    var n = 0;
    S.jobs.forEach(function (j) { n += needsYou(j.id).length; });
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () {});
  }

  // ---------- views ----------
  function tabs(on) {
    return '<nav class="tabs">' +
      '<a href="#/" class="' + (on === 'today' ? 'on' : '') + '">' + ICON.today + 'Today</a>' +
      '<a href="#/me" class="' + (on === 'me' ? 'on' : '') + '">' + ICON.gear + 'You</a></nav>';
  }

  function viewAuth() {
    var up = S.authMode === 'up';
    return '<form class="auth" data-form="auth">' +
      '<div class="head"><div class="eyebrow">Work Hub</div><h1>' + (up ? 'Create your account' : 'Sign in') + '</h1></div>' +
      '<div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" autocapitalize="none" required></div>' +
      '<div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" minlength="8" required></div>' +
      (up ? '<div class="field"><label for="inv">Invite code</label><input id="inv" name="invite" type="text" autocapitalize="none" autocomplete="off" required></div>' : '') +
      '<div class="msg' + (S.msgOk ? ' ok' : '') + '" role="status">' + esc(S.msg) + '</div>' +
      '<button class="btn block" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'One moment' : up ? 'Create account' : 'Sign in') + '</button>' +
      '<button class="linkbtn" type="button" data-act="authmode">' + (up ? 'I already have an account' : 'I have an invite code') + '</button>' +
      '</form>';
  }

  function viewToday() {
    var total = 0;
    var cards = S.jobs.map(function (j) {
      var need = needsYou(j.id).length, open = openTodos(j.id);
      total += need;
      var peek = open.slice(0, 2).map(function (i) {
        var d = dueLabel(i.due_at);
        return '<div>' + esc(i.title) + (d ? ' <span class="due' + (d.late ? ' late' : '') + '">' + esc(d.text) + '</span>' : '') + '</div>';
      }).join('');
      var more = open.length > 2 ? '<div class="due">and ' + (open.length - 2) + ' more</div>' : '';
      return '<a class="card jobcard" href="#/job/' + esc(j.id) + '">' +
        '<div class="row1"><div class="dot" style="background:' + color(j.color) + '"></div>' +
        '<div class="jobname">' + esc(j.name) + '</div>' +
        '<div class="count' + (need ? '' : ' zero') + '"' + (need ? ' style="background:' + color(j.color) + '"' : '') + '>' + need + '</div></div>' +
        '<div class="peek">' + (peek ? peek + more : '<div class="due">Nothing open.</div>') + '</div></a>';
    }).join('');
    var n = S.jobs.length;
    var headline = !n ? 'Add your first job' :
      n + (n === 1 ? ' job, ' : ' jobs, ') + (total ? total + (total === 1 ? ' thing needs you' : ' things need you') : 'nothing due today');
    return '<div class="page"><div class="head"><div class="eyebrow">' +
      esc(new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })) + '</div><h1>' + headline + '</h1></div>' +
      (S.msg ? '<div class="msg">' + esc(S.msg) + '</div>' : '') +
      '<div class="stack">' + cards +
      '<button class="btn ghost" type="button" data-act="newjob">' + ICON.plus + 'Add a job</button></div></div>' + tabs('today');
  }

  function itemRow(i) {
    var d = i.kind === 'todo' && !i.done ? dueLabel(i.due_at) : null;
    var body = '<button type="button" class="itembody' + (i.kind === 'note' ? ' note' : '') + '" data-act="edititem" data-id="' + esc(i.id) + '">' +
      '<span class="t">' + esc(i.title) + '</span>' +
      (i.body ? '<span class="b">' + esc(i.body) + '</span>' : '') +
      (d ? '<span class="due' + (d.late ? ' late' : '') + '">' + esc(d.text) + '</span>' : '') + '</button>';
    if (i.kind === 'note') return '<div class="item">' + body + '</div>';
    var j = job(i.job_id);
    return '<div class="item' + (i.done ? ' isdone' : '') + '">' +
      '<button type="button" class="check' + (i.done ? ' done' : '') + '" data-act="toggle" data-id="' + esc(i.id) + '" aria-label="' + (i.done ? 'Mark not done: ' : 'Mark done: ') + esc(i.title) + '">' +
      '<span' + (i.done ? ' style="background:' + color(j && j.color) + '"' : '') + '>' + (i.done ? ICON.check : '') + '</span></button>' + body + '</div>';
  }

  function viewJob(id) {
    var j = job(id);
    if (!j) return '<div class="page"><h1>Job not found</h1><a class="btn line" href="#/">Back to Today</a></div>';
    var c = color(j.color);
    var open = openTodos(id);
    var done = S.items.filter(function (i) { return i.job_id === id && i.kind === 'todo' && i.done; });
    var notes = S.items.filter(function (i) { return i.job_id === id && i.kind === 'note'; }).reverse();
    var links = (j.shortcuts || []).filter(function (s) { return s && SAFE_URL.test(s.url || ''); });
    var quick = j.quick_adds || [];
    var html = '<div class="jobhead" style="background:' + c + '"><div class="bar"><a href="#/">' + ICON.back + 'All jobs</a>' +
      '<button type="button" data-act="editjob" data-id="' + esc(j.id) + '">Edit</button></div>' +
      '<h1>' + esc(j.name) + '</h1>' + (j.role_note ? '<div class="note">' + esc(j.role_note) + '</div>' : '') + '</div><div class="jobbody">';
    if (links.length) {
      html += '<div class="sec"><div class="eyebrow">Open</div><div class="chips">' + links.map(function (s) {
        return '<a class="chip" href="' + esc(s.url) + '"' + (/^https?:/i.test(s.url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.label) + ICON.out + '</a>';
      }).join('') + '</div></div>';
    }
    if (quick.length) {
      html += '<div class="sec"><div class="eyebrow">Quick add</div><div class="chips">' + quick.map(function (q, n) {
        return '<button type="button" class="chip" data-act="quick" data-id="' + esc(j.id) + '" data-n="' + n + '">' + ICON.plus + esc(q.label) + '</button>';
      }).join('') + '</div></div>';
    }
    html += '<div class="sec"><div class="eyebrow">To do</div><div class="list">' +
      (open.length ? open.map(itemRow).join('') : '<div class="empty">Nothing open.</div>') + '</div>';
    if (done.length) {
      html += '<button type="button" class="linkbtn small" data-act="showdone">' + (S.showDone ? 'Hide done' : 'Show done (' + done.length + ')') + '</button>';
      if (S.showDone) html += '<div class="list">' + done.slice(-30).reverse().map(itemRow).join('') + '</div>';
    }
    html += '</div><div class="sec"><div class="eyebrow">Notes</div><div class="list">' +
      (notes.length ? notes.map(itemRow).join('') : '<div class="empty">No notes yet.</div>') + '</div></div></div>' +
      '<div class="addbar"><button type="button" class="btn" data-act="additem" data-kind="todo" data-id="' + esc(j.id) + '">' + ICON.plus + 'To-do</button>' +
      '<button type="button" class="btn line" data-act="additem" data-kind="note" data-id="' + esc(j.id) + '">' + ICON.plus + 'Note</button></div>';
    return html;
  }

  function isStandalone() {
    return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function viewMe() {
    var push;
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      push = isStandalone()
        ? '<div class="muted">This phone does not support notifications for home screen apps. On iPhone that needs iOS 16.4 or newer.</div>'
        : '<div class="muted">To get notifications on iPhone, first add this app to your home screen: open it in Safari, tap the Share button, then tap Add to Home Screen. Open it from the new icon and come back to this page.</div>';
    } else if (S.push === 'on') {
      push = '<div>On for this phone.</div><div class="rowbtns"><button type="button" class="btn line" data-act="testpush">Send a test</button><button type="button" class="btn line" data-act="pushoff">Turn off</button></div>';
    } else if (S.push === 'denied') {
      push = '<div class="muted">Notifications are blocked for this app. Turn them on in the iPhone Settings app under Notifications, then reopen Work Hub.</div>';
    } else {
      push = '<div class="muted">Get a reminder when a to-do reaches its due time.</div><button type="button" class="btn" data-act="pushon">Turn on notifications</button>';
    }
    return '<div class="page"><div class="head"><div class="eyebrow">You</div><h1>Settings</h1></div>' +
      '<div class="card setrow"><div class="eyebrow">Notifications</div>' + push +
      '<div class="msg' + (S.msgOk ? ' ok' : '') + '" role="status">' + esc(S.msg) + '</div></div>' +
      '<div class="card setrow"><div class="eyebrow">Account</div><div>' + esc(S.session.user.email) + '</div>' +
      '<button type="button" class="btn line" data-act="signout">Sign out</button></div></div>' + tabs('me');
  }

  // ---------- sheets ----------
  function sheetItem() {
    var s = sheet, isTodo = s.kind === 'todo';
    return '<form class="sheet" data-form="item"><div class="bar"><h2>' + (s.id ? 'Edit' : 'New') + ' ' + (isTodo ? 'to-do' : 'note') + '</h2>' +
      '<button type="button" class="iconbtn" data-act="closesheet" aria-label="Close">' + ICON.x + '</button></div>' +
      (s.id ? '' : '<div class="seg"><button type="button" data-act="kind" data-kind="todo" class="' + (isTodo ? 'on' : '') + '">To-do</button><button type="button" data-act="kind" data-kind="note" class="' + (isTodo ? '' : 'on') + '">Note</button></div>') +
      '<div class="field"><label for="it">' + (isTodo ? 'What needs doing' : 'Title') + '</label><input id="it" name="title" type="text" maxlength="200" required value="' + esc(s.title) + '"></div>' +
      '<div class="field"><label for="ib">Details (optional)</label><textarea id="ib" name="body" maxlength="4000">' + esc(s.body) + '</textarea></div>' +
      (isTodo ? '<div class="field"><label for="idue">Remind me at (optional)</label><input id="idue" name="due" type="datetime-local" value="' + esc(s.due) + '"></div>' : '') +
      '<div class="msg" role="status">' + esc(s.msg || '') + '</div>' +
      '<button class="btn block" type="submit">Save</button>' +
      (s.id ? '<button type="button" class="btn danger block" data-act="delitem">' + (s.confirm ? 'Tap again to delete' : 'Delete') + '</button>' : '') + '</form>';
  }
  function sheetJob() {
    var s = sheet;
    return '<form class="sheet" data-form="job"><div class="bar"><h2>' + (s.id ? 'Edit job' : 'New job') + '</h2>' +
      '<button type="button" class="iconbtn" data-act="closesheet" aria-label="Close">' + ICON.x + '</button></div>' +
      '<div class="field"><label for="jn">Job name</label><input id="jn" name="name" type="text" maxlength="80" required value="' + esc(s.name) + '"></div>' +
      '<div class="field"><label for="jr">What you do there (optional)</label><input id="jr" name="role_note" type="text" maxlength="200" value="' + esc(s.role_note) + '"></div>' +
      '<div class="field"><label>Color</label><div class="swatches">' + COLORS.map(function (c, n) {
        return '<button type="button" class="swatch' + (c === s.color ? ' on' : '') + '" style="background:' + c + '" data-act="swatch" data-c="' + c + '" aria-label="Color ' + (n + 1) + '"' + (c === s.color ? ' aria-pressed="true"' : '') + '></button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label>Shortcuts to other apps</label>' + s.shortcuts.map(function (r, n) {
        return '<div class="srow"><input class="lab" name="sl' + n + '" type="text" maxlength="30" placeholder="Name" aria-label="Shortcut name" value="' + esc(r.label) + '">' +
          '<input name="su' + n + '" type="url" inputmode="url" autocapitalize="none" placeholder="https://" aria-label="Shortcut link" value="' + esc(r.url) + '">' +
          '<button type="button" class="iconbtn" data-act="delshort" data-n="' + n + '" aria-label="Remove shortcut">' + ICON.x + '</button></div>';
      }).join('') + '<button type="button" class="btn line" data-act="addshort">' + ICON.plus + 'Add a shortcut</button></div>' +
      '<div class="msg" role="status">' + esc(s.msg || '') + '</div>' +
      '<button class="btn block" type="submit">Save</button>' +
      (s.id ? '<button type="button" class="btn danger block" data-act="deljob">' + (s.confirm ? 'Tap again to delete this job and everything in it' : 'Delete job') + '</button>' : '') + '</form>';
  }
  function collect() {
    var f = sheetEl.querySelector('form');
    if (!f || !sheet) return;
    if (sheet.type === 'item') {
      sheet.title = f.title.value; sheet.body = f.body.value;
      if (f.due) sheet.due = f.due.value;
    } else {
      sheet.name = f.name.value; sheet.role_note = f.role_note.value;
      sheet.shortcuts = sheet.shortcuts.map(function (r, n) { return { label: f['sl' + n].value, url: f['su' + n].value }; });
    }
  }
  function renderSheet(focus) {
    sheetEl.innerHTML = !sheet ? '' : sheet.type === 'item' ? sheetItem() : sheetJob();
    if (focus) { var el = sheetEl.querySelector('input[type=text]'); if (el) el.focus(); }
  }
  function closeSheet() { sheet = null; renderSheet(); }

  // ---------- render / route ----------
  function render() {
    var h = location.hash || '#/';
    if (!S.session) { app.innerHTML = viewAuth(); return; }
    if (!S.loaded) { app.innerHTML = '<div class="page"><div class="muted">Loading</div></div>'; return; }
    var m = h.match(/^#\/job\/([0-9a-f-]+)$/i);
    app.innerHTML = m ? viewJob(m[1]) : h === '#/me' ? viewMe() : viewToday();
  }
  window.addEventListener('hashchange', function () { S.msg = ''; S.showDone = false; closeSheet(); render(); window.scrollTo(0, 0); });

  // ---------- push ----------
  function b64ToBytes(b64) {
    var s = atob((b64 + '==='.slice((b64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') { S.push = 'denied'; return; }
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      S.push = sub && Notification.permission === 'granted' ? 'on' : 'off';
    } catch (e) { S.push = 'off'; }
  }
  async function pushOn() {
    S.msg = ''; S.msgOk = false;
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { S.push = perm === 'denied' ? 'denied' : 'off'; return render(); }
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapid) });
      var j = sub.toJSON();
      var r = await sb.from('push_subscriptions').upsert({ user_id: uid(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
      if (r.error) throw r.error;
      S.push = 'on'; S.msg = 'Notifications are on.'; S.msgOk = true;
    } catch (e) { S.msg = 'Could not turn on notifications. ' + (e && e.message ? e.message : ''); }
    render();
  }
  async function pushOff() {
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    } catch (e) {}
    S.push = 'off'; S.msg = ''; render();
  }
  async function testPush() {
    S.msg = 'Sending'; S.msgOk = true; render();
    var r = await sb.functions.invoke('push', { body: { action: 'test' } });
    var sent = r.data && r.data.sent;
    S.msgOk = !r.error && sent > 0;
    S.msg = S.msgOk ? 'Sent. It should arrive within a few seconds.' : 'The test did not go out. Turn notifications off and on again, then retry.';
    render();
  }

  // ---------- actions ----------
  async function saveItem(f) {
    collect();
    var s = sheet, title = s.title.trim();
    if (!title) return;
    var due = s.kind === 'todo' && s.due ? new Date(s.due).toISOString() : null;
    var row = { title: title, body: s.body.trim() || null, due_at: due };
    var r;
    if (s.id) {
      var old = S.items.filter(function (i) { return i.id === s.id; })[0];
      if (!old || old.due_at !== due) row.notified_at = null;
      r = await sb.from('items').update(row).eq('id', s.id).select().single();
      if (!r.error) S.items = S.items.map(function (i) { return i.id === s.id ? r.data : i; });
    } else {
      row.user_id = uid(); row.job_id = s.job_id; row.kind = s.kind;
      r = await sb.from('items').insert(row).select().single();
      if (!r.error) S.items.push(r.data);
    }
    if (r.error) { sheet.msg = 'Could not save. Try again.'; return renderSheet(); }
    closeSheet(); setBadge(); render();
  }
  async function saveJob() {
    collect();
    var s = sheet, name = s.name.trim();
    if (!name) return;
    var shortcuts = [];
    for (var n = 0; n < s.shortcuts.length; n++) {
      var lab = s.shortcuts[n].label.trim(), url = s.shortcuts[n].url.trim();
      if (!lab && !url) continue;
      if (!lab || !SAFE_URL.test(url)) { sheet.msg = 'Each shortcut needs a name and a link that starts with https://'; return renderSheet(); }
      shortcuts.push({ label: lab, url: url });
    }
    var row = { name: name, role_note: s.role_note.trim() || null, color: color(s.color), shortcuts: shortcuts };
    var r;
    if (s.id) {
      r = await sb.from('jobs').update(row).eq('id', s.id).select().single();
      if (!r.error) S.jobs = S.jobs.map(function (j) { return j.id === s.id ? r.data : j; });
    } else {
      row.user_id = uid(); row.sort = S.jobs.length;
      r = await sb.from('jobs').insert(row).select().single();
      if (!r.error) S.jobs.push(r.data);
    }
    if (r.error) { sheet.msg = 'Could not save. Try again.'; return renderSheet(); }
    closeSheet(); render();
  }
  async function auth(f) {
    var email = f.email.value.trim(), password = f.password.value;
    S.busy = true; S.msg = ''; S.msgOk = false; render();
    try {
      if (S.authMode === 'up') {
        var r = await sb.functions.invoke('signup', { body: { email: email, password: password, invite: f.invite.value.trim() } });
        var problem = r.data && r.data.error;
        if (r.error && r.error.context && r.error.context.json) { try { problem = (await r.error.context.json()).error; } catch (e) {} }
        if (r.error || problem) throw new Error(problem || 'Could not create the account. Try again.');
      }
      var s = await sb.auth.signInWithPassword({ email: email, password: password });
      if (s.error) throw new Error(S.authMode === 'up' ? 'Account created, but sign in failed. Try signing in.' : 'That email and password did not match.');
    } catch (e) { S.msg = e.message; }
    S.busy = false; render();
  }

  document.addEventListener('submit', function (e) {
    var f = e.target, kind = f.getAttribute('data-form');
    if (!kind) return;
    e.preventDefault();
    if (kind === 'auth') auth(f); else if (kind === 'item') saveItem(f); else if (kind === 'job') saveJob();
  });

  document.addEventListener('click', async function (e) {
    if (e.target === sheetEl) return closeSheet();
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (act === 'authmode') { S.authMode = S.authMode === 'up' ? 'in' : 'up'; S.msg = ''; render(); }
    else if (act === 'closesheet') closeSheet();
    else if (act === 'newjob') { sheet = { type: 'job', name: '', role_note: '', color: COLORS[S.jobs.length % COLORS.length], shortcuts: [] }; renderSheet(true); }
    else if (act === 'editjob') { var j = job(id); sheet = { type: 'job', id: id, name: j.name, role_note: j.role_note || '', color: color(j.color), shortcuts: (j.shortcuts || []).map(function (s) { return { label: s.label || '', url: s.url || '' }; }) }; renderSheet(); }
    else if (act === 'swatch') { collect(); sheet.color = t.getAttribute('data-c'); renderSheet(); }
    else if (act === 'addshort') { collect(); sheet.shortcuts.push({ label: '', url: '' }); renderSheet(); }
    else if (act === 'delshort') { collect(); sheet.shortcuts.splice(+t.getAttribute('data-n'), 1); renderSheet(); }
    else if (act === 'additem') { sheet = { type: 'item', job_id: id, kind: t.getAttribute('data-kind'), title: '', body: '', due: '' }; renderSheet(true); }
    else if (act === 'quick') {
      var q = (job(id).quick_adds || [])[+t.getAttribute('data-n')] || {};
      var due = q.due_hours ? toLocalInput(new Date(Date.now() + q.due_hours * 3600000).toISOString()) : '';
      sheet = { type: 'item', job_id: id, kind: 'todo', title: q.title || '', body: '', due: due }; renderSheet(true);
    }
    else if (act === 'kind') { collect(); sheet.kind = t.getAttribute('data-kind'); renderSheet(); }
    else if (act === 'edititem') { var it = S.items.filter(function (i) { return i.id === id; })[0]; sheet = { type: 'item', id: id, job_id: it.job_id, kind: it.kind, title: it.title, body: it.body || '', due: toLocalInput(it.due_at) }; renderSheet(); }
    else if (act === 'toggle') {
      var item = S.items.filter(function (i) { return i.id === id; })[0];
      item.done = !item.done; setBadge(); render();
      var r = await sb.from('items').update({ done: item.done }).eq('id', id);
      if (r.error) { item.done = !item.done; setBadge(); render(); }
    }
    else if (act === 'showdone') { S.showDone = !S.showDone; render(); }
    else if (act === 'delitem') {
      if (!sheet.confirm) { collect(); sheet.confirm = true; return renderSheet(); }
      var d = await sb.from('items').delete().eq('id', sheet.id);
      if (d.error) { sheet.msg = 'Could not delete. Try again.'; return renderSheet(); }
      S.items = S.items.filter(function (i) { return i.id !== sheet.id; }); closeSheet(); setBadge(); render();
    }
    else if (act === 'deljob') {
      if (!sheet.confirm) { collect(); sheet.confirm = true; return renderSheet(); }
      var gone = sheet.id, dj = await sb.from('jobs').delete().eq('id', gone);
      if (dj.error) { sheet.msg = 'Could not delete. Try again.'; return renderSheet(); }
      S.jobs = S.jobs.filter(function (x) { return x.id !== gone; });
      S.items = S.items.filter(function (i) { return i.job_id !== gone; });
      closeSheet(); setBadge(); location.hash = '#/';
    }
    else if (act === 'pushon') pushOn();
    else if (act === 'pushoff') pushOff();
    else if (act === 'testpush') testPush();
    else if (act === 'signout') { await pushOff(); await sb.auth.signOut(); }
  });

  // ---------- start ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  sb.auth.onAuthStateChange(function (event, session) {
    var was = S.session && S.session.user.id, now = session && session.user.id;
    S.session = session;
    if (was === now && S.loaded) return;
    S.loaded = false; S.jobs = []; S.items = []; S.msg = '';
    render();
    if (session) setTimeout(function () { pushState().then(load); }, 0);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.session && S.loaded && !sheet) load();
  });
  render();
})();
