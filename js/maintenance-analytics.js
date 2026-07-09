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
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";

const el = (id) => document.getElementById(id);


const OPERATING_HOURS_PER_DAY = 8;
const WORKING_DAYS_PER_MONTH = 22;

const MONTHLY_OPERATING_HOURS =
  OPERATING_HOURS_PER_DAY * WORKING_DAYS_PER_MONTH;

const YEARLY_OPERATING_HOURS =
  MONTHLY_OPERATING_HOURS * 12;

const MTTR_COLOR = "#f97316";
const MTBF_COLOR = "#2563eb";

const barValueLabelPlugin = {
  id: "barValueLabel",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;

    ctx.save();
    ctx.font = "700 11px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = "#374151";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);

      meta.data.forEach((bar, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || Number.isNaN(value)) return;

        const label = `${value}h`;
        const labelY = Math.max(chartArea.top + 14, bar.y - 8);
        ctx.fillText(label, bar.x, labelY);
      });
    });

    ctx.restore();
  }
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

let mttrChart = null;
let mtbfChart = null;
let chart = null;
let isLoggingOut = false;

const sideUserInitial = el("sideUserInitial");
const sideUserName = el("sideUserName");
const sideUserEmail = el("sideUserEmail");
const logoutBtn = el("logoutBtn");
const menuToggle = el("menuToggle");
const sidebarBackdrop = el("sidebarBackdrop");
const alertEl = el("alert");
const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");
const mttrEmpty = el("mttrEmpty");
const mtbfEmpty = el("mtbfEmpty");
const monthFilter = el("monthFilter");
const exportExcelBtn = el("exportExcelBtn");

function toDateFromUpdate(updateDate, updateTime) {
  if (!updateDate || !updateTime) return null;
  return new Date(`${updateDate}T${updateTime}`);
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function safeSheetName(name) {
  return String(name || "Unknown")
    .replace(/[\\/?*[\]:]/g, "-")
    .substring(0, 31);
}


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
  if (loadingText) loadingText.textContent = message;
  if (loadingOverlay) loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  if (loadingOverlay) loadingOverlay.classList.add("hidden");
}

function showAlert(msg, kind = "err") {
  if (!alertEl) return;
  alertEl.textContent = msg;
  alertEl.className = `alert show ${kind}`;
}

async function getTicketClosedDate(ticketId) {
  const updateSnap = await getDocs(
    query(
      collection(db, "tickets", ticketId, "updates"),
      orderBy("createdAt", "asc")
    )
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

  return closedAt;
}

async function loadStatusCounts() {
  const statuses = [
    "OPEN",
    "IN_PROGRESS",
    "WAITING_SPARE_PARTS",
    "RESOLVED",
    "CLOSED"
  ];

  try {
    await Promise.all(
      statuses.map(async (status) => {
        const q = query(collection(db, "tickets"), where("status", "==", status));
        const snap = await getCountFromServer(q);
        const countEl = document.getElementById(`count-${status}`);
        if (countEl) countEl.textContent = String(snap.data().count);
      })
    );
  } catch (err) {
    console.error("Failed to load status counts:", err);
  }
}

function parseManualDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  // Malaysia time UTC+8
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

function getLocalMonthKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function buildGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, `${color}99`);
  return gradient;
}

function setChartEmptyState(canvasId, emptyEl, isEmpty) {
  const canvas = el(canvasId);
  if (canvas) canvas.classList.toggle("hidden", isEmpty);
  if (emptyEl) emptyEl.classList.toggle("hidden", !isEmpty);
}

function getSharedChartOptions(unitLabel, tooltipLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 650,
      easing: "easeOutQuart"
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: "#111827",
        titleColor: "#fff",
        bodyColor: "#e5e7eb",
        padding: 12,
        displayColors: false,
          callbacks: {
            label(context) {
            return `${tooltipLabel}: ${context.parsed.y} ${unitLabel}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: "#374151",
          maxRotation: 55,
          minRotation: 35,
          font: {
            weight: "600"
          }
        }
      },
      y: {
        beginAtZero: true,
        grace: "12%",
        grid: {
          color: "#e5e7eb"
        },
        ticks: {
          color: "#6b7280",
          callback(value) {
            return `${value}h`;
          }
        },
        title: {
          display: true,
          text: "Hours",
          color: "#374151",
          font: {
            weight: "700"
          }
        }
      }
    }
  };
}

async function loadAnalytics() {
  showLoading("Loading analytics...");

  try {
    const selectedMonth = el("monthFilter").value; // yyyy-mm
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

      const openedAt = ticket.createdAt.toDate();
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

      if (selectedMonth) {
        const closedMonth = getLocalMonthKey(closedAt);
        if (closedMonth !== selectedMonth) continue;
      }

      const breakdownMs = closedAt - openedAt;
      if (breakdownMs <= 0) continue;

      if (!summaryMap[machineId]) {
        summaryMap[machineId] = { count: 0, totalMs: 0 };
      }

      summaryMap[machineId].count += 1;
      summaryMap[machineId].totalMs += breakdownMs;
    }

    renderReliabilityCharts(summaryMap);
  } catch (err) {
    console.error(err);
    showAlert(`Could not load analytics: ${err.message}`, "err");
  } finally {
    hideLoading();
  }
}

function renderReliabilityCharts(summaryMap) {

  const labels = [];
  const mttrValues = [];
  const mtbfValues = [];
  const ticketCounts = [];

  MACHINES.forEach(([id, name]) => {

    const data = summaryMap[id];

    if (!data || !data.count) return;

    const mttrHours =
      (data.totalMs / data.count) / 1000 / 60 / 60;

    const mtbfHours =
      MONTHLY_OPERATING_HOURS / data.count;

    labels.push(name);

    mttrValues.push(
      Number(mttrHours.toFixed(2))
    );

    mtbfValues.push(
      Number(mtbfHours.toFixed(2))
    );

    ticketCounts.push(data.count);
  });

  // Destroy old charts
  if (mttrChart) mttrChart.destroy();
  if (mtbfChart) mtbfChart.destroy();

  const hasData = labels.length > 0;
  setChartEmptyState("mttrChart", mttrEmpty, !hasData);
  setChartEmptyState("mtbfChart", mtbfEmpty, !hasData);

  if (!hasData) {
    el("mttrChart").parentElement.style.height = "320px";
    el("mtbfChart").parentElement.style.height = "320px";
    return;
  }

  el("mttrChart").parentElement.style.height = "420px";
  el("mtbfChart").parentElement.style.height = "420px";

  const mttrCtx = el("mttrChart").getContext("2d");
  const mtbfCtx = el("mtbfChart").getContext("2d");
  const mttrColor = buildGradient(mttrCtx, MTTR_COLOR);
  const mtbfColor = buildGradient(mtbfCtx, MTBF_COLOR);

  // MTTR
  const mttrOptions = getSharedChartOptions("h", "Average repair time");
  const mtbfOptions = getSharedChartOptions("h", "Estimated time between failures");

  mttrChart = new Chart(el("mttrChart"), {
    type: "bar",
    plugins: [barValueLabelPlugin],
    data: {
      labels,
      datasets: [{
        label: "MTTR (Hours)",
        data: mttrValues,
        backgroundColor: mttrColor,
        borderColor: MTTR_COLOR,
        borderWidth: 1,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 34
      }]
    },
    options: {
      ...mttrOptions,
      plugins: {
        ...mttrOptions.plugins,
        tooltip: {
          ...mttrOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              const count = ticketCounts[context.dataIndex];
              return [
                `Average repair time: ${context.parsed.y}h`,
                `Closed tickets: ${count}`
              ];
            }
          }
        }
      }
    }
  });

  // MTBF
  mtbfChart = new Chart(el("mtbfChart"), {
    type: "bar",
    plugins: [barValueLabelPlugin],
    data: {
      labels,
      datasets: [{
        label: "MTBF (Hours)",
        data: mtbfValues,
        backgroundColor: mtbfColor,
        borderColor: MTBF_COLOR,
        borderWidth: 1,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 34
      }]
    },
    options: {
      ...mtbfOptions,
      plugins: {
        ...mtbfOptions.plugins,
        tooltip: {
          ...mtbfOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              const count = ticketCounts[context.dataIndex];
              return [
                `Estimated MTBF: ${context.parsed.y}h`,
                `Failures: ${count}`
              ];
            }
          }
        }
      }
    }
  });
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

async function exportMonthlyMttrMtbf() {
  const selectedMonth = monthFilter.value;

  if (!selectedMonth) {
    showAlert("Please choose month.", "err");
    return;
  }

  showLoading("Exporting MTTR / MTBF Excel...");

  try {
    const summaryMap = {};

    MACHINES.forEach(([id, name, location]) => {
      summaryMap[id] = {
        machineId: id,
        machineName: name,
        location,
        closedTickets: 0,
        totalBreakdownMs: 0
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

      const openedAt = ticket.createdAt.toDate();
      const closedAt = await getTicketClosedDate(ticket.id);

      if (!closedAt) continue;

      if (getLocalMonthKey(closedAt) !== selectedMonth) continue;

      const machineId = ticket.machine?.id;
      if (!machineId) continue;

      const breakdownMs = closedAt - openedAt;
      if (breakdownMs <= 0) continue;

      if (!summaryMap[machineId]) {
        summaryMap[machineId] = {
          machineId,
          machineName: ticket.machine?.name || "-",
          location: ticket.machine?.location || "-",
          closedTickets: 0,
          totalBreakdownMs: 0
        };
      }

      summaryMap[machineId].closedTickets += 1;
      summaryMap[machineId].totalBreakdownMs += breakdownMs;
    }

    const rows = Object.values(summaryMap).map((m) => {
      const totalBreakdownHours = m.totalBreakdownMs / 1000 / 60 / 60;
      const mttrHours =
        m.closedTickets > 0 ? totalBreakdownHours / m.closedTickets : 0;
      const mtbfHours =
        m.closedTickets > 0 ? MONTHLY_OPERATING_HOURS / m.closedTickets : 0;

      return {
        "Month": selectedMonth,
        "Machine ID": m.machineId,
        "Machine": m.machineName,
        "Location": m.location,
        "Closed Tickets / Failures": m.closedTickets,
        "Total Breakdown Time (hr)": Number(totalBreakdownHours.toFixed(2)),
        "Monthly Operating Time (hr)": MONTHLY_OPERATING_HOURS,
        "MTTR (hr)": Number(mttrHours.toFixed(2)),
        "MTBF (hr)": Number(mtbfHours.toFixed(2))
      };
    });

    const totalFailures = rows.reduce(
      (sum, r) => sum + r["Closed Tickets / Failures"],
      0
    );

    const totalBreakdownHours = rows.reduce(
      (sum, r) => sum + r["Total Breakdown Time (hr)"],
      0
    );

    rows.push({});
    rows.push({
      "Month": selectedMonth,
      "Machine ID": "TOTAL",
      "Closed Tickets / Failures": totalFailures,
      "Total Breakdown Time (hr)": Number(totalBreakdownHours.toFixed(2)),
      "Monthly Operating Time (hr)": MONTHLY_OPERATING_HOURS * MACHINES.length,
      "MTTR (hr)": totalFailures > 0
        ? Number((totalBreakdownHours / totalFailures).toFixed(2))
        : 0,
      "MTBF (hr)": totalFailures > 0
        ? Number(((MONTHLY_OPERATING_HOURS * MACHINES.length) / totalFailures).toFixed(2))
        : 0
    });

    const mttrRows = rows.map((r) => ({
      "Month": r["Month"],
      "Machine ID": r["Machine ID"],
      "Machine": r["Machine"],
      "Location": r["Location"],
      "Closed Tickets / Failures": r["Closed Tickets / Failures"],
      "Total Breakdown Time (hr)": r["Total Breakdown Time (hr)"],
      "MTTR (hr)": r["MTTR (hr)"]
    }));

    const mtbfRows = rows.map((r) => ({
      "Month": r["Month"],
      "Machine ID": r["Machine ID"],
      "Machine": r["Machine"],
      "Location": r["Location"],
      "Closed Tickets / Failures": r["Closed Tickets / Failures"],
      "Monthly Operating Time (hr)": r["Monthly Operating Time (hr)"],
      "MTBF (hr)": r["MTBF (hr)"]
    }));

    const wb = XLSX.utils.book_new();

    const mttrWs = XLSX.utils.json_to_sheet(mttrRows);
    const mtbfWs = XLSX.utils.json_to_sheet(mtbfRows);

    XLSX.utils.book_append_sheet(wb, mttrWs, "MTTR");
    XLSX.utils.book_append_sheet(wb, mtbfWs, "MTBF");

    XLSX.writeFile(wb, `Monthly_MTTR_MTBF_${selectedMonth}.xlsx`);

    hideLoading();

  } catch (err) {
    console.error(err);
    hideLoading();
    showAlert(`Failed to export Excel: ${err.message}`, "err");
  }
}

exportExcelBtn.addEventListener("click", exportMonthlyMttrMtbf);

el("loadAnalyticsBtn").addEventListener("click", loadAnalytics);

el("monthFilter").addEventListener("change", loadAnalytics);

el("monthFilter").value = getLocalMonthKey(new Date());

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

    if (sideUserInitial) sideUserInitial.textContent = (profile.name || "M").trim().charAt(0).toUpperCase();
    if (sideUserName) sideUserName.textContent = profile.name || "Maintenance";
    if (sideUserEmail) sideUserEmail.textContent = user.email || profile.email || profile.employeeId || "Maintenance";

    await loadStatusCounts();
    await loadAnalytics();
  } catch (err) {
    console.error(err);
    showAlert("Could not verify user access.", "err");
  }
});
