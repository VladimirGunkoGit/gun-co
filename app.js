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
  const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
  const MONTHS_SHORT = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
  const WEEKDAYS = ["ВС","ПН","ВТ","СР","ЧТ","ПТ","СБ"];

  /* Статусы */
  const STATUSES = [
    { key: "none",     name: "без статуса", c: "150,153,163" },
    { key: "waiting",  name: "ждёт начала", c: "231,200,106" },
    { key: "progress", name: "в работе",    c: "126,196,232" },
    { key: "daily",    name: "ежедневно",   c: "199,138,74"  },
    { key: "late",     name: "опоздание",   c: "232,155,184" },
    { key: "done",     name: "готово",      c: "134,217,152" },
  ];
  const SMAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
  const DEFAULT_STATUSES = ["none", "waiting", "progress", "daily", "late"];
  function statusOf(t) { return SMAP[t.status] ? t.status : (t.is_done ? "done" : "progress"); }
  function statusDot(key, lg) { const s = SMAP[key] || SMAP.progress; return `<span class="status-dot${lg ? " status-dot--lg" : ""}" style="--c:${s.c}"></span>`; }
  function statusPill(key) { const s = SMAP[key] || SMAP.progress; return `<span class="status-pill" style="--c:${s.c}"><span>${s.name}</span>${statusDot(key)}</span>`; }

  /* Проекты */
  const DEFAULT_PROJECTS = [{ emoji: "🧶", name: "Жизнь" }, { emoji: "🔨", name: "Работа" }];
  const DEFAULT_EMOJI = "⚪️";
  let projectsCache = [];
  function projById(id) { return id ? projectsCache.find((p) => p.id === id) || null : null; }
  function projEmoji(p) { return (p && p.emoji) ? p.emoji : DEFAULT_EMOJI; }
  function projPillInner(p) { return `<span class="proj-emoji">${p ? projEmoji(p) : DEFAULT_EMOJI}</span><span class="proj-name">${p ? esc(p.name) : "проект"}</span>`; }
  async function loadProjects() { projectsCache = await Store.projects(); return projectsCache; }

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
      if (!d.projectsV1) { d.projects = DEFAULT_PROJECTS.map((p) => ({ id: uid(), emoji: p.emoji, name: p.name })); d.projectsV1 = true; delete d.tags; delete d.tagsV2; }
      d.projects = d.projects || [];
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
        return data;
      }
      return Local.ensure().projects;
    },
    async addProject({ emoji, name }) {
      if (sb && this.userId) { const { data } = await sb.from("projects").insert({ emoji: emoji || null, name, user_id: this.userId }).select().single(); return data; }
      const d = Local.ensure(); const row = { id: uid(), emoji: emoji || "", name }; d.projects.push(row); Local.write(d); return row;
    },
    async settings() { if (sb && this.userId) { const { data } = await sb.from("settings").select("*").eq("user_id", this.userId).single(); return data || { theme: "dark", count: 5 }; } return Local.ensure().settings; },
    async saveSettings(s) { if (sb && this.userId) { await sb.from("settings").upsert({ user_id: this.userId, ...s }); return; } const d = Local.ensure(); d.settings = { ...d.settings, ...s }; Local.write(d); },
  };

  /* ---------- Тема ---------- */
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); Store.saveSettings({ theme: t }); }
  $("#theme-btn").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

  /* ---------- Подтверждение ---------- */
  let confirmResolve = null;
  function askConfirm(text = "Удалить?") { $("#confirm-text").textContent = text; $("#confirm-modal").hidden = false; return new Promise((res) => (confirmResolve = res)); }
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
  function openCalendar({ value, allowAll = false, onPick }) {
    const base = (value || todayStr()).split("-"); cal.y = +base[0]; cal.m = +base[1] - 1; cal.value = value || (allowAll ? "" : todayStr()); cal.allowAll = allowAll; cal.onPick = onPick;
    $("#cal-all").hidden = !allowAll; renderCal(); $("#cal").hidden = false;
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

  /* ---------- Статус (одиночный) ---------- */
  let statusOnPick = null;
  function openStatusPicker(current, onPick) {
    statusOnPick = onPick;
    $("#status-list").innerHTML = STATUSES.map((s) => `<button type="button" class="status-pill ${s.key === current ? "is-cur" : ""}" data-k="${s.key}" style="--c:${s.c}"><span>${s.name}</span>${statusDot(s.key)}</button>`).join("");
    $$("#status-list .status-pill").forEach((b) => b.addEventListener("click", () => { $("#status-modal").hidden = true; if (statusOnPick) statusOnPick(b.dataset.k); }));
    $("#status-modal").hidden = false;
  }
  $("#status-modal").addEventListener("click", (e) => { if (e.target.id === "status-modal") $("#status-modal").hidden = true; });

  /* ---------- Проекты: выбор (одиночный) и фильтр (множественный) ---------- */
  let projMode = "single", projCurrent = null, projOnPick = null;
  async function openProjectPicker(currentId, onPick) {
    await loadProjects(); projMode = "single"; projCurrent = currentId; projOnPick = onPick;
    $("#project-modal-title").textContent = "проект"; $("#project-reset").hidden = true;
    $("#project-search").value = ""; $("#project-modal .search-wrap").classList.remove("has-text");
    renderProjectList(); $("#project-modal").hidden = false;
  }
  async function openProjectFilter() {
    await loadProjects(); projMode = "filter";
    $("#project-modal-title").textContent = "проекты"; $("#project-reset").hidden = false;
    $("#project-search").value = ""; $("#project-modal .search-wrap").classList.remove("has-text");
    renderProjectList(); $("#project-modal").hidden = false;
  }
  function renderProjectList() {
    const q = ($("#project-search").value || "").trim().toLowerCase();
    const list = q ? projectsCache.filter((p) => (p.name || "").toLowerCase().includes(q)) : projectsCache;
    let html = `<button type="button" class="proj-add-row" id="proj-add-row" aria-label="Новый проект">+</button>`;
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

  function openProjForm() { $("#projform-emoji").value = ""; $("#projform-name").value = ""; $("#projform-modal").hidden = false; setTimeout(() => $("#projform-name").focus(), 30); }
  $("#projform-ok").addEventListener("click", async () => {
    const name = ($("#projform-name").value || "").trim(); if (!name) { $("#projform-name").focus(); return; }
    const emoji = ($("#projform-emoji").value || "").trim();
    const row = await Store.addProject({ emoji, name }); await loadProjects();
    $("#projform-modal").hidden = true;
    if (projMode === "single" && row) { $("#project-modal").hidden = true; if (projOnPick) projOnPick(row.id); }
    else renderProjectList();
  });
  $("#projform-cancel").addEventListener("click", () => ($("#projform-modal").hidden = true));
  $("#projform-modal").addEventListener("click", (e) => { if (e.target.id === "projform-modal") $("#projform-modal").hidden = true; });

  /* ---------- Чек-листы в contenteditable ---------- */
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
      const box = e.target.closest(".chk-box"); if (!box) return;
      const blk = box.closest(".chk"); if (!blk) return;
      const on = blk.getAttribute("data-checked") === "1";
      blk.setAttribute("data-checked", on ? "0" : "1"); blk.classList.toggle("is-done", !on);
    });
  }
  function currentBlock(el) { const sel = window.getSelection(); if (!sel.rangeCount) return null; let n = sel.anchorNode; if (!n || n === el) return null; while (n && n.parentNode !== el) n = n.parentNode; if (!n || n.parentNode !== el) return null; return n.nodeType === 1 ? n : null; }
  function placeCaretAtStart(node) { const sel = window.getSelection(); const r = document.createRange(); r.setStart(node, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  function placeCaretInText(span, offset) { const sel = window.getSelection(); const r = document.createRange(); let tn = span.firstChild; if (!tn) { tn = document.createTextNode(""); span.appendChild(tn); } r.setStart(tn, Math.min(offset, tn.textContent.length)); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  function makeChk(blk, rest, checked) {
    blk.className = "chk" + (checked ? " is-done" : ""); blk.setAttribute("data-checked", checked ? "1" : "0");
    blk.innerHTML = `<span class="chk-box" contenteditable="false"></span><span class="chk-text"></span>`;
    blk.querySelector(".chk-text").textContent = rest || "";
  }
  function maybeMakeChecklist(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const blk = currentBlock(el);
    if (blk) {
      if (blk.classList.contains("chk")) return;
      const txt = blk.textContent;
      if (txt.startsWith("[]")) { makeChk(blk, txt.slice(2), false); placeCaretInText(blk.querySelector(".chk-text"), (txt.slice(2)).length); }
    } else {
      const node = sel.anchorNode;
      if (node && node.nodeType === 3 && node.parentNode === el && node.textContent.startsWith("[]")) {
        const div = document.createElement("div"); el.insertBefore(div, node); const rest = node.textContent.slice(2); node.remove();
        makeChk(div, rest, false); placeCaretInText(div.querySelector(".chk-text"), rest.length);
      }
    }
  }
  function descToText(el) {
    const lines = [];
    el.childNodes.forEach((node) => {
      if (node.nodeType === 1 && node.classList && node.classList.contains("chk")) {
        const checked = node.getAttribute("data-checked") === "1"; const t = node.querySelector(".chk-text");
        lines.push((checked ? "[x] " : "[] ") + (t ? t.textContent : ""));
      } else if (node.nodeType === 1 && node.tagName === "DIV") { lines.push(node.textContent); }
      else if (node.nodeType === 3) { lines.push(node.textContent); }
      else if (node.nodeType === 1 && node.tagName === "BR") { lines.push(""); }
    });
    return lines.join("\n").replace(/\s+$/, "");
  }
  function textToDesc(el, text) {
    el.innerHTML = ""; if (!text) return;
    text.split("\n").forEach((line) => {
      let m = line.match(/^\[x\]\s?(.*)$/i);
      if (m) { const div = document.createElement("div"); makeChk(div, m[1], true); el.appendChild(div); return; }
      m = line.match(/^\[\s?\]\s?(.*)$/);
      if (m) { const div = document.createElement("div"); makeChk(div, m[1], false); el.appendChild(div); return; }
      const div = document.createElement("div"); if (line === "") div.appendChild(document.createElement("br")); else div.textContent = line; el.appendChild(div);
    });
  }

  /* ---------- Навигация ---------- */
  let currentView = "tasks";
  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    const sub = name === "task";
    $("#back-btn").hidden = !sub; $("#page-title").hidden = sub; $("#fab").hidden = sub;
    if (name === "tasks") renderTasks();
  }
  function goBack() { const m = $$(".modal").find((x) => !x.hidden); if (m) { m.hidden = true; return; } if (currentView === "task") showView("tasks"); }
  $("#back-btn").addEventListener("click", goBack);
  $("#brand-home").addEventListener("click", () => showView("tasks"));
  $("#fab").addEventListener("click", () => newTask());
  (function () { const main = $(".main"); let sx = 0, sy = 0, on = false;
    main.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest(".swipe-row") || e.target.closest("[contenteditable]")) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
    main.addEventListener("touchmove", (e) => { if (!on) return; if (Math.abs(e.touches[0].clientY - sy) > Math.abs(e.touches[0].clientX - sx)) on = false; }, { passive: true });
    main.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) goBack(); }, { passive: true });
  })();

  /* ---------- Фильтры ---------- */
  let dateFilter = "", filterProjects = new Set(), filterStatuses = new Set(DEFAULT_STATUSES), taskCount = 5, tasksById = {};
  const FKEY = "gunco_filters";
  function saveFilters() { try { localStorage.setItem(FKEY, JSON.stringify({ dateFilter, projects: [...filterProjects], statuses: [...filterStatuses] })); } catch {} }
  function loadFilters() { try { const f = JSON.parse(localStorage.getItem(FKEY)) || {}; dateFilter = f.dateFilter || ""; filterProjects = new Set(f.projects || []); filterStatuses = new Set(f.statuses || DEFAULT_STATUSES); } catch {} }
  function isDefaultStatuses() { return filterStatuses.size === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every((k) => filterStatuses.has(k)); }
  function applyFiltersUI() {
    $("#date-filter-label").textContent = dateFilter ? fmtFull(dateFilter) : "все дни";
    $("#date-filter").classList.toggle("is-set", !!dateFilter);
    $("#date-clear").hidden = !dateFilter;
    $("#project-filter").classList.toggle("is-on", filterProjects.size > 0);
    $("#status-filter").classList.toggle("is-on", !isDefaultStatuses());
  }

  /* ---------- Список задач ---------- */
  function dayHead(day) { if (!day) return "без даты"; const [y, m, d] = day.split("-").map(Number); return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} · ${d} ${MONTHS_SHORT[m - 1]}`; }
  function taskRow(t) {
    const st = statusOf(t); const p = projById(t.project_id);
    return `<div class="task swipeable" data-id="${t.id}">
      <div class="swipe-del">${TRASH_SVG}</div>
      <div class="swipe-row">
        <button class="row-status" data-act="status" aria-label="Статус">${statusDot(st, true)}</button>
        <span class="task-title">${esc(t.title)}</span>
        <span class="proj-pill task-proj ${p ? "" : "is-empty"}" data-act="project">${projPillInner(p)}</span>
        <button class="task-time" data-act="time">${t.due_time ? esc(t.due_time) : "—"}</button>
      </div>
    </div>`;
  }
  async function renderTasks() {
    let tasks = await Store.tasks();
    tasks = tasks.filter((t) => filterStatuses.has(statusOf(t)));
    if (dateFilter) tasks = tasks.filter((t) => (t.due_date || "").slice(0, 10) === dateFilter);
    if (filterProjects.size) tasks = tasks.filter((t) => filterProjects.has(t.project_id));
    tasks.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.due_time || "99:99").localeCompare(b.due_time || "99:99"));
    const shown = tasks.slice(0, taskCount);
    tasksById = {}; shown.forEach((t) => (tasksById[t.id] = t));
    $("#tasks-empty").hidden = shown.length > 0;
    let html = "", lastDay = null;
    shown.forEach((t) => { const day = t.due_date ? t.due_date.slice(0, 10) : ""; if (day !== lastDay) { if (lastDay !== null) html += "</div></div>"; html += `<div class="day-group"><div class="day-head">${dayHead(day)}</div><div class="day-tasks">`; lastDay = day; } html += taskRow(t); });
    if (lastDay !== null) html += "</div></div>";
    $("#task-list").innerHTML = html;
    $$("#task-list .task").forEach((el) => attachSwipe(el, async () => { await Store.deleteTask(el.dataset.id); renderTasks(); }));
  }
  $("#task-list").addEventListener("click", (e) => {
    if (justSwiped) return;
    const el = e.target.closest(".task"); if (!el) return; const t = tasksById[el.dataset.id]; if (!t) return;
    const hit = e.target.closest("[data-act]"); const act = hit ? hit.dataset.act : null;
    if (act === "status") { openStatusPicker(statusOf(t), async (k) => { await Store.updateTask(t.id, { status: k, is_done: k === "done" }); renderTasks(); }); return; }
    if (act === "project") { openProjectPicker(t.project_id || null, async (id) => { await Store.updateTask(t.id, { project_id: id }); renderTasks(); }); return; }
    if (act === "time") { openDateTime({ date: t.due_date, time: t.due_time, notify: t.notify !== false, onDone: async (date, time, notify) => { await updateTaskDateTime(t.id, date, time, notify); renderTasks(); } }); return; }
    openTaskEdit(t);
  });
  async function updateTaskDateTime(id, date, time, notify) { let remind_at = null; if (notify && date && time) { const d = new Date(`${date}T${time}:00`); if (!isNaN(d)) remind_at = d.toISOString(); } await Store.updateTask(id, { due_date: date || null, due_time: time || null, notify, remind_at, notified: false }); }

  /* фильтры-кнопки */
  $("#date-filter").addEventListener("click", () => openCalendar({ value: dateFilter, allowAll: true, onPick: (v) => { dateFilter = v; applyFiltersUI(); saveFilters(); renderTasks(); } }));
  $("#date-clear").addEventListener("click", () => { dateFilter = ""; applyFiltersUI(); saveFilters(); renderTasks(); });
  $("#project-filter").addEventListener("click", openProjectFilter);

  function renderStatusFilter() {
    $("#statusfilter-list").innerHTML = STATUSES.map((s) => `<button type="button" class="status-pill ${filterStatuses.has(s.key) ? "" : "off"}" data-k="${s.key}" style="--c:${s.c}"><span>${s.name}</span>${statusDot(s.key)}</button>`).join("");
    $$("#statusfilter-list .status-pill").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.k; filterStatuses.has(k) ? filterStatuses.delete(k) : filterStatuses.add(k); applyFiltersUI(); saveFilters(); renderStatusFilter(); renderTasks(); }));
  }
  $("#status-filter").addEventListener("click", () => { renderStatusFilter(); $("#statusfilter-modal").hidden = false; });
  $("#statusfilter-modal").addEventListener("click", (e) => { if (e.target.id === "statusfilter-modal") $("#statusfilter-modal").hidden = true; });

  /* ползунок */
  const slider = $("#task-count"), sliderVal = $("#slider-val");
  slider.addEventListener("input", (e) => { taskCount = +e.target.value; sliderVal.value = taskCount; renderTasks(); });
  slider.addEventListener("change", () => Store.saveSettings({ count: taskCount }));
  sliderVal.addEventListener("change", () => { let v = parseInt(sliderVal.value, 10); if (!v || v < 1) v = 1; taskCount = v; slider.value = Math.min(v, 9); sliderVal.value = v; Store.saveSettings({ count: v }); renderTasks(); });
  sliderVal.addEventListener("focus", () => sliderVal.select());

  /* ---------- КАРТОЧКА задачи ---------- */
  let editingTaskId = null, cardDate = tomorrowStr(), cardTime = "12:00", cardNotify = true, cardStatus = "progress", cardProjectId = null;
  function renderCardMeta() {
    $("#t-date").textContent = cardDate ? fmtFull(cardDate) : "дата";
    $("#t-time").value = cardTime || "";
    $("#t-notify").innerHTML = cardNotify ? BELL_ON : BELL_OFF; $("#t-notify").classList.toggle("off", !cardNotify);
    $("#t-status").innerHTML = statusPill(cardStatus);
    const p = projById(cardProjectId);
    $("#t-project").innerHTML = projPillInner(p); $("#t-project").classList.toggle("is-empty", !p);
  }
  $("#t-date").addEventListener("click", () => openCalendar({ value: cardDate, onPick: (v) => { cardDate = v; renderCardMeta(); } }));
  $("#t-time").addEventListener("input", (e) => { cardTime = e.target.value; });
  $("#t-notify").addEventListener("click", () => { cardNotify = !cardNotify; renderCardMeta(); });
  $("#t-status").addEventListener("click", () => openStatusPicker(cardStatus, (k) => { cardStatus = k; renderCardMeta(); }));
  $("#t-project").addEventListener("click", () => openProjectPicker(cardProjectId, (id) => { cardProjectId = id; renderCardMeta(); }));
  initChecklist($("#t-desc"));

  function newTask() {
    editingTaskId = null; cardDate = tomorrowStr(); cardTime = "12:00"; cardNotify = true; cardStatus = "progress"; cardProjectId = null;
    $("#t-title").innerText = ""; $("#t-desc").innerHTML = ""; renderCardMeta();
    $("#t-submit").textContent = "Добавить"; $("#t-delete").hidden = true;
    showView("task"); $("#t-title").focus();
  }
  function openTaskEdit(t) {
    editingTaskId = t.id; cardDate = t.due_date || tomorrowStr(); cardTime = t.due_time || ""; cardNotify = t.notify !== false; cardStatus = statusOf(t); cardProjectId = t.project_id || null;
    $("#t-title").innerText = t.title || ""; textToDesc($("#t-desc"), t.description || ""); renderCardMeta();
    $("#t-submit").textContent = "Сохранить"; $("#t-delete").hidden = false;
    showView("task");
  }
  $("#t-submit").addEventListener("click", async () => {
    const title = $("#t-title").textContent.trim(); if (!title) { $("#t-title").focus(); return; }
    let remind_at = null; if (cardNotify && cardDate && cardTime) { const d = new Date(`${cardDate}T${cardTime}:00`); if (!isNaN(d)) remind_at = d.toISOString(); }
    const fields = { title, description: descToText($("#t-desc")), due_date: cardDate || null, due_time: cardTime || null, notify: cardNotify, project_id: cardProjectId || null, status: cardStatus, is_done: cardStatus === "done", remind_at, notified: false };
    if (editingTaskId) { await Store.updateTask(editingTaskId, fields); editingTaskId = null; } else await Store.addTask(fields);
    showView("tasks");
  });
  $("#t-delete").addEventListener("click", async () => { if (editingTaskId && await askConfirm("Удалить задачу?")) { await Store.deleteTask(editingTaskId); editingTaskId = null; showView("tasks"); } });

  /* ---------- Аккаунт ---------- */
  $("#account-btn").addEventListener("click", async () => {
    if (!(sb && Store.userId)) { showAuth(); return; }
    const pop = $("#account-pop"); if (!pop.hidden) { pop.hidden = true; return; }
    let email = ""; try { const { data } = await sb.auth.getUser(); email = data && data.user && data.user.email; } catch {}
    $("#account-email").textContent = email || "аккаунт"; updateNotifBtn(); pop.hidden = false;
  });
  $("#account-signout").addEventListener("click", async () => { $("#account-pop").hidden = true; if (sb) await sb.auth.signOut(); Store.userId = null; showAuth(); });
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
  async function startApp() {
    $("#auth").hidden = true; $("#app").hidden = false;
    const s = await Store.settings();
    taskCount = s.count || 5; slider.value = Math.min(taskCount, 9); sliderVal.value = taskCount;
    document.documentElement.setAttribute("data-theme", s.theme || "dark");
    await loadProjects();
    loadFilters(); applyFiltersUI(); renderCardMeta(); showView("tasks");
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

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
