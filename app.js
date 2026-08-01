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
  const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const WEEKDAYS = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 1400); }
  function copyText(t) { if (!t) return; try { navigator.clipboard.writeText(t).then(() => toast("скопировано"), () => toast("скопировано")); } catch { toast("скопировано"); } }

  /* ---------- Хранилище ---------- */
  const LKEY = "gunco_data_v1";
  const DEFAULT_TAGS = ["жизнь", "работа"];

  const Local = {
    read() { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { return {}; } },
    write(d) { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch (e) { toast("не хватает места (нужен вход/сервер)"); } },
    ensure() {
      const d = this.read();
      d.tasks = d.tasks || [];
      d.tasks.forEach((t) => { if (!t.id) t.id = uid(); });
      d.tags = d.tags || DEFAULT_TAGS.slice();
      if (!d.tagsV2) { d.tags = DEFAULT_TAGS.slice(); d.tagsV2 = true; }
      d.settings = d.settings || { theme: "dark", count: 5 };
      this.write(d); return d;
    },
  };

  const Store = {
    userId: null,
    async tasks() {
      if (sb && this.userId) { const { data } = await sb.from("tasks").select("*").eq("user_id", this.userId); return data || []; }
      return Local.ensure().tasks;
    },
    async addTask(t) {
      if (sb && this.userId) { const { data } = await sb.from("tasks").insert({ ...t, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { ...t, id: uid(), is_done: false }; d.tasks.push(row); Local.write(d); return row;
    },
    async updateTask(id, fields) {
      if (sb && this.userId) { await sb.from("tasks").update(fields).eq("id", id); return; }
      const d = Local.ensure(); const t = d.tasks.find((x) => x.id === id); if (t) Object.assign(t, fields); Local.write(d);
    },
    async toggleTask(id, done) { await this.updateTask(id, { is_done: done }); },
    async deleteTask(id) {
      if (sb && this.userId) { await sb.from("tasks").delete().eq("id", id); return; }
      const d = Local.ensure(); d.tasks = d.tasks.filter((x) => x.id !== id); Local.write(d);
    },
    async tags() {
      if (sb && this.userId) {
        const { data } = await sb.from("tags").select("*").eq("user_id", this.userId).order("name");
        if (!data || !data.length) { for (const n of DEFAULT_TAGS) await this.addTag(n); return DEFAULT_TAGS.slice(); }
        return data.map((x) => x.name);
      }
      return Local.ensure().tags;
    },
    async addTag(name) {
      if (sb && this.userId) { await sb.from("tags").insert({ name, user_id: this.userId }); return; }
      const d = Local.ensure(); if (!d.tags.includes(name)) d.tags.push(name); Local.write(d);
    },
    async settings() {
      if (sb && this.userId) { const { data } = await sb.from("settings").select("*").eq("user_id", this.userId).single(); return data || { theme: "dark", count: 5 }; }
      return Local.ensure().settings;
    },
    async saveSettings(s) {
      if (sb && this.userId) { await sb.from("settings").upsert({ user_id: this.userId, ...s }); return; }
      const d = Local.ensure(); d.settings = { ...d.settings, ...s }; Local.write(d);
    },
  };

  /* ---------- Тема ---------- */
  function applyTheme(theme) { document.documentElement.setAttribute("data-theme", theme); Store.saveSettings({ theme }); }
  $("#theme-btn").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

  /* ---------- Подтверждение ---------- */
  const TRASH_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5.5h6V7M6.5 7l.9 12.5h9.2L17.5 7"/></svg>`;
  const BELL_BASE = `<path d="M6 8.6a6 6 0 0112 0c0 4.4 1.8 5.7 2.4 6.2.4.3.1.9-.4.9H4c-.5 0-.8-.6-.4-.9.6-.5 2.4-1.8 2.4-6.2z"/><path d="M10 19a2 2 0 004 0"/>`;
  const BELL_ON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">${BELL_BASE}</svg>`;
  const BELL_OFF = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;opacity:.6">${BELL_BASE}<line x1="4.5" y1="4" x2="20" y2="20.5"/></svg>`;
  let confirmResolve = null;
  function askConfirm(text = "Удалить?") { $("#confirm-text").textContent = text; $("#confirm-modal").hidden = false; return new Promise((res) => (confirmResolve = res)); }
  function closeConfirm(v) { $("#confirm-modal").hidden = true; if (confirmResolve) { confirmResolve(v); confirmResolve = null; } }
  $("#confirm-yes").addEventListener("click", () => closeConfirm(true));
  $("#confirm-no").addEventListener("click", () => closeConfirm(false));
  $("#confirm-modal").addEventListener("click", (e) => { if (e.target.id === "confirm-modal") closeConfirm(false); });

  /* ---------- Свайп строки: удаление (влево) ---------- */
  let justSwiped = false;
  function attachSwipe(el, onDelete) {
    const fg = el.querySelector(".swipe-row");
    let startX = 0, startY = 0, dx = 0, dragging = false;
    el.addEventListener("touchstart", (e) => { const t = e.touches[0]; startX = t.clientX; startY = t.clientY; dx = 0; dragging = true; fg.style.transition = "none"; }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const t = e.touches[0]; const mx = t.clientX - startX, my = t.clientY - startY;
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { dragging = false; fg.style.transform = ""; return; }
      dx = Math.min(0, mx); fg.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    el.addEventListener("touchend", async () => {
      if (!dragging) return; dragging = false;
      fg.style.transition = "transform .2s";
      if (dx < -70) {
        justSwiped = true; setTimeout(() => (justSwiped = false), 400);
        fg.style.transform = "translateX(-100%)";
        if (await askConfirm("Удалить?")) await onDelete(); else fg.style.transform = "translateX(0)";
      } else fg.style.transform = "translateX(0)";
    });
  }

  /* ---------- Календарь ---------- */
  const cal = { y: 0, m: 0, value: "", mode: "filter", onPick: null, allowAll: false };
  function openCalendar({ value, mode = "filter", time = "", notify = true, allowAll = false, onPick }) {
    const base = (value || todayStr()).split("-");
    cal.y = +base[0]; cal.m = +base[1] - 1; cal.value = value || (allowAll ? "" : todayStr());
    cal.mode = mode; cal.onPick = onPick; cal.allowAll = allowAll;
    $("#cal-extra").hidden = mode !== "task";
    $("#cal-done").hidden = mode !== "task";
    $("#cal-all").hidden = !allowAll;
    $("#cal-time").value = time || "";
    $("#cal-notify").classList.toggle("off", !notify);
    renderCal(); $("#cal").hidden = false;
  }
  function renderCal() {
    $("#cal-title").textContent = `${MONTHS[cal.m]} ${cal.y}`;
    const offset = (new Date(cal.y, cal.m, 1).getDay() + 6) % 7;
    const days = new Date(cal.y, cal.m + 1, 0).getDate();
    const t = todayStr();
    let html = "";
    for (let i = 0; i < offset; i++) html += `<span class="cal-day empty"></span>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${cal.y}-${pad(cal.m + 1)}-${pad(d)}`;
      const cls = ["cal-day"]; if (ds === t) cls.push("today"); if (ds === cal.value) cls.push("sel");
      html += `<button type="button" class="${cls.join(" ")}" data-d="${ds}">${d}</button>`;
    }
    for (let i = offset + days; i < 42; i++) html += `<span class="cal-day empty"></span>`; // всегда 6 недель — окно не «прыгает»
    $("#cal-grid").innerHTML = html;
    $$("#cal-grid .cal-day[data-d]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.d;
      if (cal.mode === "task") { cal.value = v; renderCal(); }
      else { $("#cal").hidden = true; cal.onPick && cal.onPick(v); }
    }));
  }
  function calPrev() { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); }
  function calNext() { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); }
  $("#cal-prev").addEventListener("click", calPrev);
  $("#cal-next").addEventListener("click", calNext);
  (function () { const g = $("#cal-grid"); let sx = 0, sy = 0, on = false;
    g.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    g.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? calNext() : calPrev()); }, { passive: true });
  })();
  $("#cal-cancel").addEventListener("click", () => ($("#cal").hidden = true));
  $("#cal-all").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(""); });
  $("#cal-notify").addEventListener("click", () => $("#cal-notify").classList.toggle("off"));
  $("#cal-done").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(cal.value, { time: $("#cal-time").value, notify: !$("#cal-notify").classList.contains("off") }); });
  $("#cal").addEventListener("click", (e) => { if (e.target.id === "cal") $("#cal").hidden = true; });

  /* ---------- Навигация ---------- */
  let currentView = "tasks";
  let currentTaskId = null, currentTask = null;
  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    const sub = (name === "taskpage" || name === "task");
    $("#back-btn").hidden = !sub;
    $("#page-title").hidden = sub;
    $("#fab").hidden = (name === "task");
    if (name === "tasks") renderTasks();
  }
  function goBack() {
    const openModal = $$(".modal").find((m) => !m.hidden);
    if (openModal) { openModal.hidden = true; return; }
    if (currentView === "task") { if (editingTaskId && currentTaskId) openTaskPage(currentTaskId); else showView("tasks"); }
    else if (currentView === "taskpage") showView("tasks");
  }
  $("#back-btn").addEventListener("click", goBack);
  $("#fab").addEventListener("click", () => newTask());
  $("#brand-home").addEventListener("click", () => showView("tasks")); // логотип → все задачи

  /* свайп вправо = назад (без сохранения) */
  (function () {
    const main = $(".main"); let sx = 0, sy = 0, on = false;
    main.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest(".attach-list") || e.target.closest(".swipe-row")) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    main.addEventListener("touchmove", (e) => { if (!on) return; const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy; if (Math.abs(dy) > Math.abs(dx)) on = false; }, { passive: true });
    main.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) goBack(); }, { passive: true });
  })();

  /* ---------- Список задач ---------- */
  let showDone = false, dateFilter = "", filterTags = new Set(), taskCount = 5, tasksById = {};

  /* запоминание фильтров (держатся, пока пользователь сам не изменит) */
  const FKEY = "gunco_filters";
  function saveFilters() { try { localStorage.setItem(FKEY, JSON.stringify({ dateFilter, tags: [...filterTags], showDone })); } catch {} }
  function loadFilters() { try { const f = JSON.parse(localStorage.getItem(FKEY)) || {}; dateFilter = f.dateFilter || ""; filterTags = new Set(f.tags || []); showDone = !!f.showDone; } catch {} }
  function applyFiltersUI() {
    $("#date-filter-label").textContent = dateFilter ? fmtFull(dateFilter) : "все дни";
    $("#date-filter").classList.toggle("is-set", !!dateFilter);
    $("#date-clear").hidden = !dateFilter;
    $("#tags-filter").classList.toggle("is-on", filterTags.size > 0);
    $("#toggle-done").setAttribute("aria-pressed", showDone);
  }
  function dayHead(day) {
    if (!day) return "без даты";
    const [y, m, d] = day.split("-").map(Number);
    return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} · ${d} ${MONTHS_SHORT[m - 1]}`;
  }
  function taskRow(t) {
    return `<div class="task swipeable ${t.is_done ? "done" : ""}" data-id="${t.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row">
        <button class="check ${t.is_done ? "is-done" : ""}" aria-label="Готово"></button>
        <span class="task-title">${esc(t.title)}</span>
        ${t.tag ? `<span class="tag task-tag">${esc(t.tag)}</span>` : ``}
        <span class="task-time">${t.due_time ? esc(t.due_time) : ""}</span>
      </div>
    </div>`;
  }
  async function renderTasks() {
    let tasks = await Store.tasks();
    tasks = tasks.filter((t) => (showDone ? true : !t.is_done));
    if (dateFilter) tasks = tasks.filter((t) => (t.due_date || "").slice(0, 10) === dateFilter);
    if (filterTags.size) tasks = tasks.filter((t) => filterTags.has(t.tag));
    tasks.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.due_time || "99:99").localeCompare(b.due_time || "99:99"));
    const shown = tasks.slice(0, taskCount);
    tasksById = {}; shown.forEach((t) => (tasksById[t.id] = t));
    $("#tasks-empty").hidden = shown.length > 0;
    let html = "", lastDay = null;
    shown.forEach((t) => {
      const day = t.due_date ? t.due_date.slice(0, 10) : "";
      if (day !== lastDay) { if (lastDay !== null) html += "</div></div>"; html += `<div class="day-group"><div class="day-head">${dayHead(day)}</div><div class="day-tasks">`; lastDay = day; }
      html += taskRow(t);
    });
    if (lastDay !== null) html += "</div></div>";
    $("#task-list").innerHTML = html;
    $$("#task-list .task").forEach((el) => {
      el.querySelector(".check").addEventListener("click", async (e) => { e.stopPropagation(); await Store.toggleTask(el.dataset.id, !el.classList.contains("done")); renderTasks(); });
      attachSwipe(el, async () => { await Store.deleteTask(el.dataset.id); renderTasks(); });
    });
  }
  $("#task-list").addEventListener("click", (e) => {
    if (justSwiped || e.target.closest(".check")) return;
    const el = e.target.closest(".task");
    if (el && tasksById[el.dataset.id]) openTaskPage(el.dataset.id);
  });

  /* фильтры */
  $("#toggle-done").addEventListener("click", (e) => { showDone = !showDone; e.currentTarget.setAttribute("aria-pressed", showDone); saveFilters(); renderTasks(); });
  $("#date-filter").addEventListener("click", () => openCalendar({ value: dateFilter, mode: "filter", allowAll: true, onPick: (v) => { dateFilter = v; $("#date-filter-label").textContent = v ? fmtFull(v) : "все дни"; $("#date-filter").classList.toggle("is-set", !!v); $("#date-clear").hidden = !v; saveFilters(); renderTasks(); } }));
  $("#date-clear").addEventListener("click", () => { dateFilter = ""; $("#date-filter-label").textContent = "все дни"; $("#date-filter").classList.remove("is-set"); $("#date-clear").hidden = true; saveFilters(); renderTasks(); });

  async function renderTagsCloud() {
    const q = ($("#tags-search").value || "").trim().toLowerCase();
    const tags = await Store.tags();
    const list = q ? tags.filter((t) => t.toLowerCase().includes(q)) : tags;
    $("#tags-cloud").innerHTML = list.length ? list.map((t) => `<button type="button" class="tag ${filterTags.has(t) ? "is-on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("") : `<span class="empty">ничего не найдено</span>`;
    $$("#tags-cloud .tag[data-tag]").forEach((b) => b.addEventListener("click", () => { const t = b.dataset.tag; filterTags.has(t) ? filterTags.delete(t) : filterTags.add(t); $("#tags-filter").classList.toggle("is-on", filterTags.size > 0); saveFilters(); renderTagsCloud(); renderTasks(); }));
  }
  $("#tags-filter").addEventListener("click", async () => { $("#tags-search").value = ""; $(".search-wrap").classList.remove("has-text"); await renderTagsCloud(); $("#tags-menu").hidden = false; setTimeout(() => $("#tags-search").focus(), 30); });
  $("#tags-search").addEventListener("input", (e) => { $(".search-wrap").classList.toggle("has-text", !!e.target.value); renderTagsCloud(); });
  $("#tags-reset").addEventListener("click", async () => { filterTags.clear(); $("#tags-filter").classList.remove("is-on"); saveFilters(); await renderTagsCloud(); renderTasks(); });
  $("#tags-menu").addEventListener("click", (e) => { if (e.target.id === "tags-menu") $("#tags-menu").hidden = true; });

  /* ползунок */
  const slider = $("#task-count"), sliderVal = $("#slider-val");
  slider.addEventListener("input", (e) => { taskCount = +e.target.value; sliderVal.value = taskCount; renderTasks(); });
  slider.addEventListener("change", () => Store.saveSettings({ count: taskCount }));
  sliderVal.addEventListener("change", () => { let v = parseInt(sliderVal.value, 10); if (!v || v < 1) v = 1; taskCount = v; slider.value = Math.min(v, 9); sliderVal.value = v; Store.saveSettings({ count: v }); renderTasks(); });
  sliderVal.addEventListener("focus", () => sliderVal.select());

  /* ---------- СТРАНИЦА задачи ---------- */
  async function openTaskPage(id) {
    const t = (await Store.tasks()).find((x) => x.id === id);
    if (!t) { showView("tasks"); return; }
    currentTask = t; currentTaskId = id;
    $("#tp-title").textContent = t.title || "без названия";
    $("#tp-date").innerHTML = t.due_date ? (fmtFull(t.due_date) + (t.due_time ? " · " + t.due_time : "") + " " + (t.notify !== false ? BELL_ON : BELL_OFF)) : "без даты";
    $("#tp-tags").innerHTML = t.tag ? `<span class="tag is-on">${esc(t.tag)}</span>` : `<span class="tp-tag-empty">+ тег</span>`;
    renderAttachView(t.attachments || []);
    $("#tp-desc").textContent = t.description || "";
    showView("taskpage");
  }
  function renderAttachView(atts) {
    $("#tp-attach").innerHTML = (atts || []).map((a, i) => {
      const inner = a.type && a.type.startsWith("image/") ? `<img src="${a.url}" alt="">` : `<div class="att-file">${esc((a.name || "файл").slice(0, 14))}</div>`;
      return `<div class="att" data-i="${i}">${inner}</div>`;
    }).join("");
    $$("#tp-attach .att").forEach((el) => el.addEventListener("click", () => { const a = atts[+el.dataset.i]; if (a && a.url) window.open(a.url, "_blank"); }));
  }
  $("#tp-title").addEventListener("click", () => copyText(currentTask && currentTask.title));
  $("#tp-desc").addEventListener("click", () => copyText(currentTask && currentTask.description));
  $("#tp-edit").addEventListener("click", () => { if (currentTask) openTaskEdit(currentTask); });
  $("#tp-date").addEventListener("click", () => {
    if (!currentTask) return;
    openCalendar({ value: currentTask.due_date || tomorrowStr(), mode: "task", time: currentTask.due_time || "", notify: currentTask.notify !== false, onPick: async (v, ex) => { await Store.updateTask(currentTaskId, { due_date: v, due_time: (ex && ex.time) || null, notify: !!(ex && ex.notify) }); openTaskPage(currentTaskId); } });
  });
  $("#tp-tags").addEventListener("click", () => openTagPick());

  /* выбор тега для задачи (инлайн со страницы) */
  async function openTagPick() {
    const tags = await Store.tags();
    const cur = currentTask && currentTask.tag;
    $("#tagpick-pills").innerHTML = tags.map((t) => `<button type="button" class="tag ${t === cur ? "is-on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("") + `<button type="button" class="tag-add" id="tagpick-add">+</button>`;
    $$("#tagpick-pills .tag[data-tag]").forEach((b) => b.addEventListener("click", async () => { await Store.updateTask(currentTaskId, { tag: b.dataset.tag }); $("#tagpick-modal").hidden = true; openTaskPage(currentTaskId); }));
    $("#tagpick-add").addEventListener("click", () => { tagAddContext = "tagpick"; $("#tag-input").value = ""; $("#tag-modal").hidden = false; setTimeout(() => $("#tag-input").focus(), 30); });
    $("#tagpick-modal").hidden = false;
  }
  $("#tagpick-modal").addEventListener("click", (e) => { if (e.target.id === "tagpick-modal") $("#tagpick-modal").hidden = true; });

  /* ---------- РЕДАКТОР задачи ---------- */
  let editingTaskId = null, selectedTag = null, tagAddContext = "form";
  let taskDate = tomorrowStr(), taskTime = "12:00", taskNotify = true;

  async function fillTags() {
    const tags = await Store.tags();
    if (!selectedTag || !tags.includes(selectedTag)) selectedTag = tags[0] || null;
    $("#t-tags").innerHTML = tags.map((t) => `<button type="button" class="tag ${t === selectedTag ? "is-on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("") + `<button type="button" class="tag-add" id="tag-add">+</button>`;
    $$("#t-tags .tag[data-tag]").forEach((b) => b.addEventListener("click", () => { selectedTag = b.dataset.tag; fillTags(); }));
    $("#tag-add").addEventListener("click", () => { tagAddContext = "form"; $("#tag-input").value = ""; $("#tag-modal").hidden = false; setTimeout(() => $("#tag-input").focus(), 30); });
  }
  $("#tag-ok").addEventListener("click", async () => {
    const name = ($("#tag-input").value || "").trim().toLowerCase();
    $("#tag-modal").hidden = true; if (!name) return;
    await Store.addTag(name);
    if (tagAddContext === "form") { selectedTag = name; await fillTags(); } else openTagPick();
  });
  $("#tag-cancel").addEventListener("click", () => ($("#tag-modal").hidden = true));

  function setTaskDateLabel() { let s = fmtFull(taskDate); if (taskTime) s += " · " + taskTime; $("#t-date").innerHTML = s + " " + (taskNotify ? BELL_ON : BELL_OFF); }
  $("#t-date").addEventListener("click", () => openCalendar({ value: taskDate, mode: "task", time: taskTime, notify: taskNotify, onPick: (v, ex) => { taskDate = v; taskTime = (ex && ex.time) || ""; taskNotify = !!(ex && ex.notify); setTaskDateLabel(); } }));

  async function newTask() {
    editingTaskId = null; currentTaskId = null; currentTask = null; selectedTag = null;
    $("#t-title").value = ""; $("#t-desc").value = "";
    taskDate = tomorrowStr(); taskTime = "12:00"; taskNotify = true; setTaskDateLabel();
    $("#task-form-title").textContent = "новая задача"; $("#t-submit").textContent = "Добавить"; $("#t-delete").hidden = true;
    await fillTags(); showView("task"); setTimeout(() => $("#t-title").focus(), 40);
  }
  async function openTaskEdit(t) {
    editingTaskId = t.id; currentTaskId = t.id; currentTask = t; selectedTag = t.tag || null;
    $("#t-title").value = t.title || ""; $("#t-desc").value = t.description || "";
    taskDate = t.due_date || tomorrowStr(); taskTime = t.due_time || ""; taskNotify = t.notify !== false; setTaskDateLabel();
    $("#task-form-title").textContent = "задача"; $("#t-submit").textContent = "Сохранить"; $("#t-delete").hidden = false;
    await fillTags(); showView("task");
  }
  $("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#t-title").value.trim(); if (!title) return;
    // точный момент напоминания в UTC (учитывает часовой пояс устройства); notified сбрасываем
    let remind_at = null;
    if (taskNotify && taskDate && taskTime) { const dt = new Date(`${taskDate}T${taskTime}:00`); if (!isNaN(dt)) remind_at = dt.toISOString(); }
    const fields = { title, description: $("#t-desc").value.trim(), due_date: taskDate || null, due_time: taskTime || null, notify: taskNotify, tag: selectedTag || null, remind_at, notified: false };
    if (editingTaskId) { const id = editingTaskId; await Store.updateTask(id, fields); editingTaskId = null; openTaskPage(id); }
    else { await Store.addTask(fields); editingTaskId = null; showView("tasks"); }
  });
  $("#t-delete").addEventListener("click", async () => { if (editingTaskId && await askConfirm("Удалить задачу?")) { await Store.deleteTask(editingTaskId); editingTaskId = null; showView("tasks"); } });

  /* ---------- Вход / аккаунт ---------- */
  let hasStarted = false;
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
    if (m.includes("user not found")) return "Пользователь не найден";
    if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Регистрация отключена";
    if (m.includes("email logins are disabled")) return "Вход по e-mail отключён";
    return "Не получилось. Проверьте данные и попробуйте снова";
  }
  async function startApp() {
    hasStarted = true; $("#auth").hidden = true; $("#app").hidden = false;
    const s = await Store.settings();
    taskCount = s.count || 5; slider.value = Math.min(taskCount, 9); sliderVal.value = taskCount;
    document.documentElement.setAttribute("data-theme", s.theme || "dark");
    loadFilters(); applyFiltersUI();
    await fillTags(); setTaskDateLabel();
    showView("tasks");
  }
  function showAuth() {
    $("#app").hidden = true; $("#auth").hidden = false;
    $("#account-pop").hidden = true;
    $("#auth-forgot").hidden = !HAS_SUPABASE;
    $("#auth-mode-hint").textContent = HAS_SUPABASE ? "Данные синхронизируются между устройствами." : "Локальный режим: Supabase не настроен, данные хранятся в этом браузере.";
    $("#auth-google").disabled = !HAS_SUPABASE;
  }
  // Иконка человечка: если вошёл — поповер с почтой и «Выйти»; если нет — экран входа
  $("#account-btn").addEventListener("click", async () => {
    if (!(sb && Store.userId)) { showAuth(); return; }
    const pop = $("#account-pop");
    if (!pop.hidden) { pop.hidden = true; return; }
    let email = "";
    try { const { data } = await sb.auth.getUser(); email = data && data.user && data.user.email; } catch {}
    $("#account-email").textContent = email || "аккаунт";
    updateNotifBtn();
    pop.hidden = false;
  });
  $("#account-signout").addEventListener("click", async () => { $("#account-pop").hidden = true; if (sb) await sb.auth.signOut(); Store.userId = null; showAuth(); });
  document.addEventListener("click", (e) => { if (!$("#account-pop").hidden && !e.target.closest("#account-pop") && !e.target.closest("#account-btn")) $("#account-pop").hidden = true; });

  /* ---------- Пуш-уведомления ---------- */
  const VAPID_PUBLIC = CFG.VAPID_PUBLIC || "";
  function urlB64ToUint8(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function pushSupported() { return ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window); }
  function updateNotifBtn() {
    const b = $("#notif-btn");
    b.hidden = !(pushSupported() && sb && Store.userId);
    if (b.hidden) return;
    b.textContent = (Notification.permission === "granted") ? "Уведомления включены" : "Включить уведомления";
  }
  async function enableNotifications() {
    if (!pushSupported()) { toast("Уведомления не поддерживаются устройством"); return; }
    if (!VAPID_PUBLIC) { toast("Не настроен ключ уведомлений"); return; }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Разрешение на уведомления не выдано"); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
      const j = sub.toJSON();
      if (sb && Store.userId) await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: Store.userId, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      toast("Уведомления включены"); updateNotifBtn();
    } catch (e) { toast("Не удалось включить уведомления"); }
  }
  $("#notif-btn").addEventListener("click", enableNotifications);

  if (HAS_SUPABASE) {
    $("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault(); authMsg("…");
      const { data, error } = await sb.auth.signInWithPassword({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value });
      if (error) return authMsg(trAuthError(error.message), "error");
      Store.userId = data.user.id; startApp();
    });
    $("#auth-signup").addEventListener("click", async () => {
      authMsg("…"); const email = $("#auth-email").value.trim(); const password = $("#auth-pass").value;
      if (password.length < 6) return authMsg("Пароль слишком короткий (минимум 6 символов)", "error");
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return authMsg(trAuthError(error.message), "error");
      if (data.session) { Store.userId = data.user.id; startApp(); } else authMsg("Проверьте почту для подтверждения регистрации.");
    });
    $("#auth-google").addEventListener("click", async () => { await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } }); });
    // Забыли пароль → письмо со ссылкой сброса
    $("#auth-forgot").addEventListener("click", async () => {
      const email = $("#auth-email").value.trim();
      if (!email) return authMsg("Введите e-mail для сброса", "error");
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      if (error) return authMsg(trAuthError(error.message), "error");
      authMsg("Письмо для сброса пароля отправлено на почту", "info");
    });
    // Ввод нового пароля после перехода по ссылке из письма
    $("#pw-ok").addEventListener("click", async () => {
      const p = $("#pw-input").value;
      const msg = $("#pw-msg"); msg.classList.add("is-error");
      if (p.length < 6) { msg.textContent = "Минимум 6 символов"; return; }
      const { error } = await sb.auth.updateUser({ password: p });
      if (error) { msg.textContent = trAuthError(error.message); return; }
      $("#pw-modal").hidden = true; $("#pw-input").value = ""; msg.textContent = ""; toast("Пароль обновлён");
    });
    $("#pw-modal").addEventListener("click", (e) => { if (e.target.id === "pw-modal") $("#pw-modal").hidden = true; });
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { if (session) { Store.userId = session.user.id; if ($("#app").hidden) startApp(); } $("#pw-modal").hidden = false; setTimeout(() => $("#pw-input").focus(), 60); return; }
      if (session && $("#app").hidden) { Store.userId = session.user.id; startApp(); }
    });
    sb.auth.getSession().then(({ data }) => {
      if (data.session) { if ($("#app").hidden) { Store.userId = data.session.user.id; startApp(); } }
      else if (!location.hash.includes("access_token")) showAuth();
    });
  } else {
    $("#auth-form").addEventListener("submit", (e) => { e.preventDefault(); startApp(); });
    $("#auth-signup").addEventListener("click", startApp);
    startApp();
  }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
