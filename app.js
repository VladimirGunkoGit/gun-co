/* ================= gun.co — логика ================= */
(function () {
  "use strict";

  const CFG = window.GUNCO_CONFIG || {};
  const HAS_SUPABASE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
  const sb = HAS_SUPABASE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

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

  /* ---------- Хранилище ---------- */
  const LKEY = "gunco_data_v1";
  const DEFAULT_TAGS = ["жизнь", "работа"];

  const Local = {
    read() { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { return {}; } },
    write(d) { localStorage.setItem(LKEY, JSON.stringify(d)); },
    ensure() {
      const d = this.read();
      d.tasks = d.tasks || []; d.notes = d.notes || [];
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
      const d = Local.ensure(); const row = { id: uid(), is_done: false, ...t }; d.tasks.push(row); Local.write(d); return row;
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
    async notes() {
      if (sb && this.userId) { const { data } = await sb.from("notes").select("*").eq("user_id", this.userId).order("updated_at", { ascending: false }); return data || []; }
      return Local.ensure().notes.slice().sort((a, b) => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || ""));
    },
    async saveNote(n) {
      const now = new Date().toISOString();
      if (sb && this.userId) {
        if (n.id) { const { data } = await sb.from("notes").update({ title: n.title, body_html: n.body_html, updated_at: now }).eq("id", n.id).select().single(); return data; }
        const { data } = await sb.from("notes").insert({ title: n.title, body_html: n.body_html, updated_at: now, user_id: this.userId }).select().single(); return data;
      }
      const d = Local.ensure();
      if (n.id) { const e = d.notes.find((x) => x.id === n.id); if (e) { e.title = n.title; e.body_html = n.body_html; e.updated_at = now; } }
      else { n = { id: uid(), created_at: now, updated_at: now, ...n }; d.notes.push(n); }
      Local.write(d); return n;
    },
    async deleteNote(id) {
      if (sb && this.userId) { await sb.from("notes").delete().eq("id", id); return; }
      const d = Local.ensure(); d.notes = d.notes.filter((x) => x.id !== id); Local.write(d);
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
    $("#cal-grid").innerHTML = html;
    $$("#cal-grid .cal-day[data-d]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.d;
      if (cal.mode === "task") { cal.value = v; renderCal(); }
      else { $("#cal").hidden = true; cal.onPick && cal.onPick(v); }
    }));
  }
  $("#cal-prev").addEventListener("click", () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); });
  $("#cal-next").addEventListener("click", () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); });
  $("#cal-cancel").addEventListener("click", () => ($("#cal").hidden = true));
  $("#cal-all").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(""); });
  $("#cal-notify").addEventListener("click", () => $("#cal-notify").classList.toggle("off"));
  $("#cal-done").addEventListener("click", () => { $("#cal").hidden = true; cal.onPick && cal.onPick(cal.value, { time: $("#cal-time").value, notify: !$("#cal-notify").classList.contains("off") }); });
  $("#cal").addEventListener("click", (e) => { if (e.target.id === "cal") $("#cal").hidden = true; });

  /* ---------- Навигация ---------- */
  let currentView = "tasks";
  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    $$(".head-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
    if (name === "tasks") renderTasks();
    if (name === "notes") renderNotesList();
  }
  $$(".head-tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  // Крупная кнопка «+» у заголовков — создаёт по активному разделу
  $("#head-add").addEventListener("click", () => { if (currentView === "notes" || currentView === "note") newNote(); else newTask(); });

  /* ---------- Подтверждение удаления ---------- */
  const TRASH_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5.5h6V7M6.5 7l.9 12.5h9.2L17.5 7"/></svg>`;
  let confirmResolve = null;
  function askConfirm(text = "Удалить?") {
    $("#confirm-text").textContent = text;
    $("#confirm-modal").hidden = false;
    return new Promise((res) => (confirmResolve = res));
  }
  function closeConfirm(val) { $("#confirm-modal").hidden = true; if (confirmResolve) { confirmResolve(val); confirmResolve = null; } }
  $("#confirm-yes").addEventListener("click", () => closeConfirm(true));
  $("#confirm-no").addEventListener("click", () => closeConfirm(false));
  $("#confirm-modal").addEventListener("click", (e) => { if (e.target.id === "confirm-modal") closeConfirm(false); });

  /* ---------- Свайп-удаление строки ---------- */
  let justSwiped = false;
  function attachSwipe(el, onDelete) {
    const fg = el.querySelector(".swipe-row");
    let startX = 0, startY = 0, dx = 0, dragging = false;
    el.addEventListener("touchstart", (e) => { const t = e.touches[0]; startX = t.clientX; startY = t.clientY; dx = 0; dragging = true; fg.style.transition = "none"; }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const t = e.touches[0]; const mx = t.clientX - startX, my = t.clientY - startY;
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { dragging = false; fg.style.transform = ""; return; }
      dx = Math.min(0, mx);
      fg.style.transform = `translateX(${dx}px)`;
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

  /* ---------- ЗАДАЧИ: список ---------- */
  let showDone = false;
  let dateFilter = "";
  let filterTags = new Set();
  let taskCount = 5;
  let tasksById = {};

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
      el.querySelector(".check").addEventListener("click", async (e) => {
        e.stopPropagation();
        await Store.toggleTask(el.dataset.id, !el.classList.contains("done"));
        renderTasks();
      });
      attachSwipe(el, async () => { await Store.deleteTask(el.dataset.id); renderTasks(); });
    });
  }
  $("#task-list").addEventListener("click", (e) => {
    if (justSwiped) return;
    if (e.target.closest(".check")) return;
    const el = e.target.closest(".task");
    if (el && tasksById[el.dataset.id]) openTaskEdit(tasksById[el.dataset.id]);
  });

  /* фильтры */
  $("#toggle-done").addEventListener("click", (e) => { showDone = !showDone; e.currentTarget.setAttribute("aria-pressed", showDone); renderTasks(); });
  $("#date-filter").addEventListener("click", () => openCalendar({ value: dateFilter, mode: "filter", allowAll: true, onPick: (v) => {
    dateFilter = v; $("#date-filter-label").textContent = v ? fmtFull(v) : "все дни"; $("#date-filter").classList.toggle("is-set", !!v); $("#date-clear").hidden = !v; renderTasks();
  } }));
  $("#date-clear").addEventListener("click", () => { dateFilter = ""; $("#date-filter-label").textContent = "все дни"; $("#date-filter").classList.remove("is-set"); $("#date-clear").hidden = true; renderTasks(); });

  async function renderTagsCloud() {
    const q = ($("#tags-search").value || "").trim().toLowerCase();
    const tags = await Store.tags();
    const list = q ? tags.filter((t) => t.toLowerCase().includes(q)) : tags;
    $("#tags-cloud").innerHTML = list.length
      ? list.map((t) => `<button type="button" class="tag ${filterTags.has(t) ? "is-on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")
      : `<span class="empty">ничего не найдено</span>`;
    $$("#tags-cloud .tag[data-tag]").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.tag; filterTags.has(t) ? filterTags.delete(t) : filterTags.add(t);
      $("#tags-filter").classList.toggle("is-on", filterTags.size > 0); renderTagsCloud(); renderTasks();
    }));
  }
  $("#tags-filter").addEventListener("click", async () => { $("#tags-search").value = ""; $(".search-wrap").classList.remove("has-text"); await renderTagsCloud(); $("#tags-menu").hidden = false; setTimeout(() => $("#tags-search").focus(), 30); });
  $("#tags-search").addEventListener("input", (e) => { $(".search-wrap").classList.toggle("has-text", !!e.target.value); renderTagsCloud(); });
  $("#tags-reset").addEventListener("click", async () => { filterTags.clear(); $("#tags-filter").classList.remove("is-on"); await renderTagsCloud(); renderTasks(); });
  $("#tags-menu").addEventListener("click", (e) => { if (e.target.id === "tags-menu") $("#tags-menu").hidden = true; });

  /* ползунок */
  const slider = $("#task-count");
  const sliderVal = $("#slider-val");
  slider.addEventListener("input", (e) => { taskCount = +e.target.value; sliderVal.value = taskCount; renderTasks(); });
  slider.addEventListener("change", () => Store.saveSettings({ count: taskCount }));
  sliderVal.addEventListener("change", () => { let v = parseInt(sliderVal.value, 10); if (!v || v < 1) v = 1; taskCount = v; slider.value = Math.min(v, 9); sliderVal.value = v; Store.saveSettings({ count: v }); renderTasks(); });
  sliderVal.addEventListener("focus", () => sliderVal.select());

  /* ---------- ЗАДАЧА: редактор ---------- */
  let editingTaskId = null, selectedTag = null;
  let taskDate = tomorrowStr(), taskTime = "12:00", taskNotify = true;

  async function fillTags() {
    const tags = await Store.tags();
    if (!selectedTag || !tags.includes(selectedTag)) selectedTag = tags[0] || null;
    $("#t-tags").innerHTML = tags.map((t) => `<button type="button" class="tag ${t === selectedTag ? "is-on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")
      + `<button type="button" class="tag-add" id="tag-add">+</button>`;
    $$("#t-tags .tag[data-tag]").forEach((b) => b.addEventListener("click", () => { selectedTag = b.dataset.tag; fillTags(); }));
    $("#tag-add").addEventListener("click", () => { $("#tag-input").value = ""; $("#tag-modal").hidden = false; setTimeout(() => $("#tag-input").focus(), 30); });
  }
  $("#tag-ok").addEventListener("click", async () => { const name = ($("#tag-input").value || "").trim().toLowerCase(); $("#tag-modal").hidden = true; if (!name) return; await Store.addTag(name); selectedTag = name; await fillTags(); });
  $("#tag-cancel").addEventListener("click", () => ($("#tag-modal").hidden = true));

  function setTaskDateLabel() { let s = fmtFull(taskDate); if (taskTime) s += " · " + taskTime; s += taskNotify ? " 🔔" : ""; $("#t-date").textContent = s; }
  $("#t-date").addEventListener("click", () => openCalendar({ value: taskDate, mode: "task", time: taskTime, notify: taskNotify, onPick: (v, ex) => { taskDate = v; taskTime = (ex && ex.time) || ""; taskNotify = !!(ex && ex.notify); setTaskDateLabel(); } }));

  async function newTask() {
    editingTaskId = null; selectedTag = null;
    $("#t-title").value = ""; $("#t-desc").value = "";
    taskDate = tomorrowStr(); taskTime = "12:00"; taskNotify = true; setTaskDateLabel();
    $("#task-form-title").textContent = "новая задача"; $("#t-submit").textContent = "Добавить"; $("#t-delete").hidden = true;
    await fillTags(); showView("task"); setTimeout(() => $("#t-title").focus(), 40);
  }
  async function openTaskEdit(t) {
    editingTaskId = t.id; selectedTag = t.tag || null;
    $("#t-title").value = t.title || ""; $("#t-desc").value = t.description || "";
    taskDate = t.due_date || tomorrowStr(); taskTime = t.due_time || ""; taskNotify = t.notify !== false; setTaskDateLabel();
    $("#task-form-title").textContent = "задача"; $("#t-submit").textContent = "Сохранить"; $("#t-delete").hidden = false;
    await fillTags(); showView("task");
  }
  $("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#t-title").value.trim(); if (!title) return;
    const fields = { title, description: $("#t-desc").value.trim(), due_date: taskDate || null, due_time: taskTime || null, notify: taskNotify, tag: selectedTag || null };
    if (editingTaskId) await Store.updateTask(editingTaskId, fields); else await Store.addTask(fields);
    editingTaskId = null; showView("tasks");
  });
  $("#t-delete").addEventListener("click", async () => { if (editingTaskId && await askConfirm("Удалить задачу?")) { await Store.deleteTask(editingTaskId); editingTaskId = null; showView("tasks"); } });

  /* ---------- ЗАМЕТКИ: список ---------- */
  let notesById = {};
  async function renderNotesList() {
    const notes = await Store.notes();
    notesById = {}; notes.forEach((n) => (notesById[n.id] = n));
    $("#notes-empty").hidden = notes.length > 0;
    $("#note-list").innerHTML = notes.map((n) => `<li class="note-item swipeable" data-id="${n.id}"><div class="swipe-del">${TRASH_SVG}</div><div class="swipe-row">${esc(n.title) || "без названия"}</div></li>`).join("");
    $$("#note-list .note-item").forEach((li) => attachSwipe(li, async () => { await Store.deleteNote(li.dataset.id); renderNotesList(); }));
  }
  $("#note-list").addEventListener("click", (e) => {
    if (justSwiped) return;
    const li = e.target.closest(".note-item");
    if (li && notesById[li.dataset.id]) openNoteEdit(notesById[li.dataset.id]);
  });

  /* ---------- ЗАМЕТКА: редактор ---------- */
  let editingNoteId = null, savedRange = null;
  const FMT_MAP = {
    bold: { tags: ["b", "strong"], test: (cs) => parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === "bold" },
    italic: { tags: ["i", "em"], test: (cs) => cs.fontStyle === "italic" },
    underline: { tags: ["u"], test: (cs) => cs.textDecorationLine.includes("underline") },
  };
  function isFmtActive(cmd) {
    const ed = $("#n-body"); const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.anchorNode; if (!node || !ed.contains(node)) return false;
    const { tags, test } = FMT_MAP[cmd];
    while (node && node !== ed) { if (node.nodeType === 1) { if (tags.includes(node.tagName.toLowerCase())) return true; try { if (test(getComputedStyle(node))) return true; } catch {} } node = node.parentNode; }
    return false;
  }
  function updateFmtStates() { ["bold", "italic", "underline"].forEach((cmd) => $(`.fmt[data-cmd="${cmd}"]`).classList.toggle("is-on", isFmtActive(cmd))); }
  ["keyup", "mouseup", "input"].forEach((ev) => $("#n-body").addEventListener(ev, updateFmtStates));
  document.addEventListener("selectionchange", () => { if (document.activeElement === $("#n-body")) updateFmtStates(); });

  $$(".fmt").forEach((b) => b.addEventListener("mousedown", (e) => {
    e.preventDefault(); const cmd = b.dataset.cmd;
    if (cmd === "link") { const sel = window.getSelection(); savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; $("#link-input").value = ""; $("#link-modal").hidden = false; setTimeout(() => $("#link-input").focus(), 30); }
    else { $("#n-body").focus(); document.execCommand(cmd, false, null); updateFmtStates(); }
  }));
  $("#link-ok").addEventListener("click", () => {
    let url = $("#link-input").value.trim(); $("#link-modal").hidden = true; if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) url = "https://" + url;
    const ed = $("#n-body"); ed.focus();
    const sel = window.getSelection(); sel.removeAllRanges(); if (savedRange) sel.addRange(savedRange);
    if (!sel.rangeCount) { const a = document.createElement("a"); a.href = url; a.textContent = url; ed.appendChild(a); return; }
    const range = sel.getRangeAt(0); const a = document.createElement("a"); a.href = url;
    if (range.collapsed) { a.textContent = url; range.insertNode(a); } else { a.appendChild(range.extractContents()); range.insertNode(a); }
    sel.removeAllRanges(); updateFmtStates();
  });
  $("#link-cancel").addEventListener("click", () => ($("#link-modal").hidden = true));

  function newNote() {
    editingNoteId = null; $("#n-title").value = ""; $("#n-body").innerHTML = ""; $("#n-delete").hidden = true; updateFmtStates();
    showView("note"); setTimeout(() => $("#n-title").focus(), 40);
  }
  function openNoteEdit(n) {
    if (!n) return;
    editingNoteId = n.id; $("#n-title").value = n.title || ""; $("#n-body").innerHTML = n.body_html || ""; $("#n-delete").hidden = false; updateFmtStates();
    showView("note");
  }
  $("#note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#n-title").value.trim(); const body = $("#n-body").innerHTML.trim();
    if (!title && !body) { showView("notes"); return; }
    await Store.saveNote({ id: editingNoteId, title, body_html: body });
    editingNoteId = null; showView("notes");
  });
  $("#n-delete").addEventListener("click", async () => { if (editingNoteId && await askConfirm("Удалить заметку?")) { await Store.deleteNote(editingNoteId); editingNoteId = null; showView("notes"); } });

  /* ---------- Вход / аккаунт ---------- */
  let hasStarted = false;
  function authMsg(t) { $("#auth-msg").textContent = t || ""; }
  async function startApp() {
    hasStarted = true; $("#auth").hidden = true; $("#app").hidden = false;
    const s = await Store.settings();
    taskCount = s.count || 5; slider.value = Math.min(taskCount, 9); sliderVal.value = taskCount;
    document.documentElement.setAttribute("data-theme", s.theme || "dark");
    await fillTags(); setTaskDateLabel();
    showView("tasks");
  }
  function showAuth() {
    $("#app").hidden = true; $("#auth").hidden = false;
    $("#auth-close").hidden = !hasStarted;
    $("#auth-mode-hint").textContent = HAS_SUPABASE ? "Данные синхронизируются между устройствами." : "Локальный режим: Supabase не настроен, данные хранятся в этом браузере.";
    $("#auth-google").disabled = !HAS_SUPABASE;
  }
  $("#auth-close").addEventListener("click", () => { $("#auth").hidden = true; $("#app").hidden = false; });
  $("#account-btn").addEventListener("click", async () => { if (sb && Store.userId) { if (await askConfirm("Выйти из аккаунта?")) { await sb.auth.signOut(); Store.userId = null; showAuth(); } } else showAuth(); });

  if (HAS_SUPABASE) {
    $("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault(); authMsg("…");
      const { data, error } = await sb.auth.signInWithPassword({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value });
      if (error) return authMsg("Не удалось войти: " + error.message);
      Store.userId = data.user.id; startApp();
    });
    $("#auth-signup").addEventListener("click", async () => {
      authMsg("…"); const email = $("#auth-email").value.trim(); const password = $("#auth-pass").value;
      if (password.length < 6) return authMsg("Пароль минимум 6 символов");
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return authMsg("Ошибка: " + error.message);
      if (data.session) { Store.userId = data.user.id; startApp(); } else authMsg("Проверьте почту для подтверждения регистрации.");
    });
    $("#auth-google").addEventListener("click", async () => { await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } }); });
    sb.auth.getSession().then(({ data }) => { if (data.session) { Store.userId = data.session.user.id; startApp(); } else showAuth(); });
  } else {
    $("#auth-form").addEventListener("submit", (e) => { e.preventDefault(); startApp(); });
    $("#auth-signup").addEventListener("click", startApp);
    startApp();
  }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
