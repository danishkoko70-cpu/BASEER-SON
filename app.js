/* Business Finance Web App (Firebase Sync)
   - Single page app
   - Cloud sync via Firestore (collection bf_data / doc main)
   - Local cache fallback
*/

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

(function () {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const money = (n) => fmt.format(Number(n || 0));
  const safeNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const download = (filename, text, mime = "application/json") => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------- Storage (local cache) ----------
  const CACHE_KEY = "bf_cache_v1";
  const SESSION_KEY = "bf_session_v1";

  const defaultState = () => ({
    company: { name: "My Business", currency: "PKR", fiscalYearStartMonth: 7 },
    users: [
      { username: "admin", password: "admin123", role: "admin" },
      { username: "manager", password: "manager123", role: "manager" },
    ],
    clients: [],
    vendors: [],
    ledger: []
  });

  function loadCache() {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return defaultState();
    try {
      const st = JSON.parse(raw);
      if (!st.company || !st.users || !st.ledger) return defaultState();
      return st;
    } catch {
      return defaultState();
    }
  }

  function saveCache(st) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(st));
  }

  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  }
  function saveSession(sess) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  let state = loadCache();
  let session = loadSession();

  // ---------- Firebase init ----------
  const syncBadge = $("#syncBadge");
  let db = null;
  let docRef = null;
  let unsub = null;
  let lastRemoteWrite = 0;
  let pendingSaveTimer = null;
  let isApplyingRemote = false;

  function setSync(text) {
    syncBadge.textContent = `Sync: ${text}`;
  }

  function initFirebase() {
    if (!firebaseConfig) {
      setSync("CONFIG MISSING");
      return false;
    }
    try {
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      docRef = doc(db, "bf_data", "main");
      return true;
    } catch (e) {
      console.error(e);
      setSync("INIT ERROR");
      return false;
    }
  }

  async function loadFromCloudOnce() {
    if (!docRef) return;
    setSync("Loading…");
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data?.state) {
          state = data.state;
          saveCache(state);
          setSync("Loaded");
        } else {
          setSync("Empty (new)");
        }
      } else {
        // create initial doc from cache
        await setDoc(docRef, { state, updatedAt: serverTimestamp() }, { merge: true });
        setSync("Created");
      }
    } catch (e) {
      console.error(e);
      setSync("Offline (cache)");
    }
  }

  function startRealtimeSync() {
    if (!docRef) return;
    if (unsub) unsub();
    unsub = onSnapshot(docRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data?.state) return;
      // Avoid applying our own very recent writes too aggressively
      const now = Date.now();
      if (now - lastRemoteWrite < 800) return;
      // Apply remote state
      isApplyingRemote = true;
      state = data.state;
      saveCache(state);
      isApplyingRemote = false;
      setSync("Live");
      route();
    }, (err) => {
      console.error(err);
      setSync("Sync error");
    });
  }

  function scheduleCloudSave(reason = "") {
    if (!docRef) return;
    if (isApplyingRemote) return; // don't echo remote back
    setSync("Saving…");
    if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(async () => {
      try {
        lastRemoteWrite = Date.now();
        await setDoc(docRef, { state, updatedAt: serverTimestamp(), reason }, { merge: true });
        setSync("Live");
      } catch (e) {
        console.error(e);
        setSync("Offline (cache)");
      }
    }, 500); // debounce
  }

  // ---------- Auth ----------
  const loginDialog = $("#loginDialog");
  const loginForm = $("#loginForm");
  const loginErr = $("#loginErr");
  const userPill = $("#userPill");

  function ensureLogin() {
    if (!session) {
      loginDialog.showModal();
      $("#loginUser").focus();
      return false;
    }
    userPill.textContent = `User: ${session.username} (${session.role})`;
    return true;
  }

  function tryLogin(username, password) {
    const u = state.users.find(x => x.username === username && x.password === password);
    if (!u) return false;
    session = { username: u.username, role: u.role };
    saveSession(session);
    userPill.textContent = `User: ${session.username} (${session.role})`;
    loginDialog.close();
    return true;
  }

  $("#btnFillDemo").addEventListener("click", () => {
    $("#loginUser").value = "admin";
    $("#loginPass").value = "admin123";
  });

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = $("#loginUser").value.trim();
    const p = $("#loginPass").value;
    const ok = tryLogin(u, p);
    loginErr.hidden = ok;
    if (!ok) {
      loginErr.hidden = false;
      loginErr.textContent = "Wrong username or password.";
    } else {
      route();
    }
  });

  $("#btnLogout").addEventListener("click", () => {
    clearSession();
    session = null;
    loginDialog.showModal();
  });

  // ---------- Demo Data ----------
  function seedDemo() {
    state = defaultState();
    state.company.name = "Demo Trading";
    const c1 = { id: uid(), name: "Ali Store", phone: "03xx-xxxxxxx", address: "Swabi", openingBalance: 12000, notes: "" };
    const c2 = { id: uid(), name: "Khan Mart", phone: "03xx-xxxxxxx", address: "Mardan", openingBalance: 0, notes: "" };
    const v1 = { id: uid(), name: "ABC Supplier", phone: "03xx-xxxxxxx", address: "Peshawar", openingBalance: 8000, notes: "" };
    state.clients.push(c1, c2);
    state.vendors.push(v1);

    const d = todayISO();
    state.ledger.push(
      { id: uid(), date: d, type: "sale", partyType: "client", partyId: c1.id, ref: "S-001", desc: "Cement sale", category: "Sales", amount: 55000, paid: 20000, method: "Cash" },
      { id: uid(), date: d, type: "purchase", partyType: "vendor", partyId: v1.id, ref: "P-001", desc: "Cement purchase", category: "COGS", amount: 40000, paid: 10000, method: "Cash" },
      { id: uid(), date: d, type: "expense", partyType: null, partyId: null, ref: "E-001", desc: "Fuel", category: "Fuel", amount: 3000, paid: 3000, method: "Cash" },
      { id: uid(), date: d, type: "cash_in", partyType: "client", partyId: c1.id, ref: "RCV-001", desc: "Client payment", category: "Receipt", amount: 5000, paid: 5000, method: "Cash" },
      { id: uid(), date: d, type: "cash_out", partyType: "vendor", partyId: v1.id, ref: "PAY-001", desc: "Vendor payment", category: "Payment", amount: 7000, paid: 7000, method: "Cash" },
    );
    saveCache(state);
    scheduleCloudSave("seedDemo");
  }

  // ---------- Accounting ----------
  function partyName(partyType, partyId) {
    if (!partyType || !partyId) return "-";
    const list = partyType === "client" ? state.clients : state.vendors;
    return (list.find(x => x.id === partyId) || {}).name || "-";
  }

  function openingBalance(partyType, partyId) {
    if (!partyType || !partyId) return 0;
    const list = partyType === "client" ? state.clients : state.vendors;
    const p = list.find(x => x.id === partyId);
    return safeNum(p?.openingBalance);
  }

  function sumPaid(type) {
    return state.ledger
      .filter(t => t.type === type)
      .reduce((a, t) => a + safeNum(t.paid), 0);
  }

  function purchasesByCategory(cat) {
    return state.ledger
      .filter(t => t.type === "purchase" && (t.category || "") === cat)
      .reduce((a, t) => a + safeNum(t.amount), 0);
  }

  function calcReceivables() {
    const byClient = new Map();
    for (const c of state.clients) byClient.set(c.id, safeNum(c.openingBalance));
    for (const t of state.ledger) {
      if (t.partyType !== "client" || !t.partyId) continue;
      const cur = byClient.get(t.partyId) ?? 0;
      if (t.type === "sale") byClient.set(t.partyId, cur + safeNum(t.amount) - safeNum(t.paid));
      if (t.type === "cash_in") byClient.set(t.partyId, cur - safeNum(t.amount));
    }
    let total = 0;
    for (const v of byClient.values()) total += v;
    return total;
  }

  function calcPayables() {
    const byVendor = new Map();
    for (const v of state.vendors) byVendor.set(v.id, safeNum(v.openingBalance));
    for (const t of state.ledger) {
      if (t.partyType !== "vendor" || !t.partyId) continue;
      const cur = byVendor.get(t.partyId) ?? 0;
      if (t.type === "purchase") byVendor.set(t.partyId, cur + safeNum(t.amount) - safeNum(t.paid));
      if (t.type === "cash_out") byVendor.set(t.partyId, cur - safeNum(t.amount));
    }
    let total = 0;
    for (const v of byVendor.values()) total += v;
    return total;
  }

  function totals() {
    let sales = 0, purchases = 0, expenses = 0, cashIn = 0, cashOut = 0;
    for (const t of state.ledger) {
      if (t.type === "sale") sales += safeNum(t.amount);
      if (t.type === "purchase") purchases += safeNum(t.amount);
      if (t.type === "expense") expenses += safeNum(t.amount);
      if (t.type === "cash_in") cashIn += safeNum(t.amount);
      if (t.type === "cash_out") cashOut += safeNum(t.amount);
    }
    const cash = (sumPaid("sale") + cashIn) - (sumPaid("purchase") + expenses + cashOut);
    const receivable = calcReceivables();
    const payable = calcPayables();
    const cogs = purchasesByCategory("COGS");
    const profit = sales - cogs - expenses;
    return { sales, purchases, cogs, expenses, cashIn, cashOut, cash, receivable, payable, profit };
  }

  function balanceSheet() {
    const t = totals();
    const assets = [
      { name: "Cash", value: t.cash },
      { name: "Accounts Receivable (Clients)", value: t.receivable },
    ];
    const liabilities = [
      { name: "Accounts Payable (Vendors)", value: t.payable },
    ];
    const totalAssets = assets.reduce((a, x) => a + x.value, 0);
    const totalLiab = liabilities.reduce((a, x) => a + x.value, 0);
    const equity = totalAssets - totalLiab;
    return { assets, liabilities, equity, totalAssets, totalLiab };
  }

  function cashFlow() {
    const cashFromSales = sumPaid("sale") + state.ledger.filter(t => t.type === "cash_in").reduce((a, t) => a + safeNum(t.amount), 0);
    const cashToSuppliers = sumPaid("purchase") + state.ledger.filter(t => t.type === "cash_out").reduce((a, t) => a + safeNum(t.amount), 0);
    const cashToExpenses = state.ledger.filter(t => t.type === "expense").reduce((a, t) => a + safeNum(t.amount), 0);
    const net = cashFromSales - cashToSuppliers - cashToExpenses;
    return { cashFromSales, cashToSuppliers, cashToExpenses, net };
  }

  // ---------- Rendering ----------
  const view = $("#view");
  function setActive(routeName) {
    $$(".nav-link").forEach(a => a.classList.toggle("active", a.dataset.route === routeName));
  }
  function render(html) { view.innerHTML = html; }
  function card(title, inner) {
    return `
      <section class="card section">
        <div class="row space"><h2>${title}</h2></div>
        ${inner}
      </section>
    `;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  }
  function badgeType(type) {
    const map = { sale:"Sale", purchase:"Purchase", expense:"Expense", cash_in:"Cash In", cash_out:"Cash Out" };
    return `<span class="badge">${map[type] || type}</span>`;
  }
  function renderLedgerTable(rows) {
    if (!rows.length) return `<div class="muted">No transactions yet.</div>`;
    return `
      <table class="table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Party</th><th>Ref</th><th>Description</th><th>Amount</th><th>Paid</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${t.date}</td>
              <td>${badgeType(t.type)}</td>
              <td>${partyName(t.partyType, t.partyId)}</td>
              <td><span class="badge" style="font-family:var(--mono)">${escapeHtml(t.ref||"-")}</span></td>
              <td>${escapeHtml(t.desc||"-")}</td>
              <td>${money(t.amount)} ${state.company.currency}</td>
              <td>${money(t.paid)} ${state.company.currency}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderDashboard() {
    setActive("dashboard");
    const t = totals();
    const bs = balanceSheet();
    const cf = cashFlow();
    render(`
      <div class="row space">
        <div>
          <h1>Dashboard</h1>
          <div class="muted">Company: <b>${state.company.name}</b> • Currency: <b>${state.company.currency}</b></div>
        </div>
        <div class="row">
          <button class="btn small" id="btnPrintDash">Print</button>
          <button class="btn small ghost" id="btnSeed">Load Demo</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="label">Sales</div><div class="value">${money(t.sales)} ${state.company.currency}</div></div>
        <div class="kpi"><div class="label">COGS (Purchases: COGS)</div><div class="value">${money(t.cogs)} ${state.company.currency}</div></div>
        <div class="kpi"><div class="label">Expenses</div><div class="value">${money(t.expenses)} ${state.company.currency}</div></div>
        <div class="kpi"><div class="label">Profit (Simple)</div><div class="value">${money(t.profit)} ${state.company.currency}</div></div>
      </div>

      ${card("Quick Position", `
        <div class="kpis" style="grid-template-columns: repeat(3, 1fr)">
          <div class="kpi"><div class="label">Cash</div><div class="value">${money(t.cash)} ${state.company.currency}</div></div>
          <div class="kpi"><div class="label">Receivable (Clients)</div><div class="value">${money(t.receivable)} ${state.company.currency}</div></div>
          <div class="kpi"><div class="label">Payable (Vendors)</div><div class="value">${money(t.payable)} ${state.company.currency}</div></div>
        </div>
        <hr class="sep"/>
        <div class="row space">
          <div class="badge">Balance Sheet Equity: <b>${money(bs.equity)} ${state.company.currency}</b></div>
          <div class="badge">Cash Flow Net: <b>${money(cf.net)} ${state.company.currency}</b></div>
        </div>
      `)}

      ${card("Recent Transactions", renderLedgerTable(state.ledger.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)))}
    `);

    $("#btnPrintDash").addEventListener("click", () => window.print());
    $("#btnSeed").addEventListener("click", () => {
      if (!confirm("Load demo data (overwrite current)?")) return;
      seedDemo();
      route();
    });
  }

  // ---------- Party CRUD ----------
  function calcPartyBalance(kind, id) {
    const partyType = kind === "client" ? "client" : "vendor";
    let bal = openingBalance(partyType, id);
    for (const t of state.ledger) {
      if (t.partyType !== partyType || t.partyId !== id) continue;
      if (partyType === "client") {
        if (t.type === "sale") bal += safeNum(t.amount) - safeNum(t.paid);
        if (t.type === "cash_in") bal -= safeNum(t.amount);
      } else {
        if (t.type === "purchase") bal += safeNum(t.amount) - safeNum(t.paid);
        if (t.type === "cash_out") bal -= safeNum(t.amount);
      }
    }
    return bal;
  }

  function modalParty(kind) {
    const title = kind === "client" ? "Client" : "Vendor";
    return `
      <dialog id="partyDialog">
        <form method="dialog" class="card section" id="partyForm" style="width:min(720px,92vw)">
          <div class="row space">
            <h2 id="partyTitle">${title}</h2>
            <button class="btn small ghost" value="cancel">Close</button>
          </div>
          <input type="hidden" id="partyId" />
          <div class="grid2">
            <label>Name <input id="partyName" required /></label>
            <label>Phone <input id="partyPhone" /></label>
            <label>Address <input id="partyAddress" /></label>
            <label>Opening Balance <input id="partyOpening" type="number" step="0.01" value="0" /></label>
          </div>
          <label>Notes <textarea id="partyNotes"></textarea></label>
          <div class="row">
            <button class="btn" id="partySave">Save</button>
            <span class="muted tiny">Balance auto-calculates using transactions.</span>
          </div>
        </form>
      </dialog>
    `;
  }

  function openPartyModal(kind, id = null) {
    const dlg = $("#partyDialog");
    const list = kind === "client" ? state.clients : state.vendors;
    const title = kind === "client" ? "Client" : "Vendor";
    $("#partyTitle").textContent = id ? `Edit ${title}` : `Add ${title}`;
    const p = id ? list.find(x => x.id === id) : null;
    $("#partyId").value = p?.id || "";
    $("#partyName").value = p?.name || "";
    $("#partyPhone").value = p?.phone || "";
    $("#partyAddress").value = p?.address || "";
    $("#partyOpening").value = String(p?.openingBalance ?? 0);
    $("#partyNotes").value = p?.notes || "";
    dlg.showModal();
  }

  function bindPartyModal(kind) {
    $("#partyForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const list = kind === "client" ? state.clients : state.vendors;
      const id = $("#partyId").value || uid();
      const existing = list.find(x => x.id === id);
      const obj = {
        id,
        name: $("#partyName").value.trim(),
        phone: $("#partyPhone").value.trim(),
        address: $("#partyAddress").value.trim(),
        openingBalance: safeNum($("#partyOpening").value),
        notes: $("#partyNotes").value.trim(),
      };
      if (existing) Object.assign(existing, obj);
      else list.push(obj);
      saveCache(state);
      scheduleCloudSave("partySave");
      $("#partyDialog").close();
      route();
    });
  }

  function renderPartyTable(kind) {
    const list = kind === "client" ? state.clients : state.vendors;
    const title = kind === "client" ? "Client" : "Vendor";
    return `
      <table class="table" id="partyTable">
        <thead><tr>
          <th>${title}</th><th>Phone</th><th>Opening</th><th>Balance</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${list.map(p => `
            <tr data-id="${p.id}">
              <td><b>${escapeHtml(p.name)}</b><div class="muted tiny">${escapeHtml(p.address||"")}</div></td>
              <td>${escapeHtml(p.phone||"-")}</td>
              <td>${money(p.openingBalance||0)} ${state.company.currency}</td>
              <td>${money(calcPartyBalance(kind, p.id))} ${state.company.currency}</td>
              <td class="row">
                <button class="btn small ghost" data-act="edit">Edit</button>
                <button class="btn small danger" data-act="del">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function bindPartyTable(kind) {
    $("#partyTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const tr = e.target.closest("tr");
      const id = tr?.dataset.id;
      if (!id) return;
      const act = btn.dataset.act;
      if (act === "edit") openPartyModal(kind, id);
      if (act === "del") {
        if (!confirm("Delete? This will not delete transactions, only the party record.")) return;
        const list = kind === "client" ? state.clients : state.vendors;
        const idx = list.findIndex(x => x.id === id);
        if (idx >= 0) list.splice(idx, 1);
        saveCache(state);
        scheduleCloudSave("partyDelete");
        route();
      }
    });
  }

  function renderClients() {
    setActive("clients");
    render(`
      <div class="row space">
        <div>
          <h1>Clients</h1>
          <div class="muted">Store customer list and track receivable automatically.</div>
        </div>
        <button class="btn" id="btnAddClient">Add Client</button>
      </div>
      ${card("Clients List", renderPartyTable("client"))}
      ${modalParty("client")}
    `);
    $("#btnAddClient").addEventListener("click", () => openPartyModal("client"));
    bindPartyTable("client");
    bindPartyModal("client");
  }

  function renderVendors() {
    setActive("vendors");
    render(`
      <div class="row space">
        <div>
          <h1>Vendors</h1>
          <div class="muted">Store supplier list and track payable automatically.</div>
        </div>
        <button class="btn" id="btnAddVendor">Add Vendor</button>
      </div>
      ${card("Vendors List", renderPartyTable("vendor"))}
      ${modalParty("vendor")}
    `);
    $("#btnAddVendor").addEventListener("click", () => openPartyModal("vendor"));
    bindPartyTable("vendor");
    bindPartyModal("vendor");
  }

  // ---------- Transactions ----------
  function renderTxnTable(rows) {
    if (!rows.length) return `<div class="muted">No entries yet.</div>`;
    return `
      <table class="table" id="txnTable">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Party</th><th>Ref</th><th>Description</th><th>Category</th><th>Amount</th><th>Paid</th><th>Method</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(t => `
            <tr data-id="${t.id}">
              <td>${t.date}</td>
              <td>${badgeType(t.type)}</td>
              <td>${partyName(t.partyType, t.partyId)}</td>
              <td><span class="badge" style="font-family:var(--mono)">${escapeHtml(t.ref||"-")}</span></td>
              <td>${escapeHtml(t.desc||"-")}</td>
              <td>${escapeHtml(t.category||"-")}</td>
              <td>${money(t.amount)} ${state.company.currency}</td>
              <td>${money(t.paid)} ${state.company.currency}</td>
              <td>${escapeHtml(t.method||"-")}</td>
              <td class="row">
                <button class="btn small ghost" data-act="edit">Edit</button>
                <button class="btn small danger" data-act="del">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function modalTxn() {
    return `
      <dialog id="txnDialog">
        <form method="dialog" class="card section" id="txnForm" style="width:min(920px,92vw)">
          <div class="row space">
            <h2 id="txnTitle">Add Entry</h2>
            <button class="btn small ghost" value="cancel">Close</button>
          </div>
          <input type="hidden" id="txnId" />
          <div class="grid2">
            <label>Date <input id="txnDate" type="date" required /></label>
            <label>Type <select id="txnType" required></select></label>
            <label>Party <select id="txnParty"></select></label>
            <label>Reference (Bill/Invoice) <input id="txnRef" placeholder="e.g., S-001 / P-001" /></label>
            <label>Category <select id="txnCategory"></select></label>
            <label>Payment Method
              <select id="txnMethod">
                <option>Cash</option><option>Bank</option><option>JazzCash</option><option>EasyPaisa</option><option>Other</option>
              </select>
            </label>
          </div>
          <label>Description <textarea id="txnDesc" placeholder="Details..."></textarea></label>
          <div class="grid2">
            <label>Amount <input id="txnAmount" type="number" step="0.01" value="0" required /></label>
            <label>Paid Now <input id="txnPaid" type="number" step="0.01" value="0" required /></label>
          </div>
          <div class="row">
            <button class="btn" id="txnSave">Save</button>
            <span class="muted tiny">Tip: For credit, set Paid less than Amount.</span>
          </div>
        </form>
      </dialog>
    `;
  }

  function transactionsPage(mode, title, subtitle) {
    const filterType = (t) => {
      if (mode === "sale") return t.type === "sale";
      if (mode === "purchase") return t.type === "purchase";
      if (mode === "expense") return t.type === "expense";
      if (mode === "cash") return t.type === "cash_in" || t.type === "cash_out";
      return true;
    };
    const rows = state.ledger.slice().filter(filterType).sort((a,b)=>b.date.localeCompare(a.date));
    return `
      <div class="row space">
        <div>
          <h1>${title}</h1>
          <div class="muted">${subtitle}</div>
        </div>
        <button class="btn" id="btnAddTxn">Add</button>
      </div>
      ${card("Entries", `
        <div class="row">
          <input id="searchTxn" placeholder="Search by ref / description / party..." style="min-width:260px" />
          <button class="btn small ghost" id="btnExportCsv">Export CSV</button>
        </div>
        <div style="margin-top:10px" id="txnTableWrap">${renderTxnTable(rows)}</div>
      `)}
      ${modalTxn()}
    `;
  }

  function bindTransactionPage(mode) {
    const dlg = $("#txnDialog");
    const form = $("#txnForm");
    const search = $("#searchTxn");

    function typesForMode() {
      if (mode === "sale") return [{v:"sale", t:"Sale"}];
      if (mode === "purchase") return [{v:"purchase", t:"Purchase"}];
      if (mode === "expense") return [{v:"expense", t:"Expense"}];
      if (mode === "cash") return [{v:"cash_in", t:"Cash In (Receipt)"},{v:"cash_out", t:"Cash Out (Payment)"}];
      return [{v:"sale", t:"Sale"}];
    }
    function categoriesFor(type) {
      if (type === "sale") return ["Sales"];
      if (type === "purchase") return ["COGS","Asset","Other"];
      if (type === "expense") return ["Office","Fuel","Salary","Rent","Electricity","Internet","Transport","Other"];
      if (type === "cash_in") return ["Receipt"];
      if (type === "cash_out") return ["Payment"];
      return ["Other"];
    }
    function partyOptions(type) {
      if (type === "sale" || type === "cash_in") return [{ id:"", name:"(No Party)" }, ...state.clients.map(c => ({id:c.id, name:c.name}))];
      if (type === "purchase" || type === "cash_out") return [{ id:"", name:"(No Party)" }, ...state.vendors.map(v => ({id:v.id, name:v.name}))];
      return [{ id:"", name:"(No Party)" }];
    }
    function fillSelect(sel, items, getV = x => x, getT = x => x) {
      sel.innerHTML = items.map(x => `<option value="${escapeHtml(getV(x))}">${escapeHtml(getT(x))}</option>`).join("");
    }

    function openTxn(id = null) {
      $("#txnTitle").textContent = id ? "Edit Entry" : "Add Entry";
      const t = id ? state.ledger.find(x => x.id === id) : null;

      $("#txnId").value = t?.id || "";
      $("#txnDate").value = t?.date || todayISO();

      const typeSel = $("#txnType");
      fillSelect(typeSel, typesForMode(), x=>x.v, x=>x.t);
      typeSel.value = t?.type || typesForMode()[0].v;

      const partySel = $("#txnParty");
      fillSelect(partySel, partyOptions(typeSel.value), x=>x.id, x=>x.name);
      partySel.value = t?.partyId || "";

      const catSel = $("#txnCategory");
      fillSelect(catSel, categoriesFor(typeSel.value));
      catSel.value = t?.category || categoriesFor(typeSel.value)[0];

      $("#txnRef").value = t?.ref || "";
      $("#txnDesc").value = t?.desc || "";
      $("#txnAmount").value = String(t?.amount ?? 0);
      $("#txnPaid").value = String(t?.paid ?? 0);
      $("#txnMethod").value = t?.method || "Cash";

      dlg.showModal();
    }

    $("#btnAddTxn").addEventListener("click", () => openTxn(null));
    $("#txnType").addEventListener("change", (e) => {
      const type = e.target.value;
      fillSelect($("#txnParty"), partyOptions(type), x=>x.id, x=>x.name);
      fillSelect($("#txnCategory"), categoriesFor(type));
    });

    $("#txnTableWrap").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const tr = e.target.closest("tr");
      const id = tr?.dataset.id;
      if (!id) return;
      const act = btn.dataset.act;
      if (act === "edit") openTxn(id);
      if (act === "del") {
        if (!confirm("Delete this entry?")) return;
        const idx = state.ledger.findIndex(x => x.id === id);
        if (idx >= 0) state.ledger.splice(idx, 1);
        saveCache(state);
        scheduleCloudSave("txnDelete");
        route();
      }
    });

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      const filterType = (t) => {
        if (mode === "sale") return t.type === "sale";
        if (mode === "purchase") return t.type === "purchase";
        if (mode === "expense") return t.type === "expense";
        if (mode === "cash") return t.type === "cash_in" || t.type === "cash_out";
        return true;
      };
      let rows = state.ledger.slice().filter(filterType);
      if (q) {
        rows = rows.filter(t =>
          (t.ref||"").toLowerCase().includes(q) ||
          (t.desc||"").toLowerCase().includes(q) ||
          (partyName(t.partyType, t.partyId)||"").toLowerCase().includes(q) ||
          (t.category||"").toLowerCase().includes(q)
        );
      }
      rows.sort((a,b)=>b.date.localeCompare(a.date));
      $("#txnTableWrap").innerHTML = renderTxnTable(rows);
    });

    $("#btnExportCsv").addEventListener("click", () => {
      const filterType = (t) => {
        if (mode === "sale") return t.type === "sale";
        if (mode === "purchase") return t.type === "purchase";
        if (mode === "expense") return t.type === "expense";
        if (mode === "cash") return t.type === "cash_in" || t.type === "cash_out";
        return true;
      };
      const rows = state.ledger.slice().filter(filterType);
      const header = ["date","type","party","ref","desc","category","amount","paid","method"];
      const lines = [header.join(",")];
      for (const t of rows) {
        const line = [
          t.date, t.type,
          `"${(partyName(t.partyType,t.partyId)).replaceAll('"','""')}"`,
          `"${String(t.ref||"").replaceAll('"','""')}"`,
          `"${String(t.desc||"").replaceAll('"','""')}"`,
          `"${String(t.category||"").replaceAll('"','""')}"`,
          safeNum(t.amount), safeNum(t.paid),
          `"${String(t.method||"").replaceAll('"','""')}"`,
        ].join(",");
        lines.push(line);
      }
      download(`${mode}-export.csv`, lines.join("\n"), "text/csv");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#txnId").value || uid();
      const type = $("#txnType").value;
      const partyId = $("#txnParty").value || null;
      const partyType = (type === "sale" || type === "cash_in") ? (partyId ? "client" : null)
                      : (type === "purchase" || type === "cash_out") ? (partyId ? "vendor" : null)
                      : null;
      const obj = {
        id,
        date: $("#txnDate").value,
        type,
        partyType,
        partyId,
        ref: $("#txnRef").value.trim(),
        desc: $("#txnDesc").value.trim(),
        category: $("#txnCategory").value,
        amount: safeNum($("#txnAmount").value),
        paid: safeNum($("#txnPaid").value),
        method: $("#txnMethod").value,
      };
      const existing = state.ledger.find(x => x.id === id);
      if (existing) Object.assign(existing, obj);
      else state.ledger.push(obj);
      saveCache(state);
      scheduleCloudSave("txnSave");
      dlg.close();
      route();
    });
  }

  function renderSales(){ setActive("sales"); render(transactionsPage("sale","Sales","Record sales and client receivables.")); bindTransactionPage("sale"); }
  function renderPurchases(){ setActive("purchases"); render(transactionsPage("purchase","Purchases","Record purchases and vendor payables.")); bindTransactionPage("purchase"); }
  function renderExpenses(){ setActive("expenses"); render(transactionsPage("expense","Expenses","Record business expenses.")); bindTransactionPage("expense"); }
  function renderCash(){ setActive("cash"); render(transactionsPage("cash","Cashbook","Cash In/Out entries (receipts & payments).")); bindTransactionPage("cash"); }

  // ---------- Reports & Settings ----------
  function renderReports() {
    setActive("reports");
    const t = totals();
    const bs = balanceSheet();
    const cf = cashFlow();
    render(`
      <div class="row space">
        <div>
          <h1>Reports</h1>
          <div class="muted">Profit & Loss, Balance Sheet, Cash Flow</div>
        </div>
        <div class="row">
          <button class="btn small" id="btnPrintReports">Print</button>
        </div>
      </div>

      ${card("Profit & Loss (Simple)", `
        <table class="table"><tbody>
          <tr><th>Sales</th><td>${money(t.sales)} ${state.company.currency}</td></tr>
          <tr><th>COGS (Purchases: COGS)</th><td>${money(t.cogs)} ${state.company.currency}</td></tr>
          <tr><th>Expenses</th><td>${money(t.expenses)} ${state.company.currency}</td></tr>
          <tr><th><b>Net Profit</b></th><td><b>${money(t.profit)} ${state.company.currency}</b></td></tr>
        </tbody></table>
        <div class="muted tiny" style="margin-top:8px">COGS uses purchases where Category = "COGS".</div>
      `)}

      ${card("Balance Sheet", `
        <div class="grid2">
          <div>
            <h3>Assets</h3>
            <table class="table"><tbody>
              ${bs.assets.map(a=>`<tr><th>${escapeHtml(a.name)}</th><td>${money(a.value)} ${state.company.currency}</td></tr>`).join("")}
              <tr><th><b>Total Assets</b></th><td><b>${money(bs.totalAssets)} ${state.company.currency}</b></td></tr>
            </tbody></table>
          </div>
          <div>
            <h3>Liabilities & Equity</h3>
            <table class="table"><tbody>
              ${bs.liabilities.map(a=>`<tr><th>${escapeHtml(a.name)}</th><td>${money(a.value)} ${state.company.currency}</td></tr>`).join("")}
              <tr><th>Equity</th><td>${money(bs.equity)} ${state.company.currency}</td></tr>
              <tr><th><b>Total</b></th><td><b>${money(bs.totalLiab + bs.equity)} ${state.company.currency}</b></td></tr>
            </tbody></table>
          </div>
        </div>
      `)}

      ${card("Cash Flow (Simple)", `
        <table class="table"><tbody>
          <tr><th>Cash from Sales + Receipts</th><td>${money(cf.cashFromSales)} ${state.company.currency}</td></tr>
          <tr><th>Cash to Suppliers + Payments</th><td>${money(cf.cashToSuppliers)} ${state.company.currency}</td></tr>
          <tr><th>Cash to Expenses</th><td>${money(cf.cashToExpenses)} ${state.company.currency}</td></tr>
          <tr><th><b>Net Cash Flow</b></th><td><b>${money(cf.net)} ${state.company.currency}</b></td></tr>
        </tbody></table>
      `)}
    `);
    $("#btnPrintReports").addEventListener("click", () => window.print());
  }

  function renderSettings() {
    setActive("settings");
    render(`
      <div class="row space">
        <div>
          <h1>Settings</h1>
          <div class="muted">Company info, passwords, backup.</div>
        </div>
      </div>

      ${card("Company", `
        <div class="grid2">
          <label>Company Name <input id="setCompanyName" value="${escapeHtml(state.company.name)}" /></label>
          <label>Currency <input id="setCurrency" value="${escapeHtml(state.company.currency)}" /></label>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="btnSaveCompany">Save</button>
        </div>
      `)}

      ${card("Change Passwords", `
        <div class="muted tiny">Admin can change both users. Manager can change only manager password.</div>
        <div class="grid2" style="margin-top:10px">
          <label>Username <select id="setUser"></select></label>
          <label>New Password <input id="setPass" type="password" /></label>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="btnSavePass">Update Password</button>
        </div>
      `)}

      ${card("Backup", `
        <div class="row">
          <button class="btn" id="btnExport2">Export JSON</button>
          <label class="btn ghost" for="importFile2">Import JSON</label>
          <input id="importFile2" type="file" accept="application/json" hidden />
        </div>
        <div class="muted tiny" style="margin-top:8px">Export regularly to keep safe backup.</div>
      `)}
    `);

    $("#btnSaveCompany").addEventListener("click", () => {
      state.company.name = $("#setCompanyName").value.trim() || "My Business";
      state.company.currency = $("#setCurrency").value.trim() || "PKR";
      saveCache(state);
      scheduleCloudSave("companySave");
      route();
      alert("Saved.");
    });

    const userSel = $("#setUser");
    const allowedUsers = session?.role === "admin" ? state.users : state.users.filter(u => u.username === session?.username);
    userSel.innerHTML = allowedUsers.map(u => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`).join("");

    $("#btnSavePass").addEventListener("click", () => {
      const uname = userSel.value;
      const newPass = $("#setPass").value;
      if (!newPass || newPass.length < 4) return alert("Password must be at least 4 characters.");
      const u = state.users.find(x => x.username === uname);
      if (!u) return alert("User not found.");
      u.password = newPass;
      saveCache(state);
      scheduleCloudSave("passwordChange");
      $("#setPass").value = "";
      alert("Password updated.");
    });

    $("#btnExport2").addEventListener("click", exportData);
    $("#importFile2").addEventListener("change", importData);
  }

  // ---------- Export/Import/Reset ----------
  function exportData() {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    download(`bf-backup-${stamp}.json`, JSON.stringify(state, null, 2));
  }
  function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ""));
        if (!obj.company || !obj.users || !obj.ledger) throw new Error("Invalid file");
        state = obj;
        saveCache(state);
        scheduleCloudSave("importJSON");
        alert("Imported successfully.");
        route();
      } catch (err) {
        alert("Import failed: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  $("#btnExport").addEventListener("click", exportData);
  $("#importFile").addEventListener("change", importData);

  $("#btnReset").addEventListener("click", () => {
    if (!confirm("Reset ALL data (cloud + local)? This cannot be undone.")) return;
    state = defaultState();
    saveCache(state);
    scheduleCloudSave("resetAll");
    alert("Reset done.");
    route();
  });

  // ---------- Router ----------
  function route() {
    if (!ensureLogin()) return;
    const h = location.hash || "#/dashboard";
    const path = h.replace(/^#\//, "").split("?")[0];

    if (path === "dashboard") return renderDashboard();
    if (path === "clients") return renderClients();
    if (path === "vendors") return renderVendors();
    if (path === "sales") return renderSales();
    if (path === "purchases") return renderPurchases();
    if (path === "expenses") return renderExpenses();
    if (path === "cash") return renderCash();
    if (path === "reports") return renderReports();
    if (path === "settings") return renderSettings();

    location.hash = "#/dashboard";
  }

  window.addEventListener("hashchange", route);

  // ---------- Boot ----------
  const ok = initFirebase();
  if (ok) {
    loadFromCloudOnce().then(() => {
      startRealtimeSync();
      route();
    });
  } else {
    route();
  }

})();
