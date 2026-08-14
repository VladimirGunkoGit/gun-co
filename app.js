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
  const STATUS_PALETTE = ["150,153,163","231,200,106","126,196,232","199,138,74","232,155,184","134,217,152","178,150,232","110,206,197","232,120,120","245,166,110","124,146,236","210,128,196"];
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

  /* Привычки: дефолтные для новых пользователей */
  const DEFAULT_HABITS = [
    { emoji: "📘", name: "Читать", color: STATUS_PALETTE[2] },
    { emoji: "🏓", name: "Спорт", color: STATUS_PALETTE[4] },
    { emoji: "🍏", name: "Диета", color: STATUS_PALETTE[5] },
  ];

  /* Список покупок: дефолтное наполнение для новых пользователей (заметка с подзаголовками + чек-боксами) */
  const DEFAULT_SHOP_HTML = '<div>🥦 Овощи</div><div class="chk" data-checked="0">Огурцы</div><div class="chk" data-checked="0">Помидоры</div><div>🥩 Мясо</div><div class="chk" data-checked="0">Курица</div><div class="chk" data-checked="0">Говядина</div><div>🥖 Бакалея</div><div class="chk" data-checked="0">Макароны</div><div class="chk" data-checked="0">Рис</div><div>🧴 Химия</div><div class="chk" data-checked="0">Губки для посуды</div><div class="chk" data-checked="0">Порошок</div>';

  /* Финансы: дефолтные категории + деньги в целых копейках */
  const DEFAULT_FIN_CATEGORIES = [
    { emoji: "🏠", name: "Жильё", color: STATUS_PALETTE[2] },
    { emoji: "🍏", name: "Продукты", color: STATUS_PALETTE[5] },
    { emoji: "🍽️", name: "Кафе", color: STATUS_PALETTE[9] },
    { emoji: "👕", name: "Покупки", color: STATUS_PALETTE[4] },
    { emoji: "📱", name: "Связь", color: STATUS_PALETTE[7] },
    { emoji: "🎬", name: "Развлечения", color: STATUS_PALETTE[11] },
  ];
  function parseMoney(str) { const n = parseFloat(String(str == null ? "" : str).replace(",", ".").replace(/\s/g, "")); return isNaN(n) ? null : Math.round(n * 100); }
  function fmtMoney(minor) { return (Math.round(minor || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function monthStartISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  function fmtDateLong(iso) { const d = new Date(iso); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; }
  let projectsCache = [];
  function projById(id) { return id ? projectsCache.find((p) => p.id === id) || null : null; }
  function projEmoji(p) { return (p && p.emoji) ? p.emoji : DEFAULT_EMOJI; }
  function projPillInner(p) { return `<span class="proj-emoji">${p ? projEmoji(p) : DEFAULT_EMOJI}</span><span class="proj-name">${p ? esc(p.name) : "проект"}</span>`; }
  function projStatusOf(p) { return p && p.status && statusById("project", p.status) ? p.status : "progress"; }
  const projCmpNewest = (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id).localeCompare(String(a.id));
  // Ручной порядок карточек внутри колонки (перетаскивание). sort==null → в конец, дальше по свежести.
  const projSort = (a, b) => { const as = a.sort == null ? 1e9 : a.sort, bs = b.sort == null ? 1e9 : b.sort; return as - bs || projCmpNewest(a, b); };
  function orderedProjects() {
    const byStatus = {};
    projectsCache.forEach((p) => { const st = projStatusOf(p); (byStatus[st] = byStatus[st] || []).push(p); });
    const out = [];
    statusSet("project").forEach((s) => { const arr = byStatus[s.id]; if (arr) { arr.sort(projSort); out.push(...arr); } });
    return out;
  }
  let _projLoading = null;
  function loadProjects() { if (_projLoading) return _projLoading; _projLoading = Promise.resolve(Store.projects()).then((l) => { projectsCache = l; _projLoading = null; return l; }, (e) => { _projLoading = null; throw e; }); return _projLoading; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- Перетаскивание (мышь + сенсор), анимация расталкивания (FLIP 0.2s) ----------
     Сенсор: удержание 1с берёт элемент; мышь: хватание с порогом 5px. Перетаскиваемый элемент
     поднимается (position:fixed), на его месте — плейсхолдер-зазор; соседи разъезжаются через FLIP. */
  const DRAG = { active: false };
  // Эффективный zoom предков (на десктопе html{zoom:1.25}) — иначе position:fixed из-за zoom «улетает».
  function dndZoom(el) { let z = 1; for (let n = el; n; n = n.parentElement) { const v = getComputedStyle(n).zoom; const f = v && v !== "normal" ? parseFloat(v) : 1; if (f && !isNaN(f)) z *= f; } return z || 1; }
  function makeSortable(root, opts) {
    if (!root) return;
    const itemSel = opts.itemSelector;
    const contSel = opts.containerSelector || null;   // null → root — единственный контейнер
    const axis = opts.axis || "y";                    // 'y' | 'wrap'
    const colSel = opts.columnSelector || null;       // для кросс-колоночного (канбан)
    let st = null;

    const containersOf = () => (contSel ? [...root.querySelectorAll(contSel)].filter((c) => c.getClientRects().length) : [root]);   // скрытые (пустые) колонки — не цели сброса
    const colOf = (cont) => (colSel ? cont.closest(colSel) || cont : cont);

    root.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button > 0) return;
      if (st) return;
      if (opts.ignore && e.target.closest(opts.ignore)) return;
      const item = e.target.closest(itemSel);
      if (!item || !root.contains(item)) return;
      const container = contSel ? item.closest(contSel) : root;
      if (!container) return;
      st = { item, container, pointerId: e.pointerId, pointerType: e.pointerType, startX: e.clientX, startY: e.clientY, dragging: false, holdTimer: null, placeholder: null };
      if (e.pointerType === "touch" || e.pointerType === "pen") st.holdTimer = setTimeout(() => { if (st && !st.dragging) beginDrag(st.startX, st.startY); }, 500);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      document.addEventListener("keydown", onKey, true);
    });

    function onKey(e) { if (e.key === "Escape" && st && st.dragging) { e.preventDefault(); onCancel(); } }

    function onMove(e) {
      if (!st || st.dropping || e.pointerId !== st.pointerId) return;
      const dx = e.clientX - st.startX, dy = e.clientY - st.startY;
      if (!st.dragging) {
        const dist = Math.hypot(dx, dy);
        if (st.pointerType === "mouse") { if (dist > 5) beginDrag(e.clientX, e.clientY); }
        else if (dist > 10 && st.holdTimer) { detach(); return; }   // сдвиг до удержания = скролл/свайп
        if (!st || !st.dragging) return;
      }
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
    }

    function beginDrag(x, y) {
      if (!st || st.dragging) return;
      if (st.holdTimer) { clearTimeout(st.holdTimer); st.holdTimer = null; }
      st.dragging = true; DRAG.active = true; document.body.classList.add("dnd-active");
      st.blockTouch = (ev) => ev.preventDefault();
      window.addEventListener("touchmove", st.blockTouch, { passive: false });
      const item = st.item, r = item.getBoundingClientRect();
      const z = st.zoom = dndZoom(item.parentElement);
      st.grabDX = st.startX - r.left; st.grabDY = st.startY - r.top;
      const ph = document.createElement(item.tagName);
      ph.className = "dnd-ph"; ph.style.width = (r.width / z) + "px"; ph.style.height = (r.height / z) + "px";
      item.parentNode.insertBefore(ph, item);
      st.placeholder = ph; st.origContainer = st.container;
      st.origIndex = [...st.container.children].filter((c) => c !== item && c.matches(itemSel)).indexOf(ph); // фиктивно; для отмены пересчитаем
      st.origRef = item.nextSibling;
      Object.assign(item.style, { position: "fixed", margin: "0", width: (r.width / z) + "px", height: (r.height / z) + "px", left: (r.left / z) + "px", top: (r.top / z) + "px", zIndex: "2000", pointerEvents: "none" });
      item.classList.add("dnd-dragging");
      st.lastCont = st.container;
      moveDrag(x, y);
    }

    function moveDrag(x, y) {
      const item = st.item, z = st.zoom;
      item.style.left = ((x - st.grabDX) / z) + "px";
      item.style.top = ((y - st.grabDY) / z) + "px";
      let cont = st.container;
      if (contSel) {
        const conts = containersOf();
        let inside = null, nearest = null, nd = Infinity;
        for (const c of conts) {
          const cr = colOf(c).getBoundingClientRect();
          if (x >= cr.left && x <= cr.right) { inside = c; break; }
          const d = x < cr.left ? cr.left - x : x - cr.right;
          if (d < nd) { nd = d; nearest = c; }
        }
        cont = inside || nearest || st.container;
      }
      placePlaceholder(cont, insertIndex(cont, x, y));
      st.lastCont = cont;
    }

    function insertIndex(cont, x, y) {
      const items = [...cont.children].filter((c) => c !== st.item && c !== st.placeholder && c.matches(itemSel));
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (axis === "y") { if (y < r.top + r.height / 2) return i; }
        else { if (y < r.top) return i; if (y < r.bottom && x < r.left + r.width / 2) return i; }
      }
      return items.length;
    }

    function placePlaceholder(cont, idx) {
      const ph = st.placeholder;
      const items = [...cont.children].filter((c) => c !== st.item && c !== ph && c.matches(itemSel));
      const ref = items[idx] || null;
      if (ph.parentNode === cont && ph.nextSibling === ref) return;
      const affected = new Set([...cont.children]); if (ph.parentNode) [...ph.parentNode.children].forEach((c) => affected.add(c));
      const rects = new Map(); affected.forEach((el) => { if (el !== st.item && el !== ph) rects.set(el, el.getBoundingClientRect()); });
      cont.insertBefore(ph, ref);
      rects.forEach((first, el) => {
        if (!el.isConnected) return;
        const last = el.getBoundingClientRect(); const z = st.zoom; const ddx = (first.left - last.left) / z, ddy = (first.top - last.top) / z;
        if (ddx || ddy) { el.style.transition = "none"; el.style.transform = `translate(${ddx}px,${ddy}px)`; el.getBoundingClientRect(); el.style.transition = "transform .2s ease"; el.style.transform = ""; }
      });
    }

    function onUp(e) { if (!st || st.dropping || e.pointerId !== st.pointerId) return; if (!st.dragging) { detach(); return; } finishDrop(false); }
    function onCancel(e) { if (!st || st.dropping || e.pointerId !== st.pointerId) return; if (!st.dragging) { detach(); return; } st.lastCont = st.origContainer; st.origContainer.insertBefore(st.placeholder, st.origRef); finishDrop(true); }

    function finishDrop(cancelled) {
      st.dropping = true;
      const item = st.item, ph = st.placeholder, cont = st.lastCont, orig = st.origContainer;
      // погасить клик, который иначе откроет карточку/выберет статус после drag
      const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", kill, true); setTimeout(() => document.removeEventListener("click", kill, true), 350);
      const pr = ph.getBoundingClientRect(), z = st.zoom;
      item.style.transition = "left .2s ease, top .2s ease";
      item.style.left = (pr.left / z) + "px"; item.style.top = (pr.top / z) + "px";
      setTimeout(() => {
        cont.insertBefore(item, ph); ph.remove();
        item.classList.remove("dnd-dragging");
        ["position", "margin", "width", "height", "left", "top", "zIndex", "pointerEvents", "transition", "transform"].forEach((k) => (item.style[k] = ""));
        const items = [...cont.children].filter((c) => c.matches(itemSel));
        const detail = { item, itemId: item.dataset.id || item.dataset.k, fromContainer: orig, toContainer: cont, newIndex: items.indexOf(item), orderedIds: items.map((x) => x.dataset.id || x.dataset.k) };
        endGesture();
        if (!cancelled && opts.onDrop) opts.onDrop(detail);
      }, 205);
    }

    function endGesture() { detach(); document.body.classList.remove("dnd-active"); DRAG.active = false; if (opts.onEnd) opts.onEnd(); }
    function detach() {
      if (st && st.holdTimer) clearTimeout(st.holdTimer);
      if (st && st.blockTouch) window.removeEventListener("touchmove", st.blockTouch);
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); document.removeEventListener("keydown", onKey, true);
      st = null;
    }
  }

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
      if (!d.habitsV1) { if (!d.habits || !d.habits.length) { d.habits = DEFAULT_HABITS.map((h) => ({ id: uid(), created_at: new Date().toISOString(), emoji: h.emoji, name: h.name, color: h.color, progress: 0, week: null })); } d.habitsV1 = true; }
      d.habits = d.habits || [];
      d.finTx = d.finTx || [];
      if (!d.finCatV1) { d.finCategories = DEFAULT_FIN_CATEGORIES.map((c, i) => ({ id: uid(), created_at: new Date().toISOString(), emoji: c.emoji, name: c.name, color: c.color, sort: i })); d.finCatV1 = true; }
      d.finCategories = d.finCategories || [];
      if (!d.statusesV1) { d.taskStatuses = seedStatuses(); d.projectStatuses = seedStatuses(); d.statusesV1 = true; }
      d.taskStatuses = d.taskStatuses || seedStatuses();
      d.projectStatuses = d.projectStatuses || seedStatuses();
      d.settings = d.settings || { theme: "dark", count: 5 };
      if (!d.shopV1) { d.shopList = DEFAULT_SHOP_HTML; d.shopV1 = true; }
      d.shopList = d.shopList || "";
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
    async addProject({ emoji, name, status, start_date, end_date, description, sort }) {
      const base = { emoji: emoji || null, name: name || "", status: status || "progress", start_date: start_date || null, end_date: end_date || null, description: description || null, sort: sort == null ? null : sort };
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
    async habits() {
      if (sb && this.userId) {
        const { data } = await sb.from("habits").select("*").eq("user_id", this.userId).order("created_at");
        if (!data || !data.length) { const created = []; for (const h of DEFAULT_HABITS) { const row = await this.addHabit(h); if (row) created.push(row); } return created; }
        return data;
      }
      return Local.ensure().habits.slice();
    },
    async addHabit({ emoji, name, color }) {
      const base = { emoji: emoji || null, name: name || "", color: color || null, progress: 0, week: null };
      if (sb && this.userId) { const { data } = await sb.from("habits").insert({ ...base, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), created_at: new Date().toISOString(), ...base }; d.habits.push(row); Local.write(d); return row;
    },
    async updateHabit(id, fields) {
      if (sb && this.userId) { await sb.from("habits").update(fields).eq("id", id); return; }
      const d = Local.ensure(); const h = d.habits.find((x) => x.id === id); if (h) Object.assign(h, fields); Local.write(d);
    },
    async deleteHabit(id) {
      if (sb && this.userId) { await sb.from("habits").delete().eq("id", id); return; }
      const d = Local.ensure(); d.habits = d.habits.filter((x) => x.id !== id); Local.write(d);
    },
    /* Финансы */
    async finCategories() {
      if (sb && this.userId) {
        const { data } = await sb.from("fin_categories").select("*").eq("user_id", this.userId).order("sort");
        if (!data || !data.length) { const created = []; for (let i = 0; i < DEFAULT_FIN_CATEGORIES.length; i++) { const c = DEFAULT_FIN_CATEGORIES[i]; const row = await this.addFinCategory({ ...c, sort: i }); if (row) created.push(row); } return created; }
        return data;
      }
      return Local.ensure().finCategories.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    },
    async addFinCategory({ emoji, name, color, sort }) {
      const base = { emoji: emoji || null, name: name || "", color: color || null, sort: sort == null ? 0 : sort };
      if (sb && this.userId) { const { data } = await sb.from("fin_categories").insert({ ...base, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), created_at: new Date().toISOString(), ...base }; d.finCategories.push(row); Local.write(d); return row;
    },
    async updateFinCategory(id, fields) {
      if (sb && this.userId) { await sb.from("fin_categories").update(fields).eq("id", id); return; }
      const d = Local.ensure(); const c = d.finCategories.find((x) => x.id === id); if (c) Object.assign(c, fields); Local.write(d);
    },
    async deleteFinCategory(id) {
      if (sb && this.userId) { await sb.from("fin_tx").update({ category_id: null }).eq("category_id", id); await sb.from("fin_categories").delete().eq("id", id); return; }
      const d = Local.ensure(); d.finTx.forEach((t) => { if (t.category_id === id) t.category_id = null; }); d.finCategories = d.finCategories.filter((x) => x.id !== id); Local.write(d);
    },
    async finTx(fromISO, toISO) {
      if (sb && this.userId) { const { data } = await sb.from("fin_tx").select("*").eq("user_id", this.userId).gte("created_at", fromISO).lte("created_at", toISO); return data || []; }
      return Local.ensure().finTx.filter((t) => t.created_at >= fromISO && t.created_at <= toISO);
    },
    async addFinTx({ kind, amount_minor, category_id, note }) {
      const base = { kind: kind || "expense", amount_minor: Math.round(amount_minor || 0), category_id: category_id || null, note: (note && note.trim()) || null };
      if (sb && this.userId) { const { data } = await sb.from("fin_tx").insert({ ...base, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), created_at: new Date().toISOString(), ...base }; d.finTx.push(row); Local.write(d); return row;
    },
    async deleteFinTx(id) {
      if (sb && this.userId) { await sb.from("fin_tx").delete().eq("id", id); return; }
      const d = Local.ensure(); d.finTx = d.finTx.filter((x) => x.id !== id); Local.write(d);
    },
    async updateFinTx(id, fields) {
      if (sb && this.userId) { await sb.from("fin_tx").update(fields).eq("id", id); return; }
      const d = Local.ensure(); const t = d.finTx.find((x) => x.id === id); if (t) Object.assign(t, fields); Local.write(d);
    },
    async shopList() {
      if (sb && this.userId) { const { data } = await sb.from("shop_list").select("body").eq("user_id", this.userId).maybeSingle(); return data ? data.body : null; }
      return Local.ensure().shopList;
    },
    async saveShopList(body) {
      if (sb && this.userId) { await sb.from("shop_list").upsert({ user_id: this.userId, body, updated_at: new Date().toISOString() }); return; }
      const d = Local.ensure(); d.shopList = body; Local.write(d);
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
    $("#cal-clear").hidden = !allowAll; renderCal(); $("#cal").hidden = false;
  }
  function renderCal() { drawCal({ y: cal.y, m: cal.m, value: cal.value }, $("#cal-grid"), $("#cal-title"), (d) => { $("#cal").hidden = true; cal.onPick && cal.onPick(d); }); }
  function calPrev() { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); }
  function calNext() { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); }
  $("#cal-prev").addEventListener("click", calPrev);
  $("#cal-next").addEventListener("click", calNext);
  (function () { const g = $("#cal-grid"); let sx = 0, sy = 0, on = false; g.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true }); g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? calNext() : calPrev()); }, { passive: true }); })();
  $("#cal-cancel").addEventListener("click", () => ($("#cal").hidden = true));
  $("#cal-clear").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(""); });
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
  $("#dt-cal-clear").addEventListener("click", () => { dt.date = ""; drawDtCal(); });
  $("#dt-time-clear").addEventListener("click", () => { $("#dt-time").value = ""; });

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
  // Перетаскивание статусов = смена порядка (ord). Для проектов это = порядок колонок канбана.
  async function persistStatusOrder(kind, orderedIds) {
    const set = statusSet(kind); const changed = [];
    orderedIds.forEach((id, i) => { const s = set.find((x) => x.id === id); if (s && s.ord !== i) { s.ord = i; changed.push({ id, ord: i }); } });
    set.sort(byOrd);
    for (const c of changed) await Store.updateStatus(kind, c.id, { ord: c.ord });
    if (kind === "project" && currentView === "projects") renderKanban();
  }
  makeSortable($("#status-list"), { itemSelector: ".status-pill", axis: "wrap", ignore: ".status-del", onDrop: (d) => persistStatusOrder(statusPickKind, d.orderedIds) });

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

  /* ---------- Чек-листы и нумерованные списки в contenteditable ---------- */
  const CHK_TRIG = /^\[\]\s/;
  const NUM_TRIG = /^(\d+)\.\s/;   // «N. » в начале строки → нумерованный список
  function initChecklist(el) {
    el.addEventListener("beforeinput", (e) => {
      if (e.inputType !== "insertParagraph") return;
      const blk = currentBlock(el); if (!blk) return;
      const isChk = blk.classList.contains("chk"), isNum = blk.classList.contains("num");
      if (!isChk && !isNum) return;
      e.preventDefault();
      if (!blk.textContent.trim()) {
        // пустой пункт + Enter → выйти из списка: обычная строка без отступа
        blk.className = ""; blk.removeAttribute("data-checked"); blk.removeAttribute("data-num");
        blk.innerHTML = "<br>"; placeCaretAtStart(blk); return;
      }
      // есть текст → продолжить список новым пунктом
      const nl = document.createElement("div");
      if (isChk) makeChk(nl, "", false);
      else makeNum(nl, "", (parseInt(blk.getAttribute("data-num") || "0", 10) || 0) + 1);
      blk.after(nl); placeCaretAtStart(nl);
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
    blk.removeAttribute("data-num");
    blk.textContent = rest || "";
  }
  function makeNum(blk, rest, num) {
    blk.className = "num"; blk.setAttribute("data-num", String(num || 1)); blk.removeAttribute("data-checked");
    blk.textContent = rest || "";
  }
  function maybeMakeChecklist(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const blk = currentBlock(el);
    if (blk) {
      if (blk.classList.contains("chk") || blk.classList.contains("num")) return;
      const txt = blk.textContent; let m;
      if (CHK_TRIG.test(txt)) { makeChk(blk, txt.replace(CHK_TRIG, ""), false); placeCaretEnd(blk); }
      else if ((m = txt.match(NUM_TRIG))) { makeNum(blk, txt.replace(NUM_TRIG, ""), parseInt(m[1], 10)); placeCaretEnd(blk); }
    } else {
      const node = sel.anchorNode;
      if (node && node.nodeType === 3 && node.parentNode === el) {
        const tx = node.textContent; let m;
        if (CHK_TRIG.test(tx)) { const div = document.createElement("div"); el.insertBefore(div, node); const rest = tx.replace(CHK_TRIG, ""); node.remove(); makeChk(div, rest, false); placeCaretEnd(div); }
        else if ((m = tx.match(NUM_TRIG))) { const div = document.createElement("div"); el.insertBefore(div, node); const rest = tx.replace(NUM_TRIG, ""); node.remove(); makeNum(div, rest, parseInt(m[1], 10)); placeCaretEnd(div); }
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
      const isNum = n.tagName === "DIV" && n.classList.contains("num");
      [...n.attributes].forEach((a) => {
        const keep = (n.tagName === "A" && a.name === "href") || (isChk && (a.name === "data-checked" || a.name === "class")) || (isNum && (a.name === "data-num" || a.name === "class"));
        if (!keep) n.removeAttribute(a.name);
      });
      if (n.tagName === "A") { let h = (n.getAttribute("href") || "").trim(); if (h && !/^(https?:|mailto:)/i.test(h)) h = "https://" + h.replace(/^\/+/, ""); if (h) { n.setAttribute("href", h); n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); } else { while (n.firstChild) root.insertBefore(n.firstChild, n); n.remove(); } }
    });
  }
  function sanitizeHTML(html) { const t = document.createElement("div"); t.innerHTML = html || ""; sanitizeNode(t); return t.innerHTML; }
  function descSerialize(el) {
    const html = sanitizeHTML(el.innerHTML);
    const t = document.createElement("div"); t.innerHTML = html;
    if (!t.textContent.trim() && !t.querySelector(".chk, .num")) return "";
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
  let filtersOpen = false;   // фильтры на странице задач скрыты по умолчанию (не сохраняется между запусками)
  const PAGE_TITLES = { tasks: "задачи", projects: "проекты", notes: "заметки", finance: "финансы", habits: "привычки" };
  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    const isForm = name === "task" || name === "project" || name === "note";
    const isSub = name === "fincat" || name === "shop";   // под-страница: назад + свой заголовок, без нижнего меню
    $("#back-btn").hidden = !(isForm || isSub);
    $("#page-title").hidden = isForm;
    if (name === "fincat") $("#page-title").textContent = finCatViewTitle;
    else if (name === "shop") $("#page-title").textContent = "🛒 список покупок";
    else if (!isForm) $("#page-title").textContent = PAGE_TITLES[name] || "";
    $("#filter-toggle").hidden = name !== "tasks";
    if (name === "tasks") $("#task-filters").hidden = !filtersOpen;
    $("#page-nav").hidden = isForm || isSub;
    $("#fab").hidden = !(name === "tasks" || name === "projects" || name === "notes" || name === "habits" || name === "finance" || name === "fincat");
    if (!isForm && !isSub) { let activeItem = null; $$("#page-nav .nav-item").forEach((b) => { const on = b.dataset.view === name; b.classList.toggle("active", on); if (on) activeItem = b; }); if (activeItem) requestAnimationFrame(() => activeItem.scrollIntoView({ inline: "nearest", block: "nearest" })); }
    if (name === "tasks") renderTasks();
    else if (name === "projects") renderKanban();
    else if (name === "project") renderProjectTasks();
    else if (name === "notes") renderNotes();
    else if (name === "habits") renderHabits();
    else if (name === "finance") renderFinance();
    else if (name === "fincat") renderFinCatPage();
    else if (name === "shop") renderShop();
  }
  $$("#page-nav .nav-item").forEach((b) => b.addEventListener("click", () => { if (currentView !== b.dataset.view) showView(b.dataset.view); }));
  $("#filter-toggle").addEventListener("click", () => { filtersOpen = !filtersOpen; $("#task-filters").hidden = !filtersOpen; });
  function goBack() {
    const m = $$(".modal").find((x) => !x.hidden); if (m) { m.hidden = true; return; }
    if (currentView === "task") { leaveTask(); return; }
    if (currentView === "project") { leaveProject(); return; }
    if (currentView === "note") { leaveNote(); return; }
    if (currentView === "fincat") { showView("finance"); return; }
    if (currentView === "shop") { saveShop(); showView("finance"); return; }
  }
  $("#back-btn").addEventListener("click", goBack);
  $("#brand-home").addEventListener("click", () => showView("tasks"));
  $("#fab").addEventListener("click", () => { if (currentView === "projects") newProject(); else if (currentView === "notes") newNote(); else if (currentView === "habits") newHabit(); else if (currentView === "finance") openFinTx(); else if (currentView === "fincat") { finCatViewId === "__income__" ? openFinTx({ incomeOnly: true }) : openFinTx({ preCat: finCatViewId }); } else newTask(); });
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
    const projCell = opts.showProjectPill ? `<span class="proj-pill task-proj ${p ? "" : "is-empty"}" data-act="project"><span class="proj-emoji">${p ? projEmoji(p) : DEFAULT_EMOJI}</span></span>` : "";
    const dateCell = opts.showDate ? `<button class="task-date" data-act="time">${t.due_date ? dayHead(t.due_date.slice(0, 10)) : "—"}</button>` : "";
    return `<div class="task swipeable" data-id="${t.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row">
        <button class="row-status" data-act="status" aria-label="Статус">${statusDot("task", st, true)}</button>
        <span class="task-title">${esc(t.title)}</span>
        ${projCell}${dateCell}
        <button class="task-time" data-act="time">${t.notify ? `<span class="task-bell">${BELL_ON}</span>` : ""}${t.due_time ? esc(t.due_time) : ""}</button>
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
  // Уведомление: включено + есть дата → в это время; без времени → в 11:00; без даты → нет.
  function computeRemindAt(date, time, notify) { if (!(notify && date)) return null; const d = new Date(`${date}T${time || "11:00"}:00`); return isNaN(d) ? null : d.toISOString(); }
  async function updateTaskDateTime(id, date, time, notify) { const remind_at = computeRemindAt(date, time, notify); await Store.updateTask(id, { due_date: date || null, due_time: time || null, notify, remind_at, notified: false }); }

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
  makeSortable($("#statusfilter-list"), { itemSelector: ".status-pill", axis: "wrap", ignore: ".status-del", onDrop: (d) => persistStatusOrder("task", d.orderedIds) });
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
    const remind_at = computeRemindAt(cardDate, cardTime, cardNotify);
    return { title: $("#t-title").textContent.trim(), description: descSerialize($("#t-desc")), due_date: cardDate || null, due_time: cardTime || null, notify: cardNotify, project_id: cardProjectId || null, status: cardStatus, is_done: statusIsDone("task", cardStatus), remind_at, notified: false };
  }
  async function saveTaskDraft() { if (editingTaskId) await Store.updateTask(editingTaskId, taskFields()); }
  const saveTaskDebounced = debounce(saveTaskDraft, 400);
  $("#t-date").addEventListener("click", () => openCalendar({ value: cardDate, allowAll: true, clearLabel: "очистить дату", onPick: (v) => { cardDate = v; taskTouched = true; renderCardMeta(); saveTaskDraft(); } }));
  $("#t-time").addEventListener("input", (e) => { cardTime = e.target.value; taskTouched = true; saveTaskDraft(); });
  $("#t-time-clear").addEventListener("click", () => { cardTime = ""; $("#t-time").value = ""; taskTouched = true; saveTaskDraft(); });
  $("#t-notify").addEventListener("click", () => { cardNotify = !cardNotify; taskTouched = true; renderCardMeta(); saveTaskDraft(); });
  $("#t-status").addEventListener("click", () => openStatusPicker("task", cardStatus, (k) => { cardStatus = k; taskTouched = true; renderCardMeta(); saveTaskDraft(); }));
  $("#t-project").addEventListener("click", () => openProjectPicker(cardProjectId, (id) => { cardProjectId = id; taskTouched = true; renderCardMeta(); saveTaskDraft(); }));
  $("#t-title").addEventListener("input", () => { taskTouched = true; saveTaskDebounced(); });
  $("#t-desc").addEventListener("input", () => { taskTouched = true; saveTaskDebounced(); });
  initChecklist($("#t-desc")); initFormatting($("#t-desc"));

  async function newTask(opts) {
    opts = opts || {};
    await loadProjects();
    const firstProj = orderedProjects()[0];
    cardDate = tomorrowStr(); cardTime = ""; cardNotify = false; cardStatus = "progress"; cardProjectId = opts.projectId || (firstProj ? firstProj.id : null); taskTouched = false; editReturn = opts.returnView || "tasks";
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
    if (!projectsCache.length) { $("#kanban").innerHTML = `<p class="empty kb-empty">нет проектов — создай первый по +</p>`; return; }
    const byStatus = {};
    projectsCache.forEach((p) => { const st = projStatusOf(p); (byStatus[st] = byStatus[st] || []).push(p); });
    Object.values(byStatus).forEach((arr) => arr.sort(projSort));
    // все колонки статусов проектов; пустые скрыты классом (показываются при перетаскивании как зоны сброса)
    let html = "";
    statusSet("project").forEach((s) => { const arr = byStatus[s.id] || []; html += `<div class="kb-col${arr.length ? "" : " kb-col--empty"}" data-status="${s.id}"><div class="kb-col-head">${statusDot("project", s.id)}<span>${esc(s.name)}</span></div><div class="kb-cards scroll">${arr.map((p) => kanbanCard(p, tasks)).join("")}</div></div>`; });
    $("#kanban").innerHTML = html;
  }
  $("#kanban").addEventListener("click", (e) => {
    const card = e.target.closest(".kb-card"); if (!card) return; const p = projById(card.dataset.id); if (!p) return;
    openProjectEdit(p);
  });
  // Перетаскивание карточек проектов: реордер внутри колонки + перенос между колонками (смена статуса)
  makeSortable($("#kanban"), {
    itemSelector: ".kb-card", containerSelector: ".kb-cards", columnSelector: ".kb-col", axis: "y",
    onDrop: (d) => onKanbanDrop(d),
  });
  async function onKanbanDrop(d) {
    const proj = projById(d.itemId); if (!proj) return;
    const toCol = d.toContainer.closest(".kb-col"), fromCol = d.fromContainer.closest(".kb-col");
    const toStatus = toCol && toCol.dataset.status; if (!toStatus) return;
    const statusChanged = projStatusOf(proj) !== toStatus;
    const updates = [];
    const renumber = (colEl) => { if (!colEl) return; [...colEl.querySelectorAll(".kb-card")].forEach((c, i) => { const p = projById(c.dataset.id); if (!p) return; const patch = {}; if (p.sort !== i) { p.sort = i; patch.sort = i; } if (p === proj && statusChanged) { p.status = toStatus; patch.status = toStatus; } if (Object.keys(patch).length) updates.push({ id: p.id, patch }); }); };
    renumber(toCol); if (fromCol && fromCol !== toCol) renumber(fromCol);
    // пустые колонки снова скрыть
    $$("#kanban .kb-col").forEach((c) => c.classList.toggle("kb-col--empty", !c.querySelector(".kb-card")));
    for (const u of updates) await Store.updateProject(u.id, u.patch);
  }

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
    const minSort = projectsCache.filter((p) => projStatusOf(p) === "progress").reduce((m, p) => Math.min(m, p.sort == null ? 0 : p.sort), 0) - 1;
    const draft = await Store.addProject({ ...projectFields(), sort: minSort }); editingProjectId = draft.id;
    if (draft.sort == null) draft.sort = minSort;
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

  /* ---------- ПРИВЫЧКИ ---------- */
  // Неделя пн→вс; сброс в вс 23:59 = ключ недели (понедельник). Прогресс «сгорает» в новой неделе.
  function habitWeek() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function habitProgress(h) { return h.week === habitWeek() ? Math.max(0, Math.min(7, h.progress || 0)) : 0; }
  let habitsById = {};
  function habitRow(h) {
    const eff = habitProgress(h); let cells = "";
    for (let i = 0; i < 7; i++) cells += `<span class="hb-cell${i < eff ? " on" : ""}"></span>`;
    return `<div class="habit swipeable" data-id="${h.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row habit-row">
        <div class="hb-title"><span class="hb-emoji">${h.emoji || DEFAULT_EMOJI}</span><span class="hb-name">${esc(h.name || "")}</span></div>
        <div class="hb-bar" style="--c:${h.color || STATUS_PALETTE[0]}">${cells}</div>
      </div>
    </div>`;
  }
  async function renderHabits() {
    const habits = await Store.habits();
    habitsById = {}; habits.forEach((h) => (habitsById[h.id] = h));
    $("#habits-empty").hidden = habits.length > 0;
    $("#habit-list").innerHTML = habits.map(habitRow).join("");
    $$("#habit-list .habit").forEach((el) => attachSwipe(el, async () => { await Store.deleteHabit(el.dataset.id); renderHabits(); }));
  }
  $("#habit-list").addEventListener("click", async (e) => {
    if (justSwiped) return;
    const bar = e.target.closest(".hb-bar"); if (!bar) return;   // тап по заголовку — ничего
    const row = bar.closest(".habit"); const h = habitsById[row.dataset.id]; if (!h) return;
    const next = habitProgress(h) >= 7 ? 0 : habitProgress(h) + 1;
    h.progress = next; h.week = habitWeek();
    [...bar.querySelectorAll(".hb-cell")].forEach((c, i) => c.classList.toggle("on", i < next));
    await Store.updateHabit(h.id, { progress: next, week: h.week });
  });

  /* Создание Привычки */
  let habitFormEmoji = "", habitFormColor = STATUS_PALETTE[0];
  function renderHabitFormEmoji() { $("#habit-emoji").textContent = habitFormEmoji || DEFAULT_EMOJI; $("#habit-emoji").classList.toggle("is-empty", !habitFormEmoji); }
  function renderHabitSwatches() {
    $("#habit-swatches").innerHTML = STATUS_PALETTE.map((c) => `<button type="button" class="swatch ${c === habitFormColor ? "is-cur" : ""}" data-c="${c}" style="--c:${c}"><span class="status-dot"></span></button>`).join("");
    $$("#habit-swatches .swatch").forEach((b) => b.addEventListener("click", () => { habitFormColor = b.dataset.c; renderHabitSwatches(); }));
  }
  $("#habit-emoji").addEventListener("click", () => openEmojiModal(habitFormEmoji, (em) => { habitFormEmoji = em; renderHabitFormEmoji(); }));
  function newHabit() { habitFormEmoji = ""; habitFormColor = STATUS_PALETTE[0]; renderHabitFormEmoji(); renderHabitSwatches(); $("#habit-name").value = ""; $("#habit-modal").hidden = false; setTimeout(() => $("#habit-name").focus(), 30); }
  $("#habit-ok").addEventListener("click", async () => {
    const name = ($("#habit-name").value || "").trim(); if (!name) { $("#habit-name").focus(); return; }
    await Store.addHabit({ emoji: habitFormEmoji, name, color: habitFormColor });
    $("#habit-modal").hidden = true; renderHabits();
  });
  $("#habit-cancel").addEventListener("click", () => ($("#habit-modal").hidden = true));
  $("#habit-modal").addEventListener("click", (e) => { if (e.target.id === "habit-modal") $("#habit-modal").hidden = true; });

  /* ---------- ФИНАНСЫ ---------- */
  let finPeriod = { mode: "month" };   // month | range {from,to,label}. Общий для главной и страницы категории. Не сохраняется между запусками
  let finSort = false;                 // сортировка категорий по сумме (главная)
  let finCatSort = false;              // сортировка операций по сумме (страница категории)
  let finCatViewId = null, finCatViewTitle = "финансы";
  let finCatsCache = [];
  let finCatPageTx = [];                // операции, отрисованные на странице категории (для тапа→редактирование)
  function finRange() { return finPeriod.mode === "range" ? { from: finPeriod.from, to: finPeriod.to } : { from: monthStartISO(), to: new Date().toISOString() }; }
  function renderCurrentFin() { if (currentView === "fincat") renderFinCatPage(); else renderFinance(); }
  function syncFinFilters() {
    const label = finPeriod.mode === "range" ? (finPeriod.label || "") : "";
    ["#fin-range-label", "#fincat-range-label"].forEach((id) => { const el = $(id); if (el) el.textContent = label; });
    ["#fin-range", "#fincat-range"].forEach((id) => { const el = $(id); if (el) el.classList.toggle("chip--ico", finPeriod.mode !== "range"); });
    ["#fin-month", "#fincat-month"].forEach((id) => { const el = $(id); if (el) el.classList.toggle("is-on", finPeriod.mode === "month"); });
    ["#fin-range", "#fincat-range"].forEach((id) => { const el = $(id); if (el) el.classList.toggle("is-on", finPeriod.mode === "range"); });
  }
  function finSetMonth() { finPeriod = { mode: "month" }; syncFinFilters(); renderCurrentFin(); }
  // Одноразовая чистка: убрать дефолтные «Машина»/«Транспорт» (в т.ч. с уже созданных аккаунтов)
  async function cleanupDefaultCats() {
    try {
      if (localStorage.getItem("gunco_fincat_rm_v1")) return;
      const cats = await Store.finCategories();
      const rm = cats.filter((c) => (c.name === "Машина" && c.emoji === "🚗") || (c.name === "Транспорт" && c.emoji === "🚌"));
      for (const c of rm) await Store.deleteFinCategory(c.id);
      localStorage.setItem("gunco_fincat_rm_v1", "1");
    } catch (e) {}
  }
  async function renderFinance() {
    await cleanupDefaultCats();
    const cats = await Store.finCategories(); finCatsCache = cats;
    const { from, to } = finRange();
    const tx = await Store.finTx(from, to);
    const catSum = {}; let totalExp = 0, totalInc = 0;
    tx.forEach((t) => { const a = Math.round(t.amount_minor || 0); if (t.kind === "income") totalInc += a; else { totalExp += a; if (t.category_id) catSum[t.category_id] = (catSum[t.category_id] || 0) + a; } });
    let rows = cats.map((c) => ({ c, sum: catSum[c.id] || 0 }));
    if (finSort) rows = rows.slice().sort((a, b) => b.sum - a.sum);
    const maxSum = rows.reduce((m, r) => Math.max(m, r.sum), 0);
    $("#fin-list").innerHTML = rows.map((r) => {
      const pct = maxSum > 0 ? (r.sum / maxSum * 100) : 0;
      return `<div class="fin-row fin-cat" data-id="${r.c.id}">
        <div class="fin-title"><span class="fin-emoji">${r.c.emoji || DEFAULT_EMOJI}</span><span class="fin-name">${esc(r.c.name)}</span></div>
        <div class="fin-bar-wrap"><div class="fin-bar" style="width:${pct.toFixed(3)}%; background:rgba(${r.c.color || STATUS_PALETTE[0]}, .6)"></div></div>
        <span class="fin-cat-sum">${fmtMoney(r.sum)}</span>
      </div>`;
    }).join("");
    $("#fin-total-sum").textContent = fmtMoney(totalExp);
    $("#fin-income-sum").textContent = fmtMoney(totalInc);
    syncFinFilters();
    $("#fin-sort").classList.toggle("is-on", finSort);
    // иконка сортировки: активна — по убыванию (длинная-средняя-короткая); дефолт — «случайный» порядок
    const sp = $("#fin-sort svg path"); if (sp) sp.setAttribute("d", finSort ? "M4 6h16M4 12h11M4 18h6" : "M4 6h16M4 12h6M4 18h11");
  }
  $("#fin-month").addEventListener("click", finSetMonth);
  $("#fin-sort").addEventListener("click", () => { finSort = !finSort; renderFinance(); });
  // тап по строке категории/доходам → страница со списком операций (не создание)
  $("#fin-income").addEventListener("click", () => openFinCatPage("__income__"));
  $("#fin-list").addEventListener("click", (e) => { const row = e.target.closest(".fin-cat"); if (!row) return; openFinCatPage(row.dataset.id); });

  /* Страница категории: список операций (дата + сумма), свайп-удаление, свой фильтр периода */
  async function openFinCatPage(id) {
    finCatViewId = id; finCatSort = false;
    if (id === "__income__") finCatViewTitle = "доходы";
    else { const cats = await Store.finCategories(); const c = cats.find((x) => x.id === id); finCatViewTitle = c ? c.name : "категория"; }
    showView("fincat");
  }
  async function renderFinCatPage() {
    const { from, to } = finRange();
    const tx = await Store.finTx(from, to);
    const isIncome = finCatViewId === "__income__";
    let list = tx.filter((t) => (isIncome ? t.kind === "income" : (t.kind !== "income" && t.category_id === finCatViewId)));
    list = list.slice().sort(finCatSort ? (a, b) => (b.amount_minor || 0) - (a.amount_minor || 0) : (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    $("#fincat-empty").hidden = list.length > 0;
    $("#fincat-list").innerHTML = list.map((t) => `<div class="fincat-row swipeable" data-id="${t.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row fincat-txrow"><button class="fincat-del" data-act="del" type="button" aria-label="Удалить">${TRASH_SVG}</button><span class="fincat-date">${fmtDateLong(t.created_at)}</span><span class="fincat-note">${esc(t.note || "")}</span><span class="fincat-amount">${fmtMoney(t.amount_minor)}</span></div>
    </div>`).join("");
    finCatPageTx = list;
    $$("#fincat-list .fincat-row").forEach((el) => attachSwipe(el, async () => { await Store.deleteFinTx(el.dataset.id); renderFinCatPage(); }));
    syncFinFilters();
    $("#fincat-sort").classList.toggle("is-on", finCatSort);
    const sp = $("#fincat-sort svg path"); if (sp) sp.setAttribute("d", finCatSort ? "M4 6h16M4 12h11M4 18h6" : "M4 6h16M4 12h6M4 18h11");
  }
  $("#fincat-month").addEventListener("click", finSetMonth);
  $("#fincat-range").addEventListener("click", () => openFinRange());
  $("#fincat-sort").addEventListener("click", () => { finCatSort = !finCatSort; renderFinCatPage(); });
  // Тап по корзинке слева → удалить трату (моб.+комп); тап по строке → редактирование (то же окно, что и создание)
  $("#fincat-list").addEventListener("click", async (e) => {
    if (justSwiped) return;
    const row = e.target.closest(".fincat-row"); if (!row) return; const id = row.dataset.id;
    if (e.target.closest(".fincat-del")) { if (!(await askConfirm("Удалить трату?"))) return; await Store.deleteFinTx(id); renderFinCatPage(); return; }
    const tx = finCatPageTx.find((t) => t.id === id); if (tx) openFinTx({ edit: tx });
  });

  /* ---------- Список покупок (страница-заметка с автосохранением) ---------- */
  let shopInited = false, shopSaveTimer = null;
  async function renderShop() {
    const body = $("#shop-body");
    const html = await Store.shopList();
    descLoad(body, html || DEFAULT_SHOP_HTML);
    if (!shopInited) {
      shopInited = true;
      initChecklist(body); initFormatting(body);
      body.addEventListener("input", scheduleShopSave);
      body.addEventListener("click", (e) => { if (e.target.closest(".chk")) scheduleShopSave(); });
    }
  }
  function scheduleShopSave() { clearTimeout(shopSaveTimer); shopSaveTimer = setTimeout(saveShop, 400); }
  async function saveShop() { clearTimeout(shopSaveTimer); await Store.saveShopList(descSerialize($("#shop-body"))); }
  $("#shop-link").addEventListener("click", () => showView("shop"));
  $("#shop-uncheck").addEventListener("click", () => {
    $$("#shop-body .chk").forEach((c) => { c.setAttribute("data-checked", "0"); c.classList.remove("is-done"); });
    saveShop();
  });

  /* Окно создания операции */
  let finTxKind = "expense", finTxCatId = null, finTxIncomeOnly = false, finTxEditId = null;
  function renderFinTxCats() {
    const add = `<button type="button" class="proj-add-row" id="fintx-add-cat" aria-label="Новая категория"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg></button>`;
    $("#fintx-cats").innerHTML = add + finCatsCache.map((c) => `<button type="button" class="proj-pill fintx-cat ${c.id === finTxCatId ? "is-cur" : ""}" data-id="${c.id}"><span class="proj-emoji">${c.emoji || DEFAULT_EMOJI}</span><span class="proj-name">${esc(c.name)}</span><span class="status-del" data-del="${c.id}" aria-label="Удалить">×</span></button>`).join("");
    $("#fintx-add-cat").addEventListener("click", () => openFinCat());
  }
  async function openFinTx(opts) {
    opts = opts || {}; const ed = opts.edit || null; finTxEditId = ed ? ed.id : null;
    finTxIncomeOnly = ed ? (ed.kind === "income") : !!opts.incomeOnly;
    finTxKind = ed ? ed.kind : (finTxIncomeOnly ? "income" : "expense");
    finTxCatId = ed ? (ed.category_id || null) : (opts.preCat || null);
    finCatsCache = await Store.finCategories();
    $("#fintx-amount").value = ed ? fmtMoney(ed.amount_minor) : ""; $("#fintx-note").value = ed ? (ed.note || "") : "";
    $("#fintx-amount").placeholder = finTxKind === "income" ? "500,00" : "10,00";
    $("#fintx-kind").hidden = finTxIncomeOnly;
    $("#fintx-kind-expense").classList.toggle("is-on", finTxKind === "expense"); $("#fintx-kind-income").classList.toggle("is-on", finTxKind === "income");
    $("#fintx-cats").hidden = finTxKind === "income"; if (finTxKind !== "income") renderFinTxCats();
    $("#fintx-ok").textContent = ed ? "Сохранить" : "Добавить";
    $("#fintx-modal").hidden = false; setTimeout(() => $("#fintx-amount").focus(), 30);
  }
  $$("#fintx-kind .kind-btn").forEach((b) => b.addEventListener("click", () => {
    finTxKind = b.dataset.kind; $$("#fintx-kind .kind-btn").forEach((x) => x.classList.toggle("is-on", x === b));
    $("#fintx-amount").placeholder = finTxKind === "income" ? "500,00" : "10,00";
    $("#fintx-cats").hidden = finTxKind === "income"; if (finTxKind !== "income") renderFinTxCats();
  }));
  $("#fintx-cats").addEventListener("click", async (e) => {
    if (DRAG.active) return;
    const del = e.target.closest(".status-del");
    if (del) {
      if (!(await askConfirm("Удалить категорию?", "Операции в ней останутся без категории"))) return;
      await Store.deleteFinCategory(del.dataset.del);
      if (finTxCatId === del.dataset.del) finTxCatId = null;
      finCatsCache = await Store.finCategories(); renderFinTxCats(); renderCurrentFin();
      return;
    }
    const p = e.target.closest(".fintx-cat"); if (!p) return; const id = p.dataset.id;
    if (finTxCatId === id) { const c = finCatsCache.find((x) => x.id === id); if (c) openFinCat({ edit: c }); return; }  // повторный тап по выбранной → редактирование категории
    finTxCatId = id; $$("#fintx-cats .fintx-cat").forEach((x) => x.classList.toggle("is-cur", x === p));
  });
  makeSortable($("#fintx-cats"), { itemSelector: ".fintx-cat", axis: "wrap", ignore: ".status-del", onDrop: async (d) => { for (let i = 0; i < d.orderedIds.length; i++) { const c = finCatsCache.find((x) => x.id === d.orderedIds[i]); if (c && c.sort !== i) { c.sort = i; await Store.updateFinCategory(c.id, { sort: i }); } } finCatsCache.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)); renderFinance(); } });
  $("#fintx-ok").addEventListener("click", async () => {
    const minor = parseMoney($("#fintx-amount").value); if (minor == null || minor <= 0) { $("#fintx-amount").focus(); return; }
    if (finTxKind === "expense" && !finTxCatId) { return; }   // для расхода нужна категория
    const catId = finTxKind === "income" ? null : finTxCatId; const note = ($("#fintx-note").value || "").trim() || null;
    if (finTxEditId) { await Store.updateFinTx(finTxEditId, { kind: finTxKind, amount_minor: minor, category_id: catId, note }); }
    else { await Store.addFinTx({ kind: finTxKind, amount_minor: minor, category_id: catId, note }); }
    $("#fintx-modal").hidden = true; renderCurrentFin();
  });
  $("#fintx-cancel").addEventListener("click", () => ($("#fintx-modal").hidden = true));
  $("#fintx-modal").addEventListener("click", (e) => { if (e.target.id === "fintx-modal") $("#fintx-modal").hidden = true; });

  /* Окно создания/редактирования категории расхода */
  let finCatEmoji = "", finCatColor = STATUS_PALETTE[0], finCatEditId = null;
  function renderFinCatEmoji() { $("#fincat-emoji").textContent = finCatEmoji || DEFAULT_EMOJI; $("#fincat-emoji").classList.toggle("is-empty", !finCatEmoji); }
  function renderFinCatSwatches() {
    $("#fincat-swatches").innerHTML = STATUS_PALETTE.map((c) => `<button type="button" class="swatch ${c === finCatColor ? "is-cur" : ""}" data-c="${c}" style="--c:${c}"><span class="status-dot"></span></button>`).join("");
    $$("#fincat-swatches .swatch").forEach((b) => b.addEventListener("click", () => { finCatColor = b.dataset.c; renderFinCatSwatches(); }));
  }
  $("#fincat-emoji").addEventListener("click", () => openEmojiModal(finCatEmoji, (em) => { finCatEmoji = em; renderFinCatEmoji(); }));
  function openFinCat(opts) {
    const ed = (opts && opts.edit) || null; finCatEditId = ed ? ed.id : null;
    finCatEmoji = ed ? (ed.emoji || "") : "💶"; finCatColor = ed ? (ed.color || STATUS_PALETTE[0]) : STATUS_PALETTE[0];
    renderFinCatEmoji(); renderFinCatSwatches(); $("#fincat-name").value = ed ? (ed.name || "") : "";
    $("#fincat-modal .modal-title").textContent = ed ? "Категория" : "Новая категория"; $("#fincat-ok").textContent = ed ? "Сохранить" : "Создать";
    $("#fincat-modal").hidden = false; setTimeout(() => $("#fincat-name").focus(), 30);
  }
  $("#fincat-ok").addEventListener("click", async () => {
    const name = ($("#fincat-name").value || "").trim(); if (!name) { $("#fincat-name").focus(); return; }
    if (finCatEditId) { await Store.updateFinCategory(finCatEditId, { emoji: finCatEmoji || null, name, color: finCatColor }); }
    else { const sort = finCatsCache.reduce((m, c) => Math.max(m, c.sort == null ? 0 : c.sort), -1) + 1; const row = await Store.addFinCategory({ emoji: finCatEmoji, name, color: finCatColor, sort }); if (row) finTxCatId = row.id; }
    finCatsCache = await Store.finCategories();
    $("#fincat-modal").hidden = true; if (!$("#fintx-cats").hidden) renderFinTxCats(); renderCurrentFin();
  });
  $("#fincat-cancel").addEventListener("click", () => ($("#fincat-modal").hidden = true));
  $("#fincat-modal").addEventListener("click", (e) => { if (e.target.id === "fincat-modal") $("#fincat-modal").hidden = true; });

  /* Выбор периода (диапазон дат) */
  const finR = { y: 0, m: 0, start: null, end: null };
  function drawFinRange() {
    $("#finrange-title").textContent = `${MONTHS[finR.m]} ${finR.y}`;
    const offset = (new Date(finR.y, finR.m, 1).getDay() + 6) % 7; const days = new Date(finR.y, finR.m + 1, 0).getDate();
    let html = ""; for (let i = 0; i < offset; i++) html += `<span class="cal-day empty"></span>`;
    for (let d = 1; d <= days; d++) { const ds = `${finR.y}-${pad(finR.m + 1)}-${pad(d)}`; const cls = ["cal-day"]; if (ds === finR.start || ds === finR.end) cls.push("sel"); else if (finR.start && finR.end && ds > finR.start && ds < finR.end) cls.push("in-range"); html += `<button type="button" class="${cls.join(" ")}" data-d="${ds}">${d}</button>`; }
    $("#finrange-grid").innerHTML = html;
    $$("#finrange-grid .cal-day[data-d]").forEach((b) => b.addEventListener("click", () => {
      const ds = b.dataset.d;
      if (!finR.start || (finR.start && finR.end)) { finR.start = ds; finR.end = null; }
      else { if (ds < finR.start) { finR.end = finR.start; finR.start = ds; } else finR.end = ds; }
      $("#finrange-hint").textContent = finR.end ? "период выбран" : "выберите конец периода";
      drawFinRange();
    }));
  }
  function openFinRange() {
    const base = finPeriod.mode === "range" && finPeriod.from ? finPeriod.from.slice(0, 10).split("-") : [new Date().getFullYear(), new Date().getMonth() + 1];
    finR.y = +base[0]; finR.m = +base[1] - 1; finR.start = null; finR.end = null;
    $("#finrange-hint").textContent = "выберите начало периода"; drawFinRange(); $("#finrange-modal").hidden = false;
  }
  $("#fin-range").addEventListener("click", openFinRange);
  $("#finrange-prev").addEventListener("click", () => { finR.m--; if (finR.m < 0) { finR.m = 11; finR.y--; } drawFinRange(); });
  $("#finrange-next").addEventListener("click", () => { finR.m++; if (finR.m > 11) { finR.m = 0; finR.y++; } drawFinRange(); });
  $("#finrange-cancel").addEventListener("click", () => ($("#finrange-modal").hidden = true));
  $("#finrange-modal").addEventListener("click", (e) => { if (e.target.id === "finrange-modal") $("#finrange-modal").hidden = true; });
  $("#finrange-ok").addEventListener("click", () => {
    if (!finR.start) { $("#finrange-modal").hidden = true; return; }
    const s = finR.start, e = finR.end || finR.start;
    const fmt = (x) => { const p = x.split("-"); return `${p[2]}.${p[1]}`; };
    finPeriod = { mode: "range", from: new Date(s + "T00:00:00").toISOString(), to: new Date(e + "T23:59:59").toISOString(), label: `${fmt(s)}–${fmt(e)}` };
    syncFinFilters();
    $("#finrange-modal").hidden = true; renderCurrentFin();
  });

  /* ---------- Аккаунт ---------- */
  $("#account-btn").addEventListener("click", async () => {
    if (!(sb && Store.userId)) { showAuth(); return; }
    const pop = $("#account-pop"); if (!pop.hidden) { pop.hidden = true; return; }
    let email = "", name = ""; try { const { data } = await sb.auth.getUser(); email = data && data.user && data.user.email; name = data && data.user && data.user.user_metadata && (data.user.user_metadata.full_name || data.user.user_metadata.name) || ""; } catch {}
    const nameEl = $("#account-name"); nameEl.textContent = name; nameEl.hidden = !name;
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
  /* Режимы формы: вход (пароль точками + глаз) / регистрация (пароль текстом + повтор) */
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7c1.7 0 3.2.4 4.5 1.1M22 12s-3.5 7-10 7c-1.7 0-3.2-.4-4.5-1.1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/><path d="M3 3l18 18"/></svg>';
  let authMode = "login", passShown = false;
  function updatePassEye() {
    $("#auth-pass-eye").innerHTML = passShown ? EYE_OFF_SVG : EYE_SVG;
    if (authMode === "login") $("#auth-pass").type = passShown ? "text" : "password";
  }
  function setAuthMode(mode) {
    authMode = mode; passShown = false;
    const reg = mode === "register";
    $("#auth-name").hidden = !reg;
    $("#auth-pass2").hidden = !reg;
    $("#auth-pass").type = reg ? "text" : "password";   // регистрация — пароль сразу виден
    $("#auth-pass2").type = "text";
    $("#auth-pass-eye").hidden = reg;                    // глаз только при входе
    $(".field-pass").classList.toggle("no-eye", reg);
    $("#auth-signin").textContent = reg ? "Зарегистрироваться" : "Войти";
    $("#auth-signup").textContent = reg ? "Уже есть аккаунт? Войти" : "Создать аккаунт";
    $("#auth-forgot").hidden = reg || !HAS_SUPABASE;
    updatePassEye(); authMsg("");
  }
  $("#auth-pass-eye").addEventListener("click", () => { passShown = !passShown; updatePassEye(); });
  $("#auth-signup").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));

  async function doLogin() {
    if (!sb) { startApp(); return; }
    authMsg("…");
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value });
    if (error) return authMsg(trAuthError(error.message), "error");
    Store.userId = data.user.id; startApp();
  }
  async function doRegister() {
    const name = $("#auth-name").value.trim();
    if (!name) return authMsg("Введите имя и фамилию", "error");
    const p1 = $("#auth-pass").value, p2 = $("#auth-pass2").value;
    if (p1 !== p2) return authMsg("Пароли не совпадают", "error");
    if (!sb) { startApp(); return; }
    authMsg("…");
    const { data, error } = await sb.auth.signUp({ email: $("#auth-email").value.trim(), password: p1, options: { data: { full_name: name } } });
    if (error) return authMsg(trAuthError(error.message), "error");
    if (data.session) { Store.userId = data.user.id; startApp(); } else authMsg("Проверьте почту для подтверждения регистрации.");
  }
  $("#auth-form").addEventListener("submit", (e) => { e.preventDefault(); authMode === "register" ? doRegister() : doLogin(); });

  function showAuth() { $("#app").hidden = true; $("#auth").hidden = false; $("#account-pop").hidden = true; setAuthMode("login"); $("#auth-mode-hint").textContent = HAS_SUPABASE ? "Данные синхронизируются между устройствами." : "Локальный режим: данные хранятся в этом браузере."; $("#auth-google").disabled = !HAS_SUPABASE; }

  if (HAS_SUPABASE) {
    $("#auth-google").addEventListener("click", async () => { await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } }); });
    $("#auth-forgot").addEventListener("click", async () => { const email = $("#auth-email").value.trim(); if (!email) return authMsg("Введите e-mail для сброса", "error"); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }); if (error) return authMsg(trAuthError(error.message), "error"); authMsg("Письмо для сброса пароля отправлено на почту", "info"); });
    $("#pw-ok").addEventListener("click", async () => { const p = $("#pw-input").value; const msg = $("#pw-msg"); msg.classList.add("is-error"); if (p.length < 6) { msg.textContent = "Минимум 6 символов"; return; } const { error } = await sb.auth.updateUser({ password: p }); if (error) { msg.textContent = trAuthError(error.message); return; } $("#pw-modal").hidden = true; $("#pw-input").value = ""; msg.textContent = ""; toast("Пароль обновлён"); });
    $("#pw-modal").addEventListener("click", (e) => { if (e.target.id === "pw-modal") $("#pw-modal").hidden = true; });
    sb.auth.onAuthStateChange((event, session) => { if (event === "PASSWORD_RECOVERY") { if (session) { Store.userId = session.user.id; if ($("#app").hidden) startApp(); } $("#pw-modal").hidden = false; setTimeout(() => $("#pw-input").focus(), 60); return; } if (session && $("#app").hidden) { Store.userId = session.user.id; startApp(); } });
    sb.auth.getSession().then(({ data }) => { if (data.session) { if ($("#app").hidden) { Store.userId = data.session.user.id; startApp(); } } else if (!location.hash.includes("access_token")) showAuth(); });
  } else {
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
