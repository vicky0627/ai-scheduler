// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (d) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
const pad = (n) => String(n).padStart(2, '0');

function toLocalDatetimeValue(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

if ($('#tz')) {
  $('#tz').textContent = `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}

// ---------- Data Layer ----------
const KEY = 'ai-scheduler-items-v1';
const state = { items: load(), timers: new Map() };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function persist() { localStorage.setItem(KEY, JSON.stringify(state.items)); }

function addItem(item) {
  item.id = crypto.randomUUID();
  state.items.push(item);
  persist();
  scheduleReminder(item);
  render();
  return item;
}

function updateItem(id, patch) {
  const i = state.items.findIndex(x => x.id === id);
  if (i > -1) {
    state.items[i] = { ...state.items[i], ...patch };
    persist();
    clearReminder(state.items[i]);
    scheduleReminder(state.items[i]);
    render();
  }
}

function deleteItem(id) {
  const i = state.items.findIndex(x => x.id === id);
  if (i > -1) {
    clearReminder(state.items[i]);
    state.items.splice(i, 1);
    persist();
    render();
  }
}

// ---------- Reminders ----------
async function ensureNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const p = await Notification.requestPermission();
    return p === 'granted';
  }
  return false;
}

function scheduleReminder(item) {
  if (item.remind === 'none') return;
  const minutes = Number(item.remind);
  if (Number.isNaN(minutes)) return;
  const start = new Date(item.start).getTime();
  const when = start - minutes * 60 * 1000;
  const delay = when - Date.now();
  if (delay <= 0) return;

  clearReminder(item);
  const t = setTimeout(async () => {
    if (await ensureNotifPermission()) {
      new Notification('Reminder: ' + item.title, {
        body: `${fmt(item.start)} — ${item.who || ''}`
      });
    }
  }, Math.min(delay, 2 ** 31 - 1));
  state.timers.set(item.id, t);
}

function clearReminder(item) {
  const t = state.timers.get(item.id);
  if (t) {
    clearTimeout(t);
    state.timers.delete(item.id);
  }
}

state.items.forEach(scheduleReminder);

// ---------- Rendering ----------
function render() {
  const byStart = [...state.items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const now = Date.now();
  const soon = byStart.filter(x => new Date(x.start) - now < 14 * 24 * 60 * 60 * 1000);
  renderList('#upcoming', '#upcoming-empty', soon);
  renderList('#all', '#all-empty', byStart, true);
}

function renderList(listSel, emptySel, items, editable = false) {
  const list = $(listSel);
  if (!list) return;
  list.innerHTML = '';

  const empty = $(emptySel);
  if (empty) empty.style.display = items.length ? 'none' : 'block';

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'task' + (item.done ? ' done' : '');
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(item.title)}</div>
        <div class="meta">${fmt(item.start)}${item.end ? ' → ' + fmt(item.end) : ''} ${item.who ? ' • with ' + escapeHtml(item.who) : ''}</div>
        <div class="chips">${item.repeat !== 'none' ? `<span class="chip ok">${item.repeat}</span>` : ''}${item.remind !== 'none' ? `<span class="chip warn">remind ${item.remind}m</span>` : ''}</div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${editable ? `<button class="btn ghost" data-edit="${item.id}">Edit</button>` : ''}
        <button class="btn ghost" data-done="${item.id}">${item.done ? 'Undo' : 'Done'}</button>
        <button class="btn ghost" data-del="${item.id}">✕</button>
      </div>`;
    list.appendChild(el);
  });
}

// Single event listener for actions
['#upcoming', '#all'].forEach(sel => {
  const container = $(sel);
  if (container) {
    container.addEventListener('click', e => {
      const id = e.target.getAttribute('data-del');
      if (id) return deleteItem(id);

      const did = e.target.getAttribute('data-done');
      if (did) {
        const it = state.items.find(x => x.id === did);
        return updateItem(did, { done: !it.done });
      }

      const eid = e.target.getAttribute('data-edit');
      if (eid) {
        const it = state.items.find(x => x.id === eid);
        if (!it) return;
        $('#task-id').value = it.id;
        $('#title').value = it.title;
        $('#who').value = it.who || '';
        $('#start').value = toLocalDatetimeValue(it.start);
        $('#end').value = it.end ? toLocalDatetimeValue(it.end) : '';
        $('#repeat').value = it.repeat || 'none';
        $('#remind').value = it.remind || 'none';
        $('#notes').value = it.notes || '';
        $('#save-btn').textContent = 'Update';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }
});

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
}

// ---------- Form ----------
$('#add-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = getFormData();
  if (!data.title || !data.start) return alert('Title and Start are required');
  const id = $('#task-id').value;
  if (id) updateItem(id, data); else addItem({ ...data, done: false });
  $('#add-form').reset();
  $('#task-id').value = '';
  $('#save-btn').textContent = 'Save';
});

$('#reset-btn')?.addEventListener('click', () => {
  $('#add-form').reset();
  $('#task-id').value = '';
  $('#save-btn').textContent = 'Save';
});

function getFormData() {
  return {
    title: $('#title').value.trim(),
    who: $('#who').value.trim(),
    start: new Date($('#start').value).toISOString(),
    end: $('#end').value ? new Date($('#end').value).toISOString() : null,
    repeat: $('#repeat').value,
    remind: $('#remind').value,
    notes: $('#notes').value.trim()
  };
}

// ---------- Chatbot ----------
const chatlog = $('#chatlog');
function pushMsg(text, who = 'bot') {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  chatlog.appendChild(div);
  chatlog.scrollTop = chatlog.scrollHeight;
}
function sys(text) { pushMsg(text, 'bot'); }

$('#send-btn')?.addEventListener('click', send);
$('#chat-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

function send() {
  const t = $('#chat-input').value.trim();
  if (!t) return;
  pushMsg(t, 'user');
  $('#chat-input').value = '';
  handleUserText(t);
}

// Simple intent handling
function handleUserText(text) {
  const lower = text.toLowerCase();

  // list tasks
  if (/list|show|what.*(today|tomorrow|next)/.test(lower)) {
    const when = (/(today|tomorrow)/.exec(lower) || [])[1] || null;
    let from = new Date();
    if (when === 'tomorrow') {
      from.setDate(from.getDate() + 1);
      from.setHours(0, 0, 0, 0);
    }
    const items = state.items.filter(x => {
      const d = new Date(x.start);
      if (when === 'tomorrow') {
        const t0 = new Date(from);
        const t1 = new Date(from);
        t1.setDate(t1.getDate() + 1);
        return d >= t0 && d < t1;
      }
      return d >= from;
    }).sort((a, b) => new Date(a.start) - new Date(b.start));
    if (!items.length) return sys('No items found for that range.');
    return sys(items.slice(0, 6).map(i => `• ${i.title} — ${fmt(i.start)}`).join('\n'));
  }

  // delete task
  if (/(delete|remove) /.test(lower)) {
    const key = lower.replace(/(delete|remove) /, '').trim();
    const match = state.items.find(i => i.title.toLowerCase().includes(key));
    if (!match) return sys('Could not find an item matching "' + key + '"');
    deleteItem(match.id);
    return sys('Deleted: ' + match.title);
  }

  // schedule task
  if (/schedule|add|create/.test(lower)) {
    const parsed = parseSchedule(lower);
    if (!parsed.ok) return sys(parsed.message || 'Sorry, could not understand the time.');
    const item = addItem(parsed.item);
    return sys('Scheduled: ' + item.title + ' on ' + fmt(item.start));
  }

  // help
  if (/help|how|examples?/.test(lower)) {
    return sys('Examples:\n• schedule standup tomorrow at 9am for 15m\n• schedule call next monday 3pm with John\n• list tomorrow\n• delete standup');
  }

  sys('I can schedule tasks. Try: "schedule review on 25 Aug 3:30pm for 30m with Sara"');
}

function parseSchedule(text) {
  const who = (/(?:with|w\/)\s+([a-z0-9 ,._-]+)/i.exec(text) || [])[1] || '';
  const durMin = parseDurationMinutes(text);
  const when = parseWhen(text);
  if (!when) return { ok: false, message: 'Could not parse time/date' };
  const title = text.replace(/schedule|add|create|with [^]*$/gi, '')
    .replace(/\b(tomorrow|today|next [a-z]+|on \d{1,2} [a-z]{3,9}|on \d{4}-\d{2}-\d{2}|at \d{1,2}(:\d{2})?\s?(am|pm)?|for \d+\s?(m|h)?)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  const end = durMin ? new Date(when.getTime() + durMin * 60000) : null;
  return { ok: true, item: { title: title || 'Untitled', who, start: when.toISOString(), end: end ? end.toISOString() : null, repeat: 'none', remind: '15', notes: '' } };
}

function parseDurationMinutes(text) {
  const m = /for\s+(\d+)\s*(m|min|minutes?)/i.exec(text);
  if (m) return parseInt(m[1]);
  const h = /for\s+(\d+)\s*(h|hr|hours?)/i.exec(text);
  if (h) return parseInt(h[1]) * 60;
  return 0;
}

function parseWhen(text) {
  const now = new Date();
  let d = new Date(now);
  let explicitDate = false;

  if (/tomorrow/.test(text)) { d.setDate(d.getDate() + 1); explicitDate = true; }
  if (/today/.test(text)) { explicitDate = true; }

  const ymd = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (ymd) { d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])); explicitDate = true; }

  const dayShort = /(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(text);
  if (dayShort) {
    const next = !!dayShort[1];
    const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(dayShort[2].toLowerCase());
    d = nextWeekday(d, dow, next);
    explicitDate = true;
  }

  const dmy = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"].indexOf(dmy[2].toLowerCase());
    d = new Date(now.getFullYear(), mon, day);
    explicitDate = true;
  }

  const t12 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  const t24 = /\b(\d{1,2}):(\d{2})\b/.exec(text);
  let hours = 9, minutes = 0;
  if (t12) {
    hours = Number(t12[1]) % 12;
    if (t12[3].toLowerCase() === 'pm') hours += 12;
    minutes = Number(t12[2] || 0);
  } else if (t24) {
    hours = Number(t24[1]);
    minutes = Number(t24[2]);
  } else if (/morning/.test(text)) hours = 9;
  else if (/afternoon/.test(text)) hours = 14;
  else if (/evening/.test(text)) hours = 18;

  d.setHours(hours, minutes, 0, 0);
  if (!explicitDate && d < now) d.setDate(d.getDate() + 1);
  return isNaN(d) ? null : d;
}

function nextWeekday(from, dow, forceNext) {
  const d = new Date(from);
  const diff = (dow + 7 - d.getDay()) % 7;
  d.setDate(d.getDate() + (forceNext ? (diff || 7) : diff));
  d.setHours(9, 0, 0, 0);
  return d;
}

// ---------- Boot ----------
render();
if ($('#start')) $('#start').value = toLocalDatetimeValue(new Date(Date.now() + 60 * 60 * 1000));
sys('Hi Vicky! I can schedule things. Try: "schedule meeting tomorrow at 3pm with John for 30m"');
