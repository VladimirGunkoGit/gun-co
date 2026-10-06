/* =================================================================
   gunco — логика приложения (задачи / проекты / заметки / покупки)
   -----------------------------------------------------------------
   • FEATURES  — какие разделы показывать. Финансы/Калории/Привычки
                 скрыты в этом деплое, но код цел — включаются здесь.
   • PLATFORM  — различаем нативное приложение (Capacitor) и браузер;
                 на <html> вешаются классы .native / .web.
   ================================================================= */
(function () {
  "use strict";
  const CFG = window.GUNCO_CONFIG || {};

  /* ---------- Разделы этого деплоя ---------- */
  const FEATURES = { finance: false, food: false, habits: false };   // включить в будущих версиях

  /* ---------- Платформа: нативное приложение vs браузер ---------- */
  const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  document.documentElement.classList.toggle("native", isNative);
  document.documentElement.classList.toggle("web", !isNative);
  // Нативный статус-бар: прозрачный оверлей + стиль под тему (иначе белая полоса сверху)
  function applyNativeStatusBar() {
    if (!isNative) return;
    const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if (!SB) return;
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    try { SB.setOverlaysWebView({ overlay: true }); } catch (e) {}
    try { SB.setStyle({ style: dark ? "LIGHT" : "DARK" }); } catch (e) {}   // LIGHT = светлый текст на тёмном
  }

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

  /* Список покупок: дефолтное наполнение (для новых пользователей и по кнопке «Очистить список») —
     подзаголовок эмодзи+название, под ним пустая позиция-чекбокс, между разделами пустая строка */
  const DEFAULT_SHOP_HTML = [
    ["🥦", "Овощи и фрукты"], ["🥩", "Мясо и рыба"], ["🥛", "Молоко"], ["🥖", "Бакалея"],
    ["🧃", "Вода и сок"], ["🧴", "Хозтовары"], ["📦", "Другое"],
  ].map(([e, n]) => `<div>${e} ${n}</div><div class="chk" data-checked="0"></div>`).join('<div><br></div>');

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

  /* ---------- Универсальная отмена (Cmd/Ctrl+Z + встряхивание, без лимита) ---------- */
  const UndoStack = [];
  let undoing = false;
  function pushUndo(label, undo) { UndoStack.push({ label, undo }); }
  function rerenderCurrent() {
    const v = currentView;
    if (v === "tasks") renderTasks();
    else if (v === "projects") renderKanban();
    else if (v === "project") renderProjectTasks();
    else if (v === "notes") renderNotes();
    else if (v === "habits") renderHabits();
    else if (v === "finance") renderFinance();
    else if (v === "fincat") renderFinCatPage();
    else if (v === "shop") renderShop();
  }
  async function undoLast() {
    if (undoing) return;
    const item = UndoStack.pop();
    if (!item) { toast("Нечего отменять"); return; }
    undoing = true;
    try { await item.undo(); } catch (e) {}
    undoing = false;
    rerenderCurrent();
    toast("Отменено" + (item.label ? ": " + item.label : ""));
  }
  document.addEventListener("keydown", (e) => {
    const isZ = e.code === "KeyZ" || e.key === "z" || e.key === "Z" || e.key === "я" || e.key === "Я";
    if ((e.metaKey || e.ctrlKey) && isZ && !e.shiftKey && !e.altKey) {
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return; // в полях — нативная отмена ввода
      e.preventDefault(); undoLast();
    }
  });
  // Встряхивание = отмена (iOS требует разрешения по жесту)
  let shakeArmed = false, lastShake = 0;
  function onMotion(e) {
    const a = e.acceleration && (e.acceleration.x != null) ? e.acceleration : e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    const thr = (e.acceleration && e.acceleration.x != null) ? 22 : 34;
    const now = Date.now();
    if (mag > thr && now - lastShake > 1200) { lastShake = now; undoLast(); }
  }
  function armShake() {
    if (shakeArmed || typeof DeviceMotionEvent === "undefined") return;
    // НЕ запрашиваем доступ к движению/ориентации (назойливый iOS-диалог «Motion & Orientation»).
    // Включаем shake-отмену только там, где разрешение не требуется (Android/десктоп).
    if (typeof DeviceMotionEvent.requestPermission === "function") return;
    window.addEventListener("devicemotion", onMotion); shakeArmed = true;
  }
  document.addEventListener("click", function armOnce() { armShake(); document.removeEventListener("click", armOnce); }, { once: true });

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
      d.foodLog = d.foodLog || [];
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
    // Восстановление удалённой записи с ТЕМ ЖЕ id (для отмены удаления)
    async _restore(table, localKey, obj) {
      if (sb && this.userId) { const { user_id, ...rest } = obj || {}; await sb.from(table).insert({ ...rest, user_id: this.userId }); return; }
      const d = Local.ensure(); (d[localKey] = d[localKey] || []).push(obj); Local.write(d);
    },
    restoreTask(o) { return this._restore("tasks", "tasks", o); },
    restoreProject(o) { return this._restore("projects", "projects", o); },
    restoreNote(o) { return this._restore("notes", "notes", o); },
    restoreHabit(o) { return this._restore("habits", "habits", o); },
    restoreFinCategory(o) { return this._restore("fin_categories", "finCategories", o); },
    restoreFinTx(o) { return this._restore("fin_tx", "finTx", o); },
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
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); Store.saveSettings({ theme: t }); applyNativeStatusBar(); }
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
  const dt = { y: 0, m: 0, date: "", time: "", endTime: "", notify: true, onDone: null };
  function openDateTime({ date, time, endTime, notify, onDone }) {
    const base = (date || todayStr()).split("-"); dt.y = +base[0]; dt.m = +base[1] - 1; dt.date = date || ""; dt.time = time || ""; dt.endTime = endTime || ""; dt.notify = notify !== false; dt.onDone = onDone;
    $("#dt-time").value = dt.time; $("#dt-end-time").value = dt.endTime;
    $("#dt-notify").classList.toggle("off", !dt.notify); drawDtCal(); $("#datetime-modal").hidden = false;
  }
  function drawDtCal() { drawCal({ y: dt.y, m: dt.m, value: dt.date }, $("#dt-grid"), $("#dt-title"), (d) => { dt.date = d; drawDtCal(); }); }
  $("#dt-prev").addEventListener("click", () => { dt.m--; if (dt.m < 0) { dt.m = 11; dt.y--; } drawDtCal(); });
  $("#dt-next").addEventListener("click", () => { dt.m++; if (dt.m > 11) { dt.m = 0; dt.y++; } drawDtCal(); });
  (function () { const g = $("#dt-grid"); let sx = 0, sy = 0, on = false; g.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true }); g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) { dt.m++; if (dt.m > 11) { dt.m = 0; dt.y++; } } else { dt.m--; if (dt.m < 0) { dt.m = 11; dt.y--; } } drawDtCal(); } }, { passive: true }); })();
  $("#dt-notify").addEventListener("click", () => $("#dt-notify").classList.toggle("off"));
  $("#dt-cancel").addEventListener("click", () => ($("#datetime-modal").hidden = true));
  $("#datetime-modal").addEventListener("click", (e) => { if (e.target.id === "datetime-modal") $("#datetime-modal").hidden = true; });
  $("#dt-done").addEventListener("click", () => { $("#datetime-modal").hidden = true; if (dt.onDone) dt.onDone(dt.date, $("#dt-time").value, $("#dt-end-time").value, !$("#dt-notify").classList.contains("off")); });
  $("#dt-cal-clear").addEventListener("click", () => { dt.date = ""; drawDtCal(); });
  // Ввод времени начала: обновить подпись; если конец пуст — по дефолту начало + 15 мин.
  $("#dt-time").addEventListener("change", () => { if ($("#dt-time").value && !$("#dt-end-time").value) $("#dt-end-time").value = defaultEndTime($("#dt-time").value); });
  $("#dt-time-clear").addEventListener("click", () => { $("#dt-time").value = ""; });
  $("#dt-end-clear").addEventListener("click", () => { $("#dt-end-time").value = ""; });

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
    $("#project-modal-title").textContent = "проект"; $("#project-clear").hidden = !currentId;
    $("#project-search").value = ""; $("#project-modal .search-wrap").classList.remove("has-text");
    renderProjectList(); $("#project-modal").hidden = false;
  }
  async function openProjectFilter() {
    await loadProjects(); projMode = "filter";
    $("#project-modal-title").textContent = "проекты"; $("#project-clear").hidden = true;
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
  const PAGE_TITLES = { tasks: "задачи", projects: "проекты", notes: "заметки", finance: "финансы", habits: "привычки", food: "калории", ai: "добавить" };
  function showView(name) {
    if (currentView === "ai" && name !== "ai") aiStopVoice();   // уходим с экрана ИИ — остановить запись
    // скрытые разделы недоступны из UI в этом деплое — защита от прямого перехода
    if ((name === "finance" || name === "fincat") && !FEATURES.finance) name = "tasks";
    if ((name === "food" || name === "foodmeal") && !FEATURES.food) name = "tasks";
    if (name === "habits" && !FEATURES.habits) name = "tasks";
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    const isForm = name === "task" || name === "project" || name === "note";
    const isSub = name === "fincat" || name === "shop" || name === "foodmeal";   // под-страница: назад + свой заголовок, без нижнего меню
    $("#back-btn").hidden = !(isForm || isSub);
    $("#page-title").hidden = isForm;
    if (name === "fincat") $("#page-title").textContent = finCatViewTitle;
    else if (name === "shop") $("#page-title").textContent = "🛒 список покупок";
    else if (name === "foodmeal") { const m = mealById(foodMealId); $("#page-title").textContent = m ? (m.icon + " " + m.name) : "приём"; }
    else if (!isForm) $("#page-title").textContent = PAGE_TITLES[name] || "";
    $("#page-title").classList.toggle("wrap", name === "shop");
    $("#filter-toggle").hidden = name !== "tasks";
    $("#task-views").hidden = name !== "tasks";
    if (name === "tasks") $("#task-filters").hidden = !filtersOpen;
    $("#page-nav").hidden = isForm || isSub;
    $("#fab").hidden = !(name === "tasks" || name === "projects" || name === "notes" || name === "habits" || name === "finance" || name === "fincat" || name === "food" || name === "foodmeal");
    if (!isForm && !isSub) { let activeItem = null; $$("#page-nav .nav-item").forEach((b) => { const on = b.dataset.view === name; b.classList.toggle("active", on); if (on) activeItem = b; }); if (activeItem) requestAnimationFrame(() => activeItem.scrollIntoView({ inline: "nearest", block: "nearest" })); }
    if (name === "tasks") renderTasks();
    else if (name === "projects") renderKanban();
    else if (name === "project") renderProjectTasks();
    else if (name === "notes") renderNotes();
    else if (name === "habits") renderHabits();
    else if (name === "finance") renderFinance();
    else if (name === "fincat") renderFinCatPage();
    else if (name === "shop") renderShop();
    else if (name === "ai") { /* без авто-фокуса: клавиатура открывается только по тапу пользователя — страница не улетает вверх */ }
    else if (name === "food") renderFood();
    else if (name === "foodmeal") renderFoodMeal();
  }
  $$("#page-nav .nav-item").forEach((b) => b.addEventListener("click", () => { if (currentView !== b.dataset.view) showView(b.dataset.view); }));
  $("#filter-toggle").addEventListener("click", () => { filtersOpen = !filtersOpen; $("#task-filters").hidden = !filtersOpen; });
  function goBack() {
    const m = $$(".modal").find((x) => !x.hidden); if (m) { m.hidden = true; return; }
    if (currentView === "task") { leaveTask(); return; }
    if (currentView === "project") { leaveProject(); return; }
    if (currentView === "note") { leaveNote(); return; }
    if (currentView === "fincat") { showView("finance"); return; }
    if (currentView === "shop") { saveShop(); showView("notes"); return; }
    if (currentView === "foodmeal") { showView("food"); return; }
  }
  $("#back-btn").addEventListener("click", goBack);
  $("#brand-home").addEventListener("click", () => showView("tasks"));
  $("#fab").addEventListener("click", () => { if (currentView === "projects") newProject(); else if (currentView === "notes") newNote(); else if (currentView === "habits") newHabit(); else if (currentView === "finance") openFinTx(); else if (currentView === "fincat") { finCatViewId === "__income__" ? openFinTx({ incomeOnly: true }) : openFinTx({ preCat: finCatViewId }); } else if (currentView === "food") openFoodAdd("breakfast"); else if (currentView === "foodmeal") openFoodAdd(foodMealId); else newTask(); });
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
  // Корзинка в панели фильтров — сброс всех фильтров задач
  $("#filters-clear").addEventListener("click", () => { dateFilter = ""; filterProjects.clear(); filterStatuses = new Set(defaultFilterIds("task")); applyFiltersUI(); saveFilters(); renderTasks(); });

  /* ---------- Список задач ---------- */
  function dayHead(day) { if (!day) return "без даты"; const [y, m, d] = day.split("-").map(Number); return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} · ${d} ${MONTHS_SHORT[m - 1]}`; }
  function taskRow(t, opts) {
    opts = opts || {};
    const st = statusOf(t); const p = projById(t.project_id);
    const projCell = opts.showProjectPill ? `<span class="proj-pill task-proj ${p ? "" : "is-empty"}" data-act="project"><span class="proj-emoji">${p ? projEmoji(p) : DEFAULT_EMOJI}</span>${p ? `<span class="proj-name">${esc(p.name)}</span>` : ""}</span>` : "";
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
  /* ---- Виды отображения задач: список / неделя / месяц ---- */
  let taskView = localStorage.getItem("gunco_taskview") || "list";   // list | week | month
  let tmY = null, tmM = null;                 // месяц-вид
  let twBase = null, weekScrolled = false;    // неделя-вид: пагинация по дням (свайп)
  const TW_PAST = 120, TW_FUTURE = 400;       // запас дней назад/вперёд
  let twRange = TW_PAST + TW_FUTURE;
  let twCurIdx = null;                         // индекс текущего дня в массиве (перевод трека)
  function isoDate(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(dt, n) { const d = new Date(dt); d.setDate(d.getDate() + n); return d; }
  function mondayOf(dt) { const d = new Date(dt); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
  function tasksByDay(tasks) { const m = {}; tasks.forEach((t) => { const d = (t.due_date || "").slice(0, 10); if (d) (m[d] = m[d] || []).push(t); }); return m; }
  function taskStartMin(t) { const p = (t.due_time || "").split(":"); return p.length === 2 ? (+p[0]) * 60 + (+p[1]) : null; }
  function taskEndMin(t) { const s = taskStartMin(t); if (s == null) return null; if (t.end_time) { const p = t.end_time.split(":"); const e = (+p[0]) * 60 + (+p[1]); if (e > s) return e; } return s + 15; }   // дата окончания = дата начала; высота = интервал или +15 мин
  function fmtHM(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
  function setTaskView(v) { taskView = v; try { localStorage.setItem("gunco_taskview", v); } catch (e) {} if (v === "week") weekScrolled = false; renderTasks(); }
  $$("#task-views .view-btn").forEach((b) => b.addEventListener("click", () => setTaskView(b.dataset.tview)));
  $("#tm-prev").addEventListener("click", () => { tmM--; if (tmM < 0) { tmM = 11; tmY--; } renderTasks(); });
  $("#tm-next").addEventListener("click", () => { tmM++; if (tmM > 11) { tmM = 0; tmY++; } renderTasks(); });
  // Свайп по месяцам (в дополнение к стрелкам)
  (function () {
    const g = $("#task-month"); let sx = 0, sy = 0, on = false;
    g.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) { tmM++; if (tmM > 11) { tmM = 0; tmY++; } } else { tmM--; if (tmM < 0) { tmM = 11; tmY--; } } renderTasks(); } }, { passive: true });
  })();
  function openWeekAt(ds) { twBase = addDays(parseISO(ds), -TW_PAST); twCurIdx = TW_PAST; weekScrolled = false; setTaskView("week"); }

  // Одноразовая миграция: всем задачам со временем начала, но без времени конца, назначить конец = начало + 15 мин.
  async function applyDefaultEndTimes() {
    try {
      if (localStorage.getItem("gunco_endtime_def_v1")) return;
      if (sb && !Store.userId) return;   // в облачном режиме ждём логина, иначе флаг выставится на пустых задачах
      const tasks = await Store.tasks();
      for (const t of tasks) { if (t.due_time && !t.end_time) { const et = defaultEndTime(t.due_time); if (et) await Store.updateTask(t.id, { end_time: et }); } }
      localStorage.setItem("gunco_endtime_def_v1", "1");
    } catch (e) {}
  }
  async function renderTasks() {
    await applyDefaultEndTimes();
    scheduleReminderSync();   // держим локальные напоминания (нативно) в актуальном состоянии
    let tasks = await Store.tasks();
    tasks = tasks.filter((t) => filterStatuses.has(statusOf(t)));
    if (filterProjects.size) tasks = tasks.filter((t) => filterProjects.has(t.project_id));
    if (taskView === "list" && dateFilter) tasks = tasks.filter((t) => (t.due_date || "").slice(0, 10) === dateFilter);
    tasks.sort(taskSort);
    tasksById = {}; tasks.forEach((t) => (tasksById[t.id] = t));
    const isList = taskView === "list", isMonth = taskView === "month", isWeek = taskView === "week";
    $("#task-list").hidden = !isList; $("#task-month").hidden = !isMonth; $("#task-week").hidden = !isWeek;
    $("#tasks-empty").hidden = !(isList && !tasks.length);
    ["list", "week", "month"].forEach((k) => { const b = $(`#task-views .view-btn[data-tview="${k}"]`); if (b) b.classList.toggle("is-on", k === taskView); });
    if (isList) {
      $("#task-list").innerHTML = buildGroupedTaskListHTML(tasks, { showProjectPill: true });
      $$("#task-list .task").forEach((el) => attachSwipe(el, async () => { const o = tasksById[el.dataset.id]; await Store.deleteTask(el.dataset.id); if (o) pushUndo("удаление задачи", () => Store.restoreTask(o)); renderTasks(); }));
    } else if (isMonth) { renderMonthView(tasks); }
    else { renderWeekView(tasks); }
  }

  function isWeekend(dt) { const d = dt.getDay(); return d === 0 || d === 6; }
  function nowMinutes() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  // раскладка событий дня: пересекающиеся ставим рядом (под-колонки)
  function layoutDay(list) {
    const evs = list.map((t) => ({ t, s: taskStartMin(t), e: taskEndMin(t), col: 0, cols: 1 })).sort((x, y) => x.s - y.s || x.e - y.e);
    let i = 0;
    while (i < evs.length) {
      let clusterEnd = evs[i].e; const cluster = [evs[i]]; let j = i + 1;
      while (j < evs.length && evs[j].s < clusterEnd) { cluster.push(evs[j]); clusterEnd = Math.max(clusterEnd, evs[j].e); j++; }
      const colEnd = [];
      cluster.forEach((ev) => { let c = -1; for (let k = 0; k < colEnd.length; k++) { if (colEnd[k] <= ev.s) { c = k; break; } } if (c === -1) { c = colEnd.length; colEnd.push(ev.e); } else colEnd[c] = ev.e; ev.col = c; });
      cluster.forEach((ev) => (ev.cols = colEnd.length)); i = j;
    }
    return evs;
  }
  $("#tw-today").addEventListener("click", () => { twBase = addDays(new Date(), -TW_PAST); twRange = TW_PAST + TW_FUTURE; twCurIdx = TW_PAST; weekScrolled = false; renderTasks(); });
  $("#tm-today").addEventListener("click", () => { const n = new Date(); tmY = n.getFullYear(); tmM = n.getMonth(); renderTasks(); });
  let weekTasksCache = [];
  function updateNowLine() { if (taskView !== "week") return; const el = $("#tw-bodytrack .week-now"); const grid = $("#tw-grid"); if (!el || !grid) return; const hh = parseFloat(getComputedStyle(grid).getPropertyValue("--hh")) || 60; el.style.top = (nowMinutes() / 60 * hh) + "px"; }
  setInterval(updateNowLine, 60000);
  function statusBadgesFor(list) {
    const counts = {};
    list.forEach((t) => { const s = statusOf(t); if (!statusIsDone("task", s)) counts[s] = (counts[s] || 0) + 1; });
    return statusSet("task").filter((s) => !s.done && counts[s.id]).map((s) => ({ c: s.c, count: counts[s.id] }));
  }
  // Закреплённая под датой мини-карточка задачи без времени (вид как у 15-минутных карточек: только заголовок)
  function weekPinHTML(t) { return `<div class="week-pin" data-id="${t.id}" style="--c:${statusColor("task", statusOf(t))}"><span class="week-ev-title">${esc(t.title)}</span></div>`; }
  function wireWeekPins(root) { $$(`${root} .week-pin`).forEach((el) => el.addEventListener("click", () => { const t = tasksById[el.dataset.id]; if (t) openTaskEdit(t, "tasks"); })); }

  function renderMonthView(tasks) {
    if (tmY == null) { const n = new Date(); tmY = n.getFullYear(); tmM = n.getMonth(); }
    $("#tm-title").textContent = `${MONTHS[tmM]} ${tmY}`;
    const byDay = tasksByDay(tasks); const today = todayStr();
    const offset = (new Date(tmY, tmM, 1).getDay() + 6) % 7; const days = new Date(tmY, tmM + 1, 0).getDate();
    let html = `<div class="tm-wds">${["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((w, i) => `<span class="tm-wd${i >= 5 ? " weekend" : ""}">${w}</span>`).join("")}</div><div class="tm-days">`;
    for (let i = 0; i < offset; i++) html += `<span class="tm-day empty"></span>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${tmY}-${pad(tmM + 1)}-${pad(d)}`; const wd = new Date(tmY, tmM, d).getDay(); const wknd = wd === 0 || wd === 6; const list = byDay[ds] || [];
      const seen = []; list.forEach((t) => { const s = statusOf(t); if (!seen.includes(s)) seen.push(s); });
      const dots = seen.slice(0, 4).map((s) => `<span class="tm-dot" style="background:rgb(${statusColor("task", s)})"></span>`).join("");
      const cnt = list.length ? `<span class="tm-cnt">${list.length}</span>` : "";
      html += `<button type="button" class="tm-day${ds === today ? " today" : ""}${wknd ? " weekend" : ""}" data-d="${ds}"><span class="tm-num">${d}</span><span class="tm-marks">${dots}${cnt}</span></button>`;
    }
    html += `</div>`; $("#tm-grid").innerHTML = html;
    $$("#tm-grid .tm-day[data-d]").forEach((b) => b.addEventListener("click", () => openWeekAt(b.dataset.d)));
  }

  let twCtx = null;   // { colW, hh, days:[ISO], mobile }
  function renderWeekView(tasks) {
    weekTasksCache = tasks;
    if (!twBase) twBase = addDays(new Date(), -TW_PAST);
    if (twCurIdx == null) twCurIdx = TW_PAST;
    const today = todayStr();
    const scrollEl = $("#tw-scroll");
    const vpW = $("#tw-bodyvp").clientWidth || (window.innerWidth - 52);
    const mobile = window.innerWidth < 768, wide = !mobile;
    $("#task-week").classList.toggle("tw-wide", wide);
    if (wide) { const cur = addDays(twBase, twCurIdx); twCurIdx = Math.max(0, twCurIdx - ((cur.getDay() + 6) % 7)); }   // десктоп: выравниваем на понедельник
    const days = Array.from({ length: twRange }, (_, i) => addDays(twBase, i));
    const colW = wide ? Math.floor(vpW / 7) : Math.round(vpW * 0.8);   // десктоп: вся неделя на экран; моб.: 80% день + 20% peek
    const schedH = scrollEl.clientHeight || 480;
    const hh = Math.round((mobile ? Math.max(40, schedH / 11) * 2.25 : Math.max(40, schedH / 11) * 1.5) * 0.75);   // высота часа = 1.5× от «в 2 раза плотнее» (чтобы влезал заголовок 15-мин задачи)
    twCtx = { colW, hh, days: days.map(isoDate), mobile };
    $("#tw-gutter").style.height = (24 * hh) + "px";
    $("#tw-gutter").innerHTML = Array.from({ length: 24 }, (_, h) => `<span class="week-hour" style="top:${h * hh}px">${pad(h)}:00</span>`).join("");
    const byDay = tasksByDay(tasks);
    const colsBg = days.map((d) => `<div class="week-col2${isoDate(d) === today ? " today" : ""}${isWeekend(d) ? " weekend" : ""}" style="width:${colW}px"></div>`).join("");
    let cardsHTML = "";
    days.forEach((d, di) => {
      const list = (byDay[isoDate(d)] || []).filter((t) => taskStartMin(t) != null);
      layoutDay(list).forEach((ev) => {
        const { t, s, e, col, cols } = ev; const dur = e - s; const top = s / 60 * hh; const height = Math.max(18, dur / 60 * hh);
        const w = colW / cols, left = di * colW + col * w; const p = projById(t.project_id);
        const mini = dur < 60 ? " week-ev--mini" : "";   // <60 мин (15/30/45) — только заголовок; 60+ — заголовок+проект+время+уведомление
        const meta = `<span class="week-ev-side">${p ? `<span class="week-ev-proj proj-pill">${projPillInner(p)}</span>` : ""}<span class="week-ev-time">${fmtHM(s)}</span>${t.notify ? `<span class="week-ev-bell">${BELL_ON}</span>` : ""}</span>`;
        cardsHTML += `<div class="week-ev${mini}" data-id="${t.id}" style="top:${top}px;left:${left}px;width:${w}px;height:${height}px;--c:${statusColor("task", statusOf(t))}"><div class="week-ev-body"><span class="week-ev-title">${esc(t.title)}</span>${meta}</div><span class="week-ev-resize" aria-hidden="true"></span></div>`;
      });
    });
    const nowIdx = days.findIndex((d) => isoDate(d) === today);
    const nowHTML = nowIdx >= 0 ? `<div class="week-now" style="top:${nowMinutes() / 60 * hh}px;left:${nowIdx * colW}px;width:${colW}px"></div>` : "";
    const track = $("#tw-bodytrack"); $("#tw-grid").style.setProperty("--hh", hh + "px");
    track.style.width = (colW * days.length) + "px"; track.style.height = (24 * hh) + "px";
    track.innerHTML = `<div class="week-colsbg2">${colsBg}</div>${nowHTML}<div class="week-events2">${cardsHTML}</div>`;
    $$("#tw-bodytrack .week-ev").forEach((el) => attachEventInteract(el));
    // шапка-трек с днями (для десктопа — вся неделя; на моб. скрыт CSS)
    const htrack = $("#tw-headtrack"); htrack.style.width = (colW * days.length) + "px";
    htrack.innerHTML = days.map((d) => {
      const ds = isoDate(d); const wknd = isWeekend(d);
      const tl = (byDay[ds] || []).filter((t) => taskStartMin(t) == null);
      const pins = tl.length ? `<div class="week-hpins">${tl.map(weekPinHTML).join("")}</div>` : "";
      return `<div class="week-hcell${ds === today ? " today" : ""}${wknd ? " weekend" : ""}" style="width:${colW}px"><span class="week-hcell-day"><span class="week-wd2${wknd ? " weekend" : ""}">${WEEKDAYS[d.getDay()]}</span><span class="week-dnum2${wknd ? " weekend" : ""}">${d.getDate()}</span></span>${pins}</div>`;
    }).join("");
    wireWeekPins("#tw-headtrack");
    applyWeekTransform(false); updateWeekHeader();
    if (!weekScrolled) {
      const showNow = nowIdx >= 0 && (mobile ? (days[twCurIdx] && isoDate(days[twCurIdx]) === today) : (nowIdx >= twCurIdx && nowIdx <= twCurIdx + 6));
      scrollEl.scrollTop = showNow ? Math.max(0, nowMinutes() / 60 * hh - schedH / 2) : 9 * hh;
      weekScrolled = true;
    }
  }
  function applyWeekTransform(animate) {
    if (!twCtx) return;
    const tx = -twCurIdx * twCtx.colW;
    [$("#tw-bodytrack"), $("#tw-headtrack")].forEach((tr) => { if (!tr) return; tr.style.transition = animate ? "transform .22s ease" : "none"; tr.style.transform = `translateX(${tx}px)`; });
  }
  function weekMonthText() {
    if (!twCtx) return "";
    if (twCtx.mobile) { const d = addDays(twBase, twCurIdx); return MONTHS[d.getMonth()].toLowerCase(); }
    const d1 = addDays(twBase, twCurIdx), d2 = addDays(twBase, twCurIdx + 6);
    return (d1.getMonth() === d2.getMonth() ? MONTHS[d1.getMonth()] : `${MONTHS[d1.getMonth()]} – ${MONTHS[d2.getMonth()]}`).toLowerCase();
  }
  function updateWeekHeader() {
    $("#tw-month").textContent = weekMonthText();
    const d = addDays(twBase, twCurIdx); const ds = isoDate(d); const wknd = isWeekend(d);
    $("#tw-daylabel").innerHTML = `<span class="week-wd2${wknd ? " weekend" : ""}">${WEEKDAYS[d.getDay()]}</span><span class="week-dnum2${wknd ? " weekend" : ""}">${d.getDate()}</span>`;
    // мобильный: закреплённые под датой задачи без времени текущего дня
    const timeless = weekTasksCache.filter((t) => (t.due_date || "").slice(0, 10) === ds && taskStartMin(t) == null);
    $("#tw-daypins").innerHTML = timeless.map(weekPinHTML).join("");
    wireWeekPins("#tw-daypins");
  }
  function pageWeek(delta) { if (!twCtx) return; const step = twCtx.mobile ? 1 : 7; twCurIdx = Math.max(0, Math.min(twCtx.days.length - 1, twCurIdx + delta * step)); applyWeekTransform(true); updateWeekHeader(); }
  // Свайп (моб. по дням, десктоп/ландшафт по неделям) + горизонтальный wheel (трекпад)
  (function () {
    const vp = $("#tw-bodyvp"); let sx = 0, sy = 0, on = false;
    vp.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest(".week-ev")) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    vp.addEventListener("touchmove", (e) => { if (!on) return; if (Math.abs(e.touches[0].clientY - sy) > Math.abs(e.touches[0].clientX - sx)) on = false; }, { passive: true });
    vp.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) pageWeek(dx < 0 ? 1 : -1); }, { passive: true });
    let wlock = 0;
    vp.addEventListener("wheel", (e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 18) { e.preventDefault(); const n = Date.now(); if (n - wlock > 380) { wlock = n; pageWeek(e.deltaX > 0 ? 1 : -1); } } }, { passive: false });
  })();
  // Перетаскивание события (перенос) и растягивание нижнего края — с компенсацией desktop-zoom
  const DRAG_HOLD_MS = 500;   // стандартная для iOS пауза long-press перед захватом карточки
  const DRAG_CANCEL_PX = 10;  // движение до срабатывания = скролл (отмена захвата)
  function attachEventInteract(el) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      const t = tasksById[el.dataset.id]; if (!t || !twCtx) return;
      const { colW, hh, days } = twCtx; const startS = taskStartMin(t), dur = taskEndMin(t) - startS;
      const track = $("#tw-bodytrack"); const z = dndZoom(track);
      const rect = el.getBoundingClientRect(); const grabY = (e.clientY - rect.top) / z;
      const resize = e.clientY > rect.bottom - Math.min(24, rect.height * 0.5);
      const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
      let active = false, moved = false, holdTimer = null;

      function engage() {   // long-press сработал — режим перетаскивания
        holdTimer = null; active = true;
        el.classList.add("dragging");
        try { el.setPointerCapture(pid); } catch (_) {}
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }   // лёгкий отклик как в iOS
      }
      function teardown() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        try { el.releasePointerCapture(pid); } catch (_) {}
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        el.classList.remove("dragging");
      }
      const onMove = (ev) => {
        if (!active) {   // до захвата: заметное движение — это скролл, отменяем long-press
          if (Math.abs(ev.clientX - startX) > DRAG_CANCEL_PX || Math.abs(ev.clientY - startY) > DRAG_CANCEL_PX) teardown();
          return;
        }
        moved = true; const cRect = track.getBoundingClientRect();
        const localY = (ev.clientY - cRect.top) / z, localX = (ev.clientX - cRect.left) / z;
        if (resize) {
          let endMin = Math.max(startS + 15, Math.min(1440, Math.round((localY / hh * 60) / 15) * 15));
          el.style.height = ((endMin - startS) / 60 * hh) + "px"; el.dataset.newEnd = endMin;
        } else {
          let startMin = Math.max(0, Math.min(1440 - dur, Math.round(((localY - grabY) / hh * 60) / 15) * 15));
          let di = Math.max(0, Math.min(days.length - 1, Math.floor(localX / colW)));
          el.style.top = (startMin / 60 * hh) + "px"; el.style.left = (di * colW) + "px"; el.style.width = colW + "px";
          el.dataset.newStart = startMin; el.dataset.newDay = di;
        }
        ev.preventDefault();
      };
      const onCancel = () => teardown();
      const onUp = async () => {
        const wasActive = active, didMove = moved;
        teardown();
        if (!wasActive) { openTaskEdit(t, "tasks"); return; }   // не было удержания → тап (открыть карточку)
        if (!didMove) { openTaskEdit(t, "tasks"); return; }      // удержали, но не двигали → тоже открыть
        const prev = { due_date: t.due_date, due_time: t.due_time, end_time: t.end_time, remind_at: t.remind_at, notified: t.notified };
        if (resize) { await Store.updateTask(t.id, { end_time: fmtHM(+el.dataset.newEnd) }); }
        else {
          const startMin = +el.dataset.newStart, di = +el.dataset.newDay; const newDate = days[di];
          const newStart = fmtHM(startMin), newEnd = fmtHM(startMin + dur);
          await Store.updateTask(t.id, { due_date: newDate, due_time: newStart, end_time: newEnd, remind_at: computeRemindAt(newDate, newStart, t.notify !== false), notified: false });
        }
        pushUndo("перенос", () => Store.updateTask(t.id, prev)); renderTasks();
      };
      holdTimer = setTimeout(engage, DRAG_HOLD_MS);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
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
    $$("#p-task-list .task").forEach((el) => attachSwipe(el, async () => { const o = projTasksById[el.dataset.id]; await Store.deleteTask(el.dataset.id); if (o) pushUndo("удаление задачи", () => Store.restoreTask(o)); renderProjectTasks(); }));
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
      if (act === "status") { const prev = { status: t.status, is_done: t.is_done }; openStatusPicker("task", statusOf(t), async (k) => { await Store.updateTask(t.id, { status: k, is_done: statusIsDone("task", k) }); pushUndo("статус", () => Store.updateTask(t.id, prev)); onChange(); }); return; }
      if (act === "project") { const prev = t.project_id || null; openProjectPicker(t.project_id || null, async (id) => { await Store.updateTask(t.id, { project_id: id }); pushUndo("проект", () => Store.updateTask(t.id, { project_id: prev })); onChange(); }); return; }
      if (act === "time") { const prev = { due_date: t.due_date || null, due_time: t.due_time || null, end_time: t.end_time || null, notify: t.notify, remind_at: t.remind_at, notified: t.notified }; openDateTime({ date: t.due_date, time: t.due_time, endTime: t.end_time, notify: t.notify !== false, onDone: async (date, time, endTime, notify) => { await updateTaskDateTime(t.id, date, time, endTime, notify); pushUndo("дата", () => Store.updateTask(t.id, prev)); onChange(); } }); return; }
      openTaskEdit(t, returnView);
    };
  }
  $("#task-list").addEventListener("click", taskListClick(() => tasksById, renderTasks, "tasks"));
  $("#p-task-list").addEventListener("click", taskListClick(() => projTasksById, renderProjectTasks, "project"));
  // Уведомление: включено + есть дата → в это время; без времени → в 11:00; без даты → нет.
  function computeRemindAt(date, time, notify) { if (!(notify && date)) return null; const d = new Date(`${date}T${time || "11:00"}:00`); if (isNaN(d)) return null; if (time) d.setHours(d.getHours() - 1); return d.toISOString(); }   // напоминание за час до начала (если есть время)
  async function updateTaskDateTime(id, date, time, endTime, notify) { const remind_at = computeRemindAt(date, time, notify); await Store.updateTask(id, { due_date: date || null, due_time: time || null, end_time: endTime || null, notify, remind_at, notified: false }); }
  // Прибавить минуты к "ЧЧ:ММ" (с ограничением 23:59). Пусто → "".
  function timeAddMin(hhmm, n) { if (!hhmm) return ""; const p = String(hhmm).split(":"); let m = (+p[0]) * 60 + (+p[1]); if (isNaN(m)) return ""; m = Math.min(23 * 60 + 59, m + n); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  // Дефолтное время окончания = начало + 15 минут.
  function defaultEndTime(start) { return timeAddMin(start, 15); }

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
  let cardEndTime = "";   // дата окончания всегда = дате начала; отдельно только время окончания
  function renderCardMeta() {
    $("#t-date").textContent = cardDate ? fmtFull(cardDate) : "дата";
    $("#t-time").value = cardTime || "";
    $("#t-end-time").value = cardEndTime || "";
    $("#t-notify").innerHTML = cardNotify ? BELL_ON : BELL_OFF; $("#t-notify").classList.toggle("off", !cardNotify);
    $("#t-status").innerHTML = statusPill("task", cardStatus);
    const p = projById(cardProjectId);
    $("#t-project").innerHTML = projPillInner(p); $("#t-project").classList.toggle("is-empty", !p);
  }
  function taskFields() {
    const remind_at = computeRemindAt(cardDate, cardTime, cardNotify);
    return { title: $("#t-title").textContent.trim(), description: descSerialize($("#t-desc")), due_date: cardDate || null, due_time: cardTime || null, end_time: cardEndTime || null, notify: cardNotify, project_id: cardProjectId || null, status: cardStatus, is_done: statusIsDone("task", cardStatus), remind_at, notified: false };
  }
  async function saveTaskDraft() { if (editingTaskId) await Store.updateTask(editingTaskId, taskFields()); }
  const saveTaskDebounced = debounce(saveTaskDraft, 400);
  $("#t-date").addEventListener("click", () => openCalendar({ value: cardDate, allowAll: true, clearLabel: "очистить дату", onPick: (v) => { cardDate = v; taskTouched = true; renderCardMeta(); saveTaskDraft(); } }));
  $("#t-time").addEventListener("input", (e) => { cardTime = e.target.value; taskTouched = true; saveTaskDraft(); });
  // дефолт «конец = начало + 15» ставим по завершении ввода (change), а не на каждый символ — иначе при печати минут срабатывает на промежуточном значении
  $("#t-time").addEventListener("change", () => { if (cardTime && !cardEndTime) { cardEndTime = defaultEndTime(cardTime); $("#t-end-time").value = cardEndTime; taskTouched = true; saveTaskDraft(); } });
  $("#t-time-clear").addEventListener("click", () => { cardTime = ""; $("#t-time").value = ""; taskTouched = true; saveTaskDraft(); });
  $("#t-end-time").addEventListener("input", (e) => { cardEndTime = e.target.value; taskTouched = true; saveTaskDraft(); });
  $("#t-end-clear").addEventListener("click", () => { cardEndTime = ""; $("#t-end-time").value = ""; taskTouched = true; saveTaskDraft(); });
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
    cardEndTime = "";
    $("#t-title").innerText = ""; $("#t-desc").innerHTML = ""; renderCardMeta();
    const draft = await Store.addTask(taskFields()); editingTaskId = draft.id;
    $("#t-submit").textContent = "Готово"; $("#t-delete").hidden = false;
    showView("task"); $("#t-title").focus();
  }
  function openTaskEdit(t, returnView) {
    editReturn = returnView || "tasks"; editingTaskId = t.id; cardDate = t.due_date || tomorrowStr(); cardTime = t.due_time || ""; cardNotify = t.notify !== false; cardStatus = statusOf(t); cardProjectId = t.project_id || null; taskTouched = true;
    cardEndTime = t.end_time || "";
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
  $("#t-delete").addEventListener("click", async () => { if (editingTaskId && await askConfirm("Удалить задачу?")) { const rv = editReturn; const o = (await Store.tasks()).find((x) => x.id === editingTaskId); await Store.deleteTask(editingTaskId); if (o) pushUndo("удаление задачи", () => Store.restoreTask(o)); editingTaskId = null; showView(rv === "project" ? "project" : "tasks"); } });

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
    const prevState = {}; orderedProjects().forEach((p) => { prevState[p.id] = { status: p.status, sort: p.sort }; });
    const updates = [];
    const renumber = (colEl) => { if (!colEl) return; [...colEl.querySelectorAll(".kb-card")].forEach((c, i) => { const p = projById(c.dataset.id); if (!p) return; const patch = {}; if (p.sort !== i) { p.sort = i; patch.sort = i; } if (p === proj && statusChanged) { p.status = toStatus; patch.status = toStatus; } if (Object.keys(patch).length) updates.push({ id: p.id, patch }); }); };
    renumber(toCol); if (fromCol && fromCol !== toCol) renumber(fromCol);
    // пустые колонки снова скрыть
    $$("#kanban .kb-col").forEach((c) => c.classList.toggle("kb-col--empty", !c.querySelector(".kb-card")));
    for (const u of updates) await Store.updateProject(u.id, u.patch);
    if (updates.length) pushUndo("перемещение", async () => { for (const u of updates) { const pv = prevState[u.id]; if (!pv) continue; await Store.updateProject(u.id, { status: pv.status, sort: pv.sort }); const p = projById(u.id); if (p) { p.status = pv.status; p.sort = pv.sort; } } });
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
  $("#p-delete").addEventListener("click", async () => { if (editingProjectId && await askConfirm("Удалить проект?")) { const o = (await Store.projects()).find((x) => x.id === editingProjectId); await Store.deleteProject(editingProjectId); if (o) pushUndo("удаление проекта", () => Store.restoreProject(o)); editingProjectId = null; await loadProjects(); showView("projects"); } });

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
    $$("#note-list .note").forEach((el) => attachSwipe(el, async () => { const o = notesById[el.dataset.id]; await Store.deleteNote(el.dataset.id); if (o) pushUndo("удаление заметки", () => Store.restoreNote(o)); renderNotes(); }));
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
    $$("#habit-list .habit").forEach((el) => attachSwipe(el, async () => { const o = habitsById[el.dataset.id]; await Store.deleteHabit(el.dataset.id); if (o) pushUndo("удаление привычки", () => Store.restoreHabit(o)); renderHabits(); }));
  }
  $("#habit-list").addEventListener("click", async (e) => {
    if (justSwiped) return;
    const bar = e.target.closest(".hb-bar"); if (!bar) return;   // тап по заголовку — ничего
    const row = bar.closest(".habit"); const h = habitsById[row.dataset.id]; if (!h) return;
    const prev = { progress: h.progress, week: h.week };
    const next = habitProgress(h) >= 7 ? 0 : habitProgress(h) + 1;
    h.progress = next; h.week = habitWeek();
    [...bar.querySelectorAll(".hb-cell")].forEach((c, i) => c.classList.toggle("on", i < next));
    await Store.updateHabit(h.id, { progress: next, week: h.week });
    pushUndo("привычка", () => Store.updateHabit(h.id, prev));
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
    $$("#fincat-list .fincat-row").forEach((el) => attachSwipe(el, async () => { const o = finCatPageTx.find((x) => x.id === el.dataset.id); await Store.deleteFinTx(el.dataset.id); if (o) pushUndo("удаление траты", () => Store.restoreFinTx(o)); renderFinCatPage(); }));
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
    if (e.target.closest(".fincat-del")) { if (!(await askConfirm("Удалить трату?"))) return; const o = finCatPageTx.find((t) => t.id === id); await Store.deleteFinTx(id); if (o) pushUndo("удаление траты", () => Store.restoreFinTx(o)); renderFinCatPage(); return; }
    const tx = finCatPageTx.find((t) => t.id === id); if (tx) openFinTx({ edit: tx });
  });

  /* ---------- Список покупок (страница-заметка с автосохранением + realtime) ---------- */
  let shopInited = false, shopSaveTimer = null, shopChannel = null;
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
    subscribeShopRealtime();
  }
  function scheduleShopSave() { clearTimeout(shopSaveTimer); shopSaveTimer = setTimeout(saveShop, 400); }
  async function saveShop() { clearTimeout(shopSaveTimer); await Store.saveShopList(descSerialize($("#shop-body"))); }
  // Реалтайм между устройствами: при внешнем изменении строки shop_list — подтянуть, но не сбивать активный ввод
  function subscribeShopRealtime() {
    if (!sb || !Store.userId || shopChannel) return;
    try {
      shopChannel = sb.channel("shop_" + Store.userId)
        .on("postgres_changes", { event: "*", schema: "public", table: "shop_list", filter: "user_id=eq." + Store.userId }, (payload) => {
          const body = $("#shop-body"); const incoming = payload.new && payload.new.body;
          if (currentView !== "shop" || !incoming) return;
          if (document.activeElement === body) return;                 // печатает — не перетираем
          if (descSerialize(body) === incoming) return;                // уже актуально
          descLoad(body, incoming);
        }).subscribe();
    } catch (e) { shopChannel = null; }
  }
  $("#shop-link").addEventListener("click", () => showView("shop"));
  function shopUndoSnapshot(label) { const prev = descSerialize($("#shop-body")); pushUndo(label, async () => { await Store.saveShopList(prev); if (currentView === "shop") descLoad($("#shop-body"), prev); }); }
  $("#shop-uncheck").addEventListener("click", () => {
    shopUndoSnapshot("отметки");
    $$("#shop-body .chk").forEach((c) => { c.setAttribute("data-checked", "0"); c.classList.remove("is-done"); });
    saveShop();
  });
  $("#shop-reset").addEventListener("click", async () => {
    if (!(await askConfirm("Очистить список?", "Вернётся стандартный набор категорий и позиций"))) return;
    shopUndoSnapshot("список покупок");
    descLoad($("#shop-body"), DEFAULT_SHOP_HTML); saveShop();
  });
  $("#shop-done").addEventListener("click", () => { saveShop(); showView("notes"); });

  /* ---------- Калории ---------- */
  const MEALS = [
    { id: "breakfast", name: "завтрак", icon: "🍳" },
    { id: "lunch", name: "обед", icon: "🍲" },
    { id: "dinner", name: "ужин", icon: "🍜" },
    { id: "other", name: "другое", icon: "🍎" },
    { id: "activity", name: "активность", icon: "🎾" },
  ];
  const mealById = (id) => MEALS.find((m) => m.id === id);
  // версия ассетов берётся из тега <script src="app.js?v=NN"> — чтобы data-файлы кэшировались синхронно
  const ASSET_V = (function () { try { const s = [...document.scripts].find((x) => /app\.js/.test(x.src || "")); const m = s && (s.src || "").match(/[?&]v=([^&]+)/); return m ? m[1] : ""; } catch (e) { return ""; } })();
  let foodDate = todayStr(), foodView = "day", foodMealId = null, foodMealCache = [];
  // Недавно добавленные (свои у каждого пользователя, хранятся локально; продукт + последний вес)
  const RECENT_MAX = 20;   // TODO: уточнить число позже
  function recentsKey() { return "gunco_recents_" + (Store.userId || "local"); }
  function loadRecents() { try { return JSON.parse(localStorage.getItem(recentsKey())) || []; } catch (e) { return []; } }
  function saveRecents(list) { try { localStorage.setItem(recentsKey(), JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) {} }
  function pushRecent(name, amount, meal) { const list = loadRecents().filter((r) => r.name !== name); list.unshift({ name, amount, meal }); saveRecents(list); }
  let foodDb = null, actDb = null; const foodDbById = {}, actDbById = {};
  const fcState = { y: new Date().getFullYear(), m: new Date().getMonth() };

  async function loadFoodDb() {
    if (foodDb && actDb) return;
    try {
      const q = ASSET_V ? "?v=" + ASSET_V : "";
      const [f, a] = await Promise.all([
        fetch("data/foods.json" + q).then((r) => r.json()),
        fetch("data/activities.json" + q).then((r) => r.json()),
      ]);
      foodDb = (f.items || []).slice(); actDb = (a.items || []).slice();
      foodDb.forEach((x) => (foodDbById[x.name] = x));
      actDb.forEach((x) => (actDbById[x.name] = x));
    } catch (e) { foodDb = foodDb || []; actDb = actDb || []; toast("не удалось загрузить базу продуктов"); }
  }

  // Store-методы журнала калорий
  Store.foodLog = async function (date) {
    if (sb && this.userId) { const { data } = await sb.from("food_log").select("*").eq("user_id", this.userId).eq("date", date); return data || []; }
    return Local.ensure().foodLog.filter((x) => x.date === date);
  };
  Store.addFood = async function (e) {
    const base = { date: e.date, meal: e.meal, ref_id: e.ref_id, name: e.name, amount: Math.round(e.amount), kcal: Math.round(e.kcal) };
    if (sb && this.userId) { const { data } = await sb.from("food_log").insert({ ...base, user_id: this.userId }).select().single(); return data; }
    const d = Local.ensure(); const row = { id: uid(), created_at: new Date().toISOString(), ...base }; d.foodLog.push(row); Local.write(d); return row;
  };
  Store.deleteFood = async function (id) {
    if (sb && this.userId) { await sb.from("food_log").delete().eq("id", id); return; }
    const d = Local.ensure(); d.foodLog = d.foodLog.filter((x) => x.id !== id); Local.write(d);
  };
  Store.restoreFood = function (o) { return this._restore("food_log", "foodLog", o); };

  function foodSearch(q) {
    q = (q || "").trim().toLowerCase();
    const db = (foodMealIdForSearch() === "activity" ? actDb : foodDb) || [];
    if (!q) return db.slice(0, 50);
    const starts = [], contains = [];
    db.forEach((it) => {
      const n = it.name.toLowerCase();
      if (n.startsWith(q)) starts.push(it);
      else if (n.includes(q) || (it.aliases || []).some((a) => a.toLowerCase().includes(q))) contains.push(it);
    });
    return starts.concat(contains).slice(0, 50);
  }

  function updateFoodHeader() {
    const d = new Date(foodDate + "T00:00:00");
    $("#food-wd").textContent = WEEKDAYS[d.getDay()];
    $("#food-dn").textContent = d.getDate();
    $("#food-mon").textContent = MONTHS_GEN[d.getMonth()];
  }
  async function renderFood() {
    await loadFoodDb();
    updateFoodHeader();
    $$(".food-view-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.fview === foodView));
    $("#food-day").hidden = foodView !== "day";
    $("#food-cal").hidden = foodView !== "cal";
    if (foodView === "cal") { drawFoodCal(); return; }
    const log = await Store.foodLog(foodDate);
    const byMeal = {}; MEALS.forEach((m) => (byMeal[m.id] = []));
    log.forEach((e) => { (byMeal[e.meal] = byMeal[e.meal] || []).push(e); });
    $("#food-meals").innerHTML = MEALS.map((m) => {
      const items = byMeal[m.id] || []; const sum = items.reduce((s, x) => s + (x.kcal || 0), 0);
      const isAct = m.id === "activity";
      const sumTxt = !items.length ? "0" : (isAct ? "−" + sum : String(sum));
      return `<button class="food-meal-row${isAct ? " food-meal-row--act" : ""}" data-meal="${m.id}" type="button">
        <span class="food-meal-ico">${m.icon}</span>
        <span class="food-meal-name">${m.name}</span>
        <span class="food-meal-sum">${sumTxt}</span>
      </button>`;
    }).join("");
    const eaten = MEALS.filter((m) => m.id !== "activity").reduce((s, m) => s + (byMeal[m.id] || []).reduce((a, x) => a + (x.kcal || 0), 0), 0);
    const burned = (byMeal["activity"] || []).reduce((a, x) => a + (x.kcal || 0), 0);
    $("#food-total-num").textContent = String(eaten - burned);
    // недавно добавленные плашки (продукт + вес, без калорий)
    $("#food-recents").innerHTML = loadRecents().map((r) =>
      `<button class="food-recent" data-name="${esc(r.name)}" data-amt="${r.amount}" data-meal="${r.meal || "other"}" type="button"><span class="food-recent-name">${esc(r.name)}</span><span class="food-recent-amt">${r.amount} г</span></button>`
    ).join("");
  }
  $("#food-meals").addEventListener("click", (e) => { const row = e.target.closest(".food-meal-row"); if (!row) return; foodMealId = row.dataset.meal; showView("foodmeal"); });
  $("#food-recents").addEventListener("click", (e) => { const b = e.target.closest(".food-recent"); if (!b) return; openFoodAdd(b.dataset.meal || "other", { name: b.dataset.name, amount: +b.dataset.amt }); });
  $$(".food-view-btn").forEach((b) => b.addEventListener("click", () => { foodView = b.dataset.fview; if (foodView === "cal") { const d = new Date(foodDate + "T00:00:00"); fcState.y = d.getFullYear(); fcState.m = d.getMonth(); } renderFood(); }));

  function drawFoodCal() { drawCal({ y: fcState.y, m: fcState.m, value: foodDate }, $("#fc-grid"), $("#fc-title"), (d) => { foodDate = d; foodView = "day"; renderFood(); }); }
  $("#fc-prev").addEventListener("click", () => { fcState.m--; if (fcState.m < 0) { fcState.m = 11; fcState.y--; } drawFoodCal(); });
  $("#fc-next").addEventListener("click", () => { fcState.m++; if (fcState.m > 11) { fcState.m = 0; fcState.y++; } drawFoodCal(); });

  async function renderFoodMeal() {
    const m = mealById(foodMealId); if (!m) return;
    const isAct = m.id === "activity";
    const log = await Store.foodLog(foodDate);
    const list = log.filter((e) => e.meal === foodMealId).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    foodMealCache = list;
    $("#foodmeal-empty").hidden = list.length > 0;
    $("#foodmeal-list").innerHTML = list.map((e) => {
      const isKcal = e.ref_id === "__kcal__";
      const unit = isAct ? "мин" : "г";
      const amtTxt = isKcal ? "" : `${e.amount} ${unit}`;   // прямой ввод калорий — без граммов
      const kcalTxt = isAct ? "−" + e.kcal : String(e.kcal);
      return `<div class="fincat-row swipeable" data-id="${e.id}">
        <div class="swipe-del">${TRASH_SVG}</div>
        <div class="swipe-row food-item-row"><button class="fincat-del" data-act="del" type="button" aria-label="Удалить">${TRASH_SVG}</button><span class="food-item-name">${esc(e.name)}</span><span class="food-item-amt">${amtTxt}</span><span class="food-item-kcal${isAct ? " is-burn" : ""}">${kcalTxt}</span></div>
      </div>`;
    }).join("");
    $$("#foodmeal-list .fincat-row").forEach((el) => attachSwipe(el, async () => { const o = foodMealCache.find((x) => x.id === el.dataset.id); await Store.deleteFood(el.dataset.id); if (o) pushUndo("удаление позиции", () => Store.restoreFood(o)); renderFoodMeal(); }));
  }
  $("#foodmeal-list").addEventListener("click", async (e) => {
    if (justSwiped) return;
    const row = e.target.closest(".fincat-row"); if (!row) return;
    if (e.target.closest(".fincat-del")) { if (!(await askConfirm("Удалить позицию?"))) return; const o = foodMealCache.find((x) => x.id === row.dataset.id); await Store.deleteFood(row.dataset.id); if (o) pushUndo("удаление позиции", () => Store.restoreFood(o)); renderFoodMeal(); }
  });

  // Добавление позиции: приём в шапке + поиск + количество
  let addMeal = null, addPicked = null;
  function foodMealIdForSearch() { return addMeal; }
  function renderAddMeals() {
    $("#foodadd-meals").innerHTML = MEALS.map((m) => `<button class="foodadd-meal${m.id === addMeal ? " is-on" : ""}" data-meal="${m.id}" type="button"><span class="foodadd-meal-ico">${m.icon}</span><span class="foodadd-meal-name">${m.name}</span></button>`).join("");
  }
  // Применить меняющиеся под приём элементы окна (единицы, плейсхолдер, строка калорий)
  function applyAddMeal() {
    const isAct = addMeal === "activity";
    $("#foodadd-search").placeholder = isAct ? "поиск активности" : "поиск блюда";
    $("#foodadd-unit").textContent = isAct ? "мин" : "г";
    $("#foodadd-kcal-row").hidden = isAct;   // прямой ввод калорий — только для приёмов пищи
    renderAddMeals();
  }
  function setAddMeal(mealId) {
    if (mealId === addMeal) return;
    addMeal = mealId; addPicked = null;
    $("#foodadd-picked").hidden = true; $("#foodadd-ok").disabled = true;
    applyAddMeal();
    renderFoodResults($("#foodadd-search").value);
  }
  $("#foodadd-meals").addEventListener("click", (e) => { const b = e.target.closest(".foodadd-meal"); if (!b) return; setAddMeal(b.dataset.meal); });
  async function openFoodAdd(mealId, preselect) {
    await loadFoodDb();
    addMeal = mealId || "breakfast"; addPicked = null;   // по умолчанию — завтрак
    $("#foodadd-search").value = "";
    $("#foodadd-picked").hidden = true; $("#foodadd-ok").disabled = true;
    applyAddMeal();
    renderFoodResults("");
    $("#foodadd-modal").hidden = false;
    if (preselect && preselect.name) pickFood(preselect.name, preselect.amount);
    else setTimeout(() => $("#foodadd-search").focus(), 30);
  }
  function renderFoodResults(q) {
    const isAct = addMeal === "activity";
    const res = foodSearch(q);
    $("#foodadd-results").innerHTML = res.length
      ? res.map((it) => `<button class="foodadd-item" data-name="${esc(it.name)}" type="button"><span class="foodadd-item-name">${esc(it.name)}</span><span class="foodadd-item-kcal">${isAct ? it.kcalMin + " ккал/мин" : it.kcal100 + " ккал"}</span></button>`).join("")
      : `<div class="foodadd-empty">ничего не найдено</div>`;
  }
  $("#foodadd-search").addEventListener("input", (e) => renderFoodResults(e.target.value));
  $("#foodadd-results").addEventListener("click", (e) => { const b = e.target.closest(".foodadd-item"); if (!b) return; pickFood(b.dataset.name); });
  function pickFood(name, amount) {
    const isAct = addMeal === "activity";
    const it = isAct ? actDbById[name] : foodDbById[name]; if (!it) return;
    addPicked = it;
    $("#foodadd-picked-name").textContent = it.name;
    $("#foodadd-unit").textContent = isAct ? "мин" : "г";
    $("#foodadd-amount").value = amount != null ? amount : (isAct ? 30 : 100);
    $("#foodadd-picked").hidden = false; $("#foodadd-ok").disabled = false;
    updateAddKcal();
    setTimeout(() => { const a = $("#foodadd-amount"); a.focus(); a.select(); }, 20);
  }
  // Прямой ввод калорий: продукт «Калории», вводится количество калорий (не грамм)
  function pickKcalDirect() {
    addPicked = { name: "Калории", direct: true };
    $("#foodadd-picked-name").textContent = "Калории";
    $("#foodadd-unit").textContent = "ккал";
    $("#foodadd-amount").value = 100;
    $("#foodadd-picked").hidden = false; $("#foodadd-ok").disabled = false;
    updateAddKcal();
    setTimeout(() => { const a = $("#foodadd-amount"); a.focus(); a.select(); }, 20);
  }
  $("#foodadd-kcal-row").addEventListener("click", () => pickKcalDirect());
  function addKcalValue() {
    if (!addPicked) return 0;
    const amt = Math.max(0, parseInt($("#foodadd-amount").value, 10) || 0);
    if (addPicked.direct) return amt;
    return addMeal === "activity" ? Math.round(addPicked.kcalMin * amt) : Math.round(addPicked.kcal100 * amt / 100);
  }
  function updateAddKcal() {
    if (addPicked && addPicked.direct) { $("#foodadd-kcal").textContent = ""; return; }   // при прямом вводе граммы = калории, предпросмотр не нужен
    $("#foodadd-kcal").textContent = (addMeal === "activity" ? "−" : "") + addKcalValue() + " ккал";
  }
  $("#foodadd-amount").addEventListener("input", updateAddKcal);
  $("#foodadd-ok").addEventListener("click", async () => {
    if (!addPicked) return;
    const amt = Math.max(0, parseInt($("#foodadd-amount").value, 10) || 0);
    if (amt <= 0) { $("#foodadd-amount").focus(); return; }
    const kcal = addKcalValue();
    const direct = !!addPicked.direct;
    const row = await Store.addFood({ date: foodDate, meal: addMeal, ref_id: direct ? "__kcal__" : addPicked.name, name: addPicked.name, amount: amt, kcal });
    if (row) pushUndo("добавление позиции", () => Store.deleteFood(row.id));
    if (!direct && addMeal !== "activity") pushRecent(addPicked.name, amt, addMeal);   // недавние — только реальные продукты
    toast(addPicked.name + " добавлено");
    addPicked = null; $("#foodadd-picked").hidden = true; $("#foodadd-ok").disabled = true;
    $("#foodadd-search").value = ""; renderFoodResults(""); $("#foodadd-search").focus();
    refreshFoodViews();
  });
  $("#foodadd-close").addEventListener("click", () => { $("#foodadd-modal").hidden = true; refreshFoodViews(); });
  $("#foodadd-modal").addEventListener("click", (e) => { if (e.target.id === "foodadd-modal") { $("#foodadd-modal").hidden = true; refreshFoodViews(); } });
  function refreshFoodViews() { if (currentView === "foodmeal") renderFoodMeal(); else if (currentView === "food") renderFood(); }

  /* ---------- Быстрое добавление через ИИ ----------
     Свободный текст/голос → Edge Function ai-parse (Claude) → превью → создание через Store.*  */
  let aiItems = [], aiTasksFull = [], aiNotesFull = [];
  function aiEndpoint() { return (CFG.SUPABASE_URL || "").replace(/\/+$/, "") + "/functions/v1/ai-parse"; }
  function aiContextNow() {
    const d = new Date(); const wd = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][d.getDay()];
    return `${dstr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())} (${wd})`;
  }
  function aiSetStatus(text, opts) {
    const s = $("#ai-status"); opts = opts || {};
    if (!text) { s.hidden = true; s.innerHTML = ""; s.classList.remove("is-error"); return; }
    s.hidden = false; s.classList.toggle("is-error", !!opts.error);
    s.innerHTML = (opts.loading ? `<span class="ai-spin"></span>` : "") + `<span>${esc(text)}</span>`;
  }
  function aiClear() {
    $("#ai-text").value = ""; aiItems = [];
    $("#ai-preview").hidden = true; $("#ai-preview").innerHTML = "";
    aiSetStatus("");
    $("#ai-foot").hidden = true;
    const add = $("#ai-add"); add.textContent = "Добавить"; add.classList.remove("btn--danger");
  }
  // Компактные списки существующих сущностей — чтобы ИИ мог сослаться на них при изменении/удалении.
  function aiCompactTasks(full) {
    return (full || []).slice()
      .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
      .slice(0, 120)
      .map((t) => ({ id: t.id, title: t.title || "", date: t.due_date || "", time: t.due_time || "", done: t.is_done === true || statusIsDone("task", t.status) }));
  }
  function aiCompactNotes(full) {
    return (full || []).slice(0, 80).map((n) => ({ id: n.id, title: n.title || (n.body || "").replace(/<[^>]+>/g, " ").trim().slice(0, 40) || "заметка" }));
  }
  async function aiParseText(text) {
    const anon = CFG.SUPABASE_ANON_KEY || "";
    const res = await fetch(aiEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + anon, "apikey": anon },
      body: JSON.stringify({
        text, now: aiContextNow(), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow"),
        projects: orderedProjects().map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || "" })),
        finCategories: (finCatsCache && finCatsCache.length ? finCatsCache : await Store.finCategories()).map((c) => ({ id: c.id, name: c.name })),
        tasks: aiCompactTasks(aiTasksFull),
        notes: aiCompactNotes(aiNotesFull),
      }),
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ("Ошибка сервера " + res.status));
    return Array.isArray(data.items) ? data.items : (data.item ? [data.item] : []);
  }
  async function aiRecognize() {
    const text = ($("#ai-text").value || "").trim();
    if (!text) { $("#ai-text").focus(); return; }
    if (!CFG.SUPABASE_URL) { aiSetStatus("Разбор через ИИ требует входа в аккаунт (нужен сервер).", { error: true }); return; }
    if (!(sb && Store.userId)) { aiSetStatus("Войдите в аккаунт, чтобы пользоваться распознаванием.", { error: true }); return; }
    await loadProjects();
    try { aiTasksFull = await Store.tasks(); aiNotesFull = await Store.notes(); } catch (e) {}   // контекст для изменения/удаления
    aiSetStatus("думаю…", { loading: true }); $("#ai-preview").hidden = true;
    try { const items = await aiParseText(text); if (!items.length) { aiSetStatus("Не удалось распознать", { error: true }); return; } aiSetStatus(""); renderAiPreview(items); }
    catch (e) { aiSetStatus(e.message || "Не удалось распознать", { error: true }); }
  }
  const AI_KIND_RU = { task: "задача", project: "проект", note: "заметка", expense: "расход", income: "доход", food: "калории", activity: "активность" };
  function aiTarget(it) {
    if (!it || !it.target_id) return null;
    if (it.kind === "task") return aiTasksFull.find((t) => t.id === it.target_id) || null;
    if (it.kind === "project") return projById(it.target_id);
    if (it.kind === "note") return aiNotesFull.find((n) => n.id === it.target_id) || null;
    return null;
  }
  function aiPreviewCard(it) {
    const hiddenHint = `<div class="ai-prev-hint">раздел скрыт в этой версии — запись сохранится и появится позже</div>`;
    const act = it.action === "delete" ? "удалить" : it.action === "update" ? "изменить" : null;
    const tgt = (it.action === "update" || it.action === "delete") ? aiTarget(it) : null;
    const kindRu = AI_KIND_RU[it.kind] || "запись";
    let html = act ? `<div class="ai-prev-kind"><span class="ai-prev-act ai-prev-act--${it.action}">${act}</span> · ${kindRu}</div>`
                   : `<div class="ai-prev-kind">${kindRu}</div>`;
    if (it.action === "delete") {
      html += `<div class="ai-prev-title">${tgt ? esc(tgt.title || tgt.name || "запись") : "запись не найдена"}</div>`;
      if (!tgt) html += `<div class="ai-prev-hint">не нашёл такую — проверьте формулировку</div>`;
      return `<div class="ai-prev-card${tgt ? "" : " is-warn"}">${html}</div>`;
    }
    if (it.kind === "task") {
      const proj = it.project_id ? projById(it.project_id) : null;
      const projLabel = proj ? `<span class="proj-pill"><span class="proj-emoji">${projEmoji(proj)}</span><span class="proj-name">${esc(proj.name)}</span></span>`
        : (it.project_new ? `<span class="ai-prev-pill">🆕 ${esc(it.project_new)}</span>` : "");
      const parts = [];
      if (it.due_date) parts.push(fmtFull(it.due_date));
      if (it.due_time) parts.push(it.due_time + (it.end_time ? "–" + it.end_time : ""));
      if (it.notify) parts.push("🔔 напомнить");
      if (it.mark_done === true) parts.push("✓ выполнена");
      if (it.mark_done === false) parts.push("↩ в работу");
      html += `<div class="ai-prev-title">${esc(it.title || (tgt && tgt.title) || "")}</div>`;
      const row = `${projLabel}${parts.map((p) => `<span class="ai-prev-pill">${esc(p)}</span>`).join("")}`;
      if (row) html += `<div class="ai-prev-row">${row}</div>`;
      if (it.description) html += `<div class="ai-prev-desc">${esc(it.description)}</div>`;
      if (it.action === "update" && !tgt) html += `<div class="ai-prev-hint">не нашёл задачу — будет создана новая</div>`;
    } else if (it.kind === "project") {
      html += `<div class="ai-prev-title">${it.emoji ? esc(it.emoji) + " " : ""}${esc(it.name || it.title || (tgt && tgt.name) || "")}</div>`;
    } else if (it.kind === "note") {
      const title = it.title || (tgt && tgt.title) || "";
      if (title) html += `<div class="ai-prev-title">${esc(title)}</div>`;
      html += `<div class="ai-prev-desc">${esc(it.body || it.description || "")}</div>`;
    } else if (it.kind === "expense" || it.kind === "income") {
      html += `<div class="ai-prev-amount">${it.kind === "income" ? "+" : "−"}${fmtMoney(Math.round((it.amount || 0) * 100))} ₽</div>`;
      const cat = it.category_id ? (finCatsCache || []).find((c) => c.id === it.category_id) : null;
      const bits = []; if (it.note) bits.push(esc(it.note)); if (cat) bits.push(esc(cat.name));
      if (bits.length) html += `<div class="ai-prev-row">${bits.map((b) => `<span class="ai-prev-pill">${b}</span>`).join("")}</div>`;
      if (!FEATURES.finance) html += hiddenHint;
    } else if (it.kind === "food") {
      html += `<div class="ai-prev-title">${esc(it.name || it.title || "")}</div>`;
      html += `<div class="ai-prev-row"><span class="ai-prev-pill">${Math.round(it.grams || 100)} г</span></div>`;
      if (!FEATURES.food) html += hiddenHint;
    } else if (it.kind === "activity") {
      html += `<div class="ai-prev-title">${esc(it.name || it.title || "")}</div>`;
      html += `<div class="ai-prev-row"><span class="ai-prev-pill">${Math.round(it.minutes || 0)} мин</span></div>`;
      if (!FEATURES.food) html += hiddenHint;
    }
    return `<div class="ai-prev-card">${html}</div>`;
  }
  function renderAiPreview(items) {
    aiItems = Array.isArray(items) ? items : (items ? [items] : []);
    $("#ai-preview").innerHTML = aiItems.map(aiPreviewCard).join("");
    $("#ai-preview").hidden = false;
    const hasDel = aiItems.some((x) => x.action === "delete");
    const hasMod = aiItems.some((x) => x.action === "update" || x.action === "delete");
    const add = $("#ai-add");
    add.textContent = aiItems.length > 1 ? (hasMod ? "Применить всё" : "Добавить всё")
      : (aiItems[0] && aiItems[0].action === "delete" ? "Удалить" : aiItems[0] && aiItems[0].action === "update" ? "Сохранить" : "Добавить");
    add.classList.toggle("btn--danger", hasDel);
    $("#ai-foot").hidden = false;
  }
  function aiMatchFood(name) { const q = (name || "").toLowerCase().trim(); return foodDbById[name] || (foodDb || []).find((x) => x.name.toLowerCase() === q) || (foodDb || []).find((x) => x.name.toLowerCase().startsWith(q)) || (foodDb || []).find((x) => x.name.toLowerCase().includes(q) || (x.aliases || []).some((a) => a.toLowerCase().includes(q))); }
  function aiMatchAct(name) { const q = (name || "").toLowerCase().trim(); return actDbById[name] || (actDb || []).find((x) => x.name.toLowerCase() === q) || (actDb || []).find((x) => x.name.toLowerCase().startsWith(q)) || (actDb || []).find((x) => x.name.toLowerCase().includes(q)); }
  function afterAiAdd(msg, view) { toast(msg); aiClear(); if (view) showView(view); }
  // Применить ОДНУ запись (create/update/delete). Возвращает раздел для перехода или null.
  async function aiApplyItem(it) {
    const action = it.action || "create";
    if (action === "delete") {
      const tgt = aiTarget(it); if (!tgt) return null;
      if (it.kind === "project") { await Store.deleteProject(tgt.id); await loadProjects(); return "projects"; }
      if (it.kind === "note") { await Store.deleteNote(tgt.id); return "notes"; }
      await Store.deleteTask(tgt.id); return "tasks";
    }
    if (action === "update") {
      const tgt = aiTarget(it);
      if (tgt && it.kind === "task") {
        const patch = {};
        if (it.title != null) patch.title = it.title;
        if (it.description != null) patch.description = it.description;
        if (it.due_date != null) patch.due_date = it.due_date;
        if (it.due_time !== undefined) patch.due_time = it.due_time || null;
        if (it.end_time !== undefined) patch.end_time = it.end_time || null;
        if (it.notify != null) patch.notify = !!it.notify;
        if (it.project_id != null) patch.project_id = it.project_id;
        if (it.project_new) { const p = await Store.addProject({ name: it.project_new }); patch.project_id = p && p.id; await loadProjects(); }
        if (it.mark_done != null) { patch.is_done = !!it.mark_done; patch.status = it.mark_done ? "done" : "progress"; }
        if ("due_date" in patch || "due_time" in patch || "notify" in patch) {
          const date = "due_date" in patch ? patch.due_date : tgt.due_date;
          const time = "due_time" in patch ? patch.due_time : tgt.due_time;
          const notify = "notify" in patch ? patch.notify : (tgt.notify !== false);
          patch.remind_at = computeRemindAt(date, time, notify); patch.notified = false;
        }
        const prev = {}; Object.keys(patch).forEach((k) => { prev[k] = tgt[k]; });
        await Store.updateTask(tgt.id, patch); pushUndo("изменение задачи", () => Store.updateTask(tgt.id, prev));
        return "tasks";
      }
      if (tgt && it.kind === "project") {
        const patch = {}; if (it.name != null) patch.name = it.name; if (it.emoji != null) patch.emoji = it.emoji;
        if (Object.keys(patch).length) await Store.updateProject(tgt.id, patch); await loadProjects(); return "projects";
      }
      if (tgt && it.kind === "note") {
        const patch = {}; if (it.title != null) patch.title = it.title; const nb = (it.body != null ? it.body : it.description); if (nb != null) patch.body = nb;
        if (Object.keys(patch).length) await Store.updateNote(tgt.id, patch); return "notes";
      }
      // цель не найдена — создаём заново (проваливаемся в create ниже)
    }
    // СОЗДАНИЕ (по умолчанию и как fallback для update без цели)
    if (it.kind === "task") {
      let pid = it.project_id || null;
      if (!pid && it.project_new) { const p = await Store.addProject({ name: it.project_new }); pid = p && p.id; await loadProjects(); }
      const due_date = it.due_date || todayStr(); const notify = !!it.notify;
      const fields = { title: it.title || "Задача", description: it.description || "", due_date, due_time: it.due_time || null, end_time: it.end_time || null, notify, project_id: pid || null, status: it.mark_done ? "done" : "progress", is_done: !!it.mark_done, remind_at: computeRemindAt(due_date, it.due_time || null, notify), notified: false };
      const row = await Store.addTask(fields); if (row) pushUndo("новая задача", () => Store.deleteTask(row.id));
      return "tasks";
    }
    if (it.kind === "project") {
      const row = await Store.addProject({ emoji: it.emoji || "", name: it.name || it.title || "Проект" }); if (row) pushUndo("новый проект", () => Store.deleteProject(row.id));
      await loadProjects(); return "projects";
    }
    if (it.kind === "note") {
      const row = await Store.addNote({ title: it.title || "", body: it.body || it.description || "" }); if (row) pushUndo("новая заметка", () => Store.deleteNote(row.id));
      return "notes";
    }
    if (it.kind === "expense" || it.kind === "income") {
      const row = await Store.addFinTx({ kind: it.kind === "income" ? "income" : "expense", amount_minor: Math.round((it.amount || 0) * 100), category_id: it.category_id || null, note: it.note || it.title || null });
      if (row) pushUndo(it.kind === "income" ? "доход" : "расход", () => Store.deleteFinTx(row.id));
      return FEATURES.finance ? "finance" : null;
    }
    if (it.kind === "food") {
      await loadFoodDb(); const m = aiMatchFood(it.name || it.title || ""); const grams = Math.max(1, Math.round(it.grams || 100));
      const kcal = m ? Math.round(m.kcal100 * grams / 100) : 0;
      const row = await Store.addFood({ date: todayStr(), meal: it.meal || "other", ref_id: m ? m.name : (it.name || it.title || ""), name: m ? m.name : (it.name || it.title || ""), amount: grams, kcal });
      if (row) pushUndo("калории", () => Store.deleteFood(row.id));
      return FEATURES.food ? "food" : null;
    }
    if (it.kind === "activity") {
      await loadFoodDb(); const a = aiMatchAct(it.name || it.title || ""); const minutes = Math.max(1, Math.round(it.minutes || 0));
      const kcal = a ? Math.round(a.kcalMin * minutes) : 0;
      const row = await Store.addFood({ date: todayStr(), meal: "activity", ref_id: a ? a.name : (it.name || it.title || ""), name: a ? a.name : (it.name || it.title || ""), amount: minutes, kcal });
      if (row) pushUndo("активность", () => Store.deleteFood(row.id));
      return FEATURES.food ? "food" : null;
    }
    return null;
  }
  async function aiAdd() {
    const items = aiItems; if (!items || !items.length) return;
    const dels = items.filter((x) => x.action === "delete" && aiTarget(x));
    if (dels.length) { const ok = await askConfirm(dels.length > 1 ? `Удалить записей: ${dels.length}?` : "Удалить запись?"); if (!ok) return; }
    aiSetStatus("применяю…", { loading: true });
    let done = 0, lastView = null;
    for (const it of items) { try { const v = await aiApplyItem(it); if (v) lastView = v; done++; } catch (e) {} }
    aiSetStatus("");
    if (!done) { aiSetStatus("Не удалось применить", { error: true }); return; }
    afterAiAdd(items.length > 1 ? `готово: ${done}` : "готово", lastView);
  }
  // Голоса больше нет: распознавание запускает стрелка. Заглушка на случай вызова из showView.
  function aiStopVoice() {}
  // Высота поля фиксирована в CSS (180px) — ничего не пересчитываем, страница не дёргается при фокусе.
  $("#ai-send").addEventListener("click", aiRecognize);
  $("#ai-add").addEventListener("click", aiAdd);
  $("#ai-clear").addEventListener("click", aiClear);
  $("#ai-text").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); aiRecognize(); } });

  /* Окно создания операции */
  let finTxKind = "expense", finTxCatId = null, finTxIncomeOnly = false, finTxEditId = null, finTxEditPrev = null;
  function renderFinTxCats() {
    const add = `<button type="button" class="proj-add-row" id="fintx-add-cat" aria-label="Новая категория"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg></button>`;
    $("#fintx-cats").innerHTML = add + finCatsCache.map((c) => `<button type="button" class="proj-pill fintx-cat ${c.id === finTxCatId ? "is-cur" : ""}" data-id="${c.id}"><span class="proj-emoji">${c.emoji || DEFAULT_EMOJI}</span><span class="proj-name">${esc(c.name)}</span><span class="status-del" data-del="${c.id}" aria-label="Удалить">×</span></button>`).join("");
    $("#fintx-add-cat").addEventListener("click", () => openFinCat());
  }
  async function openFinTx(opts) {
    opts = opts || {}; const ed = opts.edit || null; finTxEditId = ed ? ed.id : null;
    finTxEditPrev = ed ? { kind: ed.kind, amount_minor: ed.amount_minor, category_id: ed.category_id || null, note: ed.note || null } : null;
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
      const co = finCatsCache.find((x) => x.id === del.dataset.del);
      await Store.deleteFinCategory(del.dataset.del);
      if (co) pushUndo("удаление категории", () => Store.restoreFinCategory(co));
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
    if (finTxEditId) { const eid = finTxEditId, prev = finTxEditPrev; await Store.updateFinTx(eid, { kind: finTxKind, amount_minor: minor, category_id: catId, note }); if (prev) pushUndo("правка траты", () => Store.updateFinTx(eid, prev)); }
    else { const row = await Store.addFinTx({ kind: finTxKind, amount_minor: minor, category_id: catId, note }); if (row) pushUndo("новая трата", () => Store.deleteFinTx(row.id)); }
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
    $("#account-email").textContent = email || "аккаунт"; refreshNotifPerm(); pop.hidden = false;
  });
  $("#account-signout").addEventListener("click", async () => { $("#account-pop").hidden = true; if (sb) await sb.auth.signOut(); Store.userId = null; hasStarted = false; projectsCache = []; _projLoading = null; taskStatusesCache = seedStatuses(); projStatusesCache = seedStatuses(); _statusLoading = null; showAuth(); });
  document.addEventListener("click", (e) => { if (!$("#account-pop").hidden && !e.target.closest("#account-pop") && !e.target.closest("#account-btn")) $("#account-pop").hidden = true; });

  /* ---------- Уведомления (переключатель: вкл/выкл) ----------
     Нативно (Capacitor) — локальные уведомления на устройстве по remind_at.
     В браузере — web-push (VAPID + Service Worker + Supabase).
     Разрешение спрашивается только по нажатию колокольчика. */
  const VAPID_PUBLIC = CFG.VAPID_PUBLIC || "";
  const LN = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  let nativePerm = null;   // 'granted' | 'denied' | 'prompt' — статус нативного разрешения
  function urlB64ToUint8(b) { const p = "=".repeat((4 - (b.length % 4)) % 4); const s = (b + p).replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(s); const a = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function pushSupported() { return ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window); }
  function notifKey() { return "gunco_notif_" + (Store.userId || "local"); }
  function notifPref() { try { return localStorage.getItem(notifKey()); } catch (e) { return null; } }
  function setNotifPref(v) { try { localStorage.setItem(notifKey(), v); } catch (e) {} }
  function notifAvailable() { return isNative ? !!LN() : (pushSupported() && !!sb && !!Store.userId); }
  function permGranted() { return isNative ? (nativePerm === "granted") : (("Notification" in window) && Notification.permission === "granted"); }
  function permDenied() { return isNative ? (nativePerm === "denied") : (("Notification" in window) && Notification.permission === "denied"); }
  function notifOn() { return permGranted() && notifPref() === "1"; }
  // Рисуем колокольчик: обычный при включённых, зачёркнутый при выключенных/запрещённых
  function renderNotifBtn() {
    const b = $("#notif-btn"); if (!b) return;
    if (!notifAvailable()) { b.hidden = true; return; }
    b.hidden = false; const on = notifOn();
    b.classList.toggle("off", !on);
    $("#notif-label").textContent = on ? "уведомления вкл" : (permDenied() ? "уведомления запрещены" : "уведомления выкл");
  }
  async function refreshNotifPerm() { if (isNative && LN()) { try { nativePerm = (await LN().checkPermissions()).display; } catch (e) {} } renderNotifBtn(); }
  async function enableNotif() {
    if (isNative) {
      const ln = LN(); if (!ln) { toast("Уведомления недоступны"); return; }
      try { nativePerm = (await ln.requestPermissions()).display; } catch (e) {}
      if (nativePerm !== "granted") { toast("Разрешение не выдано"); renderNotifBtn(); return; }
      setNotifPref("1"); await syncNativeReminders(); toast("Уведомления включены"); renderNotifBtn(); return;
    }
    if (!pushSupported()) { toast("Уведомления не поддерживаются устройством"); return; }
    if (!VAPID_PUBLIC) { toast("Не настроен ключ уведомлений"); return; }
    let perm = Notification.permission; if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Разрешение не выдано"); renderNotifBtn(); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
      const j = sub.toJSON();
      if (sb && Store.userId) await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: Store.userId, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      setNotifPref("1"); toast("Уведомления включены");
    } catch { toast("Не удалось включить уведомления"); }
    renderNotifBtn();
  }
  async function disableNotif() {
    setNotifPref("0");
    if (isNative) { const ln = LN(); if (ln) { try { const p = await ln.getPending(); if (p.notifications && p.notifications.length) await ln.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) }); } catch (e) {} } }
    else if (pushSupported()) {
      try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); if (sb && Store.userId) await sb.from("push_subscriptions").delete().eq("endpoint", ep); } } catch (e) {}
    }
    toast("Уведомления выключены"); renderNotifBtn();
  }
  async function toggleNotif() {
    if (!notifAvailable()) return;
    if (permDenied()) { toast("Разрешите уведомления в настройках устройства"); return; }
    if (notifOn()) await disableNotif(); else await enableNotif();
  }
  $("#notif-btn").addEventListener("click", toggleNotif);
  // Нативно: пересобрать локальные напоминания из задач (отменить всё → запланировать будущие по remind_at)
  async function syncNativeReminders() {
    if (!isNative || notifPref() !== "1") return;
    const ln = LN(); if (!ln) return;
    try {
      const p = await ln.getPending();
      if (p.notifications && p.notifications.length) await ln.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) });
      const tasks = await Store.tasks(); const now = Date.now();
      const list = tasks
        .filter((t) => t.notify !== false && t.remind_at && !t.notified && new Date(t.remind_at).getTime() > now)
        .slice(0, 60)   // лимит iOS ~64 запланированных
        .map((t, i) => ({ id: i + 1, title: t.title || "Задача", body: "Напоминание", schedule: { at: new Date(t.remind_at) } }));
      if (list.length) await ln.schedule({ notifications: list });
    } catch (e) {}
  }
  let notifSyncTimer = null;
  function scheduleReminderSync() { if (!isNative || notifPref() !== "1") return; clearTimeout(notifSyncTimer); notifSyncTimer = setTimeout(syncNativeReminders, 600); }

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
    // нативно: восстановить статус уведомлений и пересобрать локальные напоминания
    if (isNative) { applyNativeStatusBar(); refreshNotifPerm(); syncNativeReminders(); }
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

  if ("serviceWorker" in navigator && !isNative) {   // в нативном приложении SW не нужен (ассеты локальные, уведомления нативные)
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    // клик по пуш-уведомлению у уже открытого приложения → раскрыть карточку задачи
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open-task") openTaskById(e.data.taskId);
    });
  }
})();
