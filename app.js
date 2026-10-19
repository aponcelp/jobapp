/* Job Tracker — static app on Supabase (schema `jobs`). No build step. */
(() => {
  const C = window.JT_CONFIG;
  const sb = window.supabase.createClient(C.url, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const db = () => sb.schema(C.schema);

  const PRIO = { 1: 'Interview this week', 2: 'Apply now', 3: 'Apply', 4: 'Follow up', 5: 'Applied, waiting', 6: 'Stalled', 7: 'Closed' };
  const LANES = ['BizOps/Special Projects', 'Customer Strategy & Ops', 'Product/Product Ops'];
  const TODO_GROUPS = [['apply', 'Apply'], ['outreach', 'Outreach'], ['follow-up', 'Follow-ups'], ['prep', 'Prep'], ['other', 'Other']];
  const TABS = [['focus', 'Today'], ['progress', 'Progress'], ['pipeline', 'Pipeline'], ['todo', 'To-do'], ['new', 'New roles'], ['resumes', 'Résumés'], ['contacts', 'Contacts']];

  const S = { roles: [], tasks: [], resumes: [], contacts: [], new_roles: [], activity: [], meta: null,
              tab: (location.hash.slice(1) || localStorage.getItem('jt_tab') || 'focus'),
              pipeView: localStorage.getItem('jt_pipeview') || 'board',
              f: { q: '', lane: '', prio: '', closed: false }, todoShowDone: false, nrFilter: 'new', sort: { k: 'priority', d: 1 } };
  if (!TABS.some(t => t[0] === S.tab)) S.tab = 'focus';

  // ---------- utils ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const pd = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const days = (a, b) => Math.round((a - b) / 864e5);
  const fmtD = s => { const d = pd(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  const fmtTs = s => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
  const norm = s => (s || '').toLowerCase().replace(/\s*[\(/].*$/, '').trim();
  const link = (href, txt) => href ? `<a class="a" href="${esc(href)}" target="_blank" rel="noopener">${esc(txt)}</a>` : '';
  const pz = p => `<span class="pz p${p || 5}">${p || '?'} · ${esc(PRIO[p] || 'Unset')}</span>`;
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }
  function salaryMax(s) {
    if (!s) return 0; const m = [...String(s).matchAll(/\$?\s?(\d[\d,.]*)\s?([KkMm])?/g)].map(x => { let v = parseFloat(x[1].replace(/,/g, '')); if (/k/i.test(x[2] || '')) v *= 1e3; if (/m/i.test(x[2] || '')) v *= 1e6; return v; });
    return Math.max(0, ...m);
  }
  const resumeUrl = code => (S.resumes.find(r => r.code === code) || {}).drive_url;
  const roleById = id => S.roles.find(r => r.id === id);

  // ---------- save ----------
  let pending = 0;
  function setSave(state) {
    const el = $('#savestate'); if (!el) return;
    el.className = 'savestate ' + (state === 'saving' ? 'saving' : state === 'err' ? 'err' : '');
    el.textContent = state === 'saving' ? 'Saving…' : state === 'err' ? 'Save failed — retrying on next edit' : 'All changes saved';
  }
  async function save(table, id, patch) {
    const row = S[table].find(r => r.id === id); if (row) Object.assign(row, patch);
    pending++; setSave('saving');
    const { data, error } = await db().from(table).update(patch).eq('id', id).select().single();
    pending--;
    if (error) { console.error(error); setSave('err'); toast('Could not save: ' + error.message); return null; }
    if (row) Object.assign(row, data);
    if (!pending) setSave('ok');
    loadActivity();
    return data;
  }
  async function insert(table, obj) {
    pending++; setSave('saving');
    const { data, error } = await db().from(table).insert(obj).select().single();
    pending--;
    if (error) { setSave('err'); toast('Could not save: ' + error.message); return null; }
    S[table].push(data); if (!pending) setSave('ok'); loadActivity(); return data;
  }
  const timers = {};
  function saveLater(table, id, patch, ms = 700) {
    const k = table + id + Object.keys(patch).join();
    clearTimeout(timers[k]); setSave('saving');
    timers[k] = setTimeout(() => save(table, id, patch), ms);
  }

  // ---------- load ----------
  async function loadAll() {
    const q = t => db().from(t).select('*').limit(5000);
    const [r, t, rs, c, n, m] = await Promise.all([q('roles'), q('tasks').order('sort'), q('resumes').order('id'), q('contacts').order('company'), q('new_roles'), db().from('sync_meta').select('*').eq('id', 1).maybeSingle()]);
    const err = [r, t, rs, c, n].find(x => x.error);
    if (err) { $('#view').innerHTML = `<div class="card"><div class="empty">Could not load data: ${esc(err.error.message)}. If this says permission denied, this account isn't the owner.</div></div>`; return; }
    S.roles = r.data; S.tasks = t.data; S.resumes = rs.data; S.contacts = c.data; S.new_roles = n.data; S.meta = m.data;
    await loadActivity(false);
    render();
  }
  async function loadActivity(rerender = true) {
    const { data } = await db().from('activity').select('*').order('at', { ascending: false }).limit(40);
    S.activity = data || [];
    if (rerender && S.tab === 'progress') renderView();
  }

  // ---------- scoring ----------
  // warm = a real warm path (referral, friend, 1st-degree, prior call); named = at least one person to reach (incl. drafted outreach)
  function personFor(r) {
    const w = r.warm_contact || '';
    if (w && !/outreach drafted/i.test(w)) return { warm: true, name: w.split(':')[0].split('(')[0].trim() };
    const c = norm(r.company);
    const ct = S.contacts.find(x => norm(x.company) === c && x.warm_path && !/^none/i.test(x.warm_path));
    if (ct) return { warm: true, name: ct.name };
    const t = S.tasks.find(x => x.contact_name && norm(x.company) === c);
    if (t) return { warm: false, name: t.contact_name };
    if (w) return { warm: false, name: w.split('(')[0].trim() };
    return null;
  }
  const warmFor = company => { const p = personFor({ company }); return p && p.warm ? p.name : null; };
  function scoreRole(r) {
    const why = []; let s = { 1: 100, 2: 70, 3: 45, 4: 55, 5: 12, 6: 4, 7: 0 }[r.priority] ?? 10;
    if (r.priority === 1) why.push(['Interview', 'chip--lime']);
    if (r.priority === 1) s += 30;
    const per = personFor(r);
    if (per && r.priority <= 5) { s += per.warm ? 15 : 7; why.push([(per.warm ? 'Warm: ' : 'Contact: ') + per.name, per.warm ? 'chip--warm' : '']); }
    if (r.fit_score) { s += r.fit_score * 3; why.push(['Fit ' + r.fit_score + '/5', '']); }
    const sal = salaryMax(r.salary_range); if (sal >= 180e3) { s += 8; why.push(['$' + Math.round(sal / 1e3) + 'K top', '']); } else if (sal >= 150e3) { s += 4; why.push(['$' + Math.round(sal / 1e3) + 'K top', '']); }
    const due = pd(r.next_step_due);
    if (due) { const d = days(due, today()); if (d < 0) { s += 25; why.push([`Overdue ${-d}d`, 'chip--over']); } else if (d <= 3) { s += 15; why.push([d === 0 ? 'Due today' : `Due in ${d}d`, 'chip--due']); } else if (d <= 7) { s += 8; why.push([`Due ${fmtD(r.next_step_due)}`, 'chip--due']); } }
    const touched = pd(r.date);
    if (touched && [4, 5].includes(r.priority)) { const d = days(today(), touched); if (d >= 14) { s += 12; why.push([`${d}d since touch`, '']); } else if (d >= 7) { s += 6; why.push([`${d}d since touch`, '']); } }
    return { s, why };
  }
  function scoreTask(t) {
    const why = []; let s = { 1: 60, 2: 45, 3: 30 }[t.priority] ?? 25;
    if (t.type === 'follow-up') s += 5;
    if (t.contact_name) { s += 6; why.push(['Named contact', 'chip--warm']); }
    const due = pd(t.due);
    if (due) { const d = days(due, today()); if (d < 0) { s += 30; why.push([`Overdue ${-d}d`, 'chip--over']); } else if (d <= 3) { s += 20; why.push([d === 0 ? 'Due today' : `Due in ${d}d`, 'chip--due']); } else if (d <= 7) { s += 10; why.push([`Due ${fmtD(t.due)}`, 'chip--due']); } }
    const r = t.role_id && roleById(t.role_id); if (r && r.priority <= 2) s += 8;
    return { s, why };
  }

  // ---------- shell ----------
  function renderMeta() {
    const left = days(pd(C.goalDate), today());
    $('#meta').innerHTML = `<span>Goal: role by <b>Dec 31</b> · <b>${left}</b> days left</span><span>Last synced <b>${esc(fmtTs(S.meta && S.meta.last_sync_at))}</b></span><span id="savestate" class="savestate">All changes saved</span><button class="linkbtn" id="signout">Sign out</button>`;
    $('#signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  function renderTabs() {
    const openTodo = S.tasks.filter(t => !t.done).length, newN = S.new_roles.filter(n => n.decision === 'new').length;
    const counts = { todo: openTodo, new: newN, pipeline: S.roles.filter(r => r.priority && r.priority <= 5).length };
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${counts[k] != null ? ` <b>${counts[k]}</b>` : ''}</button>`).join('');
    $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; localStorage.setItem('jt_tab', S.tab); history.replaceState(null, '', '#' + S.tab); render(); };
  }
  function render() { renderMeta(); renderTabs(); renderView(); }
  function renderView() { const v = $('#view'); ({ focus: vFocus, progress: vProgress, pipeline: vPipeline, todo: vTodo, new: vNew, resumes: vResumes, contacts: vContacts })[S.tab](v); }

  // ---------- Today / Focus ----------
  function vFocus(v) {
    const t0 = today(), left = days(pd(C.goalDate), t0);
    const items = [];
    const roleWithTasks = new Set(S.tasks.filter(t => !t.done && t.role_id).map(t => t.role_id));
    S.roles.filter(r => r.priority && r.priority <= 4).forEach(r => {
      const { s, why } = scoreRole(r);
      items.push({ kind: 'role', id: r.id, s, why, title: `${r.company} · ${r.role}`, sub: r.next_step || r.status || '', p: r.priority, links: [link(r.link, 'Posting'), r.resume_code ? link(resumeUrl(r.resume_code), 'Résumé ' + r.resume_code) : ''] });
    });
    S.tasks.filter(t => !t.done).forEach(t => {
      const { s, why } = scoreTask(t);
      if (t.type === 'apply' && t.role_id && S.roles.some(r => r.id === t.role_id && r.priority <= 4) && !pd(t.due)) return; // the role row already covers it
      items.push({ kind: 'task', id: t.id, s, why, title: t.title, sub: t.notes || '', type: t.type, links: [link(t.posting_url, 'Posting'), link(t.contact_url, 'Contact'), t.resume_code ? link(t.resume_url || resumeUrl(t.resume_code), 'Résumé ' + t.resume_code) : ''] });
    });
    items.sort((a, b) => b.s - a.s);
    const top = items.slice(0, 15);
    const interviews = S.roles.filter(r => r.priority === 1).length;
    const overdue = S.tasks.filter(t => !t.done && pd(t.due) && pd(t.due) < t0).length + S.roles.filter(r => r.priority <= 4 && pd(r.next_step_due) && pd(r.next_step_due) < t0).length;
    const dueWeek = S.tasks.filter(t => !t.done && pd(t.due) && days(pd(t.due), t0) <= 7).length;
    const applyNow = S.roles.filter(r => r.priority === 2).length;
    v.innerHTML = `
      <h1 class="h1">What to do next.</h1>
      <p class="lede">Ranked by priority, warm contacts, fit, pay, due dates and time since the last touch. Tick tasks off here or in To-do.</p>
      <div class="grid g4">
        <div class="stat stat--ink"><span class="stat__k">Days to Dec 31</span><span class="stat__v">${left}</span><span class="stat__s">Goal: signed offer this year</span></div>
        <div class="stat stat--lime"><span class="stat__k">Interviews live</span><span class="stat__v">${interviews}</span><span class="stat__s">${S.roles.filter(r => r.priority === 4).length} follow-ups open</span></div>
        <div class="stat"><span class="stat__k">Apply now</span><span class="stat__v">${applyNow}</span><span class="stat__s">${S.roles.filter(r => r.priority === 3).length} more good fits</span></div>
        <div class="stat"><span class="stat__k">Due this week</span><span class="stat__v">${dueWeek}</span><span class="stat__s">${overdue ? `<b style="color:var(--red)">${overdue} overdue</b>` : 'nothing overdue'}</span></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card__head"><h2>Top actions</h2><span class="sub">score = priority + warm + fit + pay + due + staleness</span></div>
        <ol class="rank">${top.map((it, i) => `
          <li>
            <span class="rank__n">${String(i + 1).padStart(2, '0')}</span>
            <div>
              <div class="rank__t">${esc(it.title)}</div>
              ${it.sub ? `<div class="rank__s">${esc(it.sub)}</div>` : ''}
              <div class="chips rank__why">${it.kind === 'role' ? pz(it.p) : `<span class="chip chip--ink">${esc(it.type)}</span>`}${it.why.map(([w, c]) => `<span class="chip ${c}">${esc(w)}</span>`).join('')}</div>
              <div class="todo__links">${it.links.filter(Boolean).join('')}</div>
            </div>
            <div class="rank__score"><b>${Math.round(it.s)}</b>${it.kind === 'task' ? `<button class="btn btn--sm" data-done="${it.id}">Done</button>` : `<button class="btn btn--sm" data-open="${it.id}">Edit</button>`}</div>
          </li>`).join('') || '<li class="empty">Nothing open. Time to find new roles.</li>'}</ol>
      </div>`;
    v.onclick = async e => {
      const d = e.target.closest('[data-done]'); if (d) { await save('tasks', +d.dataset.done, { done: true, done_at: new Date().toISOString() }); toast('Marked done'); render(); return; }
      const o = e.target.closest('[data-open]'); if (o) openRole(+o.dataset.open);
    };
  }

  // ---------- Progress ----------
  function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
  function vProgress(v) {
    const t0 = today(), ws = weekStart(t0);
    const weeks = [...Array(12)].map((_, i) => { const s = new Date(ws); s.setDate(s.getDate() - 7 * (11 - i)); return s; });
    const applied = S.roles.filter(r => r.applied_date);
    const wk = weeks.map(s => { const e = new Date(s); e.setDate(e.getDate() + 7); return applied.filter(r => { const d = pd(r.applied_date); return d >= s && d < e; }).length; });
    const maxW = Math.max(1, ...wk);
    const isResp = r => !/^(applied|no response|to apply)/i.test(r.stage || '') && !/^applied/i.test(r.status || '') || /interview|screen|call|referr|offer/i.test(r.stage + ' ' + r.status);
    const isIntv = r => /interview|screen|intro call|hm |onsite|in-person|video/i.test((r.stage || '') + ' ' + (r.status || ''));
    const appliedN = applied.length, resp = applied.filter(r => isResp(r) && !/^no response/i.test(r.stage || '')).length, intv = S.roles.filter(isIntv).length;
    const active = S.roles.filter(r => r.priority && r.priority <= 5);
    const warmN = active.filter(r => (personFor(r) || {}).warm).length;
    const namedN = active.filter(r => personFor(r)).length;
    const warmPct = active.length ? warmN / active.length : 0;
    const thisWeek = S.roles.filter(r => { const d = pd(r.applied_date); return d && d >= ws; });
    const thisWeekWarm = thisWeek.filter(r => personFor(r)).length;
    const queued = S.roles.filter(r => [2, 3].includes(r.priority)).length;
    const [tLo, tHi] = C.weeklyTarget;
    const byP = [1, 2, 3, 4, 5, 6, 7].map(p => [p, S.roles.filter(r => r.priority === p).length]);
    const maxP = Math.max(1, ...byP.map(x => x[1]));
    const doneTasks = S.tasks.filter(t => t.done).length;
    const lanes = LANES.map(l => [l, active.filter(r => r.lane === l).length]);
    v.innerHTML = `
      <h1 class="h1">How you're tracking.</h1>
      <p class="lede">Weekly target: ${tLo}–${tHi} strong-fit roles, each with a named person. Aim for about ${Math.round(C.warmTarget * 100)}% warm.</p>
      <div class="grid g4">
        <div class="stat ${thisWeek.length >= tLo ? 'stat--lime' : ''}"><span class="stat__k">Applied this week</span><span class="stat__v">${thisWeek.length}<small style="font-size:16px"> / ${tLo}–${tHi}</small></span><div class="meter"><i style="width:${Math.min(100, thisWeek.length / tLo * 100)}%"></i></div><span class="stat__s">${thisWeekWarm} with a named person · ${queued} queued to apply</span></div>
        <div class="stat"><span class="stat__k">Warm share (active)</span><span class="stat__v">${Math.round(warmPct * 100)}%</span><div class="meter ${warmPct < C.warmTarget ? 'clay' : ''}"><i style="width:${Math.round(warmPct * 100)}%"></i></div><span class="stat__s">${warmN} warm path · ${namedN - warmN} named contact only · ${active.length - namedN} cold</span></div>
        <div class="stat"><span class="stat__k">Response rate</span><span class="stat__v">${appliedN ? Math.round(resp / appliedN * 100) : 0}%</span><span class="stat__s">${resp} of ${appliedN} applications got a reply</span></div>
        <div class="stat"><span class="stat__k">Interview rate</span><span class="stat__v">${appliedN ? Math.round(intv / appliedN * 100) : 0}%</span><span class="stat__s">${intv} roles reached a screen or interview</span></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card__head"><h2>Applications per week</h2><span class="sub">last 12 weeks · by applied date</span></div>
          <div class="card__body"><div class="bars">${wk.map((n, i) => `<div class="bar"><i class="${i === 11 ? 'cur' : ''}" style="height:${n / maxW * 100}%"><span>${n || ''}</span></i><small>${weeks[i].toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</small></div>`).join('')}</div></div></div>
        <div class="card"><div class="card__head"><h2>Pipeline by priority</h2><span class="sub">${active.length} active · ${S.roles.length} total</span></div>
          <div class="card__body funnel">${byP.map(([p, n]) => `<div class="funnel__row"><span>${pz(p)}</span><div><div class="funnel__bar" style="width:${Math.max(2, n / maxP * 100)}%;${p >= 6 ? 'background:var(--steady)' : p === 5 ? 'background:var(--forest)' : ''}"></div></div><b>${n}</b></div>`).join('')}</div></div>
        <div class="card"><div class="card__head"><h2>Funnel</h2><span class="sub">all tracked roles</span></div>
          <div class="card__body funnel">${[['Tracked', S.roles.length], ['Applied', appliedN], ['Replied', resp], ['Screen / interview', intv], ['Offer', S.roles.filter(r => /offer/i.test(r.stage + ' ' + r.status)).length]].map(([l, n], i, a) => `<div class="funnel__row"><span>${l}</span><div><div class="funnel__bar" style="width:${Math.max(2, n / Math.max(1, a[0][1]) * 100)}%;${i === 4 ? 'background:var(--lime)' : ''}"></div></div><b>${n}</b></div>`).join('')}</div></div>
        <div class="card"><div class="card__head"><h2>Active by lane</h2><span class="sub">${doneTasks} of ${S.tasks.length} to-dos done</span></div>
          <div class="card__body funnel">${lanes.map(([l, n]) => `<div class="funnel__row"><span>${esc(l)}</span><div><div class="funnel__bar" style="width:${Math.max(2, n / Math.max(1, active.length) * 100)}%;background:var(--forest-deep)"></div></div><b>${n}</b></div>`).join('')}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card__head"><h2>Recent changes</h2><span class="sub">app edits and syncs</span></div>
        <div class="card__body"><ul class="feed">${S.activity.slice(0, 25).map(a => `<li><time>${esc(fmtTs(a.at))}</time><em>${esc(a.source)}</em><span>${esc(a.summary || '')}</span></li>`).join('') || '<li class="empty">No changes yet.</li>'}</ul></div></div>`;
  }

  // ---------- Pipeline ----------
  function filtered() {
    const q = S.f.q.toLowerCase();
    return S.roles.filter(r => (S.f.closed || r.priority !== 7) && (!S.f.lane || r.lane === S.f.lane) && (!S.f.prio || r.priority === +S.f.prio) &&
      (!q || [r.company, r.role, r.notes, r.next_step, r.stage, r.status].join(' ').toLowerCase().includes(q)));
  }
  function vPipeline(v) {
    v.innerHTML = `
      <div class="cli">
        <div class="cli__row"><span class="cli__key">Search</span><input type="search" id="pq" placeholder="Company, role, notes" value="${esc(S.f.q)}"/></div>
        <div class="cli__row"><span class="cli__key">Lane</span><div class="chips" id="plane">${['', ...LANES].map(l => `<button class="seg" data-v="${esc(l)}" aria-pressed="${S.f.lane === l}">${esc(l || 'All')}</button>`).join('')}</div></div>
        <div class="cli__row"><span class="cli__key">Priority</span><div class="chips" id="pprio">${['', 1, 2, 3, 4, 5, 6, 7].map(p => `<button class="seg" data-v="${p}" aria-pressed="${String(S.f.prio) === String(p)}">${p ? p + ' ' + PRIO[p] : 'All'}</button>`).join('')}</div></div>
        <div class="cli__row"><span class="cli__key">View</span><div class="chips">
          <button class="seg" data-view="board" aria-pressed="${S.pipeView === 'board'}">Board</button><button class="seg" data-view="table" aria-pressed="${S.pipeView === 'table'}">Table</button>
          <button class="seg" id="pclosed" aria-pressed="${S.f.closed}">Show closed</button><button class="btn btn--sm btn--lime" id="padd">+ Add role</button></div></div>
      </div><div id="pbody"></div>`;
    $('#pq').oninput = e => { S.f.q = e.target.value; drawPipe(); };
    $('#plane').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; S.f.lane = b.dataset.v; vPipeline(v); };
    $('#pprio').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; S.f.prio = b.dataset.v; vPipeline(v); };
    v.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.pipeView = b.dataset.view; localStorage.setItem('jt_pipeview', S.pipeView); vPipeline(v); });
    $('#pclosed').onclick = () => { S.f.closed = !S.f.closed; vPipeline(v); };
    $('#padd').onclick = () => openRole(null);
    drawPipe();
  }
  function drawPipe() {
    const el = $('#pbody'); const rows = filtered();
    if (S.pipeView === 'board') {
      const cols = [1, 2, 3, 4, 5, 6, 7].filter(p => S.f.closed || p !== 7).filter(p => !S.f.prio || +S.f.prio === p);
      el.innerHTML = `<div class="board">${cols.map(p => {
        const rs = rows.filter(r => r.priority === p).sort((a, b) => scoreRole(b).s - scoreRole(a).s);
        return `<section class="col" data-p="${p}"><div class="col__head">${pz(p)}<b>${rs.length}</b></div><div class="col__body">${rs.map(r => `
          <article class="kcard" draggable="true" data-id="${r.id}">
            <span class="kcard__c">${esc(r.company)}</span><span class="kcard__r">${esc(r.role)}</span>
            ${r.next_step ? `<span class="kcard__n">→ ${esc(r.next_step)}</span>` : `<span class="kcard__n">${esc(r.status || r.stage || '')}</span>`}
            <div class="chips">${(p => p ? (p.warm ? '<span class="chip chip--warm">warm</span>' : '<span class="chip">contact</span>') : '')(personFor(r))}${r.resume_code ? `<span class="chip">${esc(r.resume_code)}</span>` : ''}${r.next_step_due ? `<span class="chip chip--due">${fmtD(r.next_step_due)}</span>` : ''}</div>
          </article>`).join('')}</div></section>`; }).join('')}</div>`;
      el.querySelectorAll('.kcard').forEach(k => {
        k.onclick = () => openRole(+k.dataset.id);
        k.ondragstart = e => { e.dataTransfer.setData('text/plain', k.dataset.id); k.classList.add('dragging'); };
        k.ondragend = () => k.classList.remove('dragging');
      });
      el.querySelectorAll('.col').forEach(c => {
        c.ondragover = e => { e.preventDefault(); c.classList.add('drop'); };
        c.ondragleave = () => c.classList.remove('drop');
        c.ondrop = async e => { e.preventDefault(); c.classList.remove('drop'); const id = +e.dataTransfer.getData('text/plain'); const p = +c.dataset.p; const r = roleById(id); if (r && r.priority !== p) { r.priority = p; drawPipe(); renderTabs(); await save('roles', id, { priority: p }); toast(`${r.company} → ${PRIO[p]}`); } };
      });
    } else {
      const k = S.sort.k, d = S.sort.d;
      rows.sort((a, b) => { const x = a[k] ?? '', y = b[k] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * d || (a.priority - b.priority); });
      const th = (key, label) => `<th data-sort="${key}">${label}${k === key ? (d > 0 ? ' ↑' : ' ↓') : ''}</th>`;
      el.innerHTML = `<div class="card"><div class="tablewrap"><table class="t"><thead><tr>${th('priority', 'Priority')}${th('company', 'Company')}${th('role', 'Role')}${th('stage', 'Stage')}${th('status', 'Status')}${th('next_step', 'Next step')}${th('next_step_due', 'Due')}${th('lane', 'Lane')}${th('date', 'Updated')}<th>Links</th></tr></thead><tbody>${rows.map(r => `
        <tr data-id="${r.id}">
          <td><select class="ed" data-f="priority">${[1, 2, 3, 4, 5, 6, 7].map(p => `<option value="${p}" ${r.priority === p ? 'selected' : ''}>${p} ${PRIO[p]}</option>`).join('')}</select></td>
          <td class="co"><button class="linkbtn" data-open="${r.id}">${esc(r.company)}</button></td>
          <td>${esc(r.role)}</td>
          <td><input class="ed" data-f="stage" value="${esc(r.stage)}"/></td>
          <td><input class="ed" data-f="status" value="${esc(r.status)}"/></td>
          <td class="wide"><textarea class="ed" data-f="next_step" rows="1">${esc(r.next_step)}</textarea></td>
          <td><input class="ed" type="date" data-f="next_step_due" value="${esc(r.next_step_due || '')}"/></td>
          <td><select class="ed" data-f="lane">${['', ...LANES].map(l => `<option ${r.lane === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
          <td class="mono" style="font-size:12px;white-space:nowrap">${fmtD(r.date)}</td>
          <td>${link(r.link, 'Posting')} ${r.resume_code ? link(resumeUrl(r.resume_code), r.resume_code) : ''}</td>
        </tr>`).join('')}</tbody></table></div></div>`;
      el.querySelectorAll('th[data-sort]').forEach(h => h.onclick = () => { S.sort = { k: h.dataset.sort, d: S.sort.k === h.dataset.sort ? -S.sort.d : 1 }; drawPipe(); });
      el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openRole(+b.dataset.open));
      el.querySelectorAll('.ed').forEach(inp => {
        const handler = () => { const id = +inp.closest('tr').dataset.id; let val = inp.value; if (inp.dataset.f === 'priority') val = +val; if (val === '') val = null; saveLater('roles', id, { [inp.dataset.f]: val }, inp.tagName === 'SELECT' || inp.type === 'date' ? 0 : 700); };
        inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input', handler);
      });
    }
  }

  // ---------- role drawer ----------
  function closeDrawer() { $('#overlay').innerHTML = ''; renderTabs(); renderView(); }
  function openRole(id) {
    const r = id ? roleById(id) : { company: '', role: '', priority: 3, stage: 'To apply', status: 'To apply', lane: LANES[0] };
    const tasks = id ? S.tasks.filter(t => t.role_id === id || (norm(t.company) === norm(r.company) && r.company)) : [];
    const contacts = id ? S.contacts.filter(c => norm(c.company) === norm(r.company)) : [];
    const f = (k, label, type = 'text') => `<div class="field"><label>${label}</label>${type === 'area' ? `<textarea class="ed" data-f="${k}">${esc(r[k])}</textarea>` : `<input class="ed" type="${type}" data-f="${k}" value="${esc(r[k] ?? '')}"/>`}</div>`;
    $('#overlay').innerHTML = `<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-label="Role">
      <div style="display:flex;gap:10px;align-items:center"><h3>${id ? esc(r.company) : 'Add a role'}</h3><span style="margin-left:auto"></span><button class="btn btn--sm" id="dclose">Close</button></div>
      ${id ? `<p class="sub">${esc(r.role)}</p>` : ''}
      ${id ? '' : f('company', 'Company') + f('role', 'Role')}
      <div class="row2"><div class="field"><label>Priority</label><select class="ed" data-f="priority">${[1, 2, 3, 4, 5, 6, 7].map(p => `<option value="${p}" ${r.priority === p ? 'selected' : ''}>${p} · ${PRIO[p]}</option>`).join('')}</select></div>
        <div class="field"><label>Lane</label><select class="ed" data-f="lane">${['', ...LANES].map(l => `<option ${r.lane === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      <div class="row2">${f('stage', 'Stage')}${f('status', 'Status')}</div>
      ${f('next_step', 'Next step')}
      <div class="row2">${f('next_step_due', 'Next step due', 'date')}${f('date', 'Last touch', 'date')}</div>
      <div class="row2">${f('applied_date', 'Applied on', 'date')}${f('resume_code', 'Résumé code')}</div>
      <div class="row2">${f('salary_range', 'Salary')}${f('location', 'Location')}</div>
      <div class="row2">${f('fit_score', 'Fit (1–5)', 'number')}${f('warm_contact', 'Warm contact')}</div>
      ${f('link', 'Posting link', 'url')}
      ${f('notes', 'Notes', 'area')}
      ${id ? '' : '<button class="btn btn--primary" id="dcreate">Add to pipeline</button>'}
      ${r.link ? `<p>${link(r.link, 'Open posting ↗')} ${r.resume_code ? ' · ' + link(resumeUrl(r.resume_code), 'Résumé ' + r.resume_code + ' ↗') : ''}</p>` : ''}
      ${tasks.length ? `<div class="card"><div class="card__head"><h3>To-dos</h3></div><ul class="todo">${tasks.map(taskLi).join('')}</ul></div>` : ''}
      ${contacts.length ? `<div class="card"><div class="card__head"><h3>People</h3></div><div class="card__body stack">${contacts.map(c => `<div><b>${esc(c.name)}</b> <span class="sub">${esc(c.title || '')}</span> ${link(c.url, 'Profile')}${c.warm_path && !/^none/i.test(c.warm_path) ? `<div class="sub">${esc(c.warm_path)}</div>` : ''}</div>`).join('')}</div></div>` : ''}
    </aside>`;
    $('#scrim').onclick = closeDrawer; $('#dclose').onclick = closeDrawer;
    const dr = $('.drawer');
    if (id) {
      dr.querySelectorAll('[data-f]').forEach(inp => {
        const ev = inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input';
        inp.addEventListener(ev, () => { let val = inp.value; if (['priority', 'fit_score'].includes(inp.dataset.f)) val = val === '' ? null : +val; if (val === '') val = null; saveLater('roles', id, { [inp.dataset.f]: val }, ev === 'change' ? 0 : 700); });
      });
      bindTodo(dr);
    } else {
      $('#dcreate').onclick = async () => {
        const o = {}; dr.querySelectorAll('[data-f]').forEach(inp => { let v = inp.value; if (['priority', 'fit_score'].includes(inp.dataset.f)) v = v === '' ? null : +v; if (v !== '' && v != null) o[inp.dataset.f] = v; });
        if (!o.company || !o.role) { toast('Company and role are required'); return; }
        o.rkey = `${o.company.trim().toLowerCase()}|${o.role.trim().toLowerCase()}`.replace(/\s+/g, ' '); o.source = 'app'; o.date = o.date || new Date().toISOString().slice(0, 10);
        const row = await insert('roles', o); if (row) { toast('Added'); closeDrawer(); }
      };
    }
  }

  // ---------- To-do ----------
  function taskLi(t) {
    const r = t.role_id && roleById(t.role_id);
    const due = pd(t.due), dd = due ? days(due, today()) : null;
    const links = [link(t.posting_url || (r && r.link), 'Posting'), t.resume_code ? link(t.resume_url || resumeUrl(t.resume_code), 'Résumé ' + t.resume_code) : '',
      t.contact_url ? link(t.contact_url, /linkedin/.test(t.contact_url) ? 'LinkedIn' : 'Contact') : '', t.contact_email ? link('mailto:' + t.contact_email, t.contact_email) : ''].filter(Boolean);
    return `<li class="${t.done ? 'done' : ''}" data-tid="${t.id}">
      <input type="checkbox" class="check" data-check="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}"/>
      <div>
        <div class="todo__t">${esc(t.title)}</div>
        ${t.notes ? `<div class="todo__s">${esc(t.notes)}</div>` : ''}
        ${links.length ? `<div class="todo__links">${links.join('')}</div>` : ''}
        ${t.draft != null && t.draft !== '' ? `<details class="draft"><summary>Draft</summary><div class="draft__box"><textarea class="draft__text" data-draft="${t.id}">${esc(t.draft)}</textarea><div><button class="btn btn--sm btn--primary" data-copy="${t.id}">Copy</button> <span class="sub" style="font-size:12px">Edits to the draft save automatically.</span></div></div></details>` : ''}
      </div>
      <div class="todo__side">${dd != null ? `<span class="chip ${dd < 0 && !t.done ? 'chip--over' : dd <= 3 ? 'chip--due' : ''}">${dd < 0 && !t.done ? 'Overdue · ' : 'Due '}${fmtD(t.due)}</span>` : ''}<span class="chip">${esc(t.grp || '')}</span>${t.done && t.done_at ? `<span class="chip">done ${fmtD(t.done_at)}</span>` : ''}</div>
    </li>`;
  }
  function bindTodo(root) {
    root.querySelectorAll('[data-check]').forEach(c => c.onchange = async () => { const id = +c.dataset.check; c.closest('li').classList.toggle('done', c.checked); await save('tasks', id, { done: c.checked, done_at: c.checked ? new Date().toISOString() : null }); renderTabs();
      document.querySelectorAll('[data-gc]').forEach(el => { const k = el.dataset.gc; const all = S.tasks.filter(t => (TODO_GROUPS.some(g => g[0] === t.type) ? t.type : 'other') === k); el.textContent = `${all.filter(t => t.done).length} of ${all.length} done`; }); });
    root.querySelectorAll('[data-draft]').forEach(a => a.oninput = () => saveLater('tasks', +a.dataset.draft, { draft: a.value }));
    root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      const ta = root.querySelector(`[data-draft="${b.dataset.copy}"]`);
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
      b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1400);
    });
  }
  function vTodo(v) {
    const list = S.tasks.filter(t => S.todoShowDone || !t.done);
    const grpOf = t => (TODO_GROUPS.find(g => g[0] === t.type) ? t.type : 'other');
    const sortT = (a, b) => (a.done - b.done) || ((pd(a.due) || 9e15) - (pd(b.due) || 9e15)) || (a.priority - b.priority) || (a.sort - b.sort);
    v.innerHTML = `<h1 class="h1">Your checklist.</h1><p class="lede">Every application and note to send yourself. Tick it when done; it saves. Nothing is sent from here.</p>
      <div class="chips" style="margin-bottom:16px"><button class="seg" id="tdone" aria-pressed="${S.todoShowDone}">Show done</button><button class="btn btn--sm btn--lime" id="tadd">+ Add to-do</button></div>
      <div class="stack">${TODO_GROUPS.map(([k, label]) => {
        const all = S.tasks.filter(t => grpOf(t) === k); if (!all.length) return '';
        const items = list.filter(t => grpOf(t) === k).sort(sortT);
        return `<details class="card" open><summary class="card__head" style="cursor:pointer;list-style:none"><h2>${label}</h2><span class="sub" data-gc="${k}">${all.filter(t => t.done).length} of ${all.length} done</span></summary><ul class="todo">${items.map(taskLi).join('') || '<li class="empty" style="display:block">All done here.</li>'}</ul></details>`;
      }).join('')}</div>`;
    $('#tdone').onclick = () => { S.todoShowDone = !S.todoShowDone; vTodo(v); };
    $('#tadd').onclick = () => openTaskForm();
    bindTodo(v);
  }
  function openTaskForm() {
    $('#overlay').innerHTML = `<div class="scrim" id="scrim"></div><aside class="drawer"><div style="display:flex;align-items:center"><h3>Add a to-do</h3><button class="btn btn--sm" style="margin-left:auto" id="dclose">Close</button></div>
      <div class="field"><label>Title</label><input class="ed" id="nt_title"/></div>
      <div class="row2"><div class="field"><label>Type</label><select class="ed" id="nt_type">${TODO_GROUPS.slice(0, 4).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div class="field"><label>Due</label><input class="ed" type="date" id="nt_due"/></div></div>
      <div class="row2"><div class="field"><label>Company</label><input class="ed" id="nt_company"/></div><div class="field"><label>Contact</label><input class="ed" id="nt_contact"/></div></div>
      <div class="field"><label>Contact link</label><input class="ed" id="nt_url"/></div>
      <div class="field"><label>Draft</label><textarea class="ed" id="nt_draft"></textarea></div>
      <button class="btn btn--primary" id="nt_save">Add</button></aside>`;
    $('#scrim').onclick = closeDrawer; $('#dclose').onclick = closeDrawer;
    $('#nt_save').onclick = async () => {
      const title = $('#nt_title').value.trim(); if (!title) { toast('Add a title'); return; }
      const company = $('#nt_company').value.trim();
      const role = S.roles.find(r => company && norm(r.company) === norm(company));
      const row = await insert('tasks', { title, type: $('#nt_type').value, due: $('#nt_due').value || null, company: company || null, contact_name: $('#nt_contact').value || null, contact_url: $('#nt_url').value || null, draft: $('#nt_draft').value || null, grp: 'Added in app', priority: 2, role_id: role ? role.id : null, slug: 'app-' + Date.now() });
      if (row) { toast('Added'); closeDrawer(); }
    };
  }

  // ---------- New roles ----------
  function guessLane(role) { const r = (role || '').toLowerCase(); if (/\bproduct\b|\bpm\b/.test(r)) return LANES[2]; if (/customer|\bcs\b|success|support|post-sale|cx|experience/.test(r)) return LANES[1]; return LANES[0]; }
  function vNew(v) {
    const list = S.new_roles.filter(n => n.decision === S.nrFilter).sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0) || String(b.found_at).localeCompare(String(a.found_at)));
    const cnt = k => S.new_roles.filter(n => n.decision === k).length;
    v.innerHTML = `<h1 class="h1">New opportunities.</h1><p class="lede">Roles surfaced by sweeps and searches. Add the good ones to the pipeline as "3 · Apply", or skip them.</p>
      <div class="chips" style="margin-bottom:16px">${[['new', 'To review'], ['added', 'Added'], ['skipped', 'Skipped']].map(([k, l]) => `<button class="seg" data-nf="${k}" aria-pressed="${S.nrFilter === k}">${l} · ${cnt(k)}</button>`).join('')}</div>
      <div class="nr">${list.map(n => `<article class="nrc">
        <div style="display:flex;gap:8px;align-items:center"><span class="nrc__c">${esc(n.company)}</span>${n.fit_score ? `<span class="fit" style="margin-left:auto">FIT ${n.fit_score}</span>` : ''}</div>
        <div class="nrc__r">${esc(n.role)}</div>
        <div class="chips">${n.location ? `<span class="chip">${esc(n.location)}</span>` : ''}${n.salary && !/not listed/i.test(n.salary) ? `<span class="chip">${esc(n.salary)}</span>` : ''}${n.resume_variant ? `<span class="chip">${esc(n.resume_variant)}</span>` : ''}</div>
        ${n.why_fit ? `<div class="nrc__w">${esc(n.why_fit)}</div>` : ''}${n.gap ? `<div class="nrc__w"><b>Gap:</b> ${esc(n.gap)}</div>` : ''}
        <div class="sub" style="font:400 11.5px/1.3 var(--mono)">${esc(n.source || '')}${n.posted ? ' · posted ' + esc(n.posted) : ''}</div>
        <div class="nrc__a">${link(n.link, 'Posting ↗')}<span style="margin-left:auto"></span>
          ${n.decision !== 'added' ? `<button class="btn btn--sm btn--primary" data-add="${n.id}">Add to pipeline</button>` : ''}
          ${n.decision === 'new' ? `<button class="btn btn--sm" data-skip="${n.id}">Skip</button>` : n.decision === 'skipped' ? `<button class="btn btn--sm" data-undo="${n.id}">Back to review</button>` : ''}</div>
      </article>`).join('') || '<div class="empty">Nothing here.</div>'}</div>`;
    v.onclick = async e => {
      const f = e.target.closest('[data-nf]'); if (f) { S.nrFilter = f.dataset.nf; vNew(v); return; }
      const s = e.target.closest('[data-skip]'); if (s) { await save('new_roles', +s.dataset.skip, { decision: 'skipped', decided_at: new Date().toISOString() }); renderTabs(); vNew(v); return; }
      const u = e.target.closest('[data-undo]'); if (u) { await save('new_roles', +u.dataset.undo, { decision: 'new', decided_at: null }); renderTabs(); vNew(v); return; }
      const a = e.target.closest('[data-add]'); if (a) {
        const n = S.new_roles.find(x => x.id === +a.dataset.add);
        const rkey = `${n.company.trim().toLowerCase()}|${n.role.trim().toLowerCase()}`.replace(/\s+/g, ' ');
        if (!S.roles.some(r => r.rkey === rkey)) {
          const row = await insert('roles', { rkey, company: n.company, role: n.role, priority: 3, stage: 'To apply', status: 'To apply', link: n.link, salary_range: n.salary && !/not listed/i.test(n.salary) ? n.salary : null, location: n.location, notes: [n.why_fit, n.gap ? 'Gap: ' + n.gap : ''].filter(Boolean).join(' '), fit_score: n.fit_score, lane: guessLane(n.role), source: 'new_roles', date: new Date().toISOString().slice(0, 10) });
          if (!row) return;
        }
        await save('new_roles', n.id, { decision: 'added', decided_at: new Date().toISOString() }); toast(`${n.company} added as "3 · Apply"`); renderTabs(); vNew(v);
      }
    };
  }

  // ---------- Résumés ----------
  function vResumes(v) {
    const used = code => S.roles.filter(r => code && r.resume_code === code);
    const lanes = [...LANES, 'Other'];
    const laneOf = r => LANES.includes(r.lane) ? r.lane : 'Other';
    v.innerHTML = `<h1 class="h1">Résumés.</h1><p class="lede">${S.resumes.length} versions. Each opens in Drive; "Used for" lists the pipeline roles tagged with that code.</p>
      <div class="stack">${lanes.map(l => { const rs = S.resumes.filter(r => laneOf(r) === l); if (!rs.length) return '';
        return `<div class="card"><div class="card__head"><h2>${esc(l)}</h2><span class="sub">${rs.length}</span></div><div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Version</th><th>Built for</th><th>Date</th><th>Used for</th><th>Lane · notes</th><th></th></tr></thead><tbody>${rs.map(r => { const u = used(r.code);
          return `<tr data-id="${r.id}"><td class="mono"><b>${esc(r.code || '—')}</b></td><td class="co">${esc(r.version)}</td><td>${esc(r.built_for || '')}</td><td class="mono" style="font-size:12px;white-space:nowrap">${fmtD(r.created)}</td>
            <td>${u.map(x => `<span class="chip"><span class="pz p${x.priority}">${x.priority}</span> ${esc(x.company)}</span>`).join(' ') || (r.sent_to ? esc(r.sent_to) : '<span class="sub">—</span>')}</td>
            <td class="wide"><select class="ed" data-rl="${r.id}" style="max-width:200px">${['', ...LANES].map(x => `<option ${r.lane === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><div class="sub" style="font-size:12.5px">${esc(r.notes || '')}</div></td>
            <td style="white-space:nowrap">${link(r.drive_url, 'Open ↗')}</td></tr>`; }).join('')}</tbody></table></div></div>`; }).join('')}</div>`;
    v.querySelectorAll('[data-rl]').forEach(s => s.onchange = async () => { await save('resumes', +s.dataset.rl, { lane: s.value || null }); vResumes(v); });
  }

  // ---------- Contacts ----------
  function vContacts(v) {
    v.innerHTML = `<h1 class="h1">People.</h1><p class="lede">Hiring managers, referrers and warm paths. Log the last touch so follow-ups rank correctly.</p>
      <div class="cli"><div class="cli__row"><span class="cli__key">Search</span><input type="search" id="cq" placeholder="Name, company, title" value="${esc(S.cq || '')}"/></div></div><div id="cbody"></div>`;
    const draw = () => {
      const q = (S.cq || '').toLowerCase();
      const rows = S.contacts.filter(c => !q || [c.name, c.company, c.title, c.role, c.why].join(' ').toLowerCase().includes(q));
      $('#cbody').innerHTML = `<div class="card"><div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Company</th><th>Title</th><th>Warm path</th><th>Last touch</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map(c => `
        <tr data-id="${c.id}"><td class="co">${esc(c.name)}<div class="sub" style="font-size:12px;font-weight:400">${esc(c.relation || '')}</div></td><td>${esc(c.company || '')}<div class="sub" style="font-size:12px">${esc(c.role || '')}</div></td><td>${esc(c.title || '')}</td>
          <td style="max-width:260px;font-size:13px">${c.warm_path && !/^none/i.test(c.warm_path) ? `<span class="chip chip--warm">warm</span> ${esc(c.warm_path)}` : '<span class="sub">cold</span>'}</td>
          <td><input class="ed" type="date" data-cf="last_touch" value="${esc(c.last_touch || '')}"/></td>
          <td class="wide"><textarea class="ed" data-cf="notes" rows="1" placeholder="${esc((c.why || '').slice(0, 90))}">${esc(c.notes || '')}</textarea></td>
          <td>${link(c.url, 'Profile')} ${c.email ? link('mailto:' + c.email, 'Email') : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
      $('#cbody').querySelectorAll('[data-cf]').forEach(inp => inp.addEventListener(inp.type === 'date' ? 'change' : 'input', () => saveLater('contacts', +inp.closest('tr').dataset.id, { [inp.dataset.cf]: inp.value || null }, inp.type === 'date' ? 0 : 700)));
    };
    $('#cq').oninput = e => { S.cq = e.target.value; draw(); };
    draw();
  }

  // ---------- auth ----------
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + '#' + S.tab);
    $('#view').innerHTML = '<div class="card"><div class="empty">Loading your pipeline…</div></div>';
    renderMeta(); await loadAll();
  }
  function showLogin() {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#meta').innerHTML = '';
    const err = new URLSearchParams(location.hash.slice(1)).get('error_description');
    if (err) $('#loginMsg').textContent = err.replace(/\+/g, ' ');
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); const email = $('#email').value.trim();
      $('#loginMsg').textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      $('#loginMsg').textContent = error ? 'Could not send: ' + error.message : 'Check your inbox for the sign-in link (it can take a minute). Open it on this device.';
    };
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && $('#app').classList.contains('hidden')) boot(); if (ev === 'SIGNED_OUT') showLogin(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#overlay').innerHTML) closeDrawer(); });
  boot();
})();
