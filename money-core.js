/* =================================================================
   gunco — money-core: вся денежная логика без DOM.
   Деньги — ЦЕЛЫЕ копейки (number, безопасно до 9e15). Даты — строки 'YYYY-MM-DD'.
   Работает и в браузере (window.MoneyCore), и в Node (module.exports) — для тестов.
   ================================================================= */
(function (root) {
  "use strict";

  const NNBSP = " ";   // узкий неразрывный пробел — разделитель тысяч
  const NBSP = " ";    // неразрывный пробел перед ₽
  const MINUS = "−";   // настоящий минус
  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- Суммы ---------- */
  // «120к», «120 000», «120000,5», «1.5м», «1,5 млн», «12 345,67», «1 234.56 ₽» → копейки (или null)
  function parseAmount(input) {
    if (input == null) return null;
    let s = String(input).toLowerCase().replace(/[\s   ']/g, "").replace(/₽|руб\.?|rub|р\.$/g, "");
    if (!s) return null;
    let mult = 1;
    const suf = s.match(/(тыс\.?|к|k|млн\.?|м|m)$/);
    if (suf) { const u = suf[1]; mult = /^(тыс|к|k)/.test(u) ? 1000 : 1000000; s = s.slice(0, -u.length); }
    s = s.replace(/^\+/, "");
    if (!/^\d[\d.,]*$/.test(s)) return null;
    let intPart = s, frac = "";
    const lastC = s.lastIndexOf(","), lastD = s.lastIndexOf(".");
    if (lastC >= 0 && lastD >= 0) {
      const dec = Math.max(lastC, lastD);
      intPart = s.slice(0, dec).replace(/[.,]/g, ""); frac = s.slice(dec + 1);
    } else if (lastC >= 0 || lastD >= 0) {
      const sep = lastC >= 0 ? "," : ".";
      const parts = s.split(sep);
      // «1.234.567» / «1,234,567» — разделители тысяч; иначе последний разделитель — десятичный
      if (parts.length > 2) { if (!parts.slice(1).every((p) => p.length === 3)) return null; intPart = parts.join(""); frac = ""; }
      else { intPart = parts[0]; frac = parts[1]; }
    }
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
    if (!intPart && !frac) return null;
    // копейки целочисленно: (int + frac/10^k) * mult * 100
    const whole = Number(intPart || "0");
    const fracDigits = frac.length;
    const fracNum = fracDigits ? Number(frac) : 0;
    const scale = Math.pow(10, fracDigits);
    // whole*mult*100 + fracNum*mult*100/scale, округление до копейки
    const minor = whole * mult * 100 + Math.round((fracNum * mult * 100) / scale);
    if (!Number.isFinite(minor) || minor > 9e15) return null;
    return minor;
  }

  function groupInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP); }

  // 123456789 → «1 234 567,89 ₽»; копейки только если ≠ 0
  function formatMoney(minor, opts) {
    opts = opts || {};
    const m = Math.round(Number(minor) || 0);
    const neg = m < 0, a = Math.abs(m);
    const rub = Math.floor(a / 100), kop = a % 100;
    let s = groupInt(rub) + (kop || opts.kopecks ? "," + pad(kop) : "");
    const sign = neg ? MINUS : (opts.sign && m > 0 ? "+" : "");
    return sign + s + (opts.noCurrency ? "" : NBSP + "₽");
  }
  // HTML-вариант: копейки мельче (класс .mk)
  function formatMoneyHTML(minor, opts) {
    opts = opts || {};
    const m = Math.round(Number(minor) || 0);
    const neg = m < 0, a = Math.abs(m);
    const rub = Math.floor(a / 100), kop = a % 100;
    const sign = neg ? MINUS : (opts.sign && m > 0 ? "+" : "");
    return sign + groupInt(rub) + (kop ? `<span class="mk">,${pad(kop)}</span>` : "") + (opts.noCurrency ? "" : NBSP + "₽");
  }
  // «1,2 млн ₽» для тесных мест
  function formatCompact(minor) {
    const rub = Math.round(Math.abs(minor) / 100), neg = minor < 0 ? MINUS : "";
    if (rub >= 1e6) return neg + String((Math.round(rub / 1e5) / 10)).replace(".", ",") + NBSP + "млн" + NBSP + "₽";
    if (rub >= 1e4) return neg + Math.round(rub / 1e3) + NBSP + "тыс" + NBSP + "₽";
    return formatMoney(minor);
  }
  // Для поля ввода: копейки → «120 000» / «120 000,5»
  function amountToInput(minor) {
    if (minor == null) return "";
    const rub = Math.floor(minor / 100), kop = minor % 100;
    return groupInt(rub).replace(new RegExp(NNBSP, "g"), " ") + (kop ? "," + pad(kop).replace(/0$/, "") : "");
  }

  /* ---------- Даты и месяцы ---------- */
  function parseDate(s) { const [y, m, d] = String(s).split("-").map(Number); return { y, m, d }; }
  function toDateStr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m — 1..12
  function monthKey(dateStr) { return String(dateStr).slice(0, 7); }
  function monthStart(key) { return key + "-01"; }
  function addMonths(key, n) { let [y, m] = key.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; }
  // Месяц = [1-е число, 1-е число следующего)
  function monthRange(key) { return { from: monthStart(key), to: monthStart(addMonths(key, 1)) }; }
  function inMonth(dateStr, key) { return !!dateStr && dateStr >= monthStart(key) && dateStr < monthStart(addMonths(key, 1)); }
  function addDaysStr(s, n) { const { y, m, d } = parseDate(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return toDateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function clampDay(y, m, day) { return toDateStr(y, m, Math.min(day, daysInMonth(y, m))); }
  // «сегодня» в часовом поясе пользователя
  function todayInTz(tz, now) {
    const d = now || new Date();
    try {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const g = (t) => p.find((x) => x.type === t).value;
      return `${g("year")}-${g("month")}-${g("day")}`;
    } catch (e) { return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  }
  // Смещение часового пояса (мс) в момент instant: local - utc
  function tzOffsetMs(tz, instant) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
    const g = (t) => Number(p.find((x) => x.type === t).value);
    const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
  }
  // Локальные дата+время в поясе tz → ISO UTC
  function zonedToUTC(dateStr, timeStr, tz) {
    const { y, m, d } = parseDate(dateStr); const [hh, mm] = String(timeStr || "10:00").split(":").map(Number);
    const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
    let off = tzOffsetMs(tz || "Europe/Moscow", new Date(guess));
    let t = guess - off;
    const off2 = tzOffsetMs(tz || "Europe/Moscow", new Date(t));   // поправка у перехода на летнее время
    if (off2 !== off) t = guess - off2;
    return new Date(t).toISOString();
  }
  // Момент напоминания: за offsetDays до даты платежа в time по поясу tz
  function remindAtFor(dueDate, offsetDays, time, tz) {
    if (!dueDate) return null;
    return zonedToUTC(addDaysStr(dueDate, -(offsetDays || 0)), time || "10:00", tz);
  }

  /* ---------- Доли проектов ---------- */
  // 10000 на 3 → [3334, 3333, 3333] (остаток копеек — первым)
  function splitEqual(amount, n) {
    if (!n) return [];
    const base = Math.floor(amount / n), rest = amount - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
  }
  // Фактические доли: если у всех задана share — они; иначе поровну
  function projectShares(amount, links) {
    links = links || [];
    if (!links.length) return [];
    const manual = links.every((l) => l.share_minor != null);
    if (manual) return links.map((l) => ({ project_id: l.project_id, amount: Number(l.share_minor) }));
    const parts = splitEqual(amount, links.length);
    return links.map((l, i) => ({ project_id: l.project_id, amount: parts[i] }));
  }
  function sharesValid(amount, shares) { return shares.reduce((s, x) => s + (Number(x) || 0), 0) === amount; }
  // Разбить сумму по процентам (напр. 40/60), остаток копеек — последней части
  function splitByPercent(amount, percents) {
    if (!percents || !percents.length) return [amount];
    const total = percents.reduce((s, p) => s + p, 0) || 100;
    const out = percents.map((p) => Math.floor((amount * p) / total));
    out[out.length - 1] += amount - out.reduce((s, x) => s + x, 0);
    return out;
  }

  /* ---------- Статусы ---------- */
  const DONE = "done", LATE = "late";
  // Что поменять у платежа с учётом сегодняшней даты: «опоздание» / возврат из него. null — ничего.
  function lateTransition(p, today) {
    if (!p || p.deleted_at) return null;
    if (p.status === DONE) return null;
    if (p.due_date < today && p.status !== LATE) return { status: LATE, status_before_late: p.status };
    if (p.due_date >= today && p.status === LATE && p.status_before_late) return { status: p.status_before_late, status_before_late: null };
    return null;
  }

  /* ---------- Сводка ---------- */
  const alive = (p) => !p.deleted_at;
  const signed = (p) => (p.kind === "income" ? 1 : -1) * p.amount_minor;
  // Фактический остаток на НАЧАЛО дня date
  function balanceAt(payments, settings, date) {
    const opening = (settings && settings.opening_balance_minor) || 0;
    const from = settings && settings.opening_date;
    let b = opening;
    for (const p of payments) {
      if (!alive(p) || p.status !== DONE || !p.paid_date) continue;
      if (p.paid_date >= date) continue;
      if (from && p.paid_date < from) continue;
      b += signed(p);
    }
    return b;
  }
  // Все цифры сводки месяца key на сегодня today
  function monthSummary(payments, settings, key, today, opts) {
    opts = opts || {};
    const { from, to } = monthRange(key);
    const S = balanceAt(payments, settings, from);
    let If = 0, Ef = 0, Ip = 0, Ep = 0, lateI = 0, lateE = 0, tailI = 0, tailE = 0;
    let incTotal = 0, expTotal = 0, incDone = 0, expDone = 0;
    for (const p of payments) {
      if (!alive(p)) continue;
      const isInc = p.kind === "income";
      if (p.status === DONE && p.paid_date >= from && p.paid_date < to) { if (isInc) If += p.amount_minor; else Ef += p.amount_minor; }
      const inM = p.due_date >= from && p.due_date < to;
      if (inM) {
        if (isInc) { incTotal += p.amount_minor; if (p.status === DONE) incDone += p.amount_minor; }
        else { expTotal += p.amount_minor; if (p.status === DONE) expDone += p.amount_minor; }
      }
      if (p.status !== DONE) {
        if (inM) { if (isInc) Ip += p.amount_minor; else Ep += p.amount_minor; }
        if (p.due_date < today) { if (isInc) lateI += p.amount_minor; else lateE += p.amount_minor; }
        if (p.due_date < from) { if (isInc) tailI += p.amount_minor; else tailE += p.amount_minor; }
      }
    }
    const now = balanceAt(payments, settings, addDaysStr(today, 1));
    const endFact = S + If - Ef;              // остаток на конец месяца по факту
    const withTails = opts.withTails ? tailI - tailE : 0;
    const theory = S + If + Ip - Ef - Ep + withTails;
    return {
      key, from, to, opening: S, incomeFact: If, expenseFact: Ef, incomePlan: Ip, expensePlan: Ep,
      incomeTotal: incTotal, expenseTotal: expTotal, incomeDone: incDone, expenseDone: expDone,
      now, endFact, theory, diff: theory - now,
      lateIncome: lateI, lateExpense: lateE, tailIncome: tailI, tailExpense: tailE,
    };
  }
  // Кассовый разрыв: остаток по дням месяца (факт до сегодня, план после). Возвращает минимум.
  function cashGap(payments, settings, key, today) {
    const { from, to } = monthRange(key);
    let bal = balanceAt(payments, settings, from);
    const deltas = {};
    for (const p of payments) {
      if (!alive(p)) continue;
      let day = null;
      if (p.status === DONE) day = p.paid_date;
      else { day = p.due_date < today ? today : p.due_date; }   // просроченное ожидаем «сегодня»
      if (!day || day < from || day >= to) continue;
      deltas[day] = (deltas[day] || 0) + signed(p);
    }
    let min = Infinity, minDay = null; const series = [];
    for (let d = from; d < to; d = addDaysStr(d, 1)) {
      bal += deltas[d] || 0; series.push({ date: d, balance: bal });
      if (bal < min) { min = bal; minDay = d; }
    }
    const firstNeg = series.find((x) => x.balance < 0) || null;
    return { min, minDay, firstNegative: firstNeg, series };
  }

  /* ---------- Повторения ---------- */
  // Даты экземпляров правила в интервале [fromDate, toDate)
  function recurrenceDates(rule, fromDate, toDate) {
    const out = []; if (!rule || !rule.start_date) return out;
    const start = rule.start_date, end = rule.end_date || "9999-12-31";
    const lo = fromDate > start ? fromDate : start;
    if (rule.freq === "week") {
      let d = start;
      while (d < lo) d = addDaysStr(d, 7);
      for (; d < toDate && d <= end; d = addDaysStr(d, 7)) out.push(d);
      return out;
    }
    const stepM = rule.freq === "quarter" ? 3 : rule.freq === "year" ? 12 : 1;
    const s = parseDate(start); const dom = rule.day_of_month || s.d;
    let k = `${s.y}-${pad(s.m)}`;
    for (let i = 0; i < 1200; i++) {
      const [y, m] = k.split("-").map(Number); const d = clampDay(y, m, dom);
      if (d >= toDate || d > end) break;
      if (d >= lo) out.push(d);
      k = addMonths(k, stepM);
    }
    return out;
  }

  /* ---------- Зарплаты ---------- */
  // Плановые выплаты человеку в месяце key: по дням pay_days и долям pay_split
  function salaryPlan(payee, key) {
    if (!payee || !payee.active || !payee.default_amount_minor) return [];
    const days = (payee.pay_days && payee.pay_days.length ? payee.pay_days : [1]).slice().sort((a, b) => a - b);
    const split = payee.pay_split && payee.pay_split.length === days.length ? payee.pay_split : days.map(() => 1);
    const amounts = splitByPercent(payee.default_amount_minor, split);
    const [y, m] = key.split("-").map(Number);
    const titles = days.length === 2 ? ["аванс", "зарплата"] : days.map(() => "зарплата");
    return days.map((day, i) => ({ due_date: clampDay(y, m, day), amount_minor: amounts[i], title: titles[i] }));
  }

  /* ---------- Импорт выписки ---------- */
  function normalizeText(s) {
    return String(s || "").toLowerCase()
      .replace(/№\s*\d+/g, "").replace(/\b\d{6,}\b/g, "")
      .replace(/[^a-zа-яё0-9]+/gi, "");
  }
  async function sha256Hex(text) {
    const c = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : (typeof require === "function" ? require("crypto").webcrypto : null);
    const buf = await c.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function fingerprintSource(userId, t, dupIndex) {
    return [userId, t.date, t.direction, t.amount_minor, normalizeText((t.counterparty || "") + (t.purpose || ""))].join("|") + (dupIndex > 1 ? "|#" + dupIndex : "");
  }
  // Проставить отпечатки строкам выписки (одинаковые строки в выписке нумеруются #2, #3…)
  async function fingerprintRows(userId, rows) {
    const seen = {};
    for (const r of rows) {
      const base = fingerprintSource(userId, r, 1);
      seen[base] = (seen[base] || 0) + 1;
      r.fingerprint = await sha256Hex(fingerprintSource(userId, r, seen[base]));
    }
    return rows;
  }
  const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  // Классификация строк выписки относительно существующих платежей.
  // existing — ВСЕ платежи пользователя, включая удалённые (deleted_at).
  function classifyImport(rows, existing) {
    const byFp = {}; existing.forEach((p) => { if (p.fingerprint) byFp[p.fingerprint] = p; });
    const usedPlan = new Set();
    return rows.map((r) => {
      const kind = r.direction === "in" ? "income" : "expense";
      const out = { ...r, kind, label: "new", checked: true, match: null };
      const fp = r.fingerprint && byFp[r.fingerprint];
      if (fp) { out.label = fp.deleted_at ? "deleted" : "loaded"; out.checked = false; out.match = fp.id; return out; }
      if (r.is_internal_transfer) { out.label = "transfer"; out.checked = false; return out; }
      if (r.currency && r.currency !== "RUB") { out.label = "currency"; out.checked = false; }
      const live = existing.filter((p) => !p.deleted_at && p.kind === kind && p.amount_minor === r.amount_minor);
      const plan = live.find((p) => p.status !== DONE && !usedPlan.has(p.id) && Math.abs(dayDiff(p.due_date, r.date)) <= 5);
      if (plan) { usedPlan.add(plan.id); out.label = "plan"; out.match = plan.id; out.checked = true; return out; }
      const dup = live.find((p) => p.status === DONE && !p.fingerprint && p.paid_date && Math.abs(dayDiff(p.paid_date, r.date)) <= 3);
      if (dup) { out.label = "dup"; out.match = dup.id; out.checked = false; return out; }
      if (r.is_fee) out.label = "fee";
      return out;
    });
  }
  // Сверка остатков выписки: opening + Σin − Σout == closing
  function reconcileStatement(opening, closing, rows) {
    if (opening == null || closing == null) return { ok: null, diff: 0 };
    let b = opening; rows.forEach((r) => { b += (r.direction === "in" ? 1 : -1) * r.amount_minor; });
    return { ok: b === closing, diff: closing - b };
  }
  // Где ломается цепочка balance_after (индекс первой строки с расхождением)
  function findChainBreak(opening, rows) {
    let b = opening; if (b == null) return -1;
    for (let i = 0; i < rows.length; i++) {
      b += (rows[i].direction === "in" ? 1 : -1) * rows[i].amount_minor;
      if (rows[i].balance_after_minor != null && rows[i].balance_after_minor !== b) return i;
      if (rows[i].balance_after_minor != null) b = rows[i].balance_after_minor;
    }
    return -1;
  }

  /* ---------- Тексты ---------- */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
  }
  const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
  const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const MONTHS_SHORT = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
  function monthLabel(key) { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }
  function dayLabel(dateStr) { const { m, d } = parseDate(dateStr); return `${pad(d)} ${MONTHS_SHORT[m - 1].toUpperCase()}`; }
  function dayLong(dateStr) { const { m, d } = parseDate(dateStr); return `${d} ${MONTHS_GEN[m - 1]}`; }

  const api = {
    NNBSP, NBSP, MINUS,
    parseAmount, formatMoney, formatMoneyHTML, formatCompact, amountToInput,
    daysInMonth, monthKey, monthStart, addMonths, monthRange, inMonth, addDaysStr, todayInTz, zonedToUTC, remindAtFor,
    splitEqual, projectShares, sharesValid, splitByPercent,
    lateTransition, balanceAt, monthSummary, cashGap,
    recurrenceDates, salaryPlan,
    normalizeText, sha256Hex, fingerprintRows, classifyImport, reconcileStatement, findChainBreak,
    plural, monthLabel, dayLabel, dayLong, MONTHS, MONTHS_GEN, MONTHS_SHORT,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MoneyCore = api;
})(typeof window !== "undefined" ? window : globalThis);
