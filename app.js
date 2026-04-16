// ===== Firebase CDN Imports (Browser) =====

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  query,
  limitToLast,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// ===== YOUR FIREBASE CONFIG =====


const firebaseConfig = {
  apiKey: "AIzaSyBEj1XfkbI6yj6g2zvnqE5YUXWCSlwGIoI",
  authDomain: "smart-gym-access-control.firebaseapp.com",
  databaseURL: "https://smart-gym-access-control-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-gym-access-control",
  storageBucket: "smart-gym-access-control.appspot.com",
  messagingSenderId: "174529745689",
  appId: "1:174529745689:web:b4975b71f0651ce73c2b88"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);



// ===== Helpers =====
let sessionTimer;
const SESSION_LIMIT = 10 * 60 * 1000;

function resetSessionTimer() {

  clearTimeout(sessionTimer);

  sessionTimer = setTimeout(async () => {

    alert("Session expired. Please login again.");
    await signOut(auth);

  }, SESSION_LIMIT);

}
const $ = (id) => document.getElementById(id);
const unixNow = () => Math.floor(Date.now() / 1000);

function setMsg(el, text, type = "success") {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("text-success", "text-danger", "text-muted");
  if (type === "danger") el.classList.add("text-danger");
  else if (type === "muted") el.classList.add("text-muted");
  else el.classList.add("text-success");
}

function showDashboard(userEmail) {
  if ($("whoami")) $("whoami").textContent = userEmail || "Logged in";
  $("btnLogout")?.classList.remove("d-none");
  $("loginCard")?.classList.add("d-none");
  $("dashboard")?.classList.remove("d-none");
}

function showLogin() {
  if ($("whoami")) $("whoami").textContent = "Not logged in";
  $("btnLogout")?.classList.add("d-none");
  $("loginCard")?.classList.remove("d-none");
  $("dashboard")?.classList.add("d-none");
}

function fmtTime(ts) {
  if (!ts) return "-";
  const ms = ts > 20000000000 ? ts : ts * 1000; // support seconds or ms
  return new Date(ms).toLocaleString();
}

function safeText(s) {
  return (s == null || s === "") ? "-" : String(s);
}

// ✅ Standard UID key for ALL nodes (residents/access_index matching)
function normalizeUID(uid) {
  return (uid || "")
    .toString()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, " ")  // colon/space/etc -> space
    .trim()
    .replace(/\s+/g, "_");       // -> F9_48_7E_11
}

// ===================== CACHES =====================
let residentIndex = {}; // residents/<UID_KEY> -> {name, unit}
let accessIndex = {};   // access_index/<UID_KEY> -> {type,name,validUntil,status,...}
let cachedLogs = [];    // tap_logs latest

function wireResidents() {
  onValue(ref(db, "residents"), (snap) => {
    residentIndex = snap.exists() ? (snap.val() || {}) : {};
    renderTapLogs();
  });
}

function wireAccessIndex() {
  onValue(ref(db, "access_index"), (snap) => {
    accessIndex = snap.exists() ? (snap.val() || {}) : {};
    renderTapLogs();
  });
}

// ===================== TAP LOGS =====================
function classifyLogType(log) {
  const uidKey = normalizeUID(log.uid);

  // ✅ most reliable: access_index first
  const ai = accessIndex?.[uidKey];
  if (ai?.type) {
    const t = String(ai.type).toUpperCase();
    if (t === "VISITOR") return "VISITOR";
    if (t === "RESIDENT") return "RESIDENT";
  }

  // fallback: if log has explicit type
  const t2 = String(log.type || "").toUpperCase();
  if (t2 === "VISITOR") return "VISITOR";
  if (t2 === "RESIDENT") return "RESIDENT";
  if (t2 === "EXIT") return "EXIT";

  // extra heuristics
  if (String(log.status || "").toUpperCase() === "EXIT") return "EXIT";
  if (String(log.uid || "").toUpperCase() === "NONE") return "EXIT";

  return "RESIDENT";
}

function renderTapLogs() {
  const residentBody = $("residentRows");
  const visitorBody = $("visitorRows");
  if (!residentBody && !visitorBody) return;

  const qResident = ($("searchResident")?.value || "").toLowerCase();
  const qVisitor = ($("searchVisitor")?.value || "").toLowerCase();

  const toRowHtml = (log) => {
    const time = fmtTime(log.time || log.ts || log.createdAt);
    const uidRaw = safeText(log.uid);
    const uidKey = normalizeUID(log.uid);
    const kind = classifyLogType(log);

    let displayName = safeText(log.name);

    // Visitor: use access_index name
    if (kind === "VISITOR") {
      const ai = accessIndex?.[uidKey];
      if (ai?.name) displayName = ai.name;
      if (!displayName || displayName === "-") displayName = "Visitor";
    }

    // Resident/Exit: use residents cache
    if (kind === "RESIDENT" || kind === "EXIT") {
      const r = residentIndex?.[uidKey];
      if (r?.name) {
        displayName = `${r.name} (${r.unit || "-"})`;
      } else if (!log.name || String(log.name).toLowerCase() === "unknown") {
        displayName = "Unknown";
      }
    }

    return `
      <tr>
        <td>${time}</td>
        <td><code>${uidRaw}</code></td>
        <td>${displayName}</td>
      </tr>
    `;
  };

  if (residentBody) {
    const rows = cachedLogs
      .filter(l => {
        const k = classifyLogType(l);
        return k === "RESIDENT" || k === "EXIT";
      })
      .filter(l => {
        if (!qResident) return true;
        const hay = `${l.uid || ""} ${l.name || ""} ${l.status || ""}`.toLowerCase();
        return hay.includes(qResident);
      })
      .slice(0, 150);

    residentBody.innerHTML = rows.map(toRowHtml).join("");
  }

  if (visitorBody) {
    const rows = cachedLogs
      .filter(l => classifyLogType(l) === "VISITOR")
      .filter(l => {
        if (!qVisitor) return true;
        const hay = `${l.uid || ""} ${accessIndex?.[normalizeUID(l.uid)]?.name || ""} ${l.status || ""}`.toLowerCase();
        return hay.includes(qVisitor);
      })
      .slice(0, 150);

    visitorBody.innerHTML = rows.map(toRowHtml).join("");
  }
}

function wireTapLogs() {
  const logsQ = query(ref(db, "tap_logs"), limitToLast(500));
  onValue(logsQ, (snap) => {
    let rows = [];
    if (snap.exists()) {
      const obj = snap.val();
      rows = Object.keys(obj).map(id => ({ id, ...obj[id] }));
    }

    rows.sort((a, b) => {
      const ta = a.time || a.ts || a.createdAt || 0;
      const tb = b.time || b.ts || b.createdAt || 0;
      return tb - ta;
    });

    

   
    cachedLogs = rows;
    renderTapLogs();
    
    // ===== DASHBOARD COUNTER =====
// ===== DASHBOARD COUNTER (FINAL FIX) =====
let allowed = 0;
let denied = 0;

const uniqueVisitors = new Set();

// helper: check TODAY
const today = new Date().toDateString();

const isToday = (ts) => {
  if (!ts) return false;
  const ms = ts > 20000000000 ? ts : ts * 1000;
  return new Date(ms).toDateString() === today;
};

rows.forEach(log => {

  console.log("DEBUG UID:", log.uid);

  const uidKey = normalizeUID(log.uid);
  console.log("ACCESS INDEX:", accessIndex?.[uidKey]);

  const status = String(log.status || "").toUpperCase();

  if (status === "GRANTED") allowed++;
  if (status === "DENIED") denied++;

  if (
    accessIndex?.[uidKey]?.type === "VISITOR" &&
    status === "GRANTED"
  ) {
    uniqueVisitors.add(log.uid);
  }

});

const activeVisitors = uniqueVisitors.size;



// update dashboard cards
if($("statAllow")) $("statAllow").textContent = allowed;
if($("statDeny")) $("statDeny").textContent = denied;
if($("statVisitors")) $("statVisitors").textContent = activeVisitors;
    renderTapLogs();
  });

  $("searchResident")?.addEventListener("input", renderTapLogs);
  $("searchVisitor")?.addEventListener("input", renderTapLogs);
}

// ===================== CLEAR LOGS =====================
async function clearAllTapLogs() {
  const msg = $("clearMsg");
  try {
    setMsg(msg, "Clearing...", "muted");
    if (!confirm("Confirm clear ALL tap logs?")) {
      setMsg(msg, "Cancelled.", "muted");
      return;
    }
    await remove(ref(db, "tap_logs"));
    setMsg(msg, "All tap logs cleared ✅", "success");
  } catch (e) {
    setMsg(msg, "Clear failed: " + e.message, "danger");
  }
}

async function clearResidentOnly() {
  const msg = $("clearMsg");
  try {
    setMsg(msg, "Clearing resident logs...", "muted");
    if (!confirm("Confirm clear RESIDENT (and EXIT) logs only?")) {
      setMsg(msg, "Cancelled.", "muted");
      return;
    }

    const toDelete = {};
    for (const l of cachedLogs) {
      const kind = classifyLogType(l);
      if ((kind === "RESIDENT" || kind === "EXIT") && l.id) {
        toDelete[`tap_logs/${l.id}`] = null;
      }
    }

    if (!Object.keys(toDelete).length) {
      setMsg(msg, "No resident logs to clear.", "muted");
      return;
    }

    await update(ref(db), toDelete);
    setMsg(msg, "Resident logs cleared ✅", "success");
  } catch (e) {
    setMsg(msg, "Clear failed: " + e.message, "danger");
  }
}

async function clearVisitorOnly() {
  const msg = $("clearMsg");
  try {
    setMsg(msg, "Clearing visitor logs...", "muted");
    if (!confirm("Confirm clear VISITOR logs only?")) {
      setMsg(msg, "Cancelled.", "muted");
      return;
    }

    const toDelete = {};
    for (const l of cachedLogs) {
      const kind = classifyLogType(l);
      if (kind === "VISITOR" && l.id) {
        toDelete[`tap_logs/${l.id}`] = null;
      }
    }

    if (!Object.keys(toDelete).length) {
      setMsg(msg, "No visitor logs to clear.", "muted");
      return;
    }

    await update(ref(db), toDelete);
    setMsg(msg, "Visitor logs cleared ✅", "success");
  } catch (e) {
    setMsg(msg, "Clear failed: " + e.message, "danger");
  }
}

// ===================== VISITOR CREATE + ASSIGN =====================
function wireVisitorActions() {
  // Create Visitor
  $("btnCreateVisitor")?.addEventListener("click", async () => {
    const msg = $("visitorMsg");
    setMsg(msg, "", "muted");

    try {
      const name = $("vName")?.value.trim();
      const mins = parseInt($("vDuration")?.value || "60", 10);

      if (!name) throw new Error("Visitor name required");
      if (!mins || mins < 1) throw new Error("Duration mesti > 0");

      const createdAt = unixNow();
      const validUntil = createdAt + mins * 60;
      const visitorId = `v_${createdAt}_${Math.random().toString(16).slice(2, 8)}`;

      await set(ref(db, `visitors/${visitorId}`), {
        name,
        status: "ACTIVE",
        createdAt,
        validUntil,
        createdBy: auth.currentUser?.uid || "unknown"
      });

      if ($("visitorId")) $("visitorId").value = visitorId;
      setMsg(msg, `Visitor created ✅ ID: ${visitorId}`, "success");
    } catch (e) {
      setMsg(msg, "Error: " + e.message, "danger");
    }
  });

  // Assign UID to Visitor -> write access_index/<UID_KEY>
  $("btnAssign")?.addEventListener("click", async () => {
    const msg = $("assignMsg");
    setMsg(msg, "", "muted");

    try {
      const uidKey = normalizeUID($("uid")?.value || "");
      const visitorId = ($("visitorId")?.value || "").trim();

      if (!uidKey) throw new Error("UID required");
      if (!visitorId) throw new Error("Create visitor dulu (Visitor ID kosong)");

      const vSnap = await get(ref(db, `visitors/${visitorId}`));
      if (!vSnap.exists()) throw new Error("Visitor ID tak wujud dalam database");

      const v = vSnap.val();
      const now = unixNow();

      if ((v.validUntil || 0) <= now) throw new Error("Visitor pass dah expired");

      await set(ref(db, `access_index/${uidKey}`), {
        type: "VISITOR",
        ownerId: visitorId,
        name: v.name || "Visitor",
        status: v.status || "ACTIVE",
        validUntil: v.validUntil || 0,
        updatedAt: now,
        updatedBy: auth.currentUser?.uid || "unknown"
      });

      setMsg(msg, `Assigned ✅ ${uidKey} → ${v.name} (until ${fmtTime(v.validUntil)})`, "success");
    } catch (e) {
      setMsg(msg, "Error: " + e.message, "danger");
    }
  });
}

// ===== GENERATE REPORT =====
async function generateReport() {

  try {

    
    const today = new Date();

    const dateStr = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

    const snap = await get(ref(db, "tap_logs"));

    if (!snap.exists()) {
      alert("No logs found");
      return;
    }

    const logs = Object.values(snap.val());

    const todayLogs = logs.filter(log => {
      const ts = log.time || log.ts || log.createdAt;
      if (!ts) return false;

      const ms = ts > 20000000000 ? ts : ts * 1000;
      return new Date(ms).toDateString() === today.toDateString();
    });

    await set(ref(db, "reports/" + dateStr), {
      date: dateStr,
      total: todayLogs.length,
      data: todayLogs,
      createdAt: Date.now()
    });

    alert("Report generated ✅");

  } catch (e) {
    alert("Error: " + e.message);
  }
}
// ===================== AUTH + PAGE WIRING =====================
onAuthStateChanged(auth, (user) => {
  if (user) {

    

    showDashboard(user.email);

    wireReports();

    // SESSION TIMEOUT START
    resetSessionTimer();

    document.addEventListener("click", resetSessionTimer);
    document.addEventListener("keydown", resetSessionTimer);
    document.addEventListener("mousemove", resetSessionTimer);
    // SESSION TIMEOUT END

    // caches for displaying names
    wireResidents();
    wireAccessIndex();

    // tap logs tables (index.html)
    if ($("residentRows") || $("visitorRows")) {
      wireTapLogs();
    }

    // visitor create/assign UI (only if exist on page)
    wireVisitorActions();

    //GENERATE REPORT
    $("btnGenerateReport")?.addEventListener("click", generateReport);



    // clear buttons (only if exist)
    $("btnClearAllLogs")?.addEventListener("click", clearAllTapLogs);
    $("btnClearResidentLogs")?.addEventListener("click", clearResidentOnly);
    $("btnClearVisitorLogs")?.addEventListener("click", clearVisitorOnly);

  } else {
    showLogin();
  }
});


// ===== REPORT (ADD ONLY) =====
function wireReports() {

  const table = document.getElementById("reportTable");
  if (!table) return; // penting: tak ganggu dashboard

  onValue(ref(db, "reports"), (snap) => {

    if (!snap.exists()) {
      table.innerHTML = `<tr><td colspan="3">No reports</td></tr>`;
      return;
    }

    const data = snap.val();

    const html = Object.keys(data).map(date => `
      <tr>
        <td>${date}</td>
        <td>report-${date}.pdf</td>

        <td>

          <div class="d-flex gap-2">

            <button class="btn btn-sm btn-primary"
              onclick="previewReport('${date}')">
              Preview
            </button>

            <button class="btn btn-sm btn-success"
              onclick="downloadReport('${date}')">
              Download
            </button>

            <button class="btn btn-sm btn-danger"
              onclick="deleteReport('${date}')">
              Delete
            </button>

          </div>
        </td>
      </tr>
    `);

    table.innerHTML = html.join("");

  });
}

window.previewReport = async function(date){
  const snap = await get(ref(db, "reports/" + date));
  if (!snap.exists()) return alert("No report");

  const report = snap.val();
  const logs = report.data || [];

  if (!logs.length) {
    alert("No data in this report");
    return;
  }


  const total = logs.length;
  const granted = logs.filter(l => l.status === "GRANTED").length;
  const denied = logs.filter(l => l.status === "DENIED").length;  

let html = `
<html>
<head>
  <title>Report ${date}</title>

  <style>
    body {
      font-family: Arial;
      padding: 30px;
      background: #f9fafb;
    }

    h2 {
      margin-bottom: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
    }

    th {
      background: #2563eb;
      color: white;
      padding: 12px;
    }

    td {
      padding: 10px;
      border-bottom: 1px solid #eee;
    }

    tr:hover {
      background: #f3f4f6;
    }
  </style>

</head>
<body>

<h2>Smart Gym Report - ${date}</h2>

<div style="margin-bottom:15px;">
  <b>Total:</b> ${total} |
  <b>Granted:</b> ${granted} |
  <b>Denied:</b> ${denied}
</div>

<table>
  <tr>
    <th>Time</th>
    <th>UID</th>
    <th>Status</th>
  </tr>
`;

  

logs.forEach(l => {



  html += `
    <tr>
      <td>${fmtTime(l.time)}</td>
      <td>${l.uid}</td>
      <td style="color:${l.status === "GRANTED" ? "green" : "red"}; font-weight:bold;">
        ${l.status}
      </td>
    </tr>
  `;
});

  html += "</table>";

  const w = window.open();
  w.document.write(html);
};

window.downloadReport = async function(date){
  const { jsPDF } = window.jspdf;

  const snap = await get(ref(db, "reports/" + date));
  if (!snap.exists()) return alert("No report");

  const report = snap.val();
  const logs = report.data || [];

  if (!logs.length) {
    alert("No data in this report");
    return;
  }

  const total = logs.length;
  const granted = logs.filter(l => l.status === "GRANTED").length;
  const denied = logs.filter(l => l.status === "DENIED").length;

  const doc = new jsPDF();

  // ===== HEADER =====
  doc.setFontSize(18);
  doc.text("SMART GYM ACCESS", 10, 10);

  doc.setFontSize(11);
  doc.text("Access Control Report", 10, 16);

  doc.setFontSize(10);
  doc.text(`Report ID: SG-${date.replaceAll("-", "")}`, 140, 10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 140, 16);

  doc.setFontSize(13);
  doc.text(`Date: ${date}`, 10, 26);

  doc.setFontSize(11);
  doc.text(`Total: ${total} | Granted: ${granted} | Denied: ${denied}`, 10, 32);

  doc.line(10, 36, 200, 36);

  // ===== TABLE HEADER =====
  let y = 45;

  doc.setFont(undefined, "bold");
  doc.text("Time", 10, y);
  doc.text("UID", 90, y);
  doc.text("Status", 160, y);
  doc.setFont(undefined, "normal");

  y += 8;

  // ===== TABLE DATA =====
  logs.forEach(l => {

    

    if (y > 270) {
      doc.addPage();
      y = 20;

      doc.setFont(undefined, "bold");
      doc.text("Time", 10, y);
      doc.text("UID", 90, y);
      doc.text("Status", 160, y);
      doc.setFont(undefined, "normal");

      y += 8;
    }

    doc.text(fmtTime(l.time), 10, y);
    doc.text(l.uid || "-", 90, y);

    // COLOR STATUS
    if (l.status === "GRANTED") {
      doc.setTextColor(0, 150, 0);
    } else if (l.status === "DENIED") {
      doc.setTextColor(200, 0, 0);
    }

    doc.text(l.status, 160, y);
    doc.setTextColor(0, 0, 0);

    y += 9;
  });

  // ===== FOOTER =====
  const pageHeight = doc.internal.pageSize.height;

  doc.setFontSize(10);
  doc.text("Generated by Smart Gym Access", 10, pageHeight - 20);

  // signature line
  doc.line(140, pageHeight - 25, 200, pageHeight - 25);
  doc.text("Admin Signature", 145, pageHeight - 20);

  // ===== SAVE =====
  doc.save(`Smart Gym Access-Report-${date}.pdf`);
};
// ===== Login =====
// ===== Login with Email Verification =====
$("btnLogin")?.addEventListener("click", async () => {

  setMsg($("loginMsg"), "", "muted");

  try {

    const email = $("email")?.value.trim();
    const pass = $("pass")?.value.trim();

    if (!email || !pass) {
      setMsg($("loginMsg"), "Email and password required", "danger");
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const user = cred.user;

    // 🔐 CHECK EMAIL VERIFIED
    if (!user.emailVerified) {

      await sendEmailVerification(user);

      setMsg(
        $("loginMsg"),
        "Email not verified. Verification email sent. Please check your inbox.",
        "danger"
      );

      await signOut(auth);
      return;
    }

    setMsg($("loginMsg"), "Login successful ✔", "success");

  } catch (e) {

    setMsg($("loginMsg"), "Login failed: " + e.message, "danger");

  }

});

// ===== Logout =====
$("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
});

window.deleteReport = async function(date){

  const confirmDelete = confirm(`Delete report ${date}?`);
  if (!confirmDelete) return;

  try {
    await remove(ref(db, "reports/" + date));
    alert("Report deleted ✅");
  } catch (e) {
    alert("Error: " + e.message);
  }

};
// ===== Sidebar jump (optional) =====
$("jumpCreateVisitor")?.addEventListener("click", () => {
  $("cardCreateVisitor")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("jumpAssignUid")?.addEventListener("click", () => {
  $("cardAssignUid")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

