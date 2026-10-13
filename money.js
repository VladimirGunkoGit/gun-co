/* =================================================================
   gunco — страница «деньги»: доходы, расходы, зарплаты, сводка,
   импорт PDF-выписки, выгрузка xlsx, напоминания.
   Модуль подключается из app.js: GuncoMoney.init(ctx) — ctx даёт общие
   механизмы приложения (пикеры, календарь, свайп, отмена, статусы, проекты).
   Вся денежная математика — в money-core.js (MoneyCore).
   ================================================================= */
(function () {
  "use strict";
  const MC = window.MoneyCore;
  let X = null;                          // контекст приложения
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fm = (m, o) => MC.formatMoneyHTML(m, o);
  const fmt = (m, o) => MC.formatMoney(m, o);
  const PAY_KIND = "payment";
  const SALARY_TITLES = ["аванс", "зарплата", "премия", "отпускные", "бонус"];
  const DEFAULT_CATS = [
    { emoji: "💼", name: "зарплаты", is_salary: true, c: 2 },
    { emoji: "🏠", name: "аренда", c: 1 }, { emoji: "🧑‍🔧", name: "подрядчики", c: 6 }, { emoji: "📣", name: "реклама", c: 4 },
    { emoji: "🧾", name: "налоги", c: 8 }, { emoji: "💳", name: "сервисы и подписки", c: 7 }, { emoji: "🏦", name: "банк и комиссии", c: 0 }, { emoji: "📦", name: "прочее", c: 3 },
  ];
  const ICON = {
    upload: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M12 17.5v-6M9.5 14l2.5-2.5 2.5 2.5"/></svg>`,
    xlsx: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="12.5" rx="2"/><path d="M3.5 8.5h17M9.5 4v12.5"/><path d="M12 19.5l2.5 1.5 2.5-1.5M14.5 21v-5"/></svg>`,
    group: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 6.5h15M7.5 12h12M10.5 17.5h9"/></svg>`,
    more: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4 4 9-9"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>`,
  };

  /* ================= СОСТОЯНИЕ ================= */
  const S = {
    loaded: false, loading: null,
    month: null,                                   // 'YYYY-MM'
    payments: [], links: [], payees: [], cats: [], recs: [], recInst: [], settings: null,
    group: (localStorage.getItem("gunco_money_group") || "entity"),   // entity | date | status
    fStatuses: null, fProjects: new Set(), showTails: false, withTails: false,
  };
  const online = () => !!(X.sb && X.Store.userId);
  const userId = () => X.Store.userId || "local";
  const tz = () => (S.settings && S.settings.tz) || (Intl.DateTimeFormat().resolvedOptions().timeZone) || "Europe/Moscow";
  const today = () => MC.todayInTz(tz());
  const catById = (id) => S.cats.find((c) => c.id === id) || null;
  const payeeById = (id) => S.payees.find((p) => p.id === id) || null;
  const payById = (id) => S.payments.find((p) => p.id === id) || null;
  const salaryCat = () => S.cats.find((c) => c.is_salary) || null;
  const linksOf = (pid) => S.links.filter((l) => l.payment_id === pid);
  const childrenOf = (pid) => S.payments.filter((p) => p.parent_id === pid);
  const isDone = (st) => { const s = X.statusById(PAY_KIND, st); return s ? !!s.done : st === "done"; };

  /* ================= ДАННЫЕ ================= */
  const LK = "gunco_money_v1";
  const L = {
    read() { try { return JSON.parse(localStorage.getItem(LK)) || {}; } catch (e) { return {}; } },
    write(d) { try { localStorage.setItem(LK, JSON.stringify(d)); } catch (e) { X.toast("не хватает места"); } },
    ensure() { const d = this.read(); ["payments", "links", "payees", "cats", "recs"].forEach((k) => (d[k] = d[k] || [])); d.settings = d.settings || null; return d; },
  };
  async function q(p) { const { data, error } = await p; if (error) throw new Error(error.message || "ошибка сервера"); return data; }
  const DB = {
    async loadAll() {
      if (online()) {
        const sb = X.sb, u = userId();
        const [pays, links, payees, cats, recs, settings, inst] = await Promise.all([
          q(sb.from("payments").select("*").eq("user_id", u).is("deleted_at", null)),
          q(sb.from("payment_projects").select("*").eq("user_id", u)),
          q(sb.from("payees").select("*").eq("user_id", u).order("sort", { nullsFirst: false }).order("created_at")),
          q(sb.from("fin_categories").select("*").eq("user_id", u).order("sort")),
          q(sb.from("recurrences").select("*").eq("user_id", u)),
          q(sb.from("money_settings").select("*").eq("user_id", u).maybeSingle()),
          q(sb.from("payments").select("id,recurrence_id,due_date,deleted_at").eq("user_id", u).not("recurrence_id", "is", null)),
        ]);
        return { payments: pays || [], links: links || [], payees: payees || [], cats: cats || [], recs: recs || [], settings, recInst: inst || [] };
      }
      const d = L.ensure();
      // старые категории локального режима живут в gunco_data_v1 (раздел «финансы»)
      if (!d.catsV1) { let old = []; try { old = (JSON.parse(localStorage.getItem("gunco_data_v1")) || {}).finCategories || []; } catch (e) {} d.cats = old.map((c) => ({ ...c })); d.catsV1 = true; L.write(d); }
      return { payments: d.payments.filter((p) => !p.deleted_at), links: d.links, payees: d.payees, cats: d.cats, recs: d.recs, settings: d.settings, recInst: d.payments.filter((p) => p.recurrence_id).map((p) => ({ id: p.id, recurrence_id: p.recurrence_id, due_date: p.due_date, deleted_at: p.deleted_at })) };
    },
    async insert(table, row) {
      if (online()) return await q(X.sb.from(table).insert({ ...row, user_id: userId() }).select().single());
      const d = L.ensure(); const key = LKEY[table]; const r = { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }; d[key].push(r); L.write(d); return r;
    },
    async insertMany(table, rows) {
      if (!rows.length) return [];
      if (online()) return await q(X.sb.from(table).insert(rows.map((r) => ({ ...r, user_id: userId() }))).select());
      const out = []; for (const r of rows) out.push(await this.insert(table, r)); return out;
    },
    async update(table, id, patch) {
      if (online()) { await q(X.sb.from(table).update(patch).eq("id", id)); return; }
      const d = L.ensure(); const r = d[LKEY[table]].find((x) => x.id === id); if (r) Object.assign(r, patch, { updated_at: new Date().toISOString() }); L.write(d);
    },
    async remove(table, id) {
      if (online()) { await q(X.sb.from(table).delete().eq("id", id)); return; }
      const d = L.ensure(); d[LKEY[table]] = d[LKEY[table]].filter((x) => x.id !== id); L.write(d);
    },
    async setLinks(paymentId, items) {
      if (online()) { await q(X.sb.rpc("money_set_projects", { p_payment: paymentId, p_items: items })); return; }
      const d = L.ensure(); d.links = d.links.filter((l) => l.payment_id !== paymentId).concat(items.map((i) => ({ payment_id: paymentId, project_id: i.project_id, share_minor: i.share_minor == null ? null : i.share_minor }))); L.write(d);
    },
    async saveSettings(patch) {
      const row = { ...(S.settings || {}), ...patch };
      if (online()) { const r = await q(X.sb.from("money_settings").upsert({ ...row, user_id: userId(), created_at: undefined, updated_at: undefined }).select().single()); S.settings = r; return r; }
      const d = L.ensure(); d.settings = row; L.write(d); S.settings = row; return row;
    },
    async allForImport() {
      if (online()) return await q(X.sb.from("payments").select("id,kind,amount_minor,due_date,paid_date,status,fingerprint,deleted_at").eq("user_id", userId()));
      return L.ensure().payments;
    },
  };
  const LKEY = { payments: "payments", payees: "payees", fin_categories: "cats", recurrences: "recs" };

  /* ================= ЗАГРУЗКА ================= */
  async function ensureLoaded(force) {
    if (S.loaded && !force) return;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      const d = await DB.loadAll();
      Object.assign(S, d);
      if (!S.settings) S.settings = await DB.saveSettings({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow", opening_balance_minor: 0 });
      await seedCategories();
      await migrateFinTx();
      S.loaded = true;
    })();
    try { await S.loading; } finally { S.loading = null; }
  }
  async function seedCategories() {
    const names = new Set(S.cats.map((c) => (c.name || "").toLowerCase().trim()));
    const hasSalary = S.cats.some((c) => c.is_salary);
    if (hasSalary && S.cats.length) return;
    const add = [];
    let sort = S.cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
    for (const c of DEFAULT_CATS) {
      if (c.is_salary && hasSalary) continue;
      if (!c.is_salary && names.has(c.name)) continue;
      if (!c.is_salary && hasSalary) continue;   // сидим набор только один раз (вместе с «зарплатами»)
      add.push({ emoji: c.emoji, name: c.name, color: X.STATUS_PALETTE[c.c], sort: c.is_salary ? -1 : sort++, is_salary: !!c.is_salary });
    }
    if (!add.length) return;
    const rows = await DB.insertMany("fin_categories", add);
    S.cats.push(...rows);
  }
  // Одноразово: старые операции раздела «финансы» (fin_tx) → платежи «готово»
  async function migrateFinTx() {
    if (S.settings && S.settings.migrated_fin_tx) return;
    let old = [];
    try {
      if (online()) old = await q(X.sb.from("fin_tx").select("*").eq("user_id", userId()));
      else old = (JSON.parse(localStorage.getItem("gunco_data_v1")) || {}).finTx || [];
    } catch (e) { return; }
    const have = new Set(S.payments.map((p) => p.legacy_id).filter(Boolean));
    const rows = (old || []).filter((t) => t.amount_minor > 0 && !have.has(t.id)).map((t) => {
      const day = MC.todayInTz(tz(), new Date(t.created_at));
      return { kind: t.kind === "income" ? "income" : "expense", title: t.note || "", amount_minor: Math.round(t.amount_minor), due_date: day, paid_date: day, status: "done", category_id: t.kind === "income" ? null : (t.category_id || null), source: "migration", legacy_id: t.id };
    });
    try {
      for (let i = 0; i < rows.length; i += 200) { const ins = await DB.insertMany("payments", rows.slice(i, i + 200)); S.payments.push(...ins); }
      await DB.saveSettings({ migrated_fin_tx: true });
    } catch (e) { console.warn("migrate fin_tx", e); }
  }

  /* ================= ОБЩИЕ МОДАЛКИ ================= */
  function modal(id, inner, cls) {
    let m = document.getElementById(id);
    if (!m) { m = document.createElement("div"); m.id = id; m.className = "modal"; m.hidden = true; document.body.insertBefore(m, $("#toast")); m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); }); }
    m.innerHTML = `<div class="modal-card ${cls || ""}">${inner}</div>`;
    m.hidden = false; return m;
  }
  function closeModal(m) { m.hidden = true; if (m._onClose) { const f = m._onClose; m._onClose = null; f(); } }
  // Выбор из вариантов: [{label, value, cls}] → Promise<value|null>
  function choice(title, sub, options) {
    return new Promise((res) => {
      const m = modal("mchoice-modal", `<div class="modal-title">${esc(title)}</div>${sub ? `<div class="confirm-sub">${esc(sub)}</div>` : ""}<div class="mchoice">${options.map((o, i) => `<button type="button" class="btn ${o.cls || ""}" data-i="${i}">${esc(o.label)}</button>`).join("")}<button type="button" class="btn" data-i="-1">Отмена</button></div>`, "confirm-card");
      m._onClose = () => res(null);
      $$("button[data-i]", m).forEach((b) => b.addEventListener("click", () => { m._onClose = null; m.hidden = true; const i = +b.dataset.i; res(i >= 0 ? options[i].value : null); }));
    });
  }
  // Ввод суммы (+ дата) → Promise<{amount, date}|null>
  function inputAmount({ title, sub, value, date, okLabel, allowZero, allowNegative }) {
    return new Promise((res) => {
      let d = date || null;
      const m = modal("minput-modal", `<div class="modal-title">${esc(title)}</div>${sub ? `<div class="confirm-sub">${esc(sub)}</div>` : ""}
        <div class="pay-amount-wrap"><input id="minput-amount" class="field field--amount" type="text" inputmode="decimal" placeholder="0" value="${value != null ? esc(MC.amountToInput(Math.abs(value))) : ""}"/><span class="pay-cur">₽</span></div>
        ${allowNegative ? `<div class="fintx-kind"><button type="button" class="kind-btn ${value < 0 ? "" : "is-on"}" data-sg="1">плюс</button><button type="button" class="kind-btn ${value < 0 ? "is-on" : ""}" data-sg="-1">минус</button></div>` : ""}
        ${date !== undefined ? `<button type="button" id="minput-date" class="meta-pill">${d ? MC.dayLong(d) : "дата"}</button>` : ""}
        <div class="minput-err" hidden></div>
        <div class="form-actions"><button type="button" class="btn btn--solid" id="minput-ok">${esc(okLabel || "Готово")}</button><button type="button" class="btn" id="minput-cancel">Отмена</button></div>`);
      let sign = value < 0 ? -1 : 1;
      m._onClose = () => res(null);
      const inp = $("#minput-amount", m); setTimeout(() => inp.focus(), 40);
      $$("[data-sg]", m).forEach((b) => b.addEventListener("click", () => { sign = +b.dataset.sg; $$("[data-sg]", m).forEach((x) => x.classList.toggle("is-on", x === b)); }));
      const db = $("#minput-date", m); if (db) db.addEventListener("click", () => X.openCalendar({ value: d, onPick: (v) => { d = v || d; db.textContent = d ? MC.dayLong(d) : "дата"; } }));
      const ok = () => {
        const a = MC.parseAmount(inp.value);
        if (a == null || (!allowZero && a === 0)) { const e = $(".minput-err", m); e.textContent = "введите сумму"; e.hidden = false; inp.focus(); return; }
        m._onClose = null; m.hidden = true; res({ amount: a * sign, date: d });
      };
      $("#minput-ok", m).addEventListener("click", ok);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      $("#minput-cancel", m).addEventListener("click", () => closeModal(m));
    });
  }

  /* ================= СТАТУСЫ, ОПОЗДАНИЕ, ПОВТОРЕНИЯ ================= */
  async function applyAutoLate() {
    const t = today(); const changes = [];
    for (const p of S.payments) { const tr = MC.lateTransition(p, t); if (tr) changes.push([p, tr]); }
    for (const [p, tr] of changes) { Object.assign(p, tr); try { await DB.update("payments", p.id, tr); } catch (e) {} }
  }
  // Создать экземпляры повторений до конца месяца key + 1 следующий (идемпотентно)
  async function ensureRecurrences(key) {
    const until = MC.monthStart(MC.addMonths(key, 2));
    const exist = new Set(S.recInst.map((i) => i.recurrence_id + "|" + i.due_date));
    const rows = [];
    for (const r of S.recs) {
      if (!r.active) continue;
      for (const d of MC.recurrenceDates(r, r.start_date, until)) {
        if (exist.has(r.id + "|" + d)) continue;
        const t = r.template || {};
        rows.push({ kind: r.kind, title: t.title || "", amount_minor: t.amount_minor, due_date: d, status: "waiting", project_id: t.project_id || null, category_id: t.category_id || null, payee_id: t.payee_id || null, note: t.note || null, remind_enabled: !!t.remind_enabled, remind_channels: t.remind_channels || ["email", "telegram"], remind_at: t.remind_enabled ? MC.remindAtFor(d, t.remind_offset || 0, t.remind_time || defTime(), tz()) : null, source: "recurring", recurrence_id: r.id, _links: t.project_links || [] });
        exist.add(r.id + "|" + d);
      }
    }
    for (const row of rows) {
      const links = row._links; delete row._links;
      try {
        const ins = await DB.insert("payments", row); S.payments.push(ins); S.recInst.push({ id: ins.id, recurrence_id: ins.recurrence_id, due_date: ins.due_date });
        if (links.length) { await DB.setLinks(ins.id, links); links.forEach((l) => S.links.push({ payment_id: ins.id, project_id: l.project_id, share_minor: l.share_minor })); }
      } catch (e) { /* дубль по уникальному индексу — пропускаем */ }
    }
  }
  const defTime = () => String((S.settings && S.settings.remind_default_time) || "10:00").slice(0, 5);

  /* ================= СТРАНИЦА ================= */
  function buildDom() {
    const main = $(".main");
    main.insertAdjacentHTML("beforeend", `
    <section id="view-money" class="view" hidden>
      <div class="pane pane--money scroll" id="money-pane">
        <div class="cal-nav-row money-monthbar" id="money-monthbar">
          <button id="money-prev" class="cal-nav" type="button" aria-label="Предыдущий месяц">‹</button>
          <div id="money-month" class="money-month-title"></div>
          <button id="money-next" class="cal-nav" type="button" aria-label="Следующий месяц">›</button>
        </div>
        <div class="pane-head-tools money-tools-row">
          <button id="money-today" class="cal-today" type="button" hidden>сегодня</button>
          <button id="money-f-status" class="chip" type="button">статусы</button>
          <button id="money-f-proj" class="chip" type="button">проекты</button>
          <button id="money-group" class="chip chip--ico" type="button" aria-label="Группировка" title="Группировка">${ICON.group}</button>
          <button id="money-more" class="chip chip--ico" type="button" aria-label="Настройки денег" title="Настройки">${ICON.more}</button>
        </div>
        <div id="money-tails"></div>
        <section class="money-sec" id="money-income"></section>
        <section class="money-sec" id="money-expense"></section>
        <section class="money-summary" id="money-summary"></section>
      </div>
    </section>
    <section id="view-payment" class="view view--form" hidden>
      <div class="taskcard scroll" id="pay-card">
        <div class="fintx-kind pay-kind"><button class="kind-btn" type="button" data-kind="expense">расход</button><button class="kind-btn" type="button" data-kind="income">поступление</button></div>
        <div id="pay-title" class="taskcard-title" contenteditable="true" data-placeholder="название"></div>
        <div class="pay-amount-wrap pay-amount-main"><input id="pay-amount" class="field field--amount" type="text" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Сумма" /><span class="pay-cur">₽</span></div>
        <div id="pay-amount-err" class="minput-err" hidden></div>
        <div class="taskcard-meta" id="pay-meta"></div>
        <div class="taskcard-meta" id="pay-entities"></div>
        <div id="pay-shares" class="pay-shares" hidden></div>
        <div id="pay-salary-titles" class="pay-chips" hidden></div>
        <div class="taskcard-meta" id="pay-extra"></div>
        <div id="pay-note" class="taskcard-desc" contenteditable="true" data-placeholder="примечание"></div>
        <div id="pay-service" class="pay-service"></div>
      </div>
      <div class="form-foot"><div class="form-actions"><button id="pay-done" class="btn btn--solid" type="button">Готово</button><button id="pay-delete" class="btn btn--danger" type="button">Удалить</button></div></div>
    </section>
    <section id="view-payees" class="view" hidden>
      <div class="pane scroll pane--money">
        <div class="money-note">люди, которым вы платите зарплату. сумма и дни выплат по умолчанию нужны для кнопки «начислить зарплаты».</div>
        <div id="payee-list" class="payee-list"></div>
        <button id="payee-archive-toggle" class="modal-clear" type="button" hidden></button>
        <div id="payee-archive" class="payee-list" hidden></div>
      </div>
    </section>
    <section id="view-payee" class="view view--form" hidden>
      <div class="taskcard scroll">
        <div class="proj-head"><button id="pe-emoji" class="proj-emoji-btn" type="button" aria-label="Эмодзи"></button><div id="pe-name" class="taskcard-title" contenteditable="true" data-placeholder="имя"></div></div>
        <div class="payee-form">
          <label class="pf-row"><span class="pf-cap">должность</span><input id="pe-role" class="field" type="text" placeholder="напр. дизайнер" maxlength="60"/></label>
          <label class="pf-row"><span class="pf-cap">зарплата в месяц</span><div class="pay-amount-wrap"><input id="pe-amount" class="field field--amount" type="text" inputmode="decimal" placeholder="0"/><span class="pay-cur">₽</span></div></label>
          <label class="pf-row"><span class="pf-cap">дни выплат</span><input id="pe-days" class="field" type="text" inputmode="numeric" placeholder="напр. 10, 25"/></label>
          <label class="pf-row"><span class="pf-cap">доли по дням, %</span><input id="pe-split" class="field" type="text" inputmode="numeric" placeholder="напр. 40 / 60 (пусто — поровну)"/></label>
          <label class="pf-row"><span class="pf-cap">куда платить</span><input id="pe-note" class="field" type="text" placeholder="банк, телефон — не храните полный номер карты" maxlength="200"/></label>
          <div class="taskcard-meta"><button id="pe-active" class="chip" type="button"></button></div>
        </div>
        <div class="proj-tasks"><div class="proj-tasks-head">выплаты</div><div id="pe-total" class="pe-total"></div><div id="pe-history"></div></div>
      </div>
      <div class="form-foot"><div class="form-actions"><button id="pe-done" class="btn btn--solid" type="button">Готово</button><button id="pe-delete" class="btn btn--danger" type="button">В архив</button></div></div>
    </section>
    <section id="view-import" class="view" hidden>
      <div class="pane scroll pane--money" id="import-pane"></div>
    </section>`);
    // кнопки справа вверху (в строке заголовка, как виды задач)
    $("#task-views").insertAdjacentHTML("afterend", `<div id="money-head-btns" class="task-views money-head-btns" hidden>
      <button id="money-import-btn" class="chip chip--ico" type="button" aria-label="Загрузить выписку PDF" title="Загрузить выписку PDF">${ICON.upload}</button>
      <button id="money-export-btn" class="chip chip--ico" type="button" aria-label="Выгрузить в Excel" title="Выгрузить в Excel (.xlsx)">${ICON.xlsx}</button>
    </div><input id="money-file" type="file" accept="application/pdf,.pdf" hidden />`);
    // блок «деньги» в карточке проекта
    const pt = $("#view-project .proj-tasks"); if (pt) pt.insertAdjacentHTML("afterend", `<div class="proj-tasks proj-money" id="p-money"></div>`);
  }

  /* ---------- Рендер страницы месяца ---------- */
  function statusFilterOn() { return S.fStatuses && S.fStatuses.size !== X.statusSet(PAY_KIND).length; }
  function passFilters(p) {
    if (S.fStatuses && !S.fStatuses.has(p.status)) return false;
    if (S.fProjects.size) {
      const ids = p.kind === "income" ? [p.project_id] : linksOf(p.id).map((l) => l.project_id);
      if (!ids.some((id) => id && S.fProjects.has(id))) return false;
    }
    return true;
  }
  function projPillBtn(pid, act) {
    const p = X.projById(pid); if (!p) return "";
    return `<button type="button" class="proj-pill pay-proj" data-act="${act || "proj"}" data-pid="${p.id}"><span class="proj-emoji">${X.projEmoji(p)}</span><span class="proj-name">${esc(p.name)}</span></button>`;
  }
  function catPill(c, extra) { if (!c) return ""; return `<span class="cat-pill ${extra || ""}" style="--c:${c.color || X.STATUS_PALETTE[0]}"><span class="proj-emoji">${esc(c.emoji || "•")}</span><span class="proj-name">${esc(c.name)}</span></span>`; }
  function payTitle(p, hidePayee) {
    const y = hidePayee ? null : payeeById(p.payee_id);
    const t = p.title || (y ? "" : (p.kind === "expense" && catById(p.category_id) ? catById(p.category_id).name : "без названия"));
    return y ? `<b>${esc(y.name)}</b>${t ? " · " + esc(t) : ""}` : esc(t);
  }
  function payRow(p, opts) {
    opts = opts || {};
    const st = p.status;
    const pids = p.kind === "income" ? (p.project_id ? [p.project_id] : []) : linksOf(p.id).map((l) => l.project_id);
    const pills = opts.hideProj ? "" : pids.map((id) => projPillBtn(id)).join("");
    const cat = (p.kind === "expense" && opts.showCat) ? catPill(catById(p.category_id), "cat-pill--sm") : "";
    const kids = childrenOf(p.id); const paidPart = kids.reduce((s, k) => s + k.amount_minor, 0);
    const sub = kids.length && !isDone(st) ? `<span class="pay-sub">осталось ${fmt(p.amount_minor)} из ${fmt(p.amount_minor + paidPart)}</span>` : "";
    const dateTxt = isDone(st) && p.paid_date && p.paid_date !== p.due_date ? "опл. " + MC.dayLabel(p.paid_date) : MC.dayLabel(p.due_date);
    const bell = p.remind_enabled && !isDone(st) ? `<span class="task-bell">${X.BELL_ON}</span>` : "";
    const amtCls = isDone(st) ? "is-done" : (st === "late" ? "is-late" : "");
    return `<div class="swipeable pay" data-id="${p.id}">
      <div class="swipe-del">${X.TRASH_SVG}</div>
      <div class="swipe-row pay-row">
        <button class="row-status pay-dot" data-act="status" aria-label="Статус: ${esc(X.statusName(PAY_KIND, st))}">${X.statusDot(PAY_KIND, st, true)}</button>
        <div class="pay-main"><span class="pay-title">${payTitle(p, opts.hidePayee)}</span>${pills || cat || sub ? `<span class="pay-pills">${cat}${pills}${sub}</span>` : ""}</div>
        <span class="pay-date">${bell}${dateTxt}</span>
        <span class="pay-amt ${amtCls}" style="--c:${X.statusColor(PAY_KIND, st)}">${fm(p.amount_minor)}</span>
      </div>
    </div>`;
  }
  const bySort = (a, b) => a.due_date.localeCompare(b.due_date) || (a.created_at || "").localeCompare(b.created_at || "");
  function groupHead(label, list, extra) {
    const total = list.reduce((s, p) => s + p.amount_minor, 0);
    const done = list.filter((p) => isDone(p.status)).reduce((s, p) => s + p.amount_minor, 0);
    return `<div class="pay-ghead">${label}<span class="pay-gsum">${done && done !== total ? `<span class="pay-gdone">${fm(done)} / </span>` : ""}${fm(total)}</span>${extra || ""}</div>`;
  }
  function renderTable(kind) {
    const all = S.payments.filter((p) => p.kind === kind && MC.inMonth(p.due_date, S.month));
    const list = all.filter(passFilters).sort(bySort);
    const total = all.reduce((s, p) => s + p.amount_minor, 0), done = all.filter((p) => isDone(p.status)).reduce((s, p) => s + p.amount_minor, 0);
    const isInc = kind === "income";
    let html = `<div class="money-head"><span class="money-h">${isInc ? "доходы" : "расходы"}</span><span class="money-prog">${isInc ? "получено" : "оплачено"} ${fm(done)} из ${fm(total)}</span></div>`;
    html += `<div class="pay-cols"><span></span><span>название</span><span>дата</span><span>сумма</span></div>`;
    const sal0 = salaryCat();
    if (!list.length && !(kind === "expense" && S.group === "entity" && sal0 && !all.length)) {
      html += `<p class="empty money-empty">${all.length ? "ничего не подходит под фильтры" : (isInc ? "поступлений в этом месяце нет" : "расходов в этом месяце нет")}</p>`;
    } else if (S.group === "date") {
      let last = null; list.forEach((p) => { if (p.due_date !== last) { html += `<div class="day-head pay-dayhead">${dayHead(p.due_date)}</div>`; last = p.due_date; } html += payRow(p, { showCat: true }); });
    } else if (S.group === "status") {
      X.statusSet(PAY_KIND).forEach((s) => { const g = list.filter((p) => p.status === s.id); if (!g.length) return; html += `<div class="pay-group">${groupHead(X.statusPill(PAY_KIND, s.id), g)}${g.map((p) => payRow(p, { showCat: true })).join("")}</div>`; });
    } else if (isInc) {
      const groups = {}; list.forEach((p) => { const k = p.project_id || ""; (groups[k] = groups[k] || []).push(p); });
      const keys = Object.keys(groups).sort((a, b) => (!a) - (!b) || groups[b].reduce((s, p) => s + p.amount_minor, 0) - groups[a].reduce((s, p) => s + p.amount_minor, 0));
      keys.forEach((k) => {
        const pr = X.projById(k);
        const label = pr ? projPillBtn(k, "gproj") : `<span class="proj-pill is-empty">без проекта</span>`;
        let extra = "";
        if (pr && pr.contract_minor) { const got = S.payments.filter((p) => p.kind === "income" && p.project_id === k && isDone(p.status)).reduce((s, p) => s + p.amount_minor, 0); const pct = Math.min(100, Math.round((got / pr.contract_minor) * 100)); extra = `<div class="pay-contract"><span>получено ${fm(got)} из ${fm(pr.contract_minor)} по договору</span><div class="fin-bar-wrap"><div class="fin-bar" style="width:${pct}%;background:rgba(134,217,152,.75)"></div></div></div>`; }
        html += `<div class="pay-group">${groupHead(label, groups[k], extra)}${groups[k].map((p) => payRow(p, { hideProj: true })).join("")}<button type="button" class="proj-add-task pay-add" data-add="income" data-pid="${k}">+ поступление</button></div>`;
      });
    } else {
      const groups = {}; list.forEach((p) => { const k = p.category_id || ""; (groups[k] = groups[k] || []).push(p); });
      const sal = salaryCat();
      const keys = Object.keys(groups).sort((a, b) => (sal && b === sal.id) - (sal && a === sal.id) || (!a) - (!b) || groups[b].reduce((s, p) => s + p.amount_minor, 0) - groups[a].reduce((s, p) => s + p.amount_minor, 0));
      if (sal && !groups[sal.id] && !S.fProjects.size && !statusFilterOn()) keys.unshift(sal.id);
      if (!list.length) html += `<p class="empty money-empty">расходов в этом месяце нет</p>`;
      keys.forEach((k) => {
        const c = catById(k); const g = groups[k] || [];
        const isSal = sal && k === sal.id;
        const label = c ? `<button type="button" class="cat-head" data-act="${isSal ? "payees" : "gcat"}" data-cid="${k}">${catPill(c)}${isSal ? `<span class="cat-more">›</span>` : ""}</button>` : `<span class="proj-pill is-empty">без категории</span>`;
        let body = "";
        if (isSal) {
          const byP = {}; g.forEach((p) => { const pk = p.payee_id || ""; (byP[pk] = byP[pk] || []).push(p); });
          Object.keys(byP).sort((a, b) => (!a) - (!b) || ((payeeById(a) || {}).name || "").localeCompare((payeeById(b) || {}).name || "")).forEach((pk) => {
            const y = payeeById(pk); const sum = byP[pk].reduce((s, p) => s + p.amount_minor, 0);
            body += `<div class="pay-subhead"><span>${y ? esc((y.emoji ? y.emoji + " " : "") + y.name) : "без человека"}${y && y.role ? ` <span class="pay-role">${esc(y.role)}</span>` : ""}</span><span>${fm(sum)}</span></div>`;
            body += byP[pk].map((p) => payRow(p, { hidePayee: !!pk })).join("");
          });
          body += `<div class="pay-adds"><button type="button" class="proj-add-task pay-add" data-add="expense" data-cid="${k}">+ выплата</button><button type="button" class="proj-add-task" data-act="accrue">начислить зарплаты за ${MC.MONTHS[+S.month.slice(5) - 1]}</button></div>`;
        } else {
          body = g.map((p) => payRow(p)).join("") + `<button type="button" class="proj-add-task pay-add" data-add="expense" data-cid="${k}">+ расход</button>`;
        }
        html += `<div class="pay-group">${groupHead(label, g)}${body}</div>`;
      });
    }
    if (S.group !== "entity" || !list.length) html += `<button type="button" class="proj-add-task pay-add" data-add="${kind}">+ ${isInc ? "поступление" : "расход"}</button>`;
    const plan = total - done;
    html += `<div class="fin-total pay-total"><span>план ${fm(total)}</span><span>факт ${fm(done)}</span><span class="fin-sum">осталось ${fm(plan)}</span></div>`;
    const el = $(isInc ? "#money-income" : "#money-expense"); el.innerHTML = html;
    $$(".pay", el).forEach((row) => X.attachSwipe(row, () => deletePayment(row.dataset.id)));
  }
  function dayHead(day) { const [y, m, d] = day.split("-").map(Number); return `${["ВС","ПН","ВТ","СР","ЧТ","ПТ","СБ"][new Date(y, m - 1, d).getDay()]} · ${d} ${MC.MONTHS_SHORT[m - 1]}`; }

  function renderTails() {
    const el = $("#money-tails");
    const curKey = MC.monthKey(today());
    if (S.month !== curKey) { el.innerHTML = ""; return; }
    const from = MC.monthStart(S.month);
    const tails = S.payments.filter((p) => !isDone(p.status) && p.due_date < from).sort(bySort);
    if (!tails.length) { el.innerHTML = ""; return; }
    const inc = tails.filter((p) => p.kind === "income").reduce((s, p) => s + p.amount_minor, 0), exp = tails.filter((p) => p.kind === "expense").reduce((s, p) => s + p.amount_minor, 0);
    el.innerHTML = `<button type="button" class="money-tails-head" id="money-tails-toggle"><span>не закрыто из прошлых месяцев · ${tails.length}</span><span class="money-tails-sum">${inc ? "+" + fm(inc) : ""}${inc && exp ? " · " : ""}${exp ? MC.MINUS + fm(exp) : ""}</span><span class="cat-more">${S.showTails ? "⌄" : "›"}</span></button>
      ${S.showTails ? `<div class="money-tails-list">${tails.map((p) => payRow(p, { showCat: true }).replace('<span class="pay-date">', `<button type="button" class="chip pay-move" data-move="${p.id}">сюда</button><span class="pay-date">`)).join("")}</div>` : ""}`;
    $("#money-tails-toggle").addEventListener("click", () => { S.showTails = !S.showTails; renderTails(); });
    $$(".pay", el).forEach((row) => X.attachSwipe(row, () => deletePayment(row.dataset.id)));
  }

  function renderSummary() {
    const el = $("#money-summary");
    const t = today();
    const s = MC.monthSummary(S.payments, S.settings, S.month, t, { withTails: S.withTails });
    const gap = MC.cashGap(S.payments, S.settings, S.month, t);
    // разрыв интересен только впереди: первый день с сегодняшнего, когда остаток < 0, и минимум после него
    const ahead = gap.series.filter((x) => x.date >= t);
    const firstNeg = ahead.find((x) => x.balance < 0);
    const gapAhead = firstNeg ? (() => { const mn = ahead.filter((x) => x.date >= firstNeg.date).reduce((m, x) => (x.balance < m.balance ? x : m), firstNeg); return { date: firstNeg.date, min: mn.balance, minDate: mn.date }; })() : null;
    const isCur = S.month === MC.monthKey(t), isPast = MC.monthStart(S.month) < MC.monthStart(MC.monthKey(t));
    const nextFirst = MC.monthStart(MC.addMonths(S.month, 1));
    const monthStartLong = MC.dayLong(MC.monthStart(S.month));
    const needOpening = !(S.settings && S.settings.opening_date) && !localStorage.getItem("gunco_money_opening_skip");
    const neg = (v) => (v < 0 ? " is-neg" : "");
    const tailsOn = s.tailIncome || s.tailExpense;
    const bar = (done, total, color) => { const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0; return `<div class="sum-bar"><div class="sum-bar-fill" style="width:${pct}%;background:${color}"></div></div>`; };
    const maxT = Math.max(s.incomeTotal, s.expenseTotal, 1);
    el.innerHTML = `
      ${needOpening ? `<div class="money-opening"><div class="money-opening-t">сколько денег у вас сейчас?</div><div class="money-note">укажите общий остаток на счетах и в кассе — от него считается баланс.</div><div class="form-actions"><button type="button" class="btn btn--solid" data-act="opening">указать остаток</button><button type="button" class="btn" data-act="opening-skip">позже</button></div></div>` : ""}
      <div class="sum-title">сводка</div>
      <div class="sum-grid">
        <div class="sum-big">
          <div class="sum-cap">баланс ${isPast ? "на конец месяца" : "сейчас"}</div>
          <div class="sum-num sum-num--xl${neg(isPast ? s.endFact : s.now)}">${fm(isPast ? s.endFact : s.now)}</div>
          <div class="sum-hint">${isPast ? "по факту, " + MC.dayLong(MC.addDaysStr(nextFirst, -1)) : "на сегодня, " + MC.dayLong(t)}</div>
          <div class="sum-cap sum-cap--gap">в теории к ${MC.dayLong(nextFirst)}</div>
          <div class="sum-num sum-num--l${neg(s.theory)}">${fm(s.theory)}</div>
          <div class="sum-hint">если всё запланированное состоится${isPast ? "" : " · " + fm(s.diff, { sign: true }) + " к сейчас"}</div>
          ${tailsOn && !isPast ? `<button type="button" class="chip ${S.withTails ? "is-on" : ""}" data-act="withtails">с учётом хвостов (${s.tailIncome ? "+" + fmt(s.tailIncome) : ""}${s.tailIncome && s.tailExpense ? " / " : ""}${s.tailExpense ? MC.MINUS + fmt(s.tailExpense) : ""})</button>` : ""}
        </div>
        <div class="sum-side">
          <div class="sum-ladder">
            ${ladderRow("", "остаток на " + monthStartLong, s.opening, "opening")}
            ${ladderRow("+", "получено", s.incomeFact, "incomeFact")}
            ${ladderRow(MC.MINUS, "оплачено", s.expenseFact, "expenseFact")}
            ${ladderRow("=", isPast ? "на конец месяца" : "сейчас", isPast ? s.endFact : s.opening + s.incomeFact - s.expenseFact, "", "is-total")}
            ${ladderRow("+", "ожидается", s.incomePlan, "incomePlan")}
            ${ladderRow(MC.MINUS, "предстоит", s.expensePlan, "expensePlan")}
            ${ladderRow("=", "в теории", s.theory, "", "is-total")}
          </div>
          <div class="sum-bars">
            <div class="sum-barrow"><span class="sum-barcap">доходы</span><div class="sum-bar-wrap" style="width:${Math.max(8, Math.round((s.incomeTotal / maxT) * 100))}%">${bar(s.incomeDone, s.incomeTotal, "rgba(134,217,152,.85)")}</div><span class="sum-barval">${fm(s.incomeDone)} / ${fm(s.incomeTotal)}</span></div>
            <div class="sum-barrow"><span class="sum-barcap">расходы</span><div class="sum-bar-wrap" style="width:${Math.max(8, Math.round((s.expenseTotal / maxT) * 100))}%">${bar(s.expenseDone, s.expenseTotal, "rgba(232,155,184,.85)")}</div><span class="sum-barval">${fm(s.expenseDone)} / ${fm(s.expenseTotal)}</span></div>
          </div>
          ${gapAhead ? `<div class="sum-gap">${ICON.warn}<span>${gapAhead.date === t ? "уже сегодня" : MC.dayLong(gapAhead.date)} денег не хватит: <b>${fm(gapAhead.min)}</b>${gapAhead.minDate !== gapAhead.date ? ` (минимум ${MC.dayLong(gapAhead.minDate)})` : ""}</span></div>` : ""}
          <div class="pane-head-tools sum-actions">${isCur ? `<button type="button" class="chip" data-act="reconcile">сверить с банком</button>` : ""}<button type="button" class="chip" data-act="opening">начальный остаток</button></div>
        </div>
      </div>`;
  }
  function ladderRow(sign, label, value, key, cls) {
    return `<button type="button" class="sum-lrow ${cls || ""}" ${key ? `data-break="${key}"` : "disabled"}><span class="sum-lsign">${sign}</span><span class="sum-llabel">${esc(label)}</span><span class="sum-lval${value < 0 ? " is-neg" : ""}">${fm(value)}</span></button>`;
  }

  function renderMonthBar() {
    $("#money-month").textContent = MC.monthLabel(S.month);
    $("#money-today").hidden = S.month === MC.monthKey(today());
    $("#money-f-status").classList.toggle("is-on", statusFilterOn());
    $("#money-f-proj").classList.toggle("is-on", S.fProjects.size > 0);
    $("#money-group").title = { entity: "группировка: по проектам и категориям", date: "группировка: по датам", status: "группировка: по статусам" }[S.group];
    $("#money-group").classList.toggle("is-on", S.group !== "entity");
  }
  async function renderMoney() {
    await ensureLoaded();
    if (!S.month) S.month = MC.monthKey(today());
    await X.loadProjects();
    await ensureRecurrences(S.month);
    await applyAutoLate();
    renderMonthBar(); renderTails(); renderTable("income"); renderTable("expense"); renderSummary();
    if (X.getCurrentView() === "money") { try { history.replaceState(null, "", "#money/" + S.month); } catch (e) {} }
    scheduleNative();
  }
  function setMonth(key) { S.month = key; S.showTails = false; renderMoney(); const p = $("#money-pane"); if (p) p.scrollTop = 0; }

  /* ---------- Клики на странице ---------- */
  function wireMoneyPage() {
    $("#money-prev").addEventListener("click", () => setMonth(MC.addMonths(S.month, -1)));
    $("#money-next").addEventListener("click", () => setMonth(MC.addMonths(S.month, 1)));
    $("#money-today").addEventListener("click", () => setMonth(MC.monthKey(today())));
    // свайп по шапке месяца и сводке листает месяцы
    [$("#money-monthbar"), $("#money-summary")].forEach((zone) => {
      let sx = 0, sy = 0, on = false;
      zone.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; }, { passive: true });
      zone.addEventListener("touchend", (e) => { if (!on) return; on = false; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setMonth(MC.addMonths(S.month, dx < 0 ? 1 : -1)); }, { passive: true });
    });
    document.addEventListener("keydown", (e) => {
      if (X.getCurrentView() !== "money" || $$(".modal").some((m) => !m.hidden)) return;
      const ae = document.activeElement; if (ae && (ae.isContentEditable || /INPUT|TEXTAREA/.test(ae.tagName))) return;
      if (e.key === "ArrowLeft") setMonth(MC.addMonths(S.month, -1));
      else if (e.key === "ArrowRight") setMonth(MC.addMonths(S.month, 1));
      else if (e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т") { e.preventDefault(); newPayment({ kind: e.shiftKey ? "income" : "expense" }); }
    });
    $("#money-f-status").addEventListener("click", openStatusFilter);
    $("#money-f-proj").addEventListener("click", () => X.openProjectMulti([...S.fProjects], (ids) => { S.fProjects = new Set(ids); renderMoney(); }, "фильтр: проекты"));
    $("#money-group").addEventListener("click", () => { S.group = S.group === "entity" ? "date" : S.group === "date" ? "status" : "entity"; localStorage.setItem("gunco_money_group", S.group); renderMoney(); X.toast({ entity: "по проектам и категориям", date: "по датам", status: "по статусам" }[S.group]); });
    $("#money-more").addEventListener("click", openSettings);
    $("#money-import-btn").addEventListener("click", openImportPage);
    $("#money-export-btn").addEventListener("click", openExport);
    $("#money-pane").addEventListener("click", onPaneClick);
    // долгое нажатие на точку статуса → «готово»
    let lpTimer = null, lpFired = false;
    $("#money-pane").addEventListener("pointerdown", (e) => {
      const dot = e.target.closest(".pay-dot"); if (!dot) return; lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; const id = dot.closest(".pay").dataset.id; const p = payById(id); if (p && !isDone(p.status)) setStatus(p, "done", true); }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => $("#money-pane").addEventListener(ev, () => clearTimeout(lpTimer)));
    $("#money-pane").addEventListener("click", (e) => { if (lpFired && e.target.closest(".pay-dot")) { e.stopPropagation(); lpFired = false; } }, true);
  }
  async function onPaneClick(e) {
    if (X.isJustSwiped()) return;
    const actEl = e.target.closest("[data-act],[data-add],[data-break],[data-move]");
    if (actEl && actEl.dataset.move) { const p = payById(actEl.dataset.move); if (p) { const prev = { due_date: p.due_date, status: p.status, status_before_late: p.status_before_late }; const nd = MC.addDaysStr(MC.monthStart(S.month), 0) > today() ? MC.monthStart(S.month) : today(); await patchPayment(p, { due_date: nd, status: p.status_before_late || "waiting", status_before_late: null }); X.pushUndo("перенос", () => patchPayment(p, prev)); X.toast("перенесено на " + MC.dayLong(nd)); renderMoney(); } return; }
    if (actEl && actEl.dataset.break) { openBreakdown(actEl.dataset.break); return; }
    if (actEl && actEl.dataset.add) { newPayment({ kind: actEl.dataset.add, project_id: actEl.dataset.pid || null, category_id: actEl.dataset.cid || null }); return; }
    const act = actEl && actEl.dataset.act;
    const row = e.target.closest(".pay");
    const p = row ? payById(row.dataset.id) : null;
    if (act === "status" && p) { X.openStatusPicker(PAY_KIND, p.status, (k) => setStatus(p, k, true)); return; }
    if ((act === "proj" || act === "gproj") && actEl.dataset.pid) { const pr = X.projById(actEl.dataset.pid); if (pr) X.openProjectEdit(pr); return; }
    if (act === "payees") { showPayees(); return; }
    if (act === "gcat") { openCategoryEdit(catById(actEl.dataset.cid)); return; }
    if (act === "accrue") { accrueSalaries(); return; }
    if (act === "opening") { editOpening(); return; }
    if (act === "opening-skip") { localStorage.setItem("gunco_money_opening_skip", "1"); renderSummary(); return; }
    if (act === "reconcile") { reconcile(); return; }
    if (act === "withtails") { S.withTails = !S.withTails; renderSummary(); return; }
    if (p) openPayment(p, "money");
  }

  /* ---------- Действия с платежами ---------- */
  async function patchPayment(p, patch) { Object.assign(p, patch); await DB.update("payments", p.id, patch); }
  async function setStatus(p, k, withUndo) {
    const prev = { status: p.status, paid_date: p.paid_date || null, status_before_late: p.status_before_late || null };
    const patch = { status: k };
    if (isDone(k)) { if (!p.paid_date) patch.paid_date = today(); }
    else patch.paid_date = null;
    if (k !== "late") patch.status_before_late = null;
    if (isDone(k) && p.recurrence_id == null && p.remind_enabled) patch.reminded_at = new Date().toISOString();
    await patchPayment(p, patch);
    if (withUndo) X.pushUndo("статус", async () => { await patchPayment(p, prev); });
    if (isDone(k) && withUndo) X.toast("отмечено: готово");
    rerender();
  }
  async function deletePayment(id) {
    const p = payById(id); if (!p) return;
    let ids = [id];
    if (p.recurrence_id) {
      const ch = await choice("удалить повторяющийся платёж", "", [{ label: "только этот", value: "one" }, { label: "этот и следующие", value: "next", cls: "btn--danger" }]);
      if (!ch) { rerender(); return; }
      if (ch === "next") {
        ids = S.payments.filter((x) => x.recurrence_id === p.recurrence_id && x.due_date >= p.due_date && !isDone(x.status)).map((x) => x.id);
        const r = S.recs.find((x) => x.id === p.recurrence_id); if (r) { const end = MC.addDaysStr(p.due_date, -1); await DB.update("recurrences", r.id, { end_date: end }); r.end_date = end; }
      }
    }
    const now = new Date().toISOString();
    for (const i of ids) { const x = payById(i); if (!x) continue; await DB.update("payments", i, { deleted_at: now }); }
    const removed = S.payments.filter((x) => ids.includes(x.id));
    S.payments = S.payments.filter((x) => !ids.includes(x.id));
    X.pushUndo("удаление платежа", async () => { for (const x of removed) { await DB.update("payments", x.id, { deleted_at: null }); x.deleted_at = null; S.payments.push(x); } });
    X.toast(ids.length > 1 ? `удалено: ${ids.length}` : "удалено");
    rerender();
  }
  function rerender() {
    const v = X.getCurrentView();
    if (v === "money") renderMoney(); else if (v === "project") renderProjectBlock(); else if (v === "payees") renderPayees(); else if (v === "payee") renderPayeeHistory();
  }

  /* ---------- Фильтр статусов ---------- */
  function openStatusFilter() {
    const set = X.statusSet(PAY_KIND);
    if (!S.fStatuses) S.fStatuses = new Set(set.map((s) => s.id));
    const draw = () => {
      const m = modal("mfilter-modal", `<div class="modal-title">статусы</div><div class="status-list">${set.map((s) => `<button type="button" class="status-pill ${S.fStatuses.has(s.id) ? "" : "off"}" data-k="${s.id}" style="--c:${s.c}"><span>${esc(s.name)}</span>${X.statusDot(PAY_KIND, s.id)}</button>`).join("")}</div><button type="button" class="modal-clear" id="mf-all">показать все</button>`);
      $$(".status-pill", m).forEach((b) => b.addEventListener("click", () => { const k = b.dataset.k; S.fStatuses.has(k) ? S.fStatuses.delete(k) : S.fStatuses.add(k); draw(); renderMoney(); }));
      $("#mf-all", m).addEventListener("click", () => { S.fStatuses = new Set(set.map((s) => s.id)); draw(); renderMoney(); });
    };
    draw();
  }

  /* ---------- Разбор строки сводки ---------- */
  function openBreakdown(key) {
    const { from, to } = MC.monthRange(S.month);
    const names = { opening: "до начала месяца (факт)", incomeFact: "получено", expenseFact: "оплачено", incomePlan: "ожидается", expensePlan: "предстоит" };
    let list = [];
    if (key === "incomeFact") list = S.payments.filter((p) => p.kind === "income" && isDone(p.status) && p.paid_date >= from && p.paid_date < to);
    if (key === "expenseFact") list = S.payments.filter((p) => p.kind === "expense" && isDone(p.status) && p.paid_date >= from && p.paid_date < to);
    if (key === "incomePlan") list = S.payments.filter((p) => p.kind === "income" && !isDone(p.status) && MC.inMonth(p.due_date, S.month));
    if (key === "expensePlan") list = S.payments.filter((p) => p.kind === "expense" && !isDone(p.status) && MC.inMonth(p.due_date, S.month));
    if (key === "opening") {
      const ob = (S.settings && S.settings.opening_balance_minor) || 0;
      const od = S.settings && S.settings.opening_date;
      const m = modal("mlist-modal", `<div class="modal-title">остаток на ${MC.dayLong(from)}</div><div class="sum-ladder">${ladderRow("", "начальный остаток" + (od ? " на " + MC.dayLong(od) : ""), ob, "")}${ladderRow("+", "все поступления до месяца", S.payments.filter((p) => p.kind === "income" && isDone(p.status) && p.paid_date < from && (!od || p.paid_date >= od)).reduce((s, p) => s + p.amount_minor, 0), "")}${ladderRow(MC.MINUS, "все расходы до месяца", S.payments.filter((p) => p.kind === "expense" && isDone(p.status) && p.paid_date < from && (!od || p.paid_date >= od)).reduce((s, p) => s + p.amount_minor, 0), "")}</div>`, "mlist-card");
      return m;
    }
    list.sort(bySort);
    const m = modal("mlist-modal", `<div class="modal-title">${names[key]} · ${fm(list.reduce((s, p) => s + p.amount_minor, 0))}</div><div class="mlist scroll">${list.length ? list.map((p) => payRow(p, { showCat: true })).join("") : `<p class="empty">пусто</p>`}</div>`, "mlist-card");
    $$(".pay", m).forEach((row) => row.addEventListener("click", () => { m.hidden = true; const p = payById(row.dataset.id); if (p) openPayment(p, "money"); }));
  }

  /* ---------- Начальный остаток, сверка с банком ---------- */
  async function editOpening() {
    const r = await inputAmount({ title: "начальный остаток", sub: "сколько денег было на всех счетах и в кассе на дату. всё, что раньше этой даты, в баланс не войдёт.", value: (S.settings && S.settings.opening_balance_minor) || null, date: (S.settings && S.settings.opening_date) || today(), allowZero: true, allowNegative: true });
    if (!r) return;
    const prev = { opening_balance_minor: S.settings.opening_balance_minor, opening_date: S.settings.opening_date };
    await DB.saveSettings({ opening_balance_minor: r.amount, opening_date: r.date || today() });
    X.pushUndo("начальный остаток", () => DB.saveSettings(prev));
    localStorage.removeItem("gunco_money_opening_skip");
    renderSummary();
  }
  async function reconcile() {
    const s = MC.monthSummary(S.payments, S.settings, S.month, today());
    const r = await inputAmount({ title: "сверка с банком", sub: `по приложению сейчас ${fmt(s.now)}. сколько реально на счетах?`, okLabel: "Сверить", allowZero: true, allowNegative: true });
    if (!r) return;
    const diff = r.amount - s.now;
    if (diff === 0) { X.toast("всё сходится"); return; }
    const ok = await choice(`расхождение ${fmt(diff, { sign: true })}`, diff > 0 ? "на счетах больше, чем в приложении" : "на счетах меньше, чем в приложении", [{ label: "создать корректировку", value: true, cls: "btn--solid" }]);
    if (!ok) return;
    const other = S.cats.find((c) => (c.name || "").toLowerCase() === "прочее");
    const row = await DB.insert("payments", { kind: diff > 0 ? "income" : "expense", title: "корректировка остатка", amount_minor: Math.abs(diff), due_date: today(), paid_date: today(), status: "done", category_id: diff < 0 && other ? other.id : null, source: "manual" });
    S.payments.push(row); X.pushUndo("корректировка", async () => { await DB.update("payments", row.id, { deleted_at: new Date().toISOString() }); S.payments = S.payments.filter((x) => x.id !== row.id); });
    X.toast("баланс сверен"); renderMoney();
  }

  /* ================= КАРТОЧКА ПЛАТЕЖА ================= */
  let C = null;              // черновик
  let cReturn = "money";
  let cSaving = Promise.resolve();
  function blankCard(opts) {
    opts = opts || {};
    const key = S.month || MC.monthKey(today());
    const due = opts.due_date || (MC.monthKey(today()) === key ? today() : MC.monthStart(key));
    const kind = opts.kind || localStorage.getItem("gunco_money_lastkind") || "expense";
    return { id: null, kind, title: opts.title || "", amount_minor: opts.amount_minor || null, due_date: due, paid_date: null, status: "waiting", project_id: kind === "income" ? (opts.project_id || null) : null, links: kind === "expense" && opts.project_id ? [{ project_id: opts.project_id, share_minor: null }] : [], category_id: kind === "expense" ? (opts.category_id || null) : null, payee_id: opts.payee_id || null, note: "", remind_enabled: !!(S.settings && S.settings.remind_auto && kind === "expense"), remind_at: null, remind_channels: ["email", "telegram"], remind_repeat: "none", remindOffset: 0, remindTime: defTime(), remindCustom: null, recurrence_id: null, recDraft: null, source: "manual", parent_id: null, import_id: null, _linksSaved: "[]", _orig: null };
  }
  function cardFromPayment(p) {
    const links = linksOf(p.id).map((l) => ({ project_id: l.project_id, share_minor: l.share_minor == null ? null : Number(l.share_minor) }));
    const c = { ...blankCard({ kind: p.kind }), ...p, links, _linksSaved: JSON.stringify(links), _orig: JSON.stringify(p) };
    c.remindTime = defTime(); c.remindOffset = 0; c.remindCustom = null;
    if (p.remind_at) {
      const d = MC.todayInTz(tz(), new Date(p.remind_at));
      const tm = new Intl.DateTimeFormat("ru-RU", { timeZone: tz(), hour: "2-digit", minute: "2-digit" }).format(new Date(p.remind_at));
      const off = Math.round((Date.parse(p.due_date) - Date.parse(d)) / 86400000);
      c.remindTime = tm; if ([0, 1, 3].includes(off)) c.remindOffset = off; else c.remindCustom = { date: d, time: tm };
    }
    return c;
  }
  async function newPayment(opts) {
    await ensureLoaded(); await X.loadProjects();
    C = blankCard(opts || {}); cReturn = (opts && opts.returnView) || (X.getCurrentView() === "project" ? "project" : X.getCurrentView() === "payee" ? "payee" : "money");
    if (opts && opts.category_id && salaryCat() && opts.category_id === salaryCat().id && !C.title) C.title = "зарплата";
    fillCard(); X.showView("payment");
    setTimeout(() => $("#pay-amount").focus(), 60);
  }
  function openPayment(p, returnView) { C = cardFromPayment(p); cReturn = returnView || "money"; fillCard(); X.showView("payment"); }
  function fillCard() {
    $$(".pay-kind .kind-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.kind === C.kind));
    $("#pay-title").innerText = C.title || "";
    $("#pay-title").dataset.placeholder = C.kind === "income" ? "оплата этапа, аванс…" : "аренда офиса, подрядчик…";
    $("#pay-amount").value = C.amount_minor ? MC.amountToInput(C.amount_minor) : "";
    $("#pay-amount-err").hidden = true;
    $("#pay-note").innerText = C.note || "";
    $("#pay-delete").hidden = !C.id;
    renderCardMeta();
  }
  function renderCardMeta() {
    const c = C; const done = isDone(c.status);
    let meta = `<button type="button" class="status-slot" id="pay-status">${X.statusPill(PAY_KIND, c.status)}</button>`;
    meta += `<button type="button" class="meta-pill" id="pay-due" title="дата платежа"><span class="meta-cap">срок</span>${MC.dayLong(c.due_date)}${c.due_date.slice(0, 4) !== today().slice(0, 4) ? " " + c.due_date.slice(0, 4) : ""}</button>`;
    if (done) meta += `<button type="button" class="meta-pill" id="pay-paid" title="дата оплаты"><span class="meta-cap">оплачено</span>${c.paid_date ? MC.dayLong(c.paid_date) : "сегодня"}</button>`;
    if (c.kind === "expense" && !done) meta += `<button type="button" class="meta-pill meta-bell ${c.remind_enabled ? "" : "off"}" id="pay-bell" title="напоминание">${c.remind_enabled ? X.BELL_ON : X.BELL_OFF}${c.remind_enabled ? `<span>${remindLabel(c)}</span>` : ""}</button>`;
    $("#pay-meta").innerHTML = meta;
    let ent = "";
    if (c.kind === "income") {
      const p = X.projById(c.project_id);
      ent += `<button type="button" class="proj-pill ${p ? "" : "is-empty"}" id="pay-proj">${p ? `<span class="proj-emoji">${X.projEmoji(p)}</span><span class="proj-name">${esc(p.name)}</span>` : "без проекта"}</button>`;
    } else {
      const cat = catById(c.category_id);
      ent += `<button type="button" class="cat-pill ${cat ? "" : "is-empty"}" id="pay-cat" style="--c:${cat ? cat.color || X.STATUS_PALETTE[0] : "150,153,163"}">${cat ? `<span class="proj-emoji">${esc(cat.emoji || "•")}</span><span class="proj-name">${esc(cat.name)}</span>` : "категория"}</button>`;
      if (cat && cat.is_salary) { const y = payeeById(c.payee_id); ent += `<button type="button" class="proj-pill ${y ? "" : "is-empty"}" id="pay-payee">${y ? `<span class="proj-emoji">${esc(y.emoji || "👤")}</span><span class="proj-name">${esc(y.name)}</span>` : "кому"}</button>`; }
      c.links.forEach((l) => { const p = X.projById(l.project_id); if (p) ent += `<button type="button" class="proj-pill" data-link="${p.id}"><span class="proj-emoji">${X.projEmoji(p)}</span><span class="proj-name">${esc(p.name)}</span></button>`; });
      ent += `<button type="button" class="proj-add-row" id="pay-addproj" aria-label="Добавить проект" title="проекты">${ICON.plus}</button>`;
    }
    $("#pay-entities").innerHTML = ent;
    // зарплатные быстрые названия
    const cat = catById(c.category_id);
    const st = $("#pay-salary-titles");
    if (c.kind === "expense" && cat && cat.is_salary) {
      const recent = JSON.parse(localStorage.getItem("gunco_money_saltitles") || "[]");
      const list = [...new Set([...SALARY_TITLES, ...recent])].slice(0, 12);
      st.innerHTML = list.map((t) => `<button type="button" class="chip ${c.title === t ? "is-on" : ""}" data-st="${esc(t)}">${esc(t)}</button>`).join("");
      st.hidden = false;
    } else st.hidden = true;
    renderShares();
    // доп.: повтор, частично, дублировать
    const rec = c.recurrence_id ? S.recs.find((r) => r.id === c.recurrence_id) : null;
    const recLabel = rec ? recText(rec) : c.recDraft ? recText(c.recDraft) : "не повторяется";
    let extra = `<button type="button" class="meta-pill ${rec || c.recDraft ? "" : "is-empty"}" id="pay-repeat">↻ ${esc(recLabel)}</button>`;
    if (c.id && !done) extra += `<button type="button" class="meta-pill" id="pay-partial">частично ${c.kind === "income" ? "получено" : "оплачено"}</button>`;
    if (c.id) extra += `<button type="button" class="meta-pill" id="pay-dup">дублировать</button>`;
    $("#pay-extra").innerHTML = extra;
    // служебная строка
    const bits = [];
    if (c.source === "statement") bits.push("из выписки");
    if (c.source === "migration") bits.push("из старого раздела «финансы»");
    if (c.source === "ai") bits.push("добавлено через ИИ");
    if (c.source === "salary") bits.push("начислено автоматически");
    if (c.parent_id) { const par = payById(c.parent_id); if (par) bits.push(`часть платежа «${par.title || "без названия"}»`); }
    const kids = c.id ? childrenOf(c.id) : []; if (kids.length) bits.push(`уже ${c.kind === "income" ? "получено" : "оплачено"} частями ${fmt(kids.reduce((s, k) => s + k.amount_minor, 0))}`);
    if (c.created_at) bits.push("создано " + MC.dayLong(MC.todayInTz(tz(), new Date(c.created_at))));
    $("#pay-service").textContent = bits.join(" · ");
  }
  function remindLabel(c) {
    if (c.remindCustom) return `${MC.dayLong(c.remindCustom.date)}, ${c.remindCustom.time}`;
    return `${c.remindOffset === 0 ? "в день" : c.remindOffset === 1 ? "за день" : "за 3 дня"}, ${c.remindTime}`;
  }
  function recText(r) {
    const d = r.day_of_month || +(r.start_date || "").slice(8);
    const until = r.end_date ? ` до ${MC.dayLong(r.end_date)}` : "";
    if (r.freq === "week") return "каждую неделю" + until;
    if (r.freq === "quarter") return `раз в квартал, ${d}-го` + until;
    if (r.freq === "year") return "раз в год" + until;
    return `каждый месяц, ${d >= 29 ? (d === 31 ? "в последний день" : d + "-го") : d + "-го"}` + until;
  }
  function renderShares() {
    const c = C; const el = $("#pay-shares");
    if (c.kind !== "expense" || c.links.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
    const amount = c.amount_minor || 0;
    const manual = c.links.every((l) => l.share_minor != null);
    const shares = MC.projectShares(amount, c.links);
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    el.hidden = false;
    el.innerHTML = `<div class="pay-shares-head"><span class="proj-tasks-head">распределение</span><div class="fintx-kind pay-shares-mode"><button type="button" class="kind-btn ${manual ? "" : "is-on"}" data-mode="eq">поровну</button><button type="button" class="kind-btn ${manual ? "is-on" : ""}" data-mode="man">вручную</button></div></div>
      ${shares.map((s) => { const p = X.projById(s.project_id); return `<div class="pay-share-row"><span class="proj-pill"><span class="proj-emoji">${p ? X.projEmoji(p) : "•"}</span><span class="proj-name">${p ? esc(p.name) : "проект"}</span></span>${manual ? `<input class="field pay-share-inp" data-pid="${s.project_id}" inputmode="decimal" value="${esc(MC.amountToInput(s.amount))}"/>` : `<span class="pay-share-val">${fm(s.amount)}</span>`}</div>`; }).join("")}
      <div class="pay-share-check ${sum === amount ? "" : "is-error"}">распределено ${fmt(sum)} из ${fmt(amount)}</div>`;
  }
  function wireCard() {
    $$(".pay-kind .kind-btn").forEach((b) => b.addEventListener("click", () => {
      if (C.kind === b.dataset.kind) return;
      const prev = { kind: C.kind, project_id: C.project_id, links: C.links, category_id: C.category_id, payee_id: C.payee_id };
      C.kind = b.dataset.kind; localStorage.setItem("gunco_money_lastkind", C.kind);
      if (C.kind === "income") { C.project_id = (C.links[0] && C.links[0].project_id) || null; C.links = []; C.category_id = null; C.payee_id = null; C.remind_enabled = false; }
      else { C.links = C.project_id ? [{ project_id: C.project_id, share_minor: null }] : []; C.project_id = null; }
      X.pushUndo("тип платежа", () => { Object.assign(C, prev); fillCard(); saveCard(); });
      fillCard(); saveCard();
    }));
    $("#pay-title").addEventListener("input", () => { C.title = $("#pay-title").innerText.trim(); saveCardDebounced(); });
    $("#pay-note").addEventListener("input", () => { C.note = $("#pay-note").innerText.trim(); saveCardDebounced(); });
    $("#pay-amount").addEventListener("input", () => { const a = MC.parseAmount($("#pay-amount").value); C.amount_minor = a; $("#pay-amount-err").hidden = true; renderShares(); saveCardDebounced(); });
    $("#pay-amount").addEventListener("blur", () => { if (C.amount_minor) $("#pay-amount").value = MC.amountToInput(C.amount_minor); else if ($("#pay-amount").value.trim()) { $("#pay-amount-err").textContent = "не понял сумму — например 120 000 или 120к"; $("#pay-amount-err").hidden = false; } });
    $("#pay-card").addEventListener("click", onCardClick);
    $("#pay-card").addEventListener("input", (e) => {
      const inp = e.target.closest(".pay-share-inp"); if (!inp) return;
      const l = C.links.find((x) => x.project_id === inp.dataset.pid); if (l) l.share_minor = MC.parseAmount(inp.value) || 0;
      const sum = C.links.reduce((s, x) => s + (x.share_minor || 0), 0); const chk = $(".pay-share-check");
      if (chk) { chk.textContent = `распределено ${fmt(sum)} из ${fmt(C.amount_minor || 0)}`; chk.classList.toggle("is-error", sum !== (C.amount_minor || 0)); }
      saveCardDebounced();
    });
    $("#pay-done").addEventListener("click", leaveCard);
    $("#pay-delete").addEventListener("click", async () => { if (!C.id) return leaveCard(); if (!(await X.askConfirm("Удалить платёж?"))) return; const id = C.id; C = null; await deletePayment(id); X.showView(cReturn); });
  }
  async function onCardClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.id;
    if (id === "pay-status") return X.openStatusPicker(PAY_KIND, C.status, (k) => { C.status = k; if (isDone(k) && !C.paid_date) C.paid_date = today(); if (!isDone(k)) C.paid_date = null; renderCardMeta(); saveCard(); });
    if (id === "pay-due") return X.openCalendar({ value: C.due_date, onPick: (v) => { if (!v) return; C.due_date = v; if (C.status === "late" && v >= today()) { C.status = C.status_before_late || "waiting"; C.status_before_late = null; } recomputeRemind(); renderCardMeta(); saveCard(); } });
    if (id === "pay-paid") return X.openCalendar({ value: C.paid_date || today(), onPick: (v) => { if (!v) return; C.paid_date = v; renderCardMeta(); saveCard(); } });
    if (id === "pay-bell") return openRemind();
    if (id === "pay-proj") return X.openProjectPicker(C.project_id, (pid) => { C.project_id = pid; renderCardMeta(); saveCard(); });
    if (id === "pay-cat") return openCategoryPicker(C.category_id, (cid) => { C.category_id = cid; const cat = catById(cid); if (!(cat && cat.is_salary)) C.payee_id = null; else if (!C.title) { C.title = "зарплата"; $("#pay-title").innerText = C.title; } renderCardMeta(); saveCard(); });
    if (id === "pay-payee") return openPayeePicker(C.payee_id, (yid) => { C.payee_id = yid; const y = payeeById(yid); if (y && !C.amount_minor && y.default_amount_minor) { const plan = MC.salaryPlan({ ...y, active: true }, MC.monthKey(C.due_date)); const hit = plan.find((x) => x.title === C.title) || plan[0]; if (hit) { C.amount_minor = hit.amount_minor; $("#pay-amount").value = MC.amountToInput(hit.amount_minor); } } renderCardMeta(); saveCard(); });
    if (id === "pay-addproj" || b.dataset.link) return X.openProjectMulti(C.links.map((l) => l.project_id), (ids) => { const old = {}; C.links.forEach((l) => (old[l.project_id] = l.share_minor)); const manual = C.links.length > 1 && C.links.every((l) => l.share_minor != null); C.links = ids.map((pid) => ({ project_id: pid, share_minor: manual && old[pid] != null ? old[pid] : null })); if (C.links.some((l) => l.share_minor == null)) C.links.forEach((l) => (l.share_minor = null)); renderCardMeta(); saveCard(); }, "проекты расхода");
    if (b.dataset.mode) { const amount = C.amount_minor || 0; if (b.dataset.mode === "eq") C.links.forEach((l) => (l.share_minor = null)); else { const eq = MC.splitEqual(amount, C.links.length); C.links.forEach((l, i) => (l.share_minor = eq[i])); } renderShares(); saveCard(); return; }
    if (b.dataset.st != null) { C.title = b.dataset.st; $("#pay-title").innerText = C.title; renderCardMeta(); saveCard(); return; }
    if (id === "pay-repeat") return openRepeat();
    if (id === "pay-partial") return partialPay();
    if (id === "pay-dup") return duplicateCard();
  }
  function recomputeRemind() {
    if (!C.remind_enabled) { C.remind_at = null; return; }
    C.remind_at = C.remindCustom ? MC.zonedToUTC(C.remindCustom.date, C.remindCustom.time, tz()) : MC.remindAtFor(C.due_date, C.remindOffset, C.remindTime, tz());
    C.reminded_at = null;
  }
  function cardRow() {
    const c = C;
    return { kind: c.kind, title: c.title || "", amount_minor: c.amount_minor, due_date: c.due_date, paid_date: isDone(c.status) ? (c.paid_date || today()) : null, status: c.status, status_before_late: c.status_before_late || null, project_id: c.kind === "income" ? c.project_id || null : null, category_id: c.kind === "expense" ? c.category_id || null : null, payee_id: c.kind === "expense" ? c.payee_id || null : null, note: c.note || null, remind_enabled: c.kind === "expense" && !!c.remind_enabled, remind_at: c.kind === "expense" && c.remind_enabled ? c.remind_at : null, remind_channels: c.remind_channels, remind_repeat: c.remind_repeat, reminded_at: c.reminded_at || null, recurrence_id: c.recurrence_id || null };
  }
  function saveCard() { cSaving = cSaving.then(doSave, doSave); return cSaving; }
  const saveCardDebounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(saveCard, 500); }; })();
  async function doSave() {
    const c = C; if (!c) return;
    if (!c.amount_minor || c.amount_minor <= 0) return;   // пустой платёж не сохраняем
    if (c.kind === "expense" && c.links.length > 1 && c.links.every((l) => l.share_minor != null) && !MC.sharesValid(c.amount_minor, c.links.map((l) => l.share_minor))) return;   // доли не сходятся — ждём
    const row = cardRow();
    try {
      if (!c.id) { const ins = await DB.insert("payments", row); c.id = ins.id; c.created_at = ins.created_at; S.payments.push(ins); $("#pay-delete").hidden = false; }
      else { await DB.update("payments", c.id, row); const p = payById(c.id); if (p) Object.assign(p, row); }
      const links = c.kind === "expense" ? c.links.map((l) => ({ project_id: l.project_id, share_minor: c.links.length > 1 ? l.share_minor : null })) : [];
      const js = JSON.stringify(links);
      if (js !== c._linksSaved) { await DB.setLinks(c.id, links); S.links = S.links.filter((l) => l.payment_id !== c.id).concat(links.map((l) => ({ payment_id: c.id, project_id: l.project_id, share_minor: l.share_minor }))); c._linksSaved = js; }
    } catch (e) { X.toast("не сохранилось: " + e.message); }
  }
  async function leaveCard() {
    if (!C) { X.showView(cReturn); return; }
    const c = C;
    if (!c.id && !c.amount_minor) { C = null; X.showView(cReturn); return; }   // пустой — просто уходим
    if (!c.amount_minor) { $("#pay-amount-err").textContent = "введите сумму"; $("#pay-amount-err").hidden = false; $("#pay-amount").focus(); return; }
    if (c.kind === "expense" && c.links.length > 1 && c.links.every((l) => l.share_minor != null) && !MC.sharesValid(c.amount_minor, c.links.map((l) => l.share_minor))) { X.toast("доли проектов не сходятся с суммой"); return; }
    if (!c.title && c.kind === "expense" && catById(c.category_id) && !catById(c.category_id).is_salary) c.title = catById(c.category_id).name;
    await saveCard();
    // повторение: новая серия или правка серии
    if (c.recDraft && !c.recurrence_id) await createRecurrenceFrom(c);
    else if (c.recurrence_id && c._orig) {
      const o = JSON.parse(c._orig); const changed = ["title", "amount_minor", "category_id", "project_id", "payee_id", "note"].some((k) => (o[k] || null) !== (c[k] || null)) || c._linksSaved !== JSON.stringify(linksOf(c.id).map((l) => ({ project_id: l.project_id, share_minor: l.share_minor == null ? null : Number(l.share_minor) })));
      if (changed || (o.title !== c.title || o.amount_minor !== c.amount_minor)) {
        const ch = await choice("изменить повторяющийся платёж", "", [{ label: "только этот", value: "one" }, { label: "этот и следующие", value: "next", cls: "btn--solid" }]);
        if (ch === "next") await updateSeriesFrom(c);
      }
    }
    if (c.kind === "expense" && catById(c.category_id) && catById(c.category_id).is_salary && c.title && !SALARY_TITLES.includes(c.title)) { const r = JSON.parse(localStorage.getItem("gunco_money_saltitles") || "[]"); localStorage.setItem("gunco_money_saltitles", JSON.stringify([c.title, ...r.filter((x) => x !== c.title)].slice(0, 10))); }
    C = null; X.showView(cReturn);
  }
  function isOpenCard() { return !!C; }

  /* ---------- Напоминание ---------- */
  function openRemind() {
    const c = C; const s = S.settings || {};
    const tgOn = !!s.telegram_chat_id, emOn = s.email_enabled !== false;
    const draw = () => {
      const m = modal("mremind-modal", `<div class="modal-title">напоминание</div>
        <button type="button" class="chip ${c.remind_enabled ? "is-on" : ""}" id="mr-on">${c.remind_enabled ? "включено" : "выключено"}</button>
        <div class="mr-sec ${c.remind_enabled ? "" : "is-off"}">
          <div class="dt-time-cap">когда</div>
          <div class="pay-chips">${[[0, "в день платежа"], [1, "за 1 день"], [3, "за 3 дня"]].map(([o, l]) => `<button type="button" class="chip ${!c.remindCustom && c.remindOffset === o ? "is-on" : ""}" data-off="${o}">${l}</button>`).join("")}<button type="button" class="chip ${c.remindCustom ? "is-on" : ""}" data-off="custom">${c.remindCustom ? MC.dayLong(c.remindCustom.date) : "своя дата"}</button></div>
          <div class="dt-time-field"><span class="dt-time-cap">время</span><div class="meta-timebox"><input id="mr-time" class="meta-time-input" type="time" step="60" value="${esc(c.remindCustom ? c.remindCustom.time : c.remindTime)}"/></div></div>
          <div class="dt-time-cap">куда</div>
          <div class="pay-chips">
            <button type="button" class="chip ${c.remind_channels.includes("telegram") ? "is-on" : ""}" data-ch="telegram">телеграм${tgOn ? "" : " · не подключён"}</button>
            <button type="button" class="chip ${c.remind_channels.includes("email") ? "is-on" : ""}" data-ch="email">почта${emOn ? "" : " · выключена"}</button>
            ${X.isNative ? `<button type="button" class="chip ${c.remind_channels.includes("push") ? "is-on" : ""}" data-ch="push">на телефон</button>` : ""}
          </div>
          <button type="button" class="chip ${c.remind_repeat === "daily" ? "is-on" : ""}" id="mr-repeat">повторять каждый день, пока не оплачено</button>
          ${!tgOn ? `<button type="button" class="modal-clear" id="mr-settings">подключить телеграм и почту</button>` : ""}
        </div>
        <div class="form-actions"><button type="button" class="btn btn--solid" id="mr-ok">Готово</button></div>`);
      $("#mr-on", m).addEventListener("click", () => { c.remind_enabled = !c.remind_enabled; draw(); });
      $$("[data-off]", m).forEach((b) => b.addEventListener("click", () => { if (b.dataset.off === "custom") { X.openCalendar({ value: (c.remindCustom && c.remindCustom.date) || c.due_date, onPick: (v) => { if (!v) return; c.remindCustom = { date: v, time: $("#mr-time", m).value || c.remindTime }; draw(); } }); } else { c.remindCustom = null; c.remindOffset = +b.dataset.off; draw(); } }));
      $$("[data-ch]", m).forEach((b) => b.addEventListener("click", () => { const k = b.dataset.ch; c.remind_channels = c.remind_channels.includes(k) ? c.remind_channels.filter((x) => x !== k) : [...c.remind_channels, k]; draw(); }));
      $("#mr-time", m).addEventListener("change", (e) => { if (c.remindCustom) c.remindCustom.time = e.target.value || "10:00"; else c.remindTime = e.target.value || "10:00"; });
      $("#mr-repeat", m).addEventListener("click", () => { c.remind_repeat = c.remind_repeat === "daily" ? "none" : "daily"; draw(); });
      const st = $("#mr-settings", m); if (st) st.addEventListener("click", () => { m.hidden = true; openSettings(); });
      $("#mr-ok", m).addEventListener("click", () => { m.hidden = true; recomputeRemind(); renderCardMeta(); saveCard(); });
      m._onClose = () => { recomputeRemind(); renderCardMeta(); saveCard(); };
    };
    draw();
  }

  /* ---------- Повторение ---------- */
  function openRepeat() {
    const c = C;
    const rec = c.recurrence_id ? S.recs.find((r) => r.id === c.recurrence_id) : null;
    if (rec) {
      choice(recText(rec), "платёж из серии", [{ label: "остановить серию с этого платежа", value: "stop", cls: "btn--danger" }]).then(async (v) => {
        if (v !== "stop") return;
        const end = MC.addDaysStr(c.due_date, 0);
        await DB.update("recurrences", rec.id, { end_date: end }); rec.end_date = end;
        const future = S.payments.filter((x) => x.recurrence_id === rec.id && x.due_date > c.due_date && !isDone(x.status));
        for (const f of future) { await DB.update("payments", f.id, { deleted_at: new Date().toISOString() }); }
        S.payments = S.payments.filter((x) => !future.includes(x));
        X.toast(`серия остановлена${future.length ? ", удалено будущих: " + future.length : ""}`); renderCardMeta();
      });
      return;
    }
    const day = +c.due_date.slice(8);
    const draft = c.recDraft || { freq: null, end_date: null };
    const draw = () => {
      const m = modal("mrepeat-modal", `<div class="modal-title">повторять</div>
        <div class="pay-chips">${[[null, "не повторять"], ["month", `каждый месяц, ${day}-го`], ["week", "каждую неделю"], ["quarter", "раз в квартал"], ["year", "раз в год"]].map(([f, l]) => `<button type="button" class="chip ${draft.freq === f ? "is-on" : ""}" data-f="${f || ""}">${l}</button>`).join("")}</div>
        ${draft.freq ? `<button type="button" class="meta-pill" id="rp-until">${draft.end_date ? "до " + MC.dayLong(draft.end_date) + " " + draft.end_date.slice(0, 4) : "без даты окончания"}</button>` : ""}
        <div class="money-note">новые платежи серии будут появляться заранее — на этот и следующий месяц.</div>
        <div class="form-actions"><button type="button" class="btn btn--solid" id="rp-ok">Готово</button></div>`);
      $$("[data-f]", m).forEach((b) => b.addEventListener("click", () => { draft.freq = b.dataset.f || null; draw(); }));
      const u = $("#rp-until", m); if (u) u.addEventListener("click", () => X.openCalendar({ value: draft.end_date || "", allowAll: true, clearLabel: "без даты", onPick: (v) => { draft.end_date = v || null; draw(); } }));
      $("#rp-ok", m).addEventListener("click", () => { m.hidden = true; c.recDraft = draft.freq ? { freq: draft.freq, end_date: draft.end_date, start_date: c.due_date, day_of_month: day } : null; renderCardMeta(); });
    };
    draw();
  }
  function templateOf(c) { return { title: c.title, amount_minor: c.amount_minor, project_id: c.kind === "income" ? c.project_id : null, project_links: c.kind === "expense" ? c.links : [], category_id: c.category_id, payee_id: c.payee_id, note: c.note, remind_enabled: c.remind_enabled, remind_channels: c.remind_channels, remind_offset: c.remindOffset, remind_time: c.remindTime }; }
  async function createRecurrenceFrom(c) {
    const d = c.recDraft;
    const rec = await DB.insert("recurrences", { kind: c.kind, template: templateOf(c), freq: d.freq, day_of_month: d.freq === "week" ? null : d.day_of_month, weekday: null, start_date: c.due_date, end_date: d.end_date || null, active: true });
    S.recs.push(rec);
    await DB.update("payments", c.id, { recurrence_id: rec.id }); const p = payById(c.id); if (p) p.recurrence_id = rec.id;
    S.recInst.push({ id: c.id, recurrence_id: rec.id, due_date: c.due_date });
    await ensureRecurrences(S.month || MC.monthKey(c.due_date));
    X.toast("серия создана: " + recText(rec));
  }
  async function updateSeriesFrom(c) {
    const rec = S.recs.find((r) => r.id === c.recurrence_id); if (!rec) return;
    rec.template = templateOf(c); await DB.update("recurrences", rec.id, { template: rec.template });
    const future = S.payments.filter((x) => x.recurrence_id === rec.id && x.due_date > c.due_date && !isDone(x.status));
    for (const f of future) {
      const patch = { title: c.title, amount_minor: c.amount_minor, category_id: c.kind === "expense" ? c.category_id : null, project_id: c.kind === "income" ? c.project_id : null, payee_id: c.payee_id || null, note: c.note || null };
      Object.assign(f, patch); await DB.update("payments", f.id, patch);
      if (c.kind === "expense") { await DB.setLinks(f.id, c.links); S.links = S.links.filter((l) => l.payment_id !== f.id).concat(c.links.map((l) => ({ payment_id: f.id, ...l }))); }
    }
    X.toast(`обновлено платежей серии: ${future.length + 1}`);
  }

  /* ---------- Частичная оплата, дубль ---------- */
  async function partialPay() {
    const c = C; await saveCard();
    const r = await inputAmount({ title: c.kind === "income" ? "сколько пришло" : "сколько оплачено", sub: `из ${fmt(c.amount_minor)}. остаток останется открытым.`, date: today(), okLabel: "Готово" });
    if (!r) return;
    if (r.amount >= c.amount_minor) { X.toast("это вся сумма — просто отметьте «готово»"); return; }
    const p = payById(c.id); const prevAmount = p.amount_minor;
    const part = await DB.insert("payments", { ...cardRow(), amount_minor: r.amount, status: "done", paid_date: r.date || today(), remind_enabled: false, remind_at: null, recurrence_id: null, parent_id: c.id, source: "partial" });
    S.payments.push(part);
    if (c.kind === "expense" && c.links.length) { const links = c.links.map((l) => ({ project_id: l.project_id, share_minor: null })); await DB.setLinks(part.id, links); links.forEach((l) => S.links.push({ payment_id: part.id, ...l })); }
    await patchPayment(p, { amount_minor: prevAmount - r.amount }); C.amount_minor = prevAmount - r.amount;
    if (C.links.every((l) => l.share_minor != null) && C.links.length > 1) { C.links.forEach((l) => (l.share_minor = null)); await DB.setLinks(c.id, C.links); c._linksSaved = JSON.stringify(C.links); S.links = S.links.filter((l) => l.payment_id !== c.id).concat(C.links.map((l) => ({ payment_id: c.id, ...l }))); }
    X.pushUndo("частичная оплата", async () => { await DB.update("payments", part.id, { deleted_at: new Date().toISOString() }); S.payments = S.payments.filter((x) => x.id !== part.id); await patchPayment(p, { amount_minor: prevAmount }); });
    $("#pay-amount").value = MC.amountToInput(C.amount_minor); renderCardMeta();
    X.toast(`записано ${fmt(r.amount)}, осталось ${fmt(C.amount_minor)}`);
  }
  async function duplicateCard() {
    await saveCard();
    const c = C; const links = c.links.map((l) => ({ ...l }));
    const row = { ...cardRow(), status: "waiting", paid_date: null, recurrence_id: null, remind_at: c.remind_enabled ? c.remind_at : null, reminded_at: null };
    const ins = await DB.insert("payments", { ...row, source: "copy" }); S.payments.push(ins);
    if (links.length) { await DB.setLinks(ins.id, links); links.forEach((l) => S.links.push({ payment_id: ins.id, ...l })); }
    X.pushUndo("дубль", async () => { await DB.update("payments", ins.id, { deleted_at: new Date().toISOString() }); S.payments = S.payments.filter((x) => x.id !== ins.id); });
    openPayment(ins, cReturn); X.toast("копия создана");
  }

  /* ================= КАТЕГОРИИ ================= */
  function openCategoryPicker(current, onPick) {
    const cats = S.cats.filter((c) => !c.archived).sort((a, b) => (b.is_salary - a.is_salary) || (a.sort || 0) - (b.sort || 0));
    const m = modal("mcat-modal", `<div class="modal-title">категория</div><div class="proj-list scroll mcat-list">
        <button type="button" class="proj-add-row" id="mcat-add" aria-label="Новая категория">${ICON.plus}</button>
        ${cats.map((c) => `<button type="button" class="cat-pill cat-pill--row ${c.id === current ? "is-cur" : ""}" data-cid="${c.id}" style="--c:${c.color || X.STATUS_PALETTE[0]}"><span class="proj-emoji">${esc(c.emoji || "•")}</span><span class="proj-name">${esc(c.name)}</span>${c.is_salary ? `<span class="cat-note">люди</span>` : ""}</button>`).join("")}
      </div>${current ? `<button type="button" class="modal-clear" id="mcat-clear">убрать категорию</button>` : ""}`, "pick-modal");
    $$("[data-cid]", m).forEach((b) => b.addEventListener("click", () => { m.hidden = true; onPick(b.dataset.cid); }));
    $("#mcat-add", m).addEventListener("click", () => openCategoryEdit(null, (c) => { m.hidden = true; onPick(c.id); }));
    const cl = $("#mcat-clear", m); if (cl) cl.addEventListener("click", () => { m.hidden = true; onPick(null); });
  }
  function openCategoryEdit(cat, onDone) {
    let emoji = cat ? cat.emoji || "" : "", color = cat ? cat.color || X.STATUS_PALETTE[0] : X.STATUS_PALETTE[(S.cats.length * 5) % X.STATUS_PALETTE.length];
    const draw = () => {
      const m = modal("mcatform-modal", `<div class="modal-title">${cat ? "категория" : "новая категория"}</div>
        <div class="projform"><button type="button" class="projform-emoji ${emoji ? "" : "is-empty"}" id="mcf-emoji">${esc(emoji || "⚪️")}</button><input id="mcf-name" class="field" type="text" maxlength="40" placeholder="название" value="${esc(cat ? cat.name : "")}"/></div>
        <div class="statusform-swatches">${X.STATUS_PALETTE.map((c) => `<button type="button" class="swatch ${c === color ? "is-cur" : ""}" data-c="${c}" style="--c:${c}"><span class="status-dot"></span></button>`).join("")}</div>
        <div class="form-actions"><button type="button" class="btn btn--solid" id="mcf-ok">${cat ? "Сохранить" : "Создать"}</button>${cat && !cat.is_salary ? `<button type="button" class="btn" id="mcf-arch">В архив</button>` : `<button type="button" class="btn" id="mcf-cancel">Отмена</button>`}</div>`);
      $("#mcf-emoji", m).addEventListener("click", () => { const name = $("#mcf-name", m).value; X.openEmojiModal(emoji, (em) => { emoji = em; draw(); $("#mcf-name").value = name; }); });
      $$(".swatch", m).forEach((b) => b.addEventListener("click", () => { const name = $("#mcf-name", m).value; color = b.dataset.c; draw(); $("#mcf-name").value = name; }));
      $("#mcf-ok", m).addEventListener("click", async () => {
        const name = $("#mcf-name", m).value.trim(); if (!name) { $("#mcf-name", m).focus(); return; }
        if (cat) { const patch = { name, emoji: emoji || null, color }; await DB.update("fin_categories", cat.id, patch); Object.assign(cat, patch); m.hidden = true; rerender(); if (onDone) onDone(cat); return; }
        const row = await DB.insert("fin_categories", { name, emoji: emoji || null, color, sort: S.cats.reduce((mx, c) => Math.max(mx, c.sort || 0), 0) + 1, is_salary: false });
        S.cats.push(row); m.hidden = true; if (onDone) onDone(row);
      });
      const ar = $("#mcf-arch", m); if (ar) ar.addEventListener("click", async () => { await DB.update("fin_categories", cat.id, { archived: true }); cat.archived = true; m.hidden = true; X.toast("категория в архиве — старые платежи сохранены"); rerender(); });
      const cn = $("#mcf-cancel", m); if (cn) cn.addEventListener("click", () => (m.hidden = true));
    };
    draw();
  }

  /* ================= ЛЮДИ (зарплаты) ================= */
  function openPayeePicker(current, onPick) {
    const list = S.payees.filter((p) => p.active || p.id === current);
    const m = modal("mpayee-modal", `<div class="modal-title">кому</div><div class="proj-list scroll">
      <div class="projform"><input id="mpy-new" class="field" type="text" maxlength="60" placeholder="новый человек — имя"/><button type="button" class="btn btn--solid" id="mpy-add">+</button></div>
      ${list.map((y) => `<button type="button" class="proj-pill ${y.id === current ? "is-cur" : ""}" data-yid="${y.id}"><span class="proj-emoji">${esc(y.emoji || "👤")}</span><span class="proj-name">${esc(y.name)}${y.role ? ` <span class="pay-role">${esc(y.role)}</span>` : ""}</span></button>`).join("")}
    </div>`, "pick-modal");
    $$("[data-yid]", m).forEach((b) => b.addEventListener("click", () => { m.hidden = true; onPick(b.dataset.yid); }));
    const add = async () => { const name = $("#mpy-new", m).value.trim(); if (!name) { $("#mpy-new", m).focus(); return; } const row = await DB.insert("payees", { name, active: true, sort: S.payees.length }); S.payees.push(row); m.hidden = true; onPick(row.id); };
    $("#mpy-add", m).addEventListener("click", add);
    $("#mpy-new", m).addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  }
  async function showPayees() { await ensureLoaded(); X.showView("payees"); }
  function payeeRow(y) {
    const days = (y.pay_days || []).join(" и ");
    return `<div class="swipeable payee" data-yid="${y.id}"><div class="swipe-del">${X.TRASH_SVG}</div><div class="swipe-row payee-row">
      <span class="payee-ava">${esc(y.emoji || (y.name || "?").trim().slice(0, 1).toUpperCase())}</span>
      <span class="payee-main"><span class="payee-name">${esc(y.name || "без имени")}</span>${y.role ? `<span class="pay-role">${esc(y.role)}</span>` : ""}</span>
      <span class="payee-def">${y.default_amount_minor ? fm(y.default_amount_minor) : "<span class='pay-role'>сумма не задана</span>"}${days ? `<span class="pay-role"> · ${esc(days)}</span>` : ""}</span>
    </div></div>`;
  }
  function renderPayees() {
    const act = S.payees.filter((y) => y.active), arch = S.payees.filter((y) => !y.active);
    $("#payee-list").innerHTML = act.length ? act.map(payeeRow).join("") : `<p class="empty">пока никого — добавьте по +</p>`;
    $("#payee-archive-toggle").hidden = !arch.length; $("#payee-archive-toggle").textContent = `архив · ${arch.length}`;
    $("#payee-archive").innerHTML = arch.map(payeeRow).join("");
    $$("#view-payees .payee").forEach((row) => X.attachSwipe(row, async () => { const y = payeeById(row.dataset.yid); if (!y) return; const was = y.active; await DB.update("payees", y.id, { active: !was }); y.active = !was; X.pushUndo("архив", async () => { await DB.update("payees", y.id, { active: was }); y.active = was; }); X.toast(was ? "в архиве — история выплат сохранена" : "возвращён"); renderPayees(); }));
  }
  let E = null; // редактируемый человек
  function openPayee(y) {
    E = y; X.showView("payee");
    $("#pe-emoji").textContent = y.emoji || "👤"; $("#pe-emoji").classList.toggle("is-empty", !y.emoji);
    $("#pe-name").innerText = y.name || ""; $("#pe-role").value = y.role || "";
    $("#pe-amount").value = y.default_amount_minor ? MC.amountToInput(y.default_amount_minor) : "";
    $("#pe-days").value = (y.pay_days || []).join(", "); $("#pe-split").value = (y.pay_split || []).join(" / ");
    $("#pe-note").value = y.pay_note || "";
    $("#pe-active").textContent = y.active ? "активен" : "в архиве"; $("#pe-active").classList.toggle("is-on", !!y.active);
    $("#pe-delete").textContent = y.active ? "В архив" : "Вернуть";
    renderPayeeHistory();
    if (!y.name) setTimeout(() => $("#pe-name").focus(), 60);
  }
  async function newPayee() { await ensureLoaded(); const row = await DB.insert("payees", { name: "", active: true, sort: S.payees.length }); S.payees.push(row); openPayee(row); }
  function payeeFields() {
    const days = ($("#pe-days").value.match(/\d+/g) || []).map(Number).filter((d) => d >= 1 && d <= 31);
    const split = ($("#pe-split").value.match(/\d+/g) || []).map(Number);
    return { name: $("#pe-name").innerText.trim(), role: $("#pe-role").value.trim() || null, default_amount_minor: MC.parseAmount($("#pe-amount").value), pay_days: days.length ? days : null, pay_split: split.length && split.length === days.length ? split : null, pay_note: $("#pe-note").value.trim() || null };
  }
  async function savePayee() { if (!E) return; const f = payeeFields(); Object.assign(E, f); try { await DB.update("payees", E.id, f); } catch (e) { X.toast("не сохранилось: " + e.message); } }
  const savePayeeDebounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(savePayee, 500); }; })();
  function renderPayeeHistory() {
    if (!E) return;
    const list = S.payments.filter((p) => p.payee_id === E.id).sort((a, b) => b.due_date.localeCompare(a.due_date));
    const y = today().slice(0, 4);
    const year = list.filter((p) => isDone(p.status) && (p.paid_date || "").startsWith(y)).reduce((s, p) => s + p.amount_minor, 0);
    $("#pe-total").innerHTML = `выплачено в ${y}: <b>${fm(year)}</b>`;
    let html = "", last = null;
    list.forEach((p) => { const k = MC.monthKey(p.due_date); if (k !== last) { html += `<div class="day-head pay-dayhead">${MC.monthLabel(k)}</div>`; last = k; } html += payRow(p); });
    $("#pe-history").innerHTML = html || `<p class="empty">выплат пока нет</p>` ;
    $("#pe-history").insertAdjacentHTML("beforeend", `<button type="button" class="proj-add-task" id="pe-addpay">+ выплата</button>`);
    $$("#pe-history .pay").forEach((row) => X.attachSwipe(row, () => deletePayment(row.dataset.id)));
  }
  async function leavePayee() {
    if (E) { await savePayee(); if (!E.name) { const has = S.payments.some((p) => p.payee_id === E.id); if (!has) { await DB.remove("payees", E.id); S.payees = S.payees.filter((x) => x.id !== E.id); } else { E.name = "без имени"; await DB.update("payees", E.id, { name: E.name }); } } }
    E = null; X.showView("payees");
  }
  function wirePayees() {
    $("#payee-list").addEventListener("click", (e) => { if (X.isJustSwiped()) return; const r = e.target.closest(".payee"); if (r) openPayee(payeeById(r.dataset.yid)); });
    $("#payee-archive").addEventListener("click", (e) => { if (X.isJustSwiped()) return; const r = e.target.closest(".payee"); if (r) openPayee(payeeById(r.dataset.yid)); });
    $("#payee-archive-toggle").addEventListener("click", () => { $("#payee-archive").hidden = !$("#payee-archive").hidden; });
    $("#pe-name").addEventListener("input", savePayeeDebounced);
    ["#pe-role", "#pe-amount", "#pe-days", "#pe-split", "#pe-note"].forEach((s) => $(s).addEventListener("input", savePayeeDebounced));
    $("#pe-amount").addEventListener("blur", () => { const a = MC.parseAmount($("#pe-amount").value); if (a) $("#pe-amount").value = MC.amountToInput(a); });
    $("#pe-emoji").addEventListener("click", () => X.openEmojiModal(E && E.emoji, async (em) => { E.emoji = em || null; $("#pe-emoji").textContent = em || "👤"; await DB.update("payees", E.id, { emoji: E.emoji }); }));
    const toggleActive = async () => { E.active = !E.active; await DB.update("payees", E.id, { active: E.active }); $("#pe-active").textContent = E.active ? "активен" : "в архиве"; $("#pe-active").classList.toggle("is-on", E.active); $("#pe-delete").textContent = E.active ? "В архив" : "Вернуть"; };
    $("#pe-active").addEventListener("click", toggleActive);
    $("#pe-delete").addEventListener("click", async () => { await toggleActive(); if (!E.active) { X.toast("в архиве — история выплат сохранена"); leavePayee(); } });
    $("#pe-done").addEventListener("click", leavePayee);
    $("#pe-history").addEventListener("click", (e) => { if (X.isJustSwiped()) return; if (e.target.closest("#pe-addpay")) { const sal = salaryCat(); newPayment({ kind: "expense", category_id: sal && sal.id, payee_id: E.id, returnView: "payee" }); C.payee_id = E.id; renderCardMeta(); return; } const r = e.target.closest(".pay"); if (r) openPayment(payById(r.dataset.id), "payee"); });
  }
  // «начислить зарплаты за месяц»
  async function accrueSalaries() {
    const sal = salaryCat(); if (!sal) return;
    const key = S.month; const rows = [];
    for (const y of S.payees.filter((x) => x.active)) {
      for (const pl of MC.salaryPlan(y, key)) {
        const exists = S.payments.some((p) => p.payee_id === y.id && p.due_date === pl.due_date && (p.title || "") === pl.title);
        if (!exists) rows.push({ kind: "expense", title: pl.title, amount_minor: pl.amount_minor, due_date: pl.due_date, status: "waiting", category_id: sal.id, payee_id: y.id, source: "salary", remind_enabled: !!(S.settings && S.settings.remind_auto), remind_at: S.settings && S.settings.remind_auto ? MC.remindAtFor(pl.due_date, 0, defTime(), tz()) : null });
      }
    }
    const noAmount = S.payees.filter((x) => x.active && !x.default_amount_minor).length;
    if (!rows.length) { X.toast(noAmount ? "у людей не задана сумма — откройте «зарплаты ›»" : "всё уже начислено"); return; }
    const total = rows.reduce((s, r) => s + r.amount_minor, 0);
    const ok = await choice(`будет создано ${rows.length} ${MC.plural(rows.length, "выплата", "выплаты", "выплат")} на ${fmt(total)}`, noAmount ? `у ${noAmount} чел. не задана сумма — их пропустим` : "статус «ждёт начала», по дням выплат каждого", [{ label: "начислить", value: true, cls: "btn--solid" }]);
    if (!ok) return;
    const ins = await DB.insertMany("payments", rows); S.payments.push(...ins);
    X.pushUndo("начисление зарплат", async () => { for (const r of ins) { await DB.update("payments", r.id, { deleted_at: new Date().toISOString() }); } S.payments = S.payments.filter((p) => !ins.some((r) => r.id === p.id)); });
    X.toast(`начислено: ${ins.length}`); renderMoney();
  }

  /* ================= БЛОК «ДЕНЬГИ» В КАРТОЧКЕ ПРОЕКТА ================= */
  let projMonthOnly = false;
  async function renderProjectBlock() {
    const el = $("#p-money"); if (!el) return;
    const pid = X.getEditingProjectId();
    if (!pid) { el.innerHTML = ""; return; }
    await ensureLoaded();
    const pr = X.projById(pid) || {};
    const inc = S.payments.filter((p) => p.kind === "income" && p.project_id === pid);
    const expLinks = S.payments.filter((p) => p.kind === "expense").map((p) => { const sh = MC.projectShares(p.amount_minor, linksOf(p.id)).find((x) => x.project_id === pid); return sh ? { p, share: sh.amount } : null; }).filter(Boolean);
    const got = inc.filter((p) => isDone(p.status)).reduce((s, p) => s + p.amount_minor, 0);
    const wait = inc.filter((p) => !isDone(p.status)).reduce((s, p) => s + p.amount_minor, 0);
    const spent = expLinks.reduce((s, x) => s + x.share, 0);
    const margin = got - spent;
    const curKey = MC.monthKey(today());
    let list = [...inc, ...expLinks.map((x) => x.p)];
    if (projMonthOnly) list = list.filter((p) => MC.inMonth(p.due_date, curKey));
    list.sort((a, b) => b.due_date.localeCompare(a.due_date));
    const pct = pr.contract_minor ? Math.min(100, Math.round((got / pr.contract_minor) * 100)) : 0;
    el.innerHTML = `<div class="proj-tasks-head">деньги</div>
      <div class="pm-nums">
        <div><span class="pm-cap">получено</span><span class="pm-val">${fm(got)}</span></div>
        <div><span class="pm-cap">ожидается</span><span class="pm-val">${fm(wait)}</span></div>
        <div><span class="pm-cap">расходы</span><span class="pm-val">${fm(spent)}</span></div>
        <div><span class="pm-cap">маржа</span><span class="pm-val ${margin < 0 ? "is-neg" : ""}">${fm(margin)}</span></div>
      </div>
      <div class="taskcard-meta pm-fields"><button type="button" class="meta-pill ${pr.client_name ? "" : "is-empty"}" id="pm-client"><span class="meta-cap">заказчик</span>${esc(pr.client_name || "не указан")}</button><button type="button" class="meta-pill ${pr.contract_minor ? "" : "is-empty"}" id="pm-contract"><span class="meta-cap">договор</span>${pr.contract_minor ? fm(pr.contract_minor) : "сумма не указана"}</button></div>
      ${pr.contract_minor ? `<div class="pay-contract"><span>получено ${pct}% от суммы договора</span><div class="fin-bar-wrap"><div class="fin-bar" style="width:${pct}%;background:rgba(134,217,152,.75)"></div></div></div>` : ""}
      <div class="pane-head-tools"><button type="button" class="chip ${projMonthOnly ? "is-on" : ""}" id="pm-month">${projMonthOnly ? "этот месяц" : "все месяцы"}</button></div>
      <div class="pm-list">${list.length ? list.map((p) => payRow(p, { showCat: true })).join("") : `<p class="empty">платежей нет</p>`}</div>
      <div class="pay-adds"><button type="button" class="proj-add-task" id="pm-add-inc">+ поступление</button><button type="button" class="proj-add-task" id="pm-add-exp">+ расход</button></div>`;
    $$(".pay", el).forEach((row) => X.attachSwipe(row, () => deletePayment(row.dataset.id)));
  }
  function wireProjectBlock() {
    const el = $("#p-money"); if (!el) return;
    el.addEventListener("click", async (e) => {
      if (X.isJustSwiped()) return;
      const pid = X.getEditingProjectId(); const pr = X.projById(pid);
      const b = e.target.closest("button");
      if (b && b.id === "pm-month") { projMonthOnly = !projMonthOnly; renderProjectBlock(); return; }
      if (b && b.id === "pm-add-inc") { newPayment({ kind: "income", project_id: pid, returnView: "project" }); return; }
      if (b && b.id === "pm-add-exp") { newPayment({ kind: "expense", project_id: pid, returnView: "project" }); return; }
      if (b && b.id === "pm-client" && pr) {
        const v = await textPrompt("заказчик", pr.client_name || "", "название компании или имя");
        if (v === null) return; const patch = { client_name: v || null }; await X.Store.updateProject(pid, patch); Object.assign(pr, patch); renderProjectBlock(); return;
      }
      if (b && b.id === "pm-contract" && pr) {
        const r = await inputAmount({ title: "сумма договора", sub: "необязательно — покажем, сколько уже получено", value: pr.contract_minor || null, allowZero: true });
        if (!r) return; const patch = { contract_minor: r.amount || null }; await X.Store.updateProject(pid, patch); Object.assign(pr, patch); renderProjectBlock(); return;
      }
      const dot = e.target.closest("[data-act='status']"); const row = e.target.closest(".pay");
      if (dot && row) { const p = payById(row.dataset.id); if (p) X.openStatusPicker(PAY_KIND, p.status, (k) => setStatus(p, k, true)); return; }
      if (row) { const p = payById(row.dataset.id); if (p) openPayment(p, "project"); }
    });
  }
  function textPrompt(title, value, placeholder) {
    return new Promise((res) => {
      const m = modal("mtext-modal", `<div class="modal-title">${esc(title)}</div><input id="mtext-inp" class="field" type="text" maxlength="120" placeholder="${esc(placeholder || "")}" value="${esc(value || "")}"/><div class="form-actions"><button type="button" class="btn btn--solid" id="mtext-ok">Готово</button><button type="button" class="btn" id="mtext-cancel">Отмена</button></div>`);
      m._onClose = () => res(null);
      const inp = $("#mtext-inp", m); setTimeout(() => inp.focus(), 40);
      const ok = () => { m._onClose = null; m.hidden = true; res(inp.value.trim()); };
      $("#mtext-ok", m).addEventListener("click", ok); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      $("#mtext-cancel", m).addEventListener("click", () => closeModal(m));
    });
  }
  async function projectPaymentsCount(pid) { await ensureLoaded(); const list = S.payments.filter((p) => p.project_id === pid || linksOf(p.id).some((l) => l.project_id === pid)); return { count: list.length, sum: list.reduce((s, p) => s + p.amount_minor, 0) }; }

  /* ================= НАСТРОЙКИ, ТЕЛЕГРАМ, ПОЧТА ================= */
  function fnUrl(name) { return (X.CFG.SUPABASE_URL || "").replace(/\/+$/, "") + "/functions/v1/" + name; }
  async function callFn(name, body, query) {
    const { data } = await X.sb.auth.getSession(); const token = data && data.session ? data.session.access_token : "";
    const res = await fetch(fnUrl(name) + (query || ""), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: X.CFG.SUPABASE_ANON_KEY || "" }, body: JSON.stringify(body || {}) });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || j.ok === false) throw new Error((j && j.error) || "ошибка сервера " + res.status);
    return j;
  }
  function openSettings() {
    const s = S.settings || {};
    const m = modal("msettings-modal", `<div class="modal-title">настройки денег</div>
      <div class="sum-ladder">
        <button type="button" class="sum-lrow" id="ms-opening"><span class="sum-lsign"></span><span class="sum-llabel">начальный остаток${s.opening_date ? " на " + MC.dayLong(s.opening_date) : ""}</span><span class="sum-lval">${fm(s.opening_balance_minor || 0)}</span></button>
      </div>
      <div class="dt-time-cap">напоминания</div>
      <div class="pay-chips">
        ${online() ? `<button type="button" class="chip ${s.telegram_chat_id ? "is-on" : ""}" id="ms-tg">${s.telegram_chat_id ? "телеграм подключён" + (s.telegram_username ? " · @" + esc(s.telegram_username) : "") : "подключить телеграм"}</button>
        <button type="button" class="chip ${s.email_enabled !== false ? "is-on" : ""}" id="ms-email">почта: ${s.email_enabled !== false ? esc(s.email_to || "почта аккаунта") : "выключена"}</button>
        <button type="button" class="chip" id="ms-email-to">другой адрес</button>` : `<span class="money-note">телеграм и почта работают после входа в аккаунт</span>`}
        <button type="button" class="chip ${s.remind_auto ? "is-on" : ""}" id="ms-auto">напоминать о новых расходах автоматически</button>
        <button type="button" class="chip ${s.digest_enabled ? "is-on" : ""}" id="ms-digest">утренняя сводка в 9:00</button>
      </div>
      <div class="dt-time-field"><span class="dt-time-cap">время напоминаний по умолчанию</span><div class="meta-timebox"><input id="ms-time" class="meta-time-input" type="time" step="60" value="${esc(defTime())}"/></div></div>
      ${online() ? `<button type="button" class="chip" id="ms-test">отправить тестовое напоминание</button>` : ""}
      <div class="money-note">часовой пояс: ${esc(tz())}</div>
      <div class="form-actions"><button type="button" class="btn btn--solid" id="ms-ok">Готово</button></div>`);
    const re = () => setTimeout(openSettings, 0);
    $("#ms-opening", m).addEventListener("click", () => { m.hidden = true; editOpening(); });
    const tg = $("#ms-tg", m); if (tg) tg.addEventListener("click", async () => {
      if (s.telegram_chat_id) { if (!(await X.askConfirm("Отключить телеграм?"))) return; try { await callFn("money-notify", { action: "unlink" }); await DB.saveSettings({ telegram_chat_id: null, telegram_username: null }); } catch (e) { X.toast(e.message); } re(); return; }
      try {
        const r = await callFn("money-notify", { action: "link" });
        window.open(r.url, "_blank");
        X.toast("откройте бота и нажмите «Start»");
        pollTelegram();
      } catch (e) { X.toast(e.message === "not_configured" ? "телеграм-бот ещё не настроен на сервере" : e.message); }
    });
    const em = $("#ms-email", m); if (em) em.addEventListener("click", async () => { await DB.saveSettings({ email_enabled: s.email_enabled === false }); re(); });
    const et = $("#ms-email-to", m); if (et) et.addEventListener("click", async () => { const v = await textPrompt("почта для напоминаний", s.email_to || "", "пусто — почта аккаунта"); if (v === null) return re(); await DB.saveSettings({ email_to: v || null }); re(); });
    $("#ms-auto", m).addEventListener("click", async () => { await DB.saveSettings({ remind_auto: !s.remind_auto }); re(); });
    $("#ms-digest", m).addEventListener("click", async () => { await DB.saveSettings({ digest_enabled: !s.digest_enabled }); re(); });
    $("#ms-time", m).addEventListener("change", async (e) => { await DB.saveSettings({ remind_default_time: e.target.value || "10:00" }); });
    const tt = $("#ms-test", m); if (tt) tt.addEventListener("click", async () => { try { const r = await callFn("money-notify", { action: "test" }); X.toast(r.sent ? `отправлено: ${r.sent.join(", ")}` : "отправлено"); } catch (e) { X.toast(e.message === "no_channels" ? "нет подключённых каналов" : e.message); } });
    $("#ms-ok", m).addEventListener("click", () => (m.hidden = true));
  }
  let tgPoll = null;
  function pollTelegram() {
    clearInterval(tgPoll); let n = 0;
    tgPoll = setInterval(async () => {
      n++; if (n > 60) return clearInterval(tgPoll);
      try { const r = await q(X.sb.from("money_settings").select("telegram_chat_id,telegram_username").eq("user_id", userId()).maybeSingle()); if (r && r.telegram_chat_id) { clearInterval(tgPoll); Object.assign(S.settings, r); X.toast("телеграм подключён"); const m = $("#msettings-modal"); if (m && !m.hidden) openSettings(); } } catch (e) {}
    }, 3000);
  }

  /* ---------- Нативные локальные напоминания (канал «на телефон») ---------- */
  let nativeTimer = null;
  function scheduleNative() {
    if (!X.isNative) return;
    clearTimeout(nativeTimer);
    nativeTimer = setTimeout(async () => {
      const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; if (!LN) return;
      try {
        const pend = await LN.getPending(); const ours = (pend.notifications || []).filter((n) => n.extra && n.extra.money);
        if (ours.length) await LN.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
        const now = Date.now();
        const list = S.payments.filter((p) => p.remind_enabled && p.remind_at && (p.remind_channels || []).includes("push") && !isDone(p.status) && Date.parse(p.remind_at) > now).sort((a, b) => a.remind_at.localeCompare(b.remind_at)).slice(0, 30);
        if (!list.length) return;
        await LN.schedule({ notifications: list.map((p, i) => ({ id: 900000 + i, title: "оплатить: " + (p.title || "платёж"), body: fmt(p.amount_minor) + " · срок " + MC.dayLong(p.due_date), schedule: { at: new Date(p.remind_at) }, extra: { money: true, paymentId: p.id } })) });
      } catch (e) {}
    }, 800);
  }

  /* ================= ИМПОРТ PDF-ВЫПИСКИ ================= */
  const IM = { imp: null, rows: [], statement: null, busy: false, list: [] };
  async function openImportPage() {
    await ensureLoaded();
    X.showView("import");
    if (!online()) { $("#import-pane").innerHTML = `<p class="money-note">загрузка выписки работает после входа в аккаунт — распознавание идёт на сервере.</p>`; return; }
    if (IM.rows.length && IM.imp && IM.imp.status === "ready") return renderImportPreview();
    renderImportStart();
  }
  async function renderImportStart(msg) {
    IM.rows = []; IM.imp = null;
    let list = [];
    try { list = await q(X.sb.from("statement_imports").select("id,file_name,bank,account_mask,period_from,period_to,status,stats,created_at,error").eq("user_id", userId()).order("created_at", { ascending: false }).limit(20)); } catch (e) {}
    IM.list = list || [];
    $("#import-pane").innerHTML = `
      <div class="imp-drop" id="imp-drop">
        <div class="imp-drop-ico">${ICON.upload}</div>
        <div class="imp-drop-t">загрузите PDF-выписку банка</div>
        <div class="money-note">Claude найдёт в ней поступления и расходы. вы проверите список и добавите нужное — существующие платежи не удаляются и не дублируются.</div>
        <button type="button" class="btn btn--solid" id="imp-pick">выбрать PDF</button>
        <div class="money-note imp-privacy">выписка отправляется в Claude (Anthropic) для распознавания и хранится ${(S.settings && S.settings.statements_keep_days) || 30} дней. до 20 МБ, без пароля.</div>
      </div>
      ${msg ? `<div class="imp-msg is-error">${esc(msg)}</div>` : ""}
      ${IM.list.length ? `<div class="proj-tasks-head imp-hist-h">загруженные выписки</div><div class="imp-hist">${IM.list.map((i) => `<div class="imp-hrow"><div class="imp-hmain"><span>${esc(i.bank || "выписка")}${i.account_mask ? " •• " + esc(i.account_mask) : ""}</span><span class="pay-role">${i.period_from ? MC.dayLabel(i.period_from) + " — " + MC.dayLabel(i.period_to) : esc(i.file_name || "")} · ${importStatusText(i)}</span></div>${i.status === "applied" ? `<button type="button" class="chip" data-revert="${i.id}">отменить</button>` : i.status === "ready" ? `<button type="button" class="chip" data-open="${i.id}">открыть</button>` : ""}</div>`).join("")}</div>` : ""}`;
    $("#imp-pick").addEventListener("click", () => $("#money-file").click());
    $$("[data-revert]").forEach((b) => b.addEventListener("click", () => revertImport(b.dataset.revert)));
    $$("[data-open]").forEach((b) => b.addEventListener("click", async () => { const imp = await q(X.sb.from("statement_imports").select("*").eq("id", b.dataset.open).single()); await prepareRows(imp); }));
  }
  function importStatusText(i) {
    const st = i.stats || {};
    return { uploaded: "загружена", processing: "распознаётся…", ready: "ждёт проверки", applied: `добавлено ${st.created || 0}${st.confirmed ? ", подтверждено " + st.confirmed : ""}`, failed: "ошибка: " + (i.error || ""), reverted: "отменена" }[i.status] || i.status;
  }
  async function onFilePicked(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return renderImportStart("файл больше 20 МБ — разделите выписку на части");
    if (!/pdf$/i.test(file.type || file.name)) return renderImportStart("нужен PDF-файл");
    const buf = await file.arrayBuffer();
    const head = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 2048)));
    if (!head.startsWith("%PDF")) return renderImportStart("это не PDF");
    const all = new TextDecoder("latin1").decode(new Uint8Array(buf));
    if (/\/Encrypt\s/.test(all)) return renderImportStart("PDF защищён паролем — сохраните выписку без пароля");
    const hashBuf = await crypto.subtle.digest("SHA-256", buf); const sha = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const exist = await q(X.sb.from("statement_imports").select("*").eq("user_id", userId()).eq("file_sha256", sha).maybeSingle());
    if (exist && exist.status !== "failed" && exist.status !== "reverted") {
      const v = await choice("эта выписка уже загружена", `${MC.dayLong(MC.todayInTz(tz(), new Date(exist.created_at)))} · ${importStatusText(exist)}`, exist.status === "ready" ? [{ label: "открыть результат", value: "open", cls: "btn--solid" }] : [{ label: "понятно", value: null }]);
      if (v === "open") await prepareRows(exist);
      return;
    }
    importProgress("загружаю файл…");
    const path = `${userId()}/${sha}.pdf`;
    try {
      const up = await X.sb.storage.from("statements").upload(path, new Blob([buf], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);
      let imp = exist;
      if (imp) { imp = await q(X.sb.from("statement_imports").update({ status: "uploaded", error: null, parsed: null, file_path: path, file_name: file.name }).eq("id", imp.id).select().single()); }
      else imp = await q(X.sb.from("statement_imports").insert({ user_id: userId(), file_path: path, file_sha256: sha, file_name: file.name }).select().single());
      IM.imp = imp;
      importProgress("читаю выписку… это займёт до минуты");
      try { await callFn("statement-parse", { import_id: imp.id }); }
      catch (e) { if (!/Failed to fetch|timeout|504|546|502/i.test(e.message)) throw e; }
      // распознавание идёт в фоне на сервере — ждём статус «ready» (до ~6 минут)
      let parsed = false;
      for (let i = 0; !parsed && i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const cur = await q(X.sb.from("statement_imports").select("status,error").eq("id", imp.id).single());
        if (cur.status === "ready") parsed = true;
        if (cur.status === "failed") throw new Error(cur.error || "не удалось распознать");
        if (i === 20) importProgress("ещё читаю — длинные выписки занимают пару минут…");
      }
      if (!parsed) throw new Error("распознавание затянулось — откройте выписку позже из списка «загруженные выписки»");
      const fresh = await q(X.sb.from("statement_imports").select("*").eq("id", imp.id).single());
      await prepareRows(fresh);
    } catch (e) { renderImportStart(e.message || "не удалось распознать выписку"); }
  }
  function importProgress(text) { $("#import-pane").innerHTML = `<div class="imp-drop"><div class="ai-status"><span class="ai-spin"></span><span>${esc(text)}</span></div><div class="money-note">можно уйти с экрана — распознавание продолжится, результат появится в «загруженных выписках».</div></div>`; }
  async function prepareRows(imp) {
    IM.imp = imp; const p = imp.parsed || {}; const st = p.statement || {};
    IM.statement = { ...st, opening: MC.parseAmount(st.opening_balance_text), closing: MC.parseAmount(st.closing_balance_text) };
    const rows = (p.transactions || []).map((t, i) => ({ ...t, i, amount_minor: MC.parseAmount(t.amount_text), balance_after_minor: t.balance_after_text ? MC.parseAmount(t.balance_after_text) : null, currency: t.currency || st.currency || "RUB" })).filter((t) => t.amount_minor && t.date);
    await MC.fingerprintRows(userId(), rows);
    const existing = await DB.allForImport();
    IM.rows = MC.classifyImport(rows, existing).map((r) => {
      const s = r.suggest || {};
      return { ...r, title: s.title || r.counterparty || r.purpose || "", category_id: r.kind === "expense" ? (catById(s.category_id) ? s.category_id : null) : null, category_new: r.kind === "expense" && !catById(s.category_id) ? s.category_new || null : null, project_id: X.projById(s.project_id) ? s.project_id : null, payee_id: r.kind === "expense" && payeeById(s.payee_id) ? s.payee_id : null };
    });
    IM.rows.forEach((r) => { if (r.label === "fee" && !r.category_id) { const bank = S.cats.find((c) => /банк|комисс/i.test(c.name || "")); if (bank) r.category_id = bank.id; } });
    if (X.getCurrentView() !== "import") X.showView("import");
    renderImportPreview();
  }
  const LABELS = { new: ["новая", "131,190,150"], loaded: ["уже загружена", "150,153,163"], deleted: ["удалена вами раньше", "150,153,163"], plan: ["совпадает с запланированной", "126,196,232"], dup: ["возможный дубль", "231,200,106"], transfer: ["перевод между своими", "150,153,163"], fee: ["комиссия банка", "199,138,74"], currency: ["валютная — проверьте сумму", "232,155,184"] };
  function renderImportPreview() {
    const rows = IM.rows, st = IM.statement || {};
    const chk = rows.filter((r) => r.checked);
    const inSum = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount_minor, 0), outSum = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount_minor, 0);
    const rec = MC.reconcileStatement(st.opening, st.closing, rows);
    const brk = rec.ok === false ? MC.findChainBreak(st.opening, rows) : -1;
    let html = `<div class="imp-head"><div class="imp-bank">${esc(st.bank || "выписка")}${st.account_mask ? " •• " + esc(st.account_mask) : ""}</div>
      <div class="pay-role">${st.period_from ? MC.dayLong(st.period_from) + " — " + MC.dayLong(st.period_to) : ""} · найдено ${rows.length} ${MC.plural(rows.length, "операция", "операции", "операций")} · +${fmt(inSum)} / ${MC.MINUS}${fmt(outSum)}</div></div>`;
    if (rec.ok === false) html += `<div class="sum-gap">${ICON.warn}<span>суммы не сходятся с остатками выписки на ${fmt(Math.abs(rec.diff))}${brk >= 0 ? ` — проверьте строку «${esc(rows[brk].purpose || "")}» (стр. ${rows[brk].page || "?"})` : " — возможно, пропущена строка"}</span></div>`;
    if (rec.ok === true) html += `<div class="money-note imp-ok">${ICON.check} остатки на начало и конец сходятся до копейки</div>`;
    if (!rows.length) html += `<p class="empty">не нашёл операций. это точно банковская выписка?</p>`;
    html += `<div class="pane-head-tools imp-bulk"><button type="button" class="chip" data-bulk="new">выбрать все новые</button><button type="button" class="chip" data-bulk="none">снять всё</button><button type="button" class="chip" data-bulk="cat">категория для выбранных</button><button type="button" class="chip" data-bulk="proj">проект для выбранных</button></div>`;
    let last = null;
    rows.forEach((r) => {
      const k = MC.monthKey(r.date); if (k !== last) { html += `<div class="day-head pay-dayhead">${MC.monthLabel(k)}</div>`; last = k; }
      const [lab, lc] = LABELS[r.label] || LABELS.new;
      const cat = catById(r.category_id), pr = X.projById(r.project_id), y = payeeById(r.payee_id);
      const match = r.match && (r.label === "plan" || r.label === "dup") ? payById(r.match) : null;
      html += `<div class="imp-row ${r.checked ? "is-on" : ""}" data-i="${r.i}">
        <button type="button" class="imp-check" data-tog="${r.i}" aria-label="Выбрать">${r.checked ? ICON.check : ""}</button>
        <div class="imp-main">
          <span class="imp-title">${esc(r.title || "без описания")}</span>
          <span class="imp-purpose">${esc([r.counterparty, r.purpose].filter(Boolean).join(" · "))}</span>
          <span class="pay-pills"><span class="imp-label" style="--c:${lc}">${lab}${match ? ` «${esc(match.title || "")}»` : ""}</span>
            ${r.label === "plan" ? `<button type="button" class="chip imp-mini" data-asnew="${r.i}">${r.asNew ? "создать отдельно" : "отметить её готовой"}</button>` : ""}
            ${r.kind === "expense" ? `<button type="button" class="cat-pill cat-pill--sm ${cat ? "" : "is-empty"}" data-rcat="${r.i}" style="--c:${cat ? cat.color || "150,153,163" : "150,153,163"}">${cat ? `<span class="proj-emoji">${esc(cat.emoji || "•")}</span><span class="proj-name">${esc(cat.name)}</span>` : r.category_new ? `🆕 ${esc(r.category_new)}` : "категория"}</button>` : ""}
            <button type="button" class="proj-pill ${pr ? "" : "is-empty"}" data-rproj="${r.i}">${pr ? `<span class="proj-emoji">${X.projEmoji(pr)}</span><span class="proj-name">${esc(pr.name)}</span>` : "проект"}</button>
            ${y ? `<span class="proj-pill"><span class="proj-emoji">${esc(y.emoji || "👤")}</span><span class="proj-name">${esc(y.name)}</span></span>` : ""}
          </span>
        </div>
        <span class="pay-date">${MC.dayLabel(r.date)}</span>
        <span class="pay-amt ${r.direction === "in" ? "is-in" : ""}">${r.direction === "in" ? "+" : MC.MINUS}${fm(r.amount_minor)}</span>
      </div>`;
    });
    html += `<div class="imp-foot"><button type="button" class="btn btn--solid" id="imp-apply" ${chk.length ? "" : "disabled"}>добавить ${chk.length}</button><button type="button" class="btn" id="imp-cancel">отмена</button></div>`;
    $("#import-pane").innerHTML = html;
  }
  function wireImport() {
    $("#money-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) { if (X.getCurrentView() !== "import") X.showView("import"); onFilePicked(f); } });
    $("#import-pane").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); const rowEl = e.target.closest(".imp-row");
      const R = (i) => IM.rows.find((r) => r.i === +i);
      if (b && b.dataset.tog != null) { const r = R(b.dataset.tog); r.checked = !r.checked; renderImportPreview(); return; }
      if (b && b.dataset.asnew != null) { const r = R(b.dataset.asnew); r.asNew = !r.asNew; renderImportPreview(); return; }
      if (b && b.dataset.rcat != null) { const r = R(b.dataset.rcat); openCategoryPicker(r.category_id, (cid) => { r.category_id = cid; r.category_new = null; renderImportPreview(); }); return; }
      if (b && b.dataset.rproj != null) { const r = R(b.dataset.rproj); X.openProjectPicker(r.project_id, (pid) => { r.project_id = pid; renderImportPreview(); }); return; }
      if (b && b.dataset.bulk) {
        const sel = IM.rows.filter((r) => r.checked);
        if (b.dataset.bulk === "new") IM.rows.forEach((r) => (r.checked = ["new", "fee", "plan"].includes(r.label)));
        if (b.dataset.bulk === "none") IM.rows.forEach((r) => (r.checked = false));
        if (b.dataset.bulk === "cat") { if (!sel.length) return X.toast("сначала отметьте строки"); return openCategoryPicker(null, (cid) => { sel.forEach((r) => { if (r.kind === "expense") { r.category_id = cid; r.category_new = null; } }); renderImportPreview(); }); }
        if (b.dataset.bulk === "proj") { if (!sel.length) return X.toast("сначала отметьте строки"); return X.openProjectPicker(null, (pid) => { sel.forEach((r) => (r.project_id = pid)); renderImportPreview(); }); }
        renderImportPreview(); return;
      }
      if (b && b.id === "imp-apply") return applyImport();
      if (b && b.id === "imp-cancel") { IM.rows = []; X.showView("money"); return; }
      if (rowEl && !b) { const r = R(rowEl.dataset.i); r.checked = !r.checked; renderImportPreview(); }
    });
  }
  async function applyImport() {
    const sel = IM.rows.filter((r) => r.checked); if (!sel.length) return;
    $("#imp-apply").disabled = true; $("#imp-apply").textContent = "добавляю…";
    try {
      // новые категории, предложенные моделью (только принятые)
      const newNames = [...new Set(sel.filter((r) => r.kind === "expense" && !r.category_id && r.category_new).map((r) => r.category_new.trim()).filter(Boolean))];
      for (const n of newNames) {
        let c = S.cats.find((x) => (x.name || "").toLowerCase() === n.toLowerCase());
        if (!c) { c = await DB.insert("fin_categories", { name: n, emoji: null, color: X.STATUS_PALETTE[(S.cats.length * 5) % X.STATUS_PALETTE.length], sort: S.cats.length + 1, is_salary: false }); S.cats.push(c); }
        sel.forEach((r) => { if (r.category_new && r.category_new.trim().toLowerCase() === n.toLowerCase()) { r.category_id = c.id; r.category_new = null; } });
      }
      const rows = sel.map((r) => ({ action: r.label === "plan" && !r.asNew ? "confirm" : "create", payment_id: r.label === "plan" && !r.asNew ? r.match : null, kind: r.kind, title: r.title || "", amount_minor: r.amount_minor, date: r.date, category_id: r.kind === "expense" ? r.category_id || null : null, project_id: r.kind === "income" ? r.project_id || null : null, payee_id: r.payee_id || null, note: [r.counterparty, r.purpose].filter(Boolean).join(" · ").slice(0, 500) || null, fingerprint: r.fingerprint, _proj: r.kind === "expense" ? r.project_id : null }));
      const res = await q(X.sb.rpc("money_apply_import", { p_import: IM.imp.id, p_rows: rows.map(({ _proj, ...x }) => x) }));
      // проекты у расходов — через связи
      const fresh = await DB.loadAll(); Object.assign(S, fresh);
      for (const r of rows.filter((x) => x._proj && x.action === "create")) { const p = S.payments.find((x) => x.fingerprint === r.fingerprint); if (p) { await DB.setLinks(p.id, [{ project_id: r._proj, share_minor: null }]); S.links.push({ payment_id: p.id, project_id: r._proj, share_minor: null }); } }
      const impId = IM.imp.id; IM.rows = []; IM.imp = null;
      const months = [...new Set(sel.map((r) => MC.monthKey(r.date)))].sort();
      S.month = months[months.length - 1] || S.month;
      X.pushUndo("импорт выписки", () => revertImport(impId, true));
      X.showView("money");
      X.toast(`добавлено ${res.created}${res.confirmed ? ", подтверждено " + res.confirmed : ""}${res.skipped ? ", пропущено дублей " + res.skipped : ""}`);
    } catch (e) { X.toast("не получилось: " + e.message); $("#imp-apply").disabled = false; $("#imp-apply").textContent = "добавить " + sel.length; }
  }
  async function revertImport(id, silent) {
    if (!silent && !(await X.askConfirm("Отменить импорт?", "добавленные из выписки платежи будут удалены, подтверждённые — вернутся в прежний статус"))) return;
    try { const r = await q(X.sb.rpc("money_revert_import", { p_import: id })); const fresh = await DB.loadAll(); Object.assign(S, fresh); X.toast(`отменено: удалено ${r.deleted}${r.reverted ? ", возвращено " + r.reverted : ""}`); if (X.getCurrentView() === "import") renderImportStart(); else rerender(); }
    catch (e) { X.toast(e.message); }
  }

  /* ================= ВЫГРУЗКА XLSX ================= */
  function openExport() {
    const cur = S.month || MC.monthKey(today());
    let from = cur, to = cur;
    const months = [...new Set(S.payments.map((p) => MC.monthKey(p.due_date)).concat([cur]))].sort();
    const opt = (sel) => months.map((k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${MC.monthLabel(k)}</option>`).join("");
    const m = modal("mexport-modal", `<div class="modal-title">выгрузка в excel</div>
      <div class="mchoice"><button type="button" class="btn btn--solid" data-ex="month">${MC.monthLabel(cur)}</button><button type="button" class="btn" data-ex="all">всё время</button></div>
      <div class="dt-time-cap">или период</div>
      <div class="ex-range"><select id="ex-from" class="field">${opt(from)}</select><span>—</span><select id="ex-to" class="field">${opt(to)}</select></div>
      <button type="button" class="btn" data-ex="range">выгрузить период</button>
      <div class="money-note">листы: сводка, доходы, расходы, зарплаты, по проектам.</div>`);
    $$("[data-ex]", m).forEach((b) => b.addEventListener("click", async () => {
      const k = b.dataset.ex;
      if (k === "month") { from = to = cur; } else if (k === "all") { from = months[0]; to = months[months.length - 1]; } else { from = $("#ex-from", m).value; to = $("#ex-to", m).value; if (from > to) [from, to] = [to, from]; }
      m.hidden = true; await exportXlsx(from, to);
    }));
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function ensureExcelJS() {
    if (window.ExcelJS) return window.ExcelJS;
    try { await loadScript("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"); } catch (e) { await loadScript("vendor/exceljs.min.js"); }
    return window.ExcelJS;
  }
  async function exportXlsx(from, to) {
    const btn = $("#money-export-btn"); btn.disabled = true; const ico = btn.innerHTML; btn.innerHTML = `<span class="ai-spin"></span>`;
    try {
      await ensureLoaded(); await X.loadProjects();
      const ExcelJS = await ensureExcelJS();
      const wb = window.GuncoXlsx.build(ExcelJS, { from, to, payments: S.payments, links: S.links, payees: S.payees, cats: S.cats, projects: X.getProjects(), settings: S.settings, statuses: X.statusSet(PAY_KIND), today: today() });
      const buf = await wb.xlsx.writeBuffer();
      const name = `gunco-деньги-${from}${from !== to ? "—" + to : ""}.xlsx`;
      await saveFile(buf, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) { X.toast("не получилось выгрузить: " + e.message); }
    btn.disabled = false; btn.innerHTML = ico;
  }
  async function saveFile(buf, name, mime) {
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (X.isNative && P && P.Filesystem && P.Share) {
      let bin = ""; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const w = await P.Filesystem.writeFile({ path: name, data: btoa(bin), directory: "CACHE" });
      await P.Share.share({ title: name, url: w.uri, dialogTitle: "сохранить выгрузку" });
      return;
    }
    const blob = new Blob([buf], { type: mime }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    X.toast("файл сохранён: " + name);
  }

  /* ================= ИИ: создание/изменение платежей ================= */
  async function applyAI(it) {
    await ensureLoaded();
    const kind = it.kind === "income" ? "income" : "expense";
    const amount = Math.round((it.amount || 0) * 100);
    const action = it.action || "create";
    const tgt = it.target_id ? payById(it.target_id) : null;
    if (action === "delete") { if (tgt) await deletePayment(tgt.id); return "money"; }
    if (action === "update" && tgt) {
      const patch = {}; const prev = {};
      if (it.title) patch.title = it.title;
      if (amount > 0) patch.amount_minor = amount;
      if (it.due_date) patch.due_date = it.due_date;
      if (it.payment_status) { patch.status = it.payment_status; if (isDone(it.payment_status)) patch.paid_date = it.due_date && it.payment_status === "done" ? (tgt.paid_date || today()) : today(); else patch.paid_date = null; }
      if (it.note) patch.note = it.note;
      if (kind === "expense" && it.category_id && catById(it.category_id)) patch.category_id = it.category_id;
      if (kind === "income" && it.project_id && X.projById(it.project_id)) patch.project_id = it.project_id;
      Object.keys(patch).forEach((k) => (prev[k] = tgt[k] == null ? null : tgt[k]));
      await patchPayment(tgt, patch); X.pushUndo("изменение платежа", () => patchPayment(tgt, prev));
      S.month = MC.monthKey(tgt.due_date); return "money";
    }
    if (!(amount > 0)) return null;
    let payee = null;
    if (kind === "expense" && it.payee_name) {
      payee = S.payees.find((y) => (y.name || "").toLowerCase() === it.payee_name.toLowerCase().trim()) || null;
      if (!payee) { payee = await DB.insert("payees", { name: it.payee_name.trim(), active: true, sort: S.payees.length }); S.payees.push(payee); }
    }
    const sal = salaryCat();
    const due = it.due_date || today();
    const status = it.payment_status || (it.mark_done ? "done" : "waiting");
    const remind = kind === "expense" && !!it.notify && status !== "done";
    let projectIds = (it.project_ids || []).filter((id) => X.projById(id));
    if (it.project_id && X.projById(it.project_id) && !projectIds.includes(it.project_id)) projectIds.unshift(it.project_id);
    if (!projectIds.length && it.project_new) { const p = await X.Store.addProject({ name: it.project_new }); await X.loadProjects(); if (p) projectIds = [p.id]; }
    const row = { kind, title: it.title || it.note || "", amount_minor: amount, due_date: due, status, paid_date: isDone(status) ? (it.due_date && it.due_date <= today() ? it.due_date : today()) : null, project_id: kind === "income" ? projectIds[0] || null : null, category_id: kind === "expense" ? (payee && sal ? sal.id : (catById(it.category_id) ? it.category_id : null)) : null, payee_id: payee ? payee.id : null, note: it.title && it.note && it.note !== it.title ? it.note : null, remind_enabled: remind, remind_at: remind ? MC.remindAtFor(due, 0, defTime(), tz()) : null, source: "ai" };
    const ins = await DB.insert("payments", row); S.payments.push(ins);
    if (kind === "expense" && projectIds.length) { const links = projectIds.map((id) => ({ project_id: id, share_minor: null })); await DB.setLinks(ins.id, links); links.forEach((l) => S.links.push({ payment_id: ins.id, ...l })); }
    X.pushUndo(kind === "income" ? "поступление" : "расход", async () => { await DB.update("payments", ins.id, { deleted_at: new Date().toISOString() }); S.payments = S.payments.filter((x) => x.id !== ins.id); });
    S.month = MC.monthKey(due);
    return "money";
  }
  async function aiContext() {
    try { await ensureLoaded(); } catch (e) { return {}; }
    const recent = S.payments.slice().sort((a, b) => b.due_date.localeCompare(a.due_date)).slice(0, 120).map((p) => ({ id: p.id, kind: p.kind, title: p.title || (payeeById(p.payee_id) || {}).name || "", amount: p.amount_minor / 100, date: p.due_date, status: p.status }));
    return { payments: recent, payees: S.payees.filter((y) => y.active).map((y) => ({ id: y.id, name: y.name, role: y.role || "" })), finCategories: S.cats.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, is_salary: !!c.is_salary })) };
  }
  function aiPreviewBits(it) {
    const bits = [];
    if (it.due_date) bits.push(MC.dayLong(it.due_date));
    const st = it.payment_status || (it.mark_done ? "done" : null); if (st) bits.push(X.statusName(PAY_KIND, st));
    if (it.payee_name) bits.push("👤 " + it.payee_name);
    if (it.category_id && catById(it.category_id)) bits.push(catById(it.category_id).name);
    (it.project_ids || (it.project_id ? [it.project_id] : [])).forEach((id) => { const p = X.projById(id); if (p) bits.push(X.projEmoji(p) + " " + p.name); });
    if (it.notify) bits.push("🔔 напомнить");
    return bits;
  }
  function aiTargetTitle(id) { const p = payById(id); return p ? (p.title || "платёж") + " · " + fmt(p.amount_minor) : null; }

  /* ================= API ДЛЯ app.js ================= */
  const api = {
    onShow(name) {
      $("#money-head-btns").hidden = name !== "money";
      if (name === "money") renderMoney();
      else if (name === "payees") { ensureLoaded().then(renderPayees); }
      else if (name === "import") { /* рендер по месту */ }
    },
    titleFor(name) { return name === "payees" ? "💼 зарплаты" : name === "import" ? "выписка" : null; },
    goBack(name) {
      if (name === "payment") { leaveCard(); return true; }
      if (name === "payee") { leavePayee(); return true; }
      if (name === "payees") { X.showView("money"); return true; }
      if (name === "import") { X.showView("money"); return true; }
      return false;
    },
    fab(name) { if (name === "money") newPayment(); else if (name === "payees") newPayee(); },
    openHash(hash) {
      const m = /^#money(?:\/(\d{4}-\d{2}))?(?:\/pay\/([0-9a-f-]+))?/.exec(hash || ""); if (!m) return false;
      if (m[1]) S.month = m[1];
      X.showView("money");
      if (m[2]) ensureLoaded().then(() => { const p = payById(m[2]); if (p) openPayment(p, "money"); });
      return true;
    },
    renderProjectBlock, projectPaymentsCount, applyAI, aiContext, aiPreviewBits, aiTargetTitle, isOpenCard,
    reset() { S.loaded = false; S.payments = []; S.month = null; },
  };
  window.GuncoMoney = {
    init(ctx) {
      X = ctx;
      buildDom(); wireMoneyPage(); wireCard(); wirePayees(); wireProjectBlock(); wireImport();
      return api;
    },
  };
})();
