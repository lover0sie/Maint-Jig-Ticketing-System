import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";

const el = (id) => document.getElementById(id);

const STATUS_LABELS = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_SPARE_PARTS: "Waiting Spare Parts",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

const MACHINES = [
  ["MCH001", "Plasma Machine", "PV"],
  ["MCH002", "Beveling Machine", "PV"],
  ["MCH003", "Shotblast Machine", "PV"],
  ["MCH004", "Rolling Machine", "PV"],
  ["MCH005", "S.A.W Column & Boom", "PV"],
  ["MCH006", "Washing Machine", "PV"],
  ["MCH007", "Tube Expander", "PV"],
  ["MCH008", "Paint Booth", "PV"],
  ["MCH009", "MIG Column n Boom", "PV"],
  ["MCH010", "Welding Machine", "PV"],
  ["MCH011", "Forklift", "PV"],
  ["MCH012", "CNC Machine", "PV"],
  ["MCH013", "Refrigerant Charging 1", "Chiller"],
  ["MCH014", "Refrigerant Charging 2", "Chiller"],
  ["MCH015", "Refrigerant Charging 3", "Chiller"],
  ["MCH016", "Refrigerant Charging 4", "Chiller"],
  ["MCH017", "Nitrogen Charging", "Chiller"],
  ["MCH018", "Hydrogen Charging", "Chiller"],
  ["MCH019", "Vacuum Pump 1", "Chiller"],
  ["MCH020", "Vacuum Pump 2", "Chiller"],
  ["MCH021", "Weighing Machine", "Chiller"],
  ["MCH022", "Overhead Crane", "Chiller"],
  ["MCH023", "Cutting Machine", "Chiller"],
  ["MCH024", "Laser Marking Machine", "Chiller"],
  ["MCH025", "Welding Machine", "Sub-Assembly"],
  ["MCH026", "Welding Machine", "WCCH"],
  ["MCH027", "Forklift 3.0", "Production"],
  ["MCH028", "Forklift 2.5", "Production"],
  ["MCH029", "Forklift 3.0", "Warehouse"],
  ["MCH030", "Lift Truck", "Warehouse"],
  ["MCH031", "Manual Shotblast", "PV"],
  ["MCH032", "Surface Water Treatment", "PV"],
  ["MCH033", "Drilling Machine", "PV"],
  ["MCH034", "CNC 2", "PV"],
  ["MCH035", "SAW Machine 2", "PV"],
  ["MCH036", "Rolling Machine 2", "PV"],
  ["MCH037", "OTC PV", "Fabrication"],
  ["MCH038", "OTC PV", "Sub-Assembly"],
  ["MCH039", "OTC PV", "Assembly"],
  ["MCH040", "OTC", "ACCH"],
  ["MCH041", "OTC", "WCCH"],
  ["MCH042", "OTC", "Packing"],
  ["MCH043", "Leak Test Machine 1", "QC"],
  ["MCH044", "Leak Test Machine 2", "QC"]
];

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4b5563",
  "#65a30d",
  "#c2410c"
];

const sideUserInitial = el("sideUserInitial");
const sideUserName = el("sideUserName");
const sideUserEmail = el("sideUserEmail");
const logoutBtn = el("logoutBtn");
const menuToggle = el("menuToggle");
const sidebarBackdrop = el("sidebarBackdrop");
const alertEl = el("alert");
const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");
const welcomeTitle = el("welcomeTitle");
const welcomeSub = el("welcomeSub");
const breakdownLegend = el("breakdownLegend");

let isLoggingOut = false;
let breakdownPieChart = null;

function setSidebarOpen(isOpen) {
  document.body.classList.toggle("sidebar-open", isOpen);
  if (menuToggle) {
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  }
}

if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
  });
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSidebarOpen(false);
});

document.querySelectorAll(".side-link, .side-nav .chip").forEach((item) => {
  item.addEventListener("click", () => setSidebarOpen(false));
});

function showLoading(message = "Loading...") {
  loadingText.textContent = message;
  loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  loadingOverlay.classList.add("hidden");
}

function showAlert(msg, kind = "err") {
  alertEl.textContent = msg;
  alertEl.className = `alert show ${kind}`;
}

function formatDuration(ms) {
  const hours = Math.floor(ms / 1000 / 60 / 60);
  const mins = Math.floor((ms / 1000 / 60) % 60);
  return `${hours}h ${mins}m`;
}

function parseManualDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

function getEmployeeId(profile, user) {
  return profile.employeeId || user.email?.split("@")[0] || "-";
}

async function loadStatusCounts() {
  await Promise.all(
    Object.keys(STATUS_LABELS).map(async (status) => {
      const q = query(collection(db, "tickets"), where("status", "==", status));
      const snap = await getCountFromServer(q);
      const count = String(snap.data().count);
      const sideCountEl = el(`count-${status}`);
      const overviewCountEl = el(`overview-${status}`);

      if (sideCountEl) sideCountEl.textContent = count;
      if (overviewCountEl) overviewCountEl.textContent = count;
    })
  );
}

async function loadBreakdownSummary() {
  const summaryMap = {};

  MACHINES.forEach(([id]) => {
    summaryMap[id] = {
      count: 0,
      totalMs: 0
    };
  });

  const ticketSnap = await getDocs(
    query(collection(db, "tickets"), orderBy("createdAt", "desc"))
  );

  for (const ticketDoc of ticketSnap.docs) {
    const ticket = {
      id: ticketDoc.id,
      ...ticketDoc.data()
    };

    if (ticket.status !== "CLOSED") continue;
    if (!ticket.createdAt?.toDate) continue;

    const machineId = ticket.machine?.id;
    if (!machineId) continue;

    const updateSnap = await getDocs(
      query(collection(db, "tickets", ticket.id, "updates"), orderBy("createdAt", "asc"))
    );

    let closedAt = null;

    updateSnap.forEach((updateDoc) => {
      const update = updateDoc.data();

      if (update.status === "CLOSED") {
        closedAt =
          parseManualDateTime(update.updateDate, update.updateTime) ||
          update.createdAt?.toDate?.() ||
          null;
      }
    });

    if (!closedAt) continue;

    const breakdownMs = closedAt - ticket.createdAt.toDate();
    if (breakdownMs <= 0) continue;

    if (!summaryMap[machineId]) {
      summaryMap[machineId] = {
        count: 0,
        totalMs: 0
      };
    }

    summaryMap[machineId].count += 1;
    summaryMap[machineId].totalMs += breakdownMs;
  }

  return MACHINES.map(([id, name, location]) => {
    const data = summaryMap[id] || { count: 0, totalMs: 0 };

    return {
      id,
      name,
      location,
      count: data.count,
      totalMs: data.totalMs,
      totalHours: Number((data.totalMs / 1000 / 60 / 60).toFixed(2))
    };
  });
}

function renderBreakdownChart(machineSummaries) {
  const machinesWithBreakdown = machineSummaries.filter((machine) => machine.totalMs > 0);

  if (!machinesWithBreakdown.length) {
    breakdownLegend.innerHTML = `<div class="empty">No closed ticket breakdown data yet.</div>`;
    return;
  }

  const labels = machinesWithBreakdown.map((machine) => `${machine.id} ${machine.name}`);
  const values = machinesWithBreakdown.map((machine) => machine.totalHours);
  const colors = machinesWithBreakdown.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]);

  if (breakdownPieChart) breakdownPieChart.destroy();

  breakdownPieChart = new Chart(el("breakdownPieChart"), {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: "#fff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.label}: ${context.parsed}h total`;
            }
          }
        }
      }
    }
  });

  breakdownLegend.innerHTML = machinesWithBreakdown.map((machine, index) => `
    <div class="overview-breakdown-item">
      <span class="overview-color-dot" style="background:${colors[index]}"></span>
      <div>
        <strong>${machine.name}</strong>
        <span>${formatDuration(machine.totalMs)} total from ${machine.count} closed ticket${machine.count === 1 ? "" : "s"}</span>
      </div>
    </div>
  `).join("");
}

async function loadOverview() {
  showLoading("Loading overview...");

  try {
    await loadStatusCounts();
    const machineSummaries = await loadBreakdownSummary();
    renderBreakdownChart(machineSummaries);
  } catch (err) {
    console.error(err);
    showAlert("Could not load overview data.", "err");
  } finally {
    hideLoading();
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      isLoggingOut = true;
      showLoading("Signing out...");
      await signOut(auth);

      setTimeout(() => {
        window.location.href = "maintenance-login.html";
      }, 1200);
    } catch (err) {
      console.error(err);
      hideLoading();
      showAlert("Failed to log out.", "err");
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (!isLoggingOut) {
      window.location.href = "maintenance-login.html";
    }
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));

    if (!userSnap.exists()) {
      await signOut(auth);
      window.location.href = "maintenance-login.html";
      return;
    }

    const profile = userSnap.data();

    if (!profile.active || profile.role !== "maintenance") {
      await signOut(auth);
      window.location.href = "maintenance-login.html";
      return;
    }

    const employeeId = getEmployeeId(profile, user);

    if (sideUserInitial) sideUserInitial.textContent = (profile.name || "M").trim().charAt(0).toUpperCase();
    if (sideUserName) sideUserName.textContent = profile.name || "Maintenance";
    if (sideUserEmail) sideUserEmail.textContent = user.email || profile.email || employeeId;
    if (welcomeTitle) welcomeTitle.textContent = `Welcome, ${profile.name || "Maintenance"}`;
    if (welcomeSub) welcomeSub.textContent = `Employee ID: ${employeeId}`;

    await loadOverview();
  } catch (err) {
    console.error(err);
    showAlert("Could not verify user access.", "err");
    hideLoading();
  }
});
