/* =================================================================
   gunco — сборка .xlsx для страницы «деньги» (ExcelJS).
   build(ExcelJS, data) → Workbook. Работает в браузере (window.GuncoXlsx) и в Node (тест).
   Стиль: монохром как в приложении — чёрная шапка, тонкие серые линии, Arial.
   ================================================================= */
(function (root) {
  "use strict";
  const MC = (typeof module !== "undefined" && module.exports) ? require("./money-core.js") : root.MoneyCore;

  const FONT = "Arial";
  const C_BLACK = "FF000000", C_WHITE = "FFFFFFFF", C_LINE = "FFE5E5E5", C_SUB = "FFF0F0F2", C_MUTED = "FF8A8A8E", C_NEG = "FFC0392B";
  const pad = (n) => String(n).padStart(2, "0");
  // цвет статуса 24% на белом → ARGB
  function tint(rgb, a) {
    const [r, g, b] = String(rgb || "150,153,163").split(",").map(Number);
    const mix = (c) => Math.round(c * a + 255 * (1 - a));
    return "FF" + [mix(r), mix(g), mix(b)].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const toDate = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const rub = (minor) => Math.round(minor) / 100;

  function build(ExcelJS, D) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "gunco"; wb.title = "gunco · деньги"; wb.created = new Date();
    const { from, to } = { from: D.from, to: D.to };
    const range0 = MC.monthStart(from), range1 = MC.monthStart(MC.addMonths(to, 1));
    const periodLabel = from === to ? MC.monthLabel(from) : `${MC.monthLabel(from)} — ${MC.monthLabel(to)}`;
    const alive = D.payments.filter((p) => !p.deleted_at);
    const inRange = alive.filter((p) => p.due_date >= range0 && p.due_date < range1);
    const hasKop = inRange.some((p) => p.amount_minor % 100 !== 0);
    // одна секция формата: минус Excel/Numbers ставит сам (с явной секцией "-" Numbers рисует «--»)
    const MONEY = hasKop ? '#,##0.00" ₽"' : '#,##0" ₽"';
    const proj = (id) => D.projects.find((p) => p.id === id) || null;
    const cat = (id) => D.cats.find((c) => c.id === id) || null;
    const payee = (id) => D.payees.find((y) => y.id === id) || null;
    const st = (id) => D.statuses.find((s) => s.id === id) || { name: id, c: "150,153,163", done: id === "done" };
    const linksOf = (pid) => D.links.filter((l) => l.payment_id === pid);
    const exported = (() => { const [y, m, d] = D.today.split("-"); return `${d}.${m}.${y}`; })();

    function sheet(name, title, cols) {
      const ws = wb.addWorksheet(name, {
        views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: "4:4" },
        headerFooter: { oddFooter: `&L&"Arial"&8gunco · деньги · ${periodLabel}&R&"Arial"&8стр. &P из &N` },
      });
      ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
      const t = ws.getCell("A1"); t.value = title; t.font = { name: FONT, size: 18, bold: true };
      ws.getRow(1).height = 28;
      const s = ws.getCell("A2"); s.value = `gunco · ${periodLabel} · выгружено ${exported}`; s.font = { name: FONT, size: 10, color: { argb: C_MUTED } };
      const h = ws.getRow(4); h.height = 24;
      cols.forEach((c, i) => {
        const cell = h.getCell(i + 1); cell.value = c.header;
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: C_WHITE } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_BLACK } };
        cell.alignment = { vertical: "middle", horizontal: c.money ? "right" : "left", indent: c.money ? 0 : 1 };
      });
      return ws;
    }
    function styleRow(row, cols, opts) {
      opts = opts || {};
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.font = { name: FONT, size: 11, bold: !!opts.bold };
        cell.border = opts.total ? { top: { style: "medium", color: { argb: C_BLACK } } } : { bottom: { style: "thin", color: { argb: C_LINE } } };
        if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
        if (c.money) { cell.numFmt = MONEY; cell.alignment = { horizontal: "right", vertical: "middle" }; }
        else if (c.date) { cell.numFmt = "dd.mm.yyyy"; cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 }; }
        else cell.alignment = { vertical: "middle", wrapText: !!c.wrap, indent: 1 };
        if (c.pct) cell.numFmt = "0%";
      });
      // высота по самому длинному переносимому тексту (фиксированная обрезала бы его)
      let lines = 1;
      cols.forEach((c, i) => { if (!c.wrap) return; const v = row.getCell(i + 1).value; if (typeof v === "string" && v) lines = Math.max(lines, Math.ceil(v.length / Math.max(8, c.width * 1.05))); });
      row.height = opts.height || Math.max(20, 15 * lines + 5);
    }
    function statusCell(cell, id) { const s = st(id); cell.value = s.name; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint(s.c, 0.24) } }; }
    function negRule(ws, ref) { ws.addConditionalFormatting({ ref, rules: [{ type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: C_NEG } } } }] }); }
    const colL = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    function finish(ws, cols, lastRow) {
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, lastRow), column: cols.length } };
      cols.forEach((c, i) => { if (c.money) negRule(ws, `${colL(i + 1)}5:${colL(i + 1)}${Math.max(5, lastRow)}`); });
    }
    // группы с подытогами + общий итог (SUBTOTAL не считает другие SUBTOTAL — итог по всей колонке верный)
    function groupedTable(ws, cols, groups, moneyCol, fillRow) {
      let r = 5; const moneyL = colL(moneyCol);
      for (const g of groups) {
        const start = r;
        for (const p of g.items) { const row = ws.getRow(r); fillRow(row, p); styleRow(row, cols); r++; }
        const sub = ws.getRow(r);
        sub.getCell(1).value = g.label + " — итого";
        sub.getCell(moneyCol).value = { formula: `SUBTOTAL(9,${moneyL}${start}:${moneyL}${r - 1})`, result: rub(g.items.reduce((s, p) => s + p.amount_minor, 0)) };
        styleRow(sub, cols, { bold: true, fill: C_SUB }); r++;
      }
      const tot = ws.getRow(r);
      tot.getCell(1).value = "Всего";
      const all = groups.reduce((s, g) => s + g.items.reduce((a, p) => a + p.amount_minor, 0), 0);
      tot.getCell(moneyCol).value = { formula: `SUBTOTAL(9,${moneyL}5:${moneyL}${r - 1})`, result: rub(all) };
      styleRow(tot, cols, { bold: true, total: true, height: 24 });
      return r;
    }
    const bySort = (a, b) => a.due_date.localeCompare(b.due_date) || String(a.created_at || "").localeCompare(String(b.created_at || ""));

    /* ---------- Сводка ---------- */
    {
      const cols = [{ key: "a", header: "Месяц", width: 22 }, { key: "b", header: "Остаток на начало", width: 20, money: true }, { key: "c", header: "Получено", width: 18, money: true }, { key: "d", header: "Оплачено", width: 18, money: true }, { key: "e", header: "Ожидается", width: 18, money: true }, { key: "f", header: "Предстоит", width: 18, money: true }, { key: "g", header: "В теории на конец", width: 20, money: true }];
      const ws = sheet("Сводка", "Деньги · сводка", cols);
      let r = 5; const months = []; for (let k = from; k <= to; k = MC.addMonths(k, 1)) months.push(k);
      months.forEach((k) => {
        const s = MC.monthSummary(alive, D.settings, k, D.today);
        const row = ws.getRow(r);
        row.getCell(1).value = MC.monthLabel(k);
        [s.opening, s.incomeFact, s.expenseFact, s.incomePlan, s.expensePlan].forEach((v, i) => (row.getCell(i + 2).value = rub(v)));
        row.getCell(7).value = { formula: `B${r}+C${r}-D${r}+E${r}-F${r}`, result: rub(s.theory) };
        styleRow(row, cols); r++;
      });
      if (months.length > 1) {
        const tot = ws.getRow(r); tot.getCell(1).value = "За период";
        ["C", "D", "E", "F"].forEach((L, i) => (tot.getCell(i + 3).value = { formula: `SUM(${L}5:${L}${r - 1})` }));
        styleRow(tot, cols, { bold: true, total: true, height: 24 }); r++;
      }
      finish(ws, cols, r - 1);
      // крупные цифры баланса
      const last = MC.monthSummary(alive, D.settings, to, D.today);
      r += 1;
      const big = [["Баланс сейчас", last.now, `на ${exported}, по факту`], ["Баланс в теории", last.theory, `к ${MC.dayLong(MC.monthStart(MC.addMonths(to, 1)))}, если всё запланированное состоится`]];
      big.forEach(([label, v, hint]) => {
        const a = ws.getCell(`A${r}`); a.value = label; a.font = { name: FONT, size: 11, color: { argb: C_MUTED } };
        const b = ws.getCell(`B${r}`); b.value = rub(v); b.numFmt = MONEY; b.font = { name: FONT, size: 18, bold: true, color: { argb: v < 0 ? C_NEG : C_BLACK } }; b.alignment = { horizontal: "left" };
        ws.mergeCells(`B${r}:C${r}`);
        const c = ws.getCell(`D${r}`); c.value = hint; c.font = { name: FONT, size: 10, color: { argb: C_MUTED } };
        ws.getRow(r).height = 28; r++;
      });
      // кассовый разрыв — только впереди (с сегодняшнего дня)
      const gap = MC.cashGap(alive, D.settings, to, D.today);
      const ahead = gap.series.filter((x) => x.date >= D.today);
      const neg = ahead.find((x) => x.balance < 0);
      if (neg) { const mn = ahead.filter((x) => x.date >= neg.date).reduce((m, x) => (x.balance < m.balance ? x : m), neg); const g = ws.getCell(`A${r}`); g.value = `⚠ ${neg.date === D.today ? "уже сегодня" : MC.dayLong(neg.date)} денег не хватит: минимум ${MC.formatMoney(mn.balance)} (${MC.dayLong(mn.date)})`; g.font = { name: FONT, size: 11, bold: true, color: { argb: C_NEG } }; }
    }

    /* ---------- Доходы ---------- */
    {
      const cols = [{ key: "due", header: "Дата платежа", width: 14, date: true }, { key: "paid", header: "Дата оплаты", width: 14, date: true }, { key: "proj", header: "Проект", width: 24 }, { key: "client", header: "Заказчик", width: 22 }, { key: "title", header: "Название", width: 34, wrap: true }, { key: "st", header: "Статус", width: 15 }, { key: "sum", header: "Сумма, ₽", width: 18, money: true }, { key: "note", header: "Примечание", width: 40, wrap: true }];
      const ws = sheet("Доходы", "Доходы", cols);
      const list = inRange.filter((p) => p.kind === "income").sort(bySort);
      const groups = {}; list.forEach((p) => { const k = p.project_id || ""; (groups[k] = groups[k] || []).push(p); });
      const g = Object.keys(groups).sort((a, b) => (!a) - (!b) || String((proj(a) || {}).name).localeCompare(String((proj(b) || {}).name))).map((k) => ({ label: proj(k) ? proj(k).name : "без проекта", items: groups[k] }));
      const last = groupedTable(ws, cols, g, 7, (row, p) => {
        const pr = proj(p.project_id);
        row.getCell(1).value = toDate(p.due_date); row.getCell(2).value = toDate(p.paid_date);
        row.getCell(3).value = pr ? pr.name : ""; row.getCell(4).value = pr && pr.client_name ? pr.client_name : "";
        row.getCell(5).value = p.title || ""; row.getCell(7).value = rub(p.amount_minor); row.getCell(8).value = p.note || "";
        statusCell(row.getCell(6), p.status);
      });
      finish(ws, cols, last);
    }

    /* ---------- Расходы ---------- */
    {
      const cols = [{ key: "due", header: "Дата платежа", width: 14, date: true }, { key: "paid", header: "Дата оплаты", width: 14, date: true }, { key: "cat", header: "Категория", width: 22 }, { key: "who", header: "Человек", width: 20 }, { key: "title", header: "Название", width: 30, wrap: true }, { key: "proj", header: "Проекты", width: 26, wrap: true }, { key: "st", header: "Статус", width: 15 }, { key: "sum", header: "Сумма, ₽", width: 18, money: true }, { key: "rem", header: "Напоминание", width: 16 }, { key: "note", header: "Примечание", width: 36, wrap: true }];
      const ws = sheet("Расходы", "Расходы", cols);
      const list = inRange.filter((p) => p.kind === "expense").sort(bySort);
      const groups = {}; list.forEach((p) => { const k = p.category_id || ""; (groups[k] = groups[k] || []).push(p); });
      const g = Object.keys(groups).sort((a, b) => ((cat(b) || {}).is_salary ? 1 : 0) - ((cat(a) || {}).is_salary ? 1 : 0) || (!a) - (!b) || String((cat(a) || {}).name).localeCompare(String((cat(b) || {}).name))).map((k) => ({ label: cat(k) ? cat(k).name : "без категории", items: groups[k] }));
      const last = groupedTable(ws, cols, g, 8, (row, p) => {
        const c = cat(p.category_id), y = payee(p.payee_id);
        const shares = MC.projectShares(p.amount_minor, linksOf(p.id));
        row.getCell(1).value = toDate(p.due_date); row.getCell(2).value = toDate(p.paid_date);
        row.getCell(3).value = c ? c.name : ""; row.getCell(4).value = y ? y.name : "";
        row.getCell(5).value = p.title || "";
        row.getCell(6).value = shares.map((s) => { const pr = proj(s.project_id); return pr ? pr.name + (shares.length > 1 ? ` (${MC.formatMoney(s.amount)})` : "") : ""; }).filter(Boolean).join(", ");
        row.getCell(8).value = rub(p.amount_minor);
        row.getCell(9).value = p.remind_enabled && p.remind_at ? (() => { const d = MC.todayInTz((D.settings && D.settings.tz) || "Europe/Moscow", new Date(p.remind_at)); const [yy, mm, dd] = d.split("-"); return `${dd}.${mm}.${yy}`; })() : "";
        row.getCell(10).value = p.note || "";
        statusCell(row.getCell(7), p.status);
      });
      finish(ws, cols, last);
    }

    /* ---------- Зарплаты: люди × месяцы ---------- */
    {
      const months = []; for (let k = from; k <= to; k = MC.addMonths(k, 1)) months.push(k);
      const salIds = new Set(D.cats.filter((c) => c.is_salary).map((c) => c.id));
      const sal = inRange.filter((p) => p.kind === "expense" && (p.payee_id || salIds.has(p.category_id)));
      const cols = [{ key: "who", header: "Человек", width: 24 }, { key: "role", header: "Должность", width: 20 }].concat(months.map((k) => ({ key: k, header: MC.monthLabel(k), width: 16, money: true }))).concat([{ key: "tot", header: "Итого", width: 18, money: true }]);
      const ws = sheet("Зарплаты", "Зарплаты", cols);
      const people = {}; sal.forEach((p) => { const k = p.payee_id || ""; (people[k] = people[k] || []).push(p); });
      let r = 5;
      Object.keys(people).sort((a, b) => String((payee(a) || {}).name || "я").localeCompare(String((payee(b) || {}).name || "я"))).forEach((k) => {
        const y = payee(k); const row = ws.getRow(r);
        row.getCell(1).value = y ? y.name : "без человека"; row.getCell(2).value = y && y.role ? y.role : "";
        months.forEach((m, i) => { const v = people[k].filter((p) => MC.inMonth(p.due_date, m)).reduce((s, p) => s + p.amount_minor, 0); row.getCell(i + 3).value = v ? rub(v) : null; });
        row.getCell(months.length + 3).value = { formula: `SUM(${colL(3)}${r}:${colL(months.length + 2)}${r})`, result: rub(people[k].reduce((s, p) => s + p.amount_minor, 0)) };
        styleRow(row, cols); r++;
      });
      const tot = ws.getRow(r); tot.getCell(1).value = "Всего";
      for (let i = 0; i <= months.length; i++) { const L = colL(i + 3); tot.getCell(i + 3).value = { formula: `SUBTOTAL(9,${L}5:${L}${Math.max(5, r - 1)})` }; }
      styleRow(tot, cols, { bold: true, total: true, height: 24 });
      finish(ws, cols, r);
    }

    /* ---------- По проектам ---------- */
    {
      const cols = [{ key: "p", header: "Проект", width: 26 }, { key: "c", header: "Заказчик", width: 22 }, { key: "got", header: "Получено", width: 18, money: true }, { key: "wait", header: "Ожидается", width: 18, money: true }, { key: "exp", header: "Расходы (по долям)", width: 20, money: true }, { key: "m", header: "Маржа", width: 18, money: true }, { key: "mp", header: "Маржа, %", width: 12, pct: true }];
      const ws = sheet("По проектам", "По проектам", cols);
      const agg = {};
      const A = (id) => (agg[id] = agg[id] || { got: 0, wait: 0, exp: 0 });
      inRange.forEach((p) => {
        if (p.kind === "income" && p.project_id) { const a = A(p.project_id); if (st(p.status).done) a.got += p.amount_minor; else a.wait += p.amount_minor; }
        if (p.kind === "expense") MC.projectShares(p.amount_minor, linksOf(p.id)).forEach((s) => (A(s.project_id).exp += s.amount));
      });
      let r = 5;
      Object.keys(agg).sort((a, b) => (agg[b].got + agg[b].wait) - (agg[a].got + agg[a].wait)).forEach((id) => {
        const pr = proj(id); const a = agg[id]; const row = ws.getRow(r);
        row.getCell(1).value = pr ? pr.name : "проект удалён"; row.getCell(2).value = pr && pr.client_name ? pr.client_name : "";
        row.getCell(3).value = rub(a.got); row.getCell(4).value = rub(a.wait); row.getCell(5).value = rub(a.exp);
        row.getCell(6).value = { formula: `C${r}-E${r}`, result: rub(a.got - a.exp) };
        row.getCell(7).value = { formula: `IF(C${r}=0,"",F${r}/C${r})`, result: a.got ? (a.got - a.exp) / a.got : "" };
        styleRow(row, cols); r++;
      });
      const tot = ws.getRow(r); tot.getCell(1).value = "Всего";
      ["C", "D", "E", "F"].forEach((L, i) => (tot.getCell(i + 3).value = { formula: `SUBTOTAL(9,${L}5:${L}${Math.max(5, r - 1)})` }));
      tot.getCell(7).value = { formula: `IF(C${r}=0,"",F${r}/C${r})` };
      styleRow(tot, cols, { bold: true, total: true, height: 24 });
      finish(ws, cols, r);
    }
    return wb;
  }

  const api = { build, tint };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GuncoXlsx = api;
})(typeof window !== "undefined" ? window : globalThis);
