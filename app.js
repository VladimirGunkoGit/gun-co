/* ================= gunco — логика ================= */
(function () {
  "use strict";
  const CFG = window.GUNCO_CONFIG || {};
  const HAS_SUPABASE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
  const sb = HAS_SUPABASE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { detectSessionInUrl: true, flowType: "implicit", persistSession: true, autoRefreshToken: true } }) : null;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dstr(new Date());
  const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dstr(d); };
  const fmtFull = (s) => { const [y, m, d] = (s || "").split("-"); return d ? `${d}.${m}.${y}` : ""; };
  const fmtShort = (s) => { const [y, m, d] = (s || "").split("-"); return d ? `${d}.${m}` : ""; };
  const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
  const MONTHS_SHORT = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
  const WEEKDAYS = ["ВС","ПН","ВТ","СР","ЧТ","ПТ","СБ"];

  /* Статусы (пользовательские наборы: task и project — раздельные) */
  const STATUS_PALETTE = ["150,153,163","231,200,106","126,196,232","199,138,74","232,155,184","134,217,152","178,150,232","110,206,197","232,120,120"];
  const BUILTIN_STATUSES = [
    { id: "none",     name: "без статуса", c: "150,153,163", ord: 0,   done: false },
    { id: "waiting",  name: "ждёт начала", c: "231,200,106", ord: 1,   done: false },
    { id: "progress", name: "в работе",    c: "126,196,232", ord: 2,   done: false },
    { id: "daily",    name: "ежедневно",   c: "199,138,74",  ord: 3,   done: false },
    { id: "late",     name: "опоздание",   c: "232,155,184", ord: 4,   done: false },
    { id: "done",     name: "готово",      c: "134,217,152", ord: 999, done: true  },
  ];
  function seedStatuses() { return BUILTIN_STATUSES.map((s) => ({ ...s, builtin: true })); }
  let taskStatusesCache = seedStatuses(), projStatusesCache = seedStatuses();
  const byOrd = (a, b) => (a.ord || 0) - (b.ord || 0);
  function statusSet(kind) { return kind === "project" ? projStatusesCache : taskStatusesCache; }
  function statusById(kind, id) { return statusSet(kind).find((s) => s.id === id) || null; }
  function statusColor(kind, id) { const s = statusById(kind, id); return s ? s.c : "150,153,163"; }
  function statusName(kind, id) { const s = statusById(kind, id); return s ? s.name : "без статуса"; }
  function statusIsDone(kind, id) { const s = statusById(kind, id); return !!(s && s.done); }
  function defaultFilterIds(kind) { return statusSet(kind).filter((s) => !s.done).map((s) => s.id); }
  function statusOf(t) { if (t.status && statusById("task", t.status)) return t.status; if (t.is_done) return "done"; return "progress"; }
  function statusDot(kind, id, lg) { return `<span class="status-dot${lg ? " status-dot--lg" : ""}" style="--c:${statusColor(kind, id)}"></span>`; }
  function statusPill(kind, id) { return `<span class="status-pill" style="--c:${statusColor(kind, id)}"><span>${esc(statusName(kind, id))}</span>${statusDot(kind, id)}</span>`; }
  let _statusLoading = null;
  function loadStatuses() {
    if (_statusLoading) return _statusLoading;
    _statusLoading = Promise.all([Store.statuses("task"), Store.statuses("project")]).then(([t, p]) => { taskStatusesCache = t.slice().sort(byOrd); projStatusesCache = p.slice().sort(byOrd); _statusLoading = null; }, (e) => { _statusLoading = null; throw e; });
    return _statusLoading;
  }

  /* Проекты */
  const DEFAULT_PROJECTS = [{ emoji: "🧶", name: "Жизнь" }, { emoji: "🔨", name: "Работа" }];
  const DEFAULT_EMOJI = "⚪️";
  let projectsCache = [];
  function projById(id) { return id ? projectsCache.find((p) => p.id === id) || null : null; }
  function projEmoji(p) { return (p && p.emoji) ? p.emoji : DEFAULT_EMOJI; }
  function projPillInner(p) { return `<span class="proj-emoji">${p ? projEmoji(p) : DEFAULT_EMOJI}</span><span class="proj-name">${p ? esc(p.name) : "проект"}</span>`; }
  function projStatusOf(p) { return p && p.status && statusById("project", p.status) ? p.status : "progress"; }
  const projCmpNewest = (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id).localeCompare(String(a.id));
  function orderedProjects() {
    const byStatus = {};
    projectsCache.forEach((p) => { const st = projStatusOf(p); (byStatus[st] = byStatus[st] || []).push(p); });
    const out = [];
    statusSet("project").forEach((s) => { const arr = byStatus[s.id]; if (arr) { arr.sort(projCmpNewest); out.push(...arr); } });
    return out;
  }
  let _projLoading = null;
  function loadProjects() { if (_projLoading) return _projLoading; _projLoading = Promise.resolve(Store.projects()).then((l) => { projectsCache = l; _projLoading = null; return l; }, (e) => { _projLoading = null; throw e; }); return _projLoading; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  const BELL_BASE = `<path d="M6 8.6a6 6 0 0112 0c0 4.4 1.8 5.7 2.4 6.2.4.3.1.9-.4.9H4c-.5 0-.8-.6-.4-.9.6-.5 2.4-1.8 2.4-6.2z"/><path d="M10 19a2 2 0 004 0"/>`;
  const BELL_ON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${BELL_BASE}</svg>`;
  const BELL_OFF = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="opacity:.6">${BELL_BASE}<line x1="4.5" y1="4" x2="20" y2="20.5"/></svg>`;
  const TRASH_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5.5h6V7M6.5 7l.9 12.5h9.2L17.5 7"/></svg>`;

  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 1400); }

  /* ---------- Хранилище ---------- */
  const LKEY = "gunco_data_v1";
  const Local = {
    read() { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { return {}; } },
    write(d) { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch { toast("не хватает места (нужен вход/сервер)"); } },
    ensure() {
      const d = this.read();
      d.tasks = d.tasks || [];
      d.tasks.forEach((t) => { if (!t.id) t.id = uid(); if (!t.status) t.status = t.is_done ? "done" : "progress"; if ("tag" in t) delete t.tag; });
      if (!d.projectsV1) { d.projects = DEFAULT_PROJECTS.map((p) => ({ id: uid(), emoji: p.emoji, name: p.name, status: "progress" })); d.projectsV1 = true; delete d.tags; delete d.tagsV2; }
      d.projects = d.projects || [];
      d.notes = d.notes || [];
      if (!d.statusesV1) { d.taskStatuses = seedStatuses(); d.projectStatuses = seedStatuses(); d.statusesV1 = true; }
      d.taskStatuses = d.taskStatuses || seedStatuses();
      d.projectStatuses = d.projectStatuses || seedStatuses();
      d.settings = d.settings || { theme: "dark", count: 5 };
      this.write(d); return d;
    },
  };
  const Store = {
    userId: null,
    async tasks() { if (sb && this.userId) { const { data } = await sb.from("tasks").select("*").eq("user_id", this.userId); return data || []; } return Local.ensure().tasks; },
    async addTask(t) { if (sb && this.userId) { const { data } = await sb.from("tasks").insert({ ...t, user_id: this.userId }).select().single(); return data; } const d = Local.ensure(); const row = { ...t, id: uid() }; d.tasks.push(row); Local.write(d); return row; },
    async updateTask(id, fields) { if (sb && this.userId) { await sb.from("tasks").update(fields).eq("id", id); return; } const d = Local.ensure(); const t = d.tasks.find((x) => x.id === id); if (t) Object.assign(t, fields); Local.write(d); },
    async deleteTask(id) { if (sb && this.userId) { await sb.from("tasks").delete().eq("id", id); return; } const d = Local.ensure(); d.tasks = d.tasks.filter((x) => x.id !== id); Local.write(d); },
    async projects() {
      if (sb && this.userId) {
        const { data } = await sb.from("projects").select("*").eq("user_id", this.userId).order("created_at");
        if (!data || !data.length) { const created = []; for (const p of DEFAULT_PROJECTS) { const row = await this.addProject(p); if (row) created.push(row); } return created; }
        // авто-дедуп одинаковых проектов (эмодзи+имя) — чинит дубли от прошлых гонок
        const seen = new Set(), uniq = [], dups = [];
        for (const p of data) { const k = (p.emoji || "") + "|" + p.name; if (seen.has(k)) dups.push(p.id); else { seen.add(k); uniq.push(p); } }
        if (dups.length) { try { await sb.from("projects").delete().in("id", dups); } catch {} }
        return uniq;
      }
      return Local.ensure().projects;
    },
    async addProject({ emoji, name, status, start_date, end_date, description }) {
      const base = { emoji: emoji || null, name: name || "", status: status || "progress", start_date: start_date || null, end_date: end_date || null, description: description || null };
      if (sb && this.userId) { const { data } = await sb.from("projects").insert({ ...base, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), created_at: new Date().toISOString(), ...base, emoji: emoji || "" }; d.projects.push(row); Local.write(d); return row;
    },
    async updateProject(id, fields) { if (sb && this.userId) { await sb.from("projects").update(fields).eq("id", id); return; } const d = Local.ensure(); const p = d.projects.find((x) => x.id === id); if (p) Object.assign(p, fields); Local.write(d); },
    async deleteProject(id) { if (sb && this.userId) { await sb.from("tasks").update({ project_id: null }).eq("project_id", id); await sb.from("projects").delete().eq("id", id); return; } const d = Local.ensure(); d.tasks.forEach((t) => { if (t.project_id === id) t.project_id = null; }); d.projects = d.projects.filter((x) => x.id !== id); Local.write(d); },
    async statuses(kind) {
      if (sb && this.userId) {
        const { data } = await sb.from("statuses").select("*").eq("user_id", this.userId).eq("kind", kind).order("ord");
        if (!data || !data.length) { const rows = seedStatuses().map((s) => ({ ...s, user_id: this.userId, kind })); try { await sb.from("statuses").upsert(rows, { onConflict: "user_id,kind,id" }); } catch {} return seedStatuses(); }
        return data.map((s) => ({ id: s.id, name: s.name, c: s.c, ord: s.ord, done: !!s.done, builtin: !!s.builtin }));
      }
      const d = Local.ensure(); return (kind === "project" ? d.projectStatuses : d.taskStatuses).slice();
    },
    async addStatus(kind, { name, c }) {
      const set = kind === "project" ? projStatusesCache : taskStatusesCache;
      const nonDoneMax = set.filter((s) => !s.done).reduce((m, s) => Math.max(m, s.ord || 0), -1);
      const row = { id: uid(), name: name || "Без названия", c: c || STATUS_PALETTE[0], ord: nonDoneMax + 1, done: false, builtin: false };
      if (sb && this.userId) { const { data } = await sb.from("statuses").insert({ ...row, user_id: this.userId, kind }).select().single(); return data ? { id: data.id, name: data.name, c: data.c, ord: data.ord, done: !!data.done, builtin: false } : row; }
      const d = Local.ensure(); (kind === "project" ? d.projectStatuses : d.taskStatuses).push(row); Local.write(d); return row;
    },
    async updateStatus(kind, id, fields) {
      if (sb && this.userId) { await sb.from("statuses").update(fields).eq("user_id", this.userId).eq("kind", kind).eq("id", id); return; }
      const d = Local.ensure(); const arr = kind === "project" ? d.projectStatuses : d.taskStatuses; const s = arr.find((x) => x.id === id); if (s) Object.assign(s, fields); Local.write(d);
    },
    async deleteStatus(kind, id) {
      if (sb && this.userId) {
        if (kind === "project") await sb.from("projects").update({ status: "none" }).eq("user_id", this.userId).eq("status", id);
        else await sb.from("tasks").update({ status: "none" }).eq("user_id", this.userId).eq("status", id);
        await sb.from("statuses").delete().eq("user_id", this.userId).eq("kind", kind).eq("id", id); return;
      }
      const d = Local.ensure();
      if (kind === "project") d.projects.forEach((p) => { if (p.status === id) p.status = "none"; });
      else d.tasks.forEach((t) => { if (t.status === id) t.status = "none"; });
      const key = kind === "project" ? "projectStatuses" : "taskStatuses";
      d[key] = d[key].filter((x) => x.id !== id); Local.write(d);
    },
    async notes() {
      if (sb && this.userId) { const { data } = await sb.from("notes").select("*").eq("user_id", this.userId).order("updated_at", { ascending: false }); return data || []; }
      return Local.ensure().notes.slice().sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
    },
    async addNote({ title, body }) {
      const now = new Date().toISOString(); const base = { title: title || "", body: body || "" };
      if (sb && this.userId) { const { data } = await sb.from("notes").insert({ ...base, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), created_at: now, updated_at: now, ...base }; d.notes.push(row); Local.write(d); return row;
    },
    async updateNote(id, fields) {
      const patch = { ...fields, updated_at: new Date().toISOString() };
      if (sb && this.userId) { await sb.from("notes").update(patch).eq("id", id); return; }
      const d = Local.ensure(); const n = d.notes.find((x) => x.id === id); if (n) Object.assign(n, patch); Local.write(d);
    },
    async deleteNote(id) {
      if (sb && this.userId) { await sb.from("notes").delete().eq("id", id); return; }
      const d = Local.ensure(); d.notes = d.notes.filter((x) => x.id !== id); Local.write(d);
    },
    async settings() { if (sb && this.userId) { const { data } = await sb.from("settings").select("*").eq("user_id", this.userId).single(); return data || { theme: "dark", count: 5 }; } return Local.ensure().settings; },
    async saveSettings(s) { if (sb && this.userId) { await sb.from("settings").upsert({ user_id: this.userId, ...s }); return; } const d = Local.ensure(); d.settings = { ...d.settings, ...s }; Local.write(d); },
  };

  /* ---------- Тема ---------- */
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); Store.saveSettings({ theme: t }); }
  $("#theme-btn").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

  /* ---------- Подтверждение ---------- */
  let confirmResolve = null;
  function askConfirm(text = "Удалить?", sub = "") { $("#confirm-text").textContent = text; $("#confirm-sub").textContent = sub; $("#confirm-sub").hidden = !sub; $("#confirm-modal").hidden = false; return new Promise((res) => (confirmResolve = res)); }
  function closeConfirm(v) { $("#confirm-modal").hidden = true; if (confirmResolve) { confirmResolve(v); confirmResolve = null; } }
  $("#confirm-yes").addEventListener("click", () => closeConfirm(true));
  $("#confirm-no").addEventListener("click", () => closeConfirm(false));
  $("#confirm-modal").addEventListener("click", (e) => { if (e.target.id === "confirm-modal") closeConfirm(false); });

  /* ---------- Свайп удаления ---------- */
  let justSwiped = false;
  function attachSwipe(el, onDelete) {
    const fg = el.querySelector(".swipe-row"); let sx = 0, sy = 0, dx = 0, drag = false;
    el.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; drag = true; fg.style.transition = "none"; }, { passive: true });
    el.addEventListener("touchmove", (e) => { if (!drag) return; const t = e.touches[0]; const mx = t.clientX - sx, my = t.clientY - sy; if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { drag = false; fg.style.transform = ""; el.classList.remove("swiping"); return; } dx = Math.min(0, mx); fg.style.transform = `translateX(${dx}px)`; el.classList.toggle("swiping", dx < 0); }, { passive: true });
    el.addEventListener("touchend", async () => { if (!drag) return; drag = false; fg.style.transition = "transform .2s"; if (dx < -70) { justSwiped = true; setTimeout(() => (justSwiped = false), 400); fg.style.transform = "translateX(-100%)"; if (await askConfirm("Удалить?")) await onDelete(); else { fg.style.transform = "translateX(0)"; setTimeout(() => el.classList.remove("swiping"), 200); } } else { fg.style.transform = "translateX(0)"; setTimeout(() => el.classList.remove("swiping"), 200); } });
  }

  /* ---------- Календарь (общий рендер) ---------- */
  function drawCal(state, gridEl, titleEl, onPick) {
    titleEl.textContent = `${MONTHS[state.m]} ${state.y}`;
    const offset = (new Date(state.y, state.m, 1).getDay() + 6) % 7; const days = new Date(state.y, state.m + 1, 0).getDate(); const t = todayStr();
    let html = ""; for (let i = 0; i < offset; i++) html += `<span class="cal-day empty"></span>`;
    for (let d = 1; d <= days; d++) { const ds = `${state.y}-${pad(state.m + 1)}-${pad(d)}`; const cls = ["cal-day"]; if (ds === t) cls.push("today"); if (ds === state.value) cls.push("sel"); html += `<button type="button" class="${cls.join(" ")}" data-d="${ds}">${d}</button>`; }
    for (let i = offset + days; i < 42; i++) html += `<span class="cal-day empty"></span>`;
    gridEl.innerHTML = html;
    [...gridEl.querySelectorAll(".cal-day[data-d]")].forEach((b) => b.addEventListener("click", () => onPick(b.dataset.d)));
  }

  /* Календарь-модалка (только дата) */
  const cal = { y: 0, m: 0, value: "", allowAll: false, onPick: null };
  function openCalendar({ value, allowAll = false, clearLabel = "Все дни", onPick }) {
    const base = (value || todayStr()).split("-"); cal.y = +base[0]; cal.m = +base[1] - 1; cal.value = value || (allowAll ? "" : todayStr()); cal.allowAll = allowAll; cal.onPick = onPick;
    $("#cal-all").hidden = !allowAll; $("#cal-all").textContent = clearLabel; renderCal(); $("#cal").hidden = false;
  }
  function renderCal() { drawCal({ y: cal.y, m: cal.m, value: cal.value }, $("#cal-grid"), $("#cal-title"), (d) => { $("#cal").hidden = true; cal.onPick && cal.onPick(d); }); }
  function calPrev() { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); }
  function calNext() { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); }
  $("#cal-prev").addEventListener("click", calPrev);
  $("#cal-next").addEventListener("click", calNext);
  (function () { const g = $("#cal-grid"); let sx = 0, sy = 0, on = false; g.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true }); g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? calNext() : calPrev()); }, { passive: true }); })();
  $("#cal-cancel").addEventListener("click", () => ($("#cal").hidden = true));
  $("#cal-all").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(""); });
  $("#cal").addEventListener("click", (e) => { if (e.target.id === "cal") $("#cal").hidden = true; });

  /* ---------- Дата+время+уведомление (большое окно, для главной) ---------- */
  const dt = { y: 0, m: 0, date: "", time: "", notify: true, onDone: null };
  function openDateTime({ date, time, notify, onDone }) {
    const base = (date || todayStr()).split("-"); dt.y = +base[0]; dt.m = +base[1] - 1; dt.date = date || ""; dt.time = time || ""; dt.notify = notify !== false; dt.onDone = onDone;
    $("#dt-time").value = dt.time; $("#dt-notify").classList.toggle("off", !dt.notify); drawDtCal(); $("#datetime-modal").hidden = false;
  }
  function drawDtCal() { drawCal({ y: dt.y, m: dt.m, value: dt.date }, $("#dt-grid"), $("#dt-title"), (d) => { dt.date = d; drawDtCal(); }); }
  $("#dt-prev").addEventListener("click", () => { dt.m--; if (dt.m < 0) { dt.m = 11; dt.y--; } drawDtCal(); });
  $("#dt-next").addEventListener("click", () => { dt.m++; if (dt.m > 11) { dt.m = 0; dt.y++; } drawDtCal(); });
  (function () { const g = $("#dt-grid"); let sx = 0, sy = 0, on = false; g.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true }); g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) { dt.m++; if (dt.m > 11) { dt.m = 0; dt.y++; } } else { dt.m--; if (dt.m < 0) { dt.m = 11; dt.y--; } } drawDtCal(); } }, { passive: true }); })();
  $("#dt-notify").addEventListener("click", () => $("#dt-notify").classList.toggle("off"));
  $("#dt-cancel").addEventListener("click", () => ($("#datetime-modal").hidden = true));
  $("#datetime-modal").addEventListener("click", (e) => { if (e.target.id === "datetime-modal") $("#datetime-modal").hidden = true; });
  $("#dt-done").addEventListener("click", () => { $("#datetime-modal").hidden = true; if (dt.onDone) dt.onDone(dt.date, $("#dt-time").value, !$("#dt-notify").classList.contains("off")); });
  $("#dt-clear").addEventListener("click", () => { $("#datetime-modal").hidden = true; if (dt.onDone) dt.onDone("", "", !$("#dt-notify").classList.contains("off")); });

  /* ---------- Статус: пикер (одиночный) + создание/удаление кастомных ---------- */
  function statusAddBtn() { return `<button type="button" class="status-add" aria-label="Новый статус"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg></button>`; }
  function statusPillHTML(kind, s, selected, off) {
    const del = s.builtin ? "" : `<span class="status-del" data-del="${s.id}" aria-label="Удалить">×</span>`;
    return `<button type="button" class="status-pill ${selected ? "is-cur" : ""} ${off ? "off" : ""}" data-k="${s.id}" style="--c:${s.c}"><span>${esc(s.name)}</span>${statusDot(kind, s.id)}${del}</button>`;
  }
  async function deleteCustomStatus(kind, id, after) {
    if (!(await askConfirm("Удалить статус?", "Элементы с ним станут «без статуса»"))) return;
    await Store.deleteStatus(kind, id); await loadStatuses();
    if (after) after();
    if (currentView === "projects") renderKanban(); else if (currentView === "project") renderProjectTasks();
  }
  let statusPickKind = "task", statusPickCurrent = null, statusOnPick = null;
  function renderStatusPickList() {
    const kind = statusPickKind;
    $("#status-list").innerHTML = statusAddBtn() + statusSet(kind).map((s) => statusPillHTML(kind, s, s.id === statusPickCurrent, false)).join("");
    $("#status-list .status-add").addEventListener("click", () => openStatusForm(kind, (newId) => { if (newId) { $("#status-modal").hidden = true; if (statusOnPick) statusOnPick(newId); } else renderStatusPickList(); }));
    $$("#status-list .status-pill").forEach((b) => b.addEventListener("click", (e) => {
      const del = e.target.closest(".status-del");
      if (del) { deleteCustomStatus(kind, del.dataset.del, renderStatusPickList); return; }
      $("#status-modal").hidden = true; if (statusOnPick) statusOnPick(b.dataset.k);
    }));
  }
  function openStatusPicker(kind, current, onPick) { statusPickKind = kind; statusPickCurrent = current; statusOnPick = onPick; renderStatusPickList(); $("#status-modal").hidden = false; }
  $("#status-modal").addEventListener("click", (e) => { if (e.target.id === "status-modal") $("#status-modal").hidden = true; });

  /* Форма создания статуса */
  let statusFormKind = "task", statusFormColor = STATUS_PALETTE[0], statusFormOnCreate = null;
  function renderStatusSwatches() {
    $("#statusform-swatches").innerHTML = STATUS_PALETTE.map((c) => `<button type="button" class="swatch ${c === statusFormColor ? "is-cur" : ""}" data-c="${c}" style="--c:${c}"><span class="status-dot"></span></button>`).join("");
    $$("#statusform-swatches .swatch").forEach((b) => b.addEventListener("click", () => { statusFormColor = b.dataset.c; renderStatusSwatches(); }));
  }
  function openStatusForm(kind, onCreate) { statusFormKind = kind; statusFormColor = STATUS_PALETTE[0]; statusFormOnCreate = onCreate; $("#statusform-name").value = ""; renderStatusSwatches(); $("#statusform-modal").hidden = false; setTimeout(() => $("#statusform-name").focus(), 30); }
  $("#statusform-ok").addEventListener("click", async () => {
    const name = ($("#statusform-name").value || "").trim(); if (!name) { $("#statusform-name").focus(); return; }
    const row = await Store.addStatus(statusFormKind, { name, c: statusFormColor }); await loadStatuses();
    if (statusFormKind === "task" && row) { filterStatuses.add(row.id); pFilterStatuses.add(row.id); saveFilters(); }
    $("#statusform-modal").hidden = true;
    if (statusFormOnCreate) statusFormOnCreate(row ? row.id : null);
  });
  $("#statusform-cancel").addEventListener("click", () => ($("#statusform-modal").hidden = true));
  $("#statusform-modal").addEventListener("click", (e) => { if (e.target.id === "statusform-modal") $("#statusform-modal").hidden = true; });

  /* ---------- Проекты: выбор (одиночный) и фильтр (множественный) ---------- */
  let projMode = "single", projCurrent = null, projOnPick = null;
  async function openProjectPicker(currentId, onPick) {
    await loadProjects(); projMode = "single"; projCurrent = currentId; projOnPick = onPick;
    $("#project-modal-title").textContent = "проект"; $("#project-reset").hidden = true; $("#project-clear").hidden = !currentId;
    $("#project-search").value = ""; $("#project-modal .search-wrap").classList.remove("has-text");
    renderProjectList(); $("#project-modal").hidden = false;
  }
  async function openProjectFilter() {
    await loadProjects(); projMode = "filter";
    $("#project-modal-title").textContent = "проекты"; $("#project-reset").hidden = false; $("#project-clear").hidden = true;
    $("#project-search").value = ""; $("#project-modal .search-wrap").classList.remove("has-text");
    renderProjectList(); $("#project-modal").hidden = false;
  }
  $("#project-clear").addEventListener("click", () => { $("#project-modal").hidden = true; if (projOnPick) projOnPick(null); });
  function renderProjectList() {
    const q = ($("#project-search").value || "").trim().toLowerCase();
    const ordered = orderedProjects();
    const list = q ? ordered.filter((p) => (p.name || "").toLowerCase().includes(q)) : ordered;
    let html = `<button type="button" class="proj-add-row" id="proj-add-row" aria-label="Новый проект"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg></button>`;
    html += list.map((p) => { const sel = projMode === "filter" ? filterProjects.has(p.id) : p.id === projCurrent; return `<button type="button" class="proj-pill ${sel ? (projMode === "filter" ? "is-on" : "is-cur") : ""}" data-id="${p.id}"><span class="proj-emoji">${projEmoji(p)}</span><span class="proj-name">${esc(p.name)}</span></button>`; }).join("");
    if (!list.length && q) html += `<span class="empty">ничего не найдено</span>`;
    $("#project-list").innerHTML = html;
    $("#proj-add-row").addEventListener("click", openProjForm);
    $$("#project-list .proj-pill[data-id]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id;
      if (projMode === "filter") { filterProjects.has(id) ? filterProjects.delete(id) : filterProjects.add(id); applyFiltersUI(); saveFilters(); renderProjectList(); renderTasks(); }
      else { $("#project-modal").hidden = true; if (projOnPick) projOnPick(id); }
    }));
  }
  $("#project-search").addEventListener("input", (e) => { e.target.closest(".search-wrap").classList.toggle("has-text", !!e.target.value); renderProjectList(); });
  $("#project-reset").addEventListener("click", () => { filterProjects.clear(); applyFiltersUI(); saveFilters(); renderProjectList(); renderTasks(); });
  $("#project-modal").addEventListener("click", (e) => { if (e.target.id === "project-modal") $("#project-modal").hidden = true; });

  /* Эмодзи-пикер */
  const EMOJIS = ["🧶","🔨","💼","🏠","📚","✏️","💻","📱","🎯","⭐","🔥","💡","📌","✅","🗓️","⏰","🎨","🎵","🏃","🍳","🛒","💰","❤️","🧠","🌱","☕","✈️","🚗","🏋️","🎮","📷","🎁","🌍","🐶","🐱","🌟","⚡","🌈","🍎","💊","🩺","🎓","🏢","🛠️","📝","📞","💬","🔒","🔑","🧹","🍽️","🛁","👶","🐾","🎂","🎉","💍","💐","📦","🚚","🧾","💳","📈","📉","🎬","🎤","🏦","⚙️","🔧","🖥️","🗂️","📁","🔬","🧪","🌿","🪴","🐟","🍞","🥦","🏊","🚴","🧘","😀","😎","🤝","👍","🙏","🔔","📖","✒️"];
  let formEmoji = "", emojiOnPick = null;
  function renderFormEmoji() { $("#projform-emoji").textContent = formEmoji || DEFAULT_EMOJI; $("#projform-emoji").classList.toggle("is-empty", !formEmoji); }
  function openEmojiModal(current, onPick) {
    emojiOnPick = onPick; $("#emoji-input").value = "";
    $("#emoji-grid").innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-cell ${e === current ? "is-cur" : ""}" data-e="${e}">${e}</button>`).join("");
    $$("#emoji-grid .emoji-cell").forEach((b) => b.addEventListener("click", () => { $("#emoji-modal").hidden = true; if (emojiOnPick) emojiOnPick(b.dataset.e); }));
    $("#emoji-clear").hidden = !current;
    $("#emoji-modal").hidden = false;
  }
  $("#emoji-clear").addEventListener("click", () => { $("#emoji-modal").hidden = true; if (emojiOnPick) emojiOnPick(""); });
  $("#emoji-input").addEventListener("input", (e) => { const v = [...(e.target.value || "").trim()]; if (v.length) { const em = v[v.length - 1]; $("#emoji-modal").hidden = true; if (emojiOnPick) emojiOnPick(em); } });
  $("#emoji-modal").addEventListener("click", (e) => { if (e.target.id === "emoji-modal") $("#emoji-modal").hidden = true; });
  $("#projform-emoji").addEventListener("click", () => openEmojiModal(formEmoji, (em) => { formEmoji = em; renderFormEmoji(); }));

  function openProjForm() { formEmoji = ""; renderFormEmoji(); $("#projform-name").value = ""; $("#projform-modal").hidden = false; setTimeout(() => $("#projform-name").focus(), 30); }
  $("#projform-ok").addEventListener("click", async () => {
    const name = ($("#projform-name").value || "").trim(); if (!name) { $("#projform-name").focus(); return; }
    const emoji = formEmoji;
    const row = await Store.addProject({ emoji, name }); await loadProjects();
    $("#projform-modal").hidden = true;
    if (projMode === "single" && row) { $("#project-modal").hidden = true; if (projOnPick) projOnPick(row.id); }
    else renderProjectList();
  });
  $("#projform-cancel").addEventListener("click", () => ($("#projform-modal").hidden = true));
  $("#projform-modal").addEventListener("click", (e) => { if (e.target.id === "projform-modal") $("#projform-modal").hidden = true; });

  /* ---------- Чек-листы в contenteditable ---------- */
  const CHK_TRIG = /^\[\]\s/;
  function initChecklist(el) {
    el.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertParagraph") {
        const blk = currentBlock(el);
        if (blk && blk.classList.contains("chk")) {
          e.preventDefault();
          const nl = document.createElement("div"); nl.appendChild(document.createElement("br"));
          blk.after(nl); placeCaretAtStart(nl);
        }
      }
    });
    el.addEventListener("input", (e) => { if (e.isComposing) return; maybeMakeChecklist(el); });
    el.addEventListener("click", (e) => {
      const blk = e.target.closest(".chk"); if (!blk) return;
      const rect = blk.getBoundingClientRect();
      if (e.clientX - rect.left <= 26) {
        const on = blk.getAttribute("data-checked") === "1";
        blk.setAttribute("data-checked", on ? "0" : "1"); blk.classList.toggle("is-done", !on);
      }
    });
  }
  function currentBlock(el) { const sel = window.getSelection(); if (!sel.rangeCount) return null; let n = sel.anchorNode; if (!n || n === el) return null; while (n && n.parentNode !== el) n = n.parentNode; if (!n || n.parentNode !== el) return null; return n.nodeType === 1 ? n : null; }
  function placeCaretAtStart(node) { const sel = window.getSelection(); const r = document.createRange(); r.setStart(node, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  function placeCaretEnd(node) { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  function makeChk(blk, rest, checked) {
    blk.className = "chk" + (checked ? " is-done" : ""); blk.setAttribute("data-checked", checked ? "1" : "0");
    blk.textContent = rest || "";
  }
  function maybeMakeChecklist(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const blk = currentBlock(el);
    if (blk) {
      if (blk.classList.contains("chk")) return;
      const txt = blk.textContent;
      if (CHK_TRIG.test(txt)) { makeChk(blk, txt.replace(CHK_TRIG, ""), false); placeCaretEnd(blk); }
    } else {
      const node = sel.anchorNode;
      if (node && node.nodeType === 3 && node.parentNode === el && CHK_TRIG.test(node.textContent)) {
        const div = document.createElement("div"); el.insertBefore(div, node); const rest = node.textContent.replace(CHK_TRIG, ""); node.remove();
        makeChk(div, rest, false); placeCaretEnd(div);
      }
    }
  }
  /* ---------- Форматирование текста (жирный/курсив/ссылки), хранится как HTML ---------- */
  const FMT_ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1, BR: 1, DIV: 1 };
  function sanitizeNode(root) {
    [...root.childNodes].forEach((n) => {
      if (n.nodeType === 3) return;
      if (n.nodeType !== 1) { n.remove(); return; }
      sanitizeNode(n);
      if (!FMT_ALLOWED[n.tagName]) { while (n.firstChild) root.insertBefore(n.firstChild, n); n.remove(); return; }
      const isChk = n.tagName === "DIV" && n.classList.contains("chk");
      [...n.attributes].forEach((a) => {
        const keep = (n.tagName === "A" && a.name === "href") || (isChk && (a.name === "data-checked" || a.name === "class"));
        if (!keep) n.removeAttribute(a.name);
      });
      if (n.tagName === "A") { let h = (n.getAttribute("href") || "").trim(); if (h && !/^(https?:|mailto:)/i.test(h)) h = "https://" + h.replace(/^\/+/, ""); if (h) { n.setAttribute("href", h); n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); } else { while (n.firstChild) root.insertBefore(n.firstChild, n); n.remove(); } }
    });
  }
  function sanitizeHTML(html) { const t = document.createElement("div"); t.innerHTML = html || ""; sanitizeNode(t); return t.innerHTML; }
  function descSerialize(el) {
    const html = sanitizeHTML(el.innerHTML);
    const t = document.createElement("div"); t.innerHTML = html;
    if (!t.textContent.trim() && !t.querySelector(".chk")) return "";
    return html;
  }
  function descLoad(el, val) {
    el.innerHTML = ""; if (!val) return;
    if (val.indexOf("<") !== -1) { el.innerHTML = sanitizeHTML(val); return; }
    val.split("\n").forEach((line) => {
      let m = line.match(/^\[x\]\s?(.*)$/i);
      if (m) { const div = document.createElement("div"); makeChk(div, m[1], true); el.appendChild(div); return; }
      m = line.match(/^\[\s?\]\s?(.*)$/);
      if (m) { const div = document.createElement("div"); makeChk(div, m[1], false); el.appendChild(div); return; }
      const div = document.createElement("div"); if (line === "") div.appendChild(document.createElement("br")); else div.textContent = line; el.appendChild(div);
    });
  }
  let linkRange = null, linkEl = null;
  function openLinkModal(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    linkRange = sel.getRangeAt(0).cloneRange(); linkEl = el;
    $("#link-url").value = ""; $("#link-modal").hidden = false; setTimeout(() => $("#link-url").focus(), 30);
  }
  $("#link-ok").addEventListener("click", () => {
    let url = ($("#link-url").value || "").trim(); $("#link-modal").hidden = true;
    if (!url || !linkRange) { linkRange = null; return; }
    if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(linkRange);
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.textContent = linkRange.toString() || url; linkRange.deleteContents(); linkRange.insertNode(a);
    const r = document.createRange(); r.setStartAfter(a); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    if (linkEl) linkEl.dispatchEvent(new Event("input", { bubbles: true }));
    linkRange = null;
  });
  $("#link-cancel").addEventListener("click", () => { $("#link-modal").hidden = true; linkRange = null; });
  $("#link-modal").addEventListener("click", (e) => { if (e.target.id === "link-modal") { $("#link-modal").hidden = true; linkRange = null; } });
  function initFormatting(el) {
    el.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey; if (!mod) return;
      const k = (e.key || "").toLowerCase();
      if (k === "k" || (e.shiftKey && k === "u")) { e.preventDefault(); openLinkModal(el); }
    });
    el.addEventListener("click", (e) => {
      const a = e.target.closest("a"); if (!a) return;
      const href = a.getAttribute("href"); if (!href) return;
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    });
    el.addEventListener("paste", (e) => {
      const cd = e.clipboardData; if (!cd) return;
      const html = cd.getData("text/html"); const text = cd.getData("text/plain");
      e.preventDefault();
      const sel = window.getSelection(); if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0); range.deleteContents();
      if (html) { range.insertNode(range.createContextualFragment(sanitizeHTML(html))); }
      else if (text) { range.insertNode(document.createTextNode(text)); }
      sel.collapseToEnd();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /* ---------- Навигация ---------- */
  let currentView = "tasks";
  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    const isForm = name === "task" || name === "project" || name === "note";
    $("#back-btn").hidden = !isForm;
    $("#page-nav").hidden = isForm;
    $("#fab").hidden = !(name === "tasks" || name === "projects" || name === "notes");
    if (!isForm) { let activeItem = null; $$("#page-nav .nav-item").forEach((b) => { const on = b.dataset.view === name; b.classList.toggle("active", on); if (on) activeItem = b; }); if (activeItem) requestAnimationFrame(() => activeItem.scrollIntoView({ inline: "nearest", block: "nearest" })); }
    if (name === "tasks") renderTasks();
    else if (name === "projects") renderKanban();
    else if (name === "project") renderProjectTasks();
    else if (name === "notes") renderNotes();
  }
  $$("#page-nav .nav-item").forEach((b) => b.addEventListener("click", () => { if (currentView !== b.dataset.view) showView(b.dataset.view); }));
  function goBack() {
    const m = $$(".modal").find((x) => !x.hidden); if (m) { m.hidden = true; return; }
    if (currentView === "task") { leaveTask(); return; }
    if (currentView === "project") { leaveProject(); return; }
    if (currentView === "note") { leaveNote(); return; }
  }
  $("#back-btn").addEventListener("click", goBack);
  $("#brand-home").addEventListener("click", () => showView("tasks"));
  $("#fab").addEventListener("click", () => { if (currentView === "projects") newProject(); else if (currentView === "notes") newNote(); else newTask(); });
  (function () { const main = $(".main"); let sx = 0, sy = 0, on = false;
    main.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest(".swipe-row") || e.target.closest("[contenteditable]")) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    main.addEventListener("touchmove", (e) => { if (!on) return; if (Math.abs(e.touches[0].clientY - sy) > Math.abs(e.touches[0].clientX - sx)) on = false; }, { passive: true });
    main.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) goBack(); }, { passive: true });
  })();

  /* ---------- Фильтры ---------- */
  let dateFilter = "", filterProjects = new Set(), filterStatuses = new Set(defaultFilterIds("task")), tasksById = {};
  const FKEY = "gunco_filters";
  function saveFilters() { try { localStorage.setItem(FKEY, JSON.stringify({ dateFilter, projects: [...filterProjects], statuses: [...filterStatuses] })); } catch {} }
  function loadFilters() { try { const f = JSON.parse(localStorage.getItem(FKEY)) || {}; dateFilter = f.dateFilter || ""; filterProjects = new Set(f.projects || []); filterStatuses = new Set(f.statuses || defaultFilterIds("task")); } catch {} }
  function isDefaultStatuses() { const def = defaultFilterIds("task"); return filterStatuses.size === def.length && def.every((k) => filterStatuses.has(k)); }
  function applyFiltersUI() {
    $("#date-filter-label").textContent = dateFilter ? fmtFull(dateFilter) : "все дни";
    $("#date-filter").classList.toggle("is-set", !!dateFilter);
    $("#date-clear").hidden = !dateFilter;
    $("#project-filter").classList.toggle("is-on", filterProjects.size > 0);
    $("#status-filter").classList.toggle("is-on", !isDefaultStatuses());
  }

  /* ---------- Список задач ---------- */
  function dayHead(day) { if (!day) return "без даты"; const [y, m, d] = day.split("-").map(Number); return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} · ${d} ${MONTHS_SHORT[m - 1]}`; }
  function taskRow(t, opts) {
    opts = opts || {};
    const st = statusOf(t); const p = projById(t.project_id);
    const projCell = opts.showProjectPill ? `<span class="proj-pill task-proj ${p ? "" : "is-empty"}" data-act="project">${projPillInner(p)}</span>` : "";
    const dateCell = opts.showDate ? `<button class="task-date" data-act="time">${t.due_date ? dayHead(t.due_date.slice(0, 10)) : "—"}</button>` : "";
    return `<div class="task swipeable" data-id="${t.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row">
        <button class="row-status" data-act="status" aria-label="Статус">${statusDot("task", st, true)}</button>
        <span class="task-title">${esc(t.title)}</span>
        ${projCell}${dateCell}
        <button class="task-time" data-act="time">${t.due_time ? esc(t.due_time) : "—"}</button>
      </div>
    </div>`;
  }
  const taskSort = (a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.due_time || "99:99").localeCompare(b.due_time || "99:99");
  function buildGroupedTaskListHTML(tasks, opts) {
    let html = "", lastDay = null;
    tasks.forEach((t) => { const day = t.due_date ? t.due_date.slice(0, 10) : ""; if (day !== lastDay) { if (lastDay !== null) html += "</div></div>"; html += `<div class="day-group"><div class="day-head">${dayHead(day)}</div><div class="day-tasks">`; lastDay = day; } html += taskRow(t, opts); });
    if (lastDay !== null) html += "</div></div>";
    return html;
  }
  function buildFlatTaskListHTML(tasks, opts) { return `<div class="day-tasks">${tasks.map((t) => taskRow(t, opts)).join("")}</div>`; }
  async function renderTasks() {
    let tasks = await Store.tasks();
    tasks = tasks.filter((t) => filterStatuses.has(statusOf(t)));
    if (dateFilter) tasks = tasks.filter((t) => (t.due_date || "").slice(0, 10) === dateFilter);
    if (filterProjects.size) tasks = tasks.filter((t) => filterProjects.has(t.project_id));
    tasks.sort(taskSort);
    const shown = tasks;
    tasksById = {}; shown.forEach((t) => (tasksById[t.id] = t));
    $("#tasks-empty").hidden = shown.length > 0;
    $("#task-list").innerHTML = buildGroupedTaskListHTML(shown, { showProjectPill: true });
    $$("#task-list .task").forEach((el) => attachSwipe(el, async () => { await Store.deleteTask(el.dataset.id); renderTasks(); }));
  }
  let projTasksById = {}, pFilterStatuses = new Set(defaultFilterIds("task")), pDateFilter = "";
  async function renderProjectTasks() {
    if (!editingProjectId) { projTasksById = {}; $("#p-task-list").innerHTML = ""; $("#p-tasks-empty").hidden = true; return; }
    let tasks = await Store.tasks();
    tasks = tasks.filter((t) => t.project_id === editingProjectId && pFilterStatuses.has(statusOf(t)));
    if (pDateFilter) tasks = tasks.filter((t) => (t.due_date || "").slice(0, 10) === pDateFilter);
    tasks.sort(taskSort);
    projTasksById = {}; tasks.forEach((t) => (projTasksById[t.id] = t));
    $("#p-tasks-empty").hidden = tasks.length > 0;
    $("#p-task-list").innerHTML = buildFlatTaskListHTML(tasks, { showDate: true });
    $$("#p-task-list .task").forEach((el) => attachSwipe(el, async () => { await Store.deleteTask(el.dataset.id); renderProjectTasks(); }));
  }
  function isDefaultStatusSet(set) { const def = defaultFilterIds("task"); return set.size === def.length && def.every((k) => set.has(k)); }
  function applyProjFiltersUI() {
    $("#p-date-filter-label").textContent = pDateFilter ? fmtFull(pDateFilter) : "все дни";
    $("#p-date-filter").classList.toggle("is-set", !!pDateFilter);
    $("#p-date-clear").hidden = !pDateFilter;
    $("#p-status-filter").classList.toggle("is-on", !isDefaultStatusSet(pFilterStatuses));
  }
  $("#p-date-filter").addEventListener("click", () => openCalendar({ value: pDateFilter, allowAll: true, onPick: (v) => { pDateFilter = v; applyProjFiltersUI(); renderProjectTasks(); } }));
  $("#p-date-clear").addEventListener("click", () => { pDateFilter = ""; applyProjFiltersUI(); renderProjectTasks(); });
  $("#p-status-filter").addEventListener("click", () => openStatusFilterModal(pFilterStatuses, () => { applyProjFiltersUI(); renderProjectTasks(); }));
  function taskListClick(getMap, onChange, returnView) {
    return (e) => {
      if (justSwiped) return;
      const el = e.target.closest(".task"); if (!el) return; const t = getMap()[el.dataset.id]; if (!t) return;
      const hit = e.target.closest("[data-act]"); const act = hit ? hit.dataset.act : null;
      if (act === "status") { openStatusPicker("task", statusOf(t), async (k) => { await Store.updateTask(t.id, { status: k, is_done: statusIsDone("task", k) }); onChange(); }); return; }
      if (act === "project") { openProjectPicker(t.project_id || null, async (id) => { await Store.updateTask(t.id, { project_id: id }); onChange(); }); return; }
      if (act === "time") { openDateTime({ date: t.due_date, time: t.due_time, notify: t.notify !== false, onDone: async (date, time, notify) => { await updateTaskDateTime(t.id, date, time, notify); onChange(); } }); return; }
      openTaskEdit(t, returnView);
    };
  }
  $("#task-list").addEventListener("click", taskListClick(() => tasksById, renderTasks, "tasks"));
  $("#p-task-list").addEventListener("click", taskListClick(() => projTasksById, renderProjectTasks, "project"));
  async function updateTaskDateTime(id, date, time, notify) { let remind_at = null; if (notify && date && time) { const d = new Date(`${date}T${time}:00`); if (!isNaN(d)) remind_at = d.toISOString(); } await Store.updateTask(id, { due_date: date || null, due_time: time || null, notify, remind_at, notified: false }); }

  /* фильтры-кнопки */
  $("#date-filter").addEventListener("click", () => openCalendar({ value: dateFilter, allowAll: true, onPick: (v) => { dateFilter = v; applyFiltersUI(); saveFilters(); renderTasks(); } }));
  $("#date-clear").addEventListener("click", () => { dateFilter = ""; applyFiltersUI(); saveFilters(); renderTasks(); });
  $("#project-filter").addEventListener("click", openProjectFilter);

  let sfSet = null, sfOnChange = null;
  function renderStatusFilterList() {
    $("#statusfilter-list").innerHTML = statusAddBtn() + statusSet("task").map((s) => statusPillHTML("task", s, false, !(sfSet && sfSet.has(s.id)))).join("");
    $("#statusfilter-list .status-add").addEventListener("click", () => openStatusForm("task", (newId) => { if (newId && sfSet) sfSet.add(newId); renderStatusFilterList(); if (sfOnChange) sfOnChange(); }));
    $$("#statusfilter-list .status-pill").forEach((b) => b.addEventListener("click", (e) => {
      const del = e.target.closest(".status-del");
      if (del) { const id = del.dataset.del; deleteCustomStatus("task", id, () => { sfSet && sfSet.delete(id); renderStatusFilterList(); if (sfOnChange) sfOnChange(); }); return; }
      const k = b.dataset.k; sfSet.has(k) ? sfSet.delete(k) : sfSet.add(k); renderStatusFilterList(); if (sfOnChange) sfOnChange();
    }));
  }
  function openStatusFilterModal(set, onChange) { sfSet = set; sfOnChange = onChange; renderStatusFilterList(); $("#statusfilter-modal").hidden = false; }
  $("#status-filter").addEventListener("click", () => openStatusFilterModal(filterStatuses, () => { applyFiltersUI(); saveFilters(); renderTasks(); }));
  $("#statusfilter-modal").addEventListener("click", (e) => { if (e.target.id === "statusfilter-modal") $("#statusfilter-modal").hidden = true; });

  /* ---------- КАРТОЧКА задачи (автосохранение) ---------- */
  let editingTaskId = null, cardDate = tomorrowStr(), cardTime = "12:00", cardNotify = true, cardStatus = "progress", cardProjectId = null, taskTouched = false, editReturn = "tasks";
  function renderCardMeta() {
    $("#t-date").textContent = cardDate ? fmtFull(cardDate) : "дата";
    $("#t-time").value = cardTime || "";
    $("#t-notify").innerHTML = cardNotify ? BELL_ON : BELL_OFF; $("#t-notify").classList.toggle("off", !cardNotify);
    $("#t-status").innerHTML = statusPill("task", cardStatus);
    const p = projById(cardProjectId);
    $("#t-project").innerHTML = projPillInner(p); $("#t-project").classList.toggle("is-empty", !p);
  }
  function taskFields() {
    let remind_at = null; if (cardNotify && cardDate && cardTime) { const d = new Date(`${cardDate}T${cardTime}:00`); if (!isNaN(d)) remind_at = d.toISOString(); }
    return { title: $("#t-title").textContent.trim(), description: descSerialize($("#t-desc")), due_date: cardDate || null, due_time: cardTime || null, notify: cardNotify, project_id: cardProjectId || null, status: cardStatus, is_done: statusIsDone("task", cardStatus), remind_at, notified: false };
  }
  async function saveTaskDraft() { if (editingTaskId) await Store.updateTask(editingTaskId, taskFields()); }
  const saveTaskDebounced = debounce(saveTaskDraft, 400);
  $("#t-date").addEventListener("click", () => openCalendar({ value: cardDate, allowAll: true, clearLabel: "очистить дату", onPick: (v) => { cardDate = v; taskTouched = true; renderCardMeta(); saveTaskDraft(); } }));
  $("#t-time").addEventListener("input", (e) => { cardTime = e.target.value; taskTouched = true; saveTaskDraft(); });
  $("#t-notify").addEventListener("click", () => { cardNotify = !cardNotify; taskTouched = true; renderCardMeta(); saveTaskDraft(); });
  $("#t-status").addEventListener("click", () => openStatusPicker("task", cardStatus, (k) => { cardStatus = k; taskTouched = true; renderCardMeta(); saveTaskDraft(); }));
  $("#t-project").addEventListener("click", () => openProjectPicker(cardProjectId, (id) => { cardProjectId = id; taskTouched = true; renderCardMeta(); saveTaskDraft(); }));
  $("#t-title").addEventListener("input", () => { taskTouched = true; saveTaskDebounced(); });
  $("#t-desc").addEventListener("input", () => { taskTouched = true; saveTaskDebounced(); });
  initChecklist($("#t-desc")); initFormatting($("#t-desc"));

  async function newTask(opts) {
    opts = opts || {};
    cardDate = tomorrowStr(); cardTime = "12:00"; cardNotify = true; cardStatus = "progress"; cardProjectId = opts.projectId || null; taskTouched = false; editReturn = opts.returnView || "tasks";
    $("#t-title").innerText = ""; $("#t-desc").innerHTML = ""; renderCardMeta();
    const draft = await Store.addTask(taskFields()); editingTaskId = draft.id;
    $("#t-submit").textContent = "Готово"; $("#t-delete").hidden = false;
    showView("task"); $("#t-title").focus();
  }
  function openTaskEdit(t, returnView) {
    editReturn = returnView || "tasks"; editingTaskId = t.id; cardDate = t.due_date || tomorrowStr(); cardTime = t.due_time || ""; cardNotify = t.notify !== false; cardStatus = statusOf(t); cardProjectId = t.project_id || null; taskTouched = true;
    $("#t-title").innerText = t.title || ""; descLoad($("#t-desc"), t.description || ""); renderCardMeta();
    $("#t-submit").textContent = "Готово"; $("#t-delete").hidden = false;
    showView("task");
  }
  // Открыть карточку задачи по id (из клика по пуш-уведомлению)
  async function openTaskById(id) {
    if (!id || !hasStarted) return;
    if (editingTaskId && editingTaskId !== id) await leaveTask();
    const tasks = await Store.tasks();
    const t = tasks.find((x) => x.id === id);
    if (t) openTaskEdit(t, "tasks");
  }
  async function leaveTask() {
    if (editingTaskId) {
      const f = taskFields();
      if (!taskTouched && !f.title && !f.description) { await Store.deleteTask(editingTaskId); }
      else { if (!f.title) f.title = "Без названия"; await Store.updateTask(editingTaskId, f); }
    }
    editingTaskId = null;
    showView(editReturn === "project" ? "project" : "tasks");
  }
  $("#t-submit").addEventListener("click", leaveTask);
  $("#t-delete").addEventListener("click", async () => { if (editingTaskId && await askConfirm("Удалить задачу?")) { const rv = editReturn; await Store.deleteTask(editingTaskId); editingTaskId = null; showView(rv === "project" ? "project" : "tasks"); } });

  /* ---------- Канбан проектов ---------- */
  function projBadges(pid, tasks) {
    const counts = {};
    tasks.forEach((t) => { if (t.project_id === pid) { const s = statusOf(t); if (!statusIsDone("task", s)) counts[s] = (counts[s] || 0) + 1; } });
    return statusSet("task").filter((s) => !s.done && counts[s.id]).map((s) => ({ c: s.c, count: counts[s.id] }));
  }
  function kanbanCard(p, tasks) {
    const badges = projBadges(p.id, tasks);
    const badgesHtml = badges.length ? `<div class="kb-badges">${badges.map((b) => `<span class="kb-badge" style="--c:${b.c}">${b.count}</span>`).join("")}</div>` : "";
    return `<div class="kb-card" data-id="${p.id}">
      <div class="kb-card-title"><span class="proj-emoji">${projEmoji(p)}</span><span class="kb-name">${esc(p.name || "Без названия")}</span></div>
      ${badgesHtml}
    </div>`;
  }
  async function renderKanban() {
    await loadProjects();
    const tasks = await Store.tasks();
    const byStatus = {};
    projectsCache.forEach((p) => { const st = projStatusOf(p); (byStatus[st] = byStatus[st] || []).push(p); });
    Object.values(byStatus).forEach((arr) => arr.sort(projCmpNewest));
    let html = "";
    statusSet("project").forEach((s) => { const arr = byStatus[s.id]; if (!arr || !arr.length) return; html += `<div class="kb-col"><div class="kb-col-head">${statusDot("project", s.id)}<span>${esc(s.name)}</span></div><div class="kb-cards scroll">${arr.map((p) => kanbanCard(p, tasks)).join("")}</div></div>`; });
    $("#kanban").innerHTML = html || `<p class="empty kb-empty">нет проектов — создай первый по +</p>`;
  }
  $("#kanban").addEventListener("click", (e) => {
    const card = e.target.closest(".kb-card"); if (!card) return; const p = projById(card.dataset.id); if (!p) return;
    openProjectEdit(p);
  });

  /* ---------- КАРТОЧКА проекта (автосохранение) ---------- */
  let editingProjectId = null, pEmoji = "", pStatus = "progress", pStart = null, pEnd = null, projTouched = false;
  function renderProjectMeta() {
    $("#p-emoji").textContent = pEmoji || DEFAULT_EMOJI; $("#p-emoji").classList.toggle("is-empty", !pEmoji);
    $("#p-status").innerHTML = statusPill("project", pStatus);
    $("#p-start").textContent = pStart ? fmtFull(pStart) : "дата начала"; $("#p-start").classList.toggle("is-empty", !pStart);
    $("#p-end").textContent = pEnd ? fmtFull(pEnd) : "дата окончания"; $("#p-end").classList.toggle("is-empty", !pEnd);
  }
  function projectFields() { return { name: $("#p-title").textContent.trim(), emoji: pEmoji || null, status: pStatus, start_date: pStart || null, end_date: pEnd || null, description: descSerialize($("#p-desc")) }; }
  async function saveProjectDraft() { if (!editingProjectId) return; const f = projectFields(); await Store.updateProject(editingProjectId, f); const i = projectsCache.findIndex((p) => p.id === editingProjectId); if (i >= 0) projectsCache[i] = { ...projectsCache[i], ...f }; }
  const saveProjectDebounced = debounce(saveProjectDraft, 400);
  $("#p-emoji").addEventListener("click", () => openEmojiModal(pEmoji, (em) => { pEmoji = em; projTouched = true; renderProjectMeta(); saveProjectDraft(); }));
  $("#p-status").addEventListener("click", () => openStatusPicker("project", pStatus, (k) => { pStatus = k; projTouched = true; renderProjectMeta(); saveProjectDraft(); }));
  $("#p-start").addEventListener("click", () => openCalendar({ value: pStart, allowAll: true, clearLabel: "очистить дату", onPick: (v) => { pStart = v || null; projTouched = true; renderProjectMeta(); saveProjectDraft(); } }));
  $("#p-end").addEventListener("click", () => openCalendar({ value: pEnd, allowAll: true, clearLabel: "очистить дату", onPick: (v) => { pEnd = v || null; projTouched = true; renderProjectMeta(); saveProjectDraft(); } }));
  $("#p-title").addEventListener("input", () => { projTouched = true; saveProjectDebounced(); });
  $("#p-desc").addEventListener("input", () => { projTouched = true; saveProjectDebounced(); });
  initChecklist($("#p-desc")); initFormatting($("#p-desc"));
  $("#p-add-task").addEventListener("click", () => newTask({ projectId: editingProjectId, returnView: "project" }));
  async function newProject() {
    pEmoji = ""; pStatus = "progress"; pStart = null; pEnd = null; projTouched = false;
    $("#p-title").innerText = ""; $("#p-desc").innerHTML = ""; renderProjectMeta();
    const draft = await Store.addProject(projectFields()); editingProjectId = draft.id;
    if (!projectsCache.some((p) => p.id === draft.id)) projectsCache.push(draft);
    $("#p-submit").textContent = "Готово"; $("#p-delete").hidden = false;
    pFilterStatuses = new Set(defaultFilterIds("task")); pDateFilter = ""; applyProjFiltersUI();
    renderProjectTasks(); showView("project"); $("#p-title").focus();
  }
  function openProjectEdit(p) {
    editingProjectId = p.id; pEmoji = p.emoji || ""; pStatus = projStatusOf(p); pStart = p.start_date || null; pEnd = p.end_date || null; projTouched = true;
    $("#p-title").innerText = p.name || ""; descLoad($("#p-desc"), p.description || ""); renderProjectMeta();
    $("#p-submit").textContent = "Готово"; $("#p-delete").hidden = false;
    pFilterStatuses = new Set(defaultFilterIds("task")); pDateFilter = ""; applyProjFiltersUI();
    renderProjectTasks(); showView("project");
  }
  async function leaveProject() {
    if (editingProjectId) {
      const f = projectFields(); const tasks = await Store.tasks(); const hasTasks = tasks.some((t) => t.project_id === editingProjectId);
      if (!projTouched && !f.name && !f.description && !hasTasks) { await Store.deleteProject(editingProjectId); }
      else { if (!f.name) f.name = "Без названия"; await Store.updateProject(editingProjectId, f); }
      editingProjectId = null; await loadProjects();
    }
    showView("projects");
  }
  $("#p-submit").addEventListener("click", leaveProject);
  $("#p-delete").addEventListener("click", async () => { if (editingProjectId && await askConfirm("Удалить проект?")) { await Store.deleteProject(editingProjectId); editingProjectId = null; await loadProjects(); showView("projects"); } });

  /* ---------- ЗАМЕТКИ ---------- */
  function notePreview(body) { const t = document.createElement("div"); t.innerHTML = body || ""; return t.textContent.replace(/\s+/g, " ").trim(); }
  function noteTrunc(s, n) { s = s || ""; return s.length > n ? esc(s.slice(0, n)) + "…" : esc(s); }
  let notesById = {};
  async function renderNotes() {
    const notes = await Store.notes();
    notesById = {}; notes.forEach((n) => (notesById[n.id] = n));
    $("#notes-empty").hidden = notes.length > 0;
    $("#note-list").innerHTML = notes.map((n) => {
      const title = (n.title || "").trim() || "Без названия";
      const prev = notePreview(n.body);
      return `<div class="note swipeable" data-id="${n.id}">
        <div class="swipe-del">${TRASH_SVG}</div>
        <div class="swipe-row note-row">
          <div class="note-title">${noteTrunc(title, 40)}</div>
          ${prev ? `<div class="note-preview">${noteTrunc(prev, 40)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    $$("#note-list .note").forEach((el) => attachSwipe(el, async () => { await Store.deleteNote(el.dataset.id); renderNotes(); }));
  }
  $("#note-list").addEventListener("click", (e) => {
    if (justSwiped) return;
    const el = e.target.closest(".note"); if (!el) return; const n = notesById[el.dataset.id]; if (!n) return;
    openNoteEdit(n);
  });

  let editingNoteId = null, noteTouched = false;
  function noteFields() { return { title: $("#n-title").textContent.trim(), body: descSerialize($("#n-body")) }; }
  async function saveNoteDraft() { if (editingNoteId) await Store.updateNote(editingNoteId, noteFields()); }
  const saveNoteDebounced = debounce(saveNoteDraft, 400);
  $("#n-title").addEventListener("input", () => { noteTouched = true; saveNoteDebounced(); });
  $("#n-body").addEventListener("input", () => { noteTouched = true; saveNoteDebounced(); });
  initChecklist($("#n-body")); initFormatting($("#n-body"));
  async function newNote() {
    noteTouched = false; $("#n-title").innerText = ""; $("#n-body").innerHTML = "";
    const draft = await Store.addNote(noteFields()); editingNoteId = draft.id;
    $("#n-submit").textContent = "Готово"; $("#n-delete").hidden = false;
    showView("note"); $("#n-title").focus();
  }
  function openNoteEdit(n) {
    editingNoteId = n.id; noteTouched = true;
    $("#n-title").innerText = n.title || ""; descLoad($("#n-body"), n.body || "");
    $("#n-submit").textContent = "Готово"; $("#n-delete").hidden = false;
    showView("note");
  }
  async function leaveNote() {
    if (editingNoteId) {
      const f = noteFields();
      if (!noteTouched && !f.title && !f.body) { await Store.deleteNote(editingNoteId); }
      else { if (!f.title) f.title = "Без названия"; await Store.updateNote(editingNoteId, f); }
    }
    editingNoteId = null;
    showView("notes");
  }
  $("#n-submit").addEventListener("click", leaveNote);
  $("#n-delete").addEventListener("click", async () => { if (editingNoteId && await askConfirm("Удалить заметку?")) { await Store.deleteNote(editingNoteId); editingNoteId = null; showView("notes"); } });

  /* ---------- Аккаунт ---------- */
  $("#account-btn").addEventListener("click", async () => {
    if (!(sb && Store.userId)) { showAuth(); return; }
    const pop = $("#account-pop"); if (!pop.hidden) { pop.hidden = true; return; }
    let email = ""; try { const { data } = await sb.auth.getUser(); email = data && data.user && data.user.email; } catch {}
    $("#account-email").textContent = email || "аккаунт"; updateNotifBtn(); pop.hidden = false;
  });
  $("#account-signout").addEventListener("click", async () => { $("#account-pop").hidden = true; if (sb) await sb.auth.signOut(); Store.userId = null; hasStarted = false; projectsCache = []; _projLoading = null; taskStatusesCache = seedStatuses(); projStatusesCache = seedStatuses(); _statusLoading = null; showAuth(); });
  document.addEventListener("click", (e) => { if (!$("#account-pop").hidden && !e.target.closest("#account-pop") && !e.target.closest("#account-btn")) $("#account-pop").hidden = true; });

  /* ---------- Пуш-уведомления ---------- */
  const VAPID_PUBLIC = CFG.VAPID_PUBLIC || "";
  function urlB64ToUint8(b) { const p = "=".repeat((4 - (b.length % 4)) % 4); const s = (b + p).replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(s); const a = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function pushSupported() { return ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window); }
  function updateNotifBtn() { const b = $("#notif-btn"); b.hidden = !(pushSupported() && sb && Store.userId); if (b.hidden) return; b.textContent = Notification.permission === "granted" ? "Уведомления включены" : "Включить уведомления"; }
  async function enableNotifications() {
    if (!pushSupported()) { toast("Уведомления не поддерживаются устройством"); return; }
    if (!VAPID_PUBLIC) { toast("Не настроен ключ уведомлений"); return; }
    let perm = Notification.permission; if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Разрешение не выдано"); return; }
    try { const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) }); const j = sub.toJSON(); if (sb && Store.userId) await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: Store.userId, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" }); toast("Уведомления включены"); updateNotifBtn(); } catch { toast("Не удалось включить уведомления"); }
  }
  $("#notif-btn").addEventListener("click", enableNotifications);

  /* ---------- Вход ---------- */
  function authMsg(t, type) { const el = $("#auth-msg"); el.textContent = t || ""; el.classList.toggle("is-error", type === "error"); }
  function trAuthError(msg) {
    const m = (msg || "").toLowerCase();
    if (m.includes("already registered") || m.includes("already been registered") || m.includes("already exists")) return "Аккаунт с такой почтой уже существует";
    if (m.includes("invalid login credentials")) return "Неверная почта или пароль";
    if (m.includes("email not confirmed")) return "Почта не подтверждена — проверьте письмо";
    if (m.includes("password should be at least") || m.includes("password is too short")) return "Пароль слишком короткий (минимум 6 символов)";
    if (m.includes("unable to validate email") || m.includes("invalid email") || m.includes("invalid format")) return "Некорректный e-mail";
    if (m.includes("rate limit") || m.includes("too many") || m.includes("for security purposes")) return "Слишком много попыток, попробуйте позже";
    if (m.includes("failed to fetch") || m.includes("network")) return "Нет связи с сервером";
    return "Не получилось. Проверьте данные и попробуйте снова";
  }
  let hasStarted = false;
  async function startApp() {
    if (hasStarted) return; hasStarted = true;
    $("#auth").hidden = true; $("#app").hidden = false;
    const s = await Store.settings();
    document.documentElement.setAttribute("data-theme", s.theme || "dark");
    await loadStatuses();
    await loadProjects();
    loadFilters(); applyFiltersUI(); renderCardMeta(); showView("tasks");
    // если приложение открыто из пуш-уведомления (?task=<id>) — раскрыть карточку
    const tid = new URLSearchParams(location.search).get("task");
    if (tid) { history.replaceState(null, "", location.pathname); openTaskById(tid); }
  }
  function showAuth() { $("#app").hidden = true; $("#auth").hidden = false; $("#account-pop").hidden = true; $("#auth-forgot").hidden = !HAS_SUPABASE; $("#auth-mode-hint").textContent = HAS_SUPABASE ? "Данные синхронизируются между устройствами." : "Локальный режим: данные хранятся в этом браузере."; $("#auth-google").disabled = !HAS_SUPABASE; }

  if (HAS_SUPABASE) {
    $("#auth-form").addEventListener("submit", async (e) => { e.preventDefault(); authMsg("…"); const { data, error } = await sb.auth.signInWithPassword({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value }); if (error) return authMsg(trAuthError(error.message), "error"); Store.userId = data.user.id; startApp(); });
    $("#auth-signup").addEventListener("click", async () => { authMsg("…"); const email = $("#auth-email").value.trim(); const password = $("#auth-pass").value; if (password.length < 6) return authMsg("Пароль слишком короткий (минимум 6 символов)", "error"); const { data, error } = await sb.auth.signUp({ email, password }); if (error) return authMsg(trAuthError(error.message), "error"); if (data.session) { Store.userId = data.user.id; startApp(); } else authMsg("Проверьте почту для подтверждения регистрации."); });
    $("#auth-google").addEventListener("click", async () => { await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } }); });
    $("#auth-forgot").addEventListener("click", async () => { const email = $("#auth-email").value.trim(); if (!email) return authMsg("Введите e-mail для сброса", "error"); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }); if (error) return authMsg(trAuthError(error.message), "error"); authMsg("Письмо для сброса пароля отправлено на почту", "info"); });
    $("#pw-ok").addEventListener("click", async () => { const p = $("#pw-input").value; const msg = $("#pw-msg"); msg.classList.add("is-error"); if (p.length < 6) { msg.textContent = "Минимум 6 символов"; return; } const { error } = await sb.auth.updateUser({ password: p }); if (error) { msg.textContent = trAuthError(error.message); return; } $("#pw-modal").hidden = true; $("#pw-input").value = ""; msg.textContent = ""; toast("Пароль обновлён"); });
    $("#pw-modal").addEventListener("click", (e) => { if (e.target.id === "pw-modal") $("#pw-modal").hidden = true; });
    sb.auth.onAuthStateChange((event, session) => { if (event === "PASSWORD_RECOVERY") { if (session) { Store.userId = session.user.id; if ($("#app").hidden) startApp(); } $("#pw-modal").hidden = false; setTimeout(() => $("#pw-input").focus(), 60); return; } if (session && $("#app").hidden) { Store.userId = session.user.id; startApp(); } });
    sb.auth.getSession().then(({ data }) => { if (data.session) { if ($("#app").hidden) { Store.userId = data.session.user.id; startApp(); } } else if (!location.hash.includes("access_token")) showAuth(); });
  } else {
    $("#auth-form").addEventListener("submit", (e) => { e.preventDefault(); startApp(); });
    $("#auth-signup").addEventListener("click", startApp);
    startApp();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    // клик по пуш-уведомлению у уже открытого приложения → раскрыть карточку задачи
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open-task") openTaskById(e.data.taskId);
    });
  }
})();
