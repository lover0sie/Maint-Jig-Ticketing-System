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

const ANALYTICS_YEAR = 2026;

const YEARLY_OPERATING_HOURS =
  MONTHLY_OPERATING_HOURS * 12;

const TARGET_START = new Date("2026-05-01T00:00:00+08:00");
const TARGET_END = new Date("2026-07-16T00:00:00+08:00");
const YEAR_OPTIONS_START = new Date().getFullYear();
const YEAR_OPTIONS_COUNT = 6;

const ACTUAL_COLOR = "#eab308";
const MTTR_TARGET_COLOR = "#7c3aed";
const MTBF_TARGET_COLOR = "#2f55e7";
const TARGET_LINE_COLOR = "#ef4444";

const barValueLabelPlugin = {
  id: "barValueLabel",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    const placedLabels = [];

    function labelsOverlap(a, b) {
      return !(
        a.right < b.left ||
        a.left > b.right ||
        a.bottom < b.top ||
        a.top > b.bottom
      );
    }

    ctx.save();
    ctx.font = "700 10px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = "#374151";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!chart.isDatasetVisible(datasetIndex)) return;
      if (dataset.type === "line") return;

      const meta = chart.getDatasetMeta(datasetIndex);

      meta.data.forEach((bar, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || Number.isNaN(value)) return;

        const labelValue = Number(value).toFixed(2);
        const label = labelValue;
        const textWidth = ctx.measureText(label).width;
        const labelHeight = 12;
        let labelY = Math.max(chartArea.top + labelHeight, bar.y - 8);
        let labelRect = null;
        let canPlaceLabel = false;

        for (let attempts = 0; attempts < 8; attempts += 1) {
          labelRect = {
            left: bar.x - textWidth / 2 - 4,
            right: bar.x + textWidth / 2 + 4,
            top: labelY - labelHeight,
            bottom: labelY + 2
          };

          const hasOverlap = placedLabels.some((placed) =>
            labelsOverlap(labelRect, placed)
          );

          if (!hasOverlap) {
            canPlaceLabel = true;
            break;
          }

          labelY -= labelHeight + 3;
        }

        if (!canPlaceLabel || labelY < chartArea.top + labelHeight) return;

        ctx.fillText(label, bar.x, labelY);
        placedLabels.push(labelRect);
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
const analyticsViewMode = el("analyticsViewMode");
const monthFilterGroup = el("monthFilterGroup");
const monthFilter = el("monthFilter");
const machineFilterGroup = el("machineFilterGroup");
const machineFilter = el("machineFilter");
const yearFilterGroup = el("yearFilterGroup");
const yearFilter = el("yearFilter");
const exportExcelBtn = el("exportExcelBtn");

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

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

function createEmptySummaryMap() {
  const summaryMap = {};

  MACHINES.forEach(([id]) => {
    summaryMap[id] = {
      count: 0,
      totalMs: 0
    };
  });

  return summaryMap;
}

function createEmptyMonthlySummaries() {
  return MONTH_LABELS.map(() => ({
    count: 0,
    totalMs: 0
  }));
}

function addBreakdownSummary(summaryMap, machineId, breakdownMs) {
  if (!summaryMap[machineId]) {
    summaryMap[machineId] = { count: 0, totalMs: 0 };
  }

  summaryMap[machineId].count += 1;
  summaryMap[machineId].totalMs += breakdownMs;
}

function addMonthlySummary(monthlySummaries, date, breakdownMs, selectedYear) {
  if (date.getFullYear() !== selectedYear) return;

  const monthIndex = date.getMonth();
  monthlySummaries[monthIndex].count += 1;
  monthlySummaries[monthIndex].totalMs += breakdownMs;
}

function isInYearTargetRange(date, selectedYear) {
  const targetStart = new Date(`${selectedYear}-05-01T00:00:00+08:00`);
  const targetEnd = new Date(`${selectedYear}-07-16T00:00:00+08:00`);

  return date >= targetStart && date < targetEnd;
}

function populateMachineFilter() {
  if (!machineFilter) return;

  machineFilter.innerHTML = MACHINES
    .map(([id, name, location]) => `<option value="${id}">${name} (${location})</option>`)
    .join("");
}

function populateYearFilter() {
  if (!yearFilter) return;

  yearFilter.innerHTML = Array.from({ length: YEAR_OPTIONS_COUNT }, (_, index) => {
    const year = YEAR_OPTIONS_START - index;
    return `<option value="${year}">${year}</option>`;
  }).join("");

  yearFilter.value = String(ANALYTICS_YEAR);
}

function updateAnalyticsViewControls() {
  const isMachineView = analyticsViewMode?.value === "machine";

  if (monthFilterGroup) monthFilterGroup.classList.toggle("hidden", isMachineView);
  if (machineFilterGroup) machineFilterGroup.classList.toggle("hidden", !isMachineView);
  if (yearFilterGroup) yearFilterGroup.classList.toggle("hidden", !isMachineView);
}

function isInTargetRange(date) {
  return date >= TARGET_START && date < TARGET_END;
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
      barValueLabel: {
        unitLabel
      },
      legend: {
        display: true,
        position: "top",
        align: "start",
        labels: {
          boxWidth: 14,
          boxHeight: 14,
          color: "#6b7280",
          padding: 18,
          usePointStyle: true,
          pointStyle: "rectRounded",
          font: {
            size: 13,
            weight: "400"
          }
        }
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
        border: {
          display: true,
          color: "#cbd5e1"
        },
        grid: {
          display: false
        },
        ticks: {
          color: "#020617",
          autoSkip: false,
          maxRotation: 45,
          minRotation: 35,
          padding: 8,
          callback(value) {
            return this.getLabelForValue(value);
          },
          font: {
            size: 12,
            weight: "500"
          }
        }
      },
      y: {
        beginAtZero: true,
        grace: "12%",
        border: {
          display: false
        },
        grid: {
          color: "#dbe3ef",
          drawTicks: false
        },
        ticks: {
          color: "#64748b",
          padding: 14,
          maxTicksLimit: 8,
          callback(value) {
            return `${Number(value).toFixed(2)}${unitLabel}`;
          }
        },
        title: {
          display: true,
          text: "DURATION (HOURS)",
          color: "#475569",
          font: {
            size: 12,
            weight: "800"
          }
        }
      }
    }
  };
}

async function loadAnalytics() {
  showLoading("Loading analytics...");

  try {
    const viewMode = analyticsViewMode?.value || "month";
    const selectedMonth = el("monthFilter").value; // yyyy-mm
    const selectedMachineId = machineFilter?.value || MACHINES[0][0];
    const selectedYear = Number(yearFilter?.value || ANALYTICS_YEAR);
    const actualSummaryMap = createEmptySummaryMap();
    const targetSummaryMap = createEmptySummaryMap();
    const machineMonthlySummaries = createEmptyMonthlySummaries();

    const ticketSnap = await getDocs(
      query(collection(db, "tickets"), orderBy("createdAt", "desc"))
    );

    const closedTickets = await Promise.all(ticketSnap.docs.map(async (ticketDoc) => {
      const ticket = {
        id: ticketDoc.id,
        ...ticketDoc.data()
      };

      if (ticket.status !== "CLOSED") return null;
      if (!ticket.createdAt?.toDate) return null;

      const openedAt = ticket.createdAt.toDate();
      const machineId = ticket.machine?.id;

      if (!machineId) return null;

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

      if (!closedAt) return null;

      const breakdownMs = closedAt - openedAt;
      if (breakdownMs <= 0) return null;

      return {
        machineId,
        closedAt,
        breakdownMs
      };
    }));

    closedTickets.forEach((ticket) => {
      if (!ticket) return;

      const { machineId, closedAt, breakdownMs } = ticket;

      if (viewMode === "machine") {
        if (machineId === selectedMachineId) {
          addMonthlySummary(machineMonthlySummaries, closedAt, breakdownMs, selectedYear);

          if (isInYearTargetRange(closedAt, selectedYear)) {
            addBreakdownSummary(targetSummaryMap, machineId, breakdownMs);
          }
        }
      } else {
        if (!selectedMonth || getLocalMonthKey(closedAt) === selectedMonth) {
          addBreakdownSummary(actualSummaryMap, machineId, breakdownMs);
        }

        if (isInTargetRange(closedAt)) {
          addBreakdownSummary(targetSummaryMap, machineId, breakdownMs);
        }
      }
    });

    if (viewMode === "machine") {
      renderMachineYearCharts(
        machineMonthlySummaries,
        selectedMachineId,
        targetSummaryMap[selectedMachineId],
        selectedYear
      );
    } else {
      renderReliabilityCharts(actualSummaryMap, targetSummaryMap);
    }
  } catch (err) {
    console.error(err);
    showAlert(`Could not load analytics: ${err.message}`, "err");
  } finally {
    hideLoading();
  }
}

function getMttrHours(data) {
  if (!data || !data.count) return null;
  return Number(((data.totalMs / data.count) / 1000 / 60 / 60).toFixed(2));
}

function getMtbfHours(data) {
  if (!data || !data.count) return null;
  return Number((MONTHLY_OPERATING_HOURS / data.count).toFixed(2));
}

function renderMachineYearCharts(monthlySummaries, selectedMachineId, targetSummary, selectedYear) {
  const machineName =
    MACHINES.find(([id]) => id === selectedMachineId)?.[1] || "Selected machine";
  const mttrValues = monthlySummaries.map(getMttrHours);
  const mtbfValues = monthlySummaries.map(getMtbfHours);
  const targetMttr = getMttrHours(targetSummary);
  const targetMtbf = getMtbfHours(targetSummary);
  const targetMttrValues = MONTH_LABELS.map(() => targetMttr);
  const targetMtbfValues = MONTH_LABELS.map(() => targetMtbf);
  const ticketCounts = monthlySummaries.map((summary) => summary.count);

  if (mttrChart) mttrChart.destroy();
  if (mtbfChart) mtbfChart.destroy();

  const hasData = ticketCounts.some((count) => count > 0);
  if (mttrEmpty) mttrEmpty.textContent = `No MTTR data for ${machineName} in ${selectedYear}.`;
  if (mtbfEmpty) mtbfEmpty.textContent = `No MTBF data for ${machineName} in ${selectedYear}.`;
  setChartEmptyState("mttrChart", mttrEmpty, !hasData);
  setChartEmptyState("mtbfChart", mtbfEmpty, !hasData);

  if (!hasData) {
    el("mttrChart").parentElement.style.height = "320px";
    el("mtbfChart").parentElement.style.height = "320px";
    return;
  }

  el("mttrChart").parentElement.style.height = "560px";
  el("mtbfChart").parentElement.style.height = "560px";

  const mttrOptions = getSharedChartOptions("h", "Average repair time");
  const mtbfOptions = getSharedChartOptions("h", "Estimated time between failures");

  mttrChart = new Chart(el("mttrChart"), {
    type: "bar",
    plugins: [barValueLabelPlugin],
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
        label: `${machineName} MTTR (${selectedYear})`,
          data: mttrValues,
          backgroundColor: ACTUAL_COLOR,
          borderColor: ACTUAL_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        },
        {
          type: "line",
          label: `Target MTTR (May-Jul ${selectedYear})`,
          data: targetMttrValues,
          borderColor: TARGET_LINE_COLOR,
          backgroundColor: TARGET_LINE_COLOR,
          borderDash: [6, 5],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      ...mttrOptions,
      plugins: {
        ...mttrOptions.plugins,
        tooltip: {
          ...mttrOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              if (context.dataset.type === "line") {
                return `Target MTTR: ${context.parsed.y.toFixed(2)}h`;
              }

              const count = ticketCounts[context.dataIndex];
              return [
                `MTTR: ${context.parsed.y.toFixed(2)}h`,
                `Closed tickets: ${count}`
              ];
            }
          }
        }
      }
    }
  });

  mtbfChart = new Chart(el("mtbfChart"), {
    type: "bar",
    plugins: [barValueLabelPlugin],
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
        label: `${machineName} MTBF (${selectedYear})`,
          data: mtbfValues,
          backgroundColor: ACTUAL_COLOR,
          borderColor: ACTUAL_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        },
        {
          type: "line",
          label: `Target MTBF (May-Jul ${selectedYear})`,
          data: targetMtbfValues,
          borderColor: TARGET_LINE_COLOR,
          backgroundColor: TARGET_LINE_COLOR,
          borderDash: [6, 5],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      ...mtbfOptions,
      plugins: {
        ...mtbfOptions.plugins,
        tooltip: {
          ...mtbfOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              if (context.dataset.type === "line") {
                return `Target MTBF: ${context.parsed.y.toFixed(2)}h`;
              }

              const count = ticketCounts[context.dataIndex];
              return [
                `MTBF: ${context.parsed.y.toFixed(2)}h`,
                `Failures: ${count}`
              ];
            }
          }
        }
      }
    }
  });
}

function renderReliabilityCharts(actualSummaryMap, targetSummaryMap) {

  const labels = [];
  const actualMttrValues = [];
  const targetMttrValues = [];
  const actualMtbfValues = [];
  const targetMtbfValues = [];
  const actualTicketCounts = [];
  const targetTicketCounts = [];

  MACHINES.forEach(([id, name]) => {

    const actualData = actualSummaryMap[id];
    const targetData = targetSummaryMap[id];

    if (!actualData || !actualData.count) return;

    labels.push(name);

    actualMttrValues.push(getMttrHours(actualData));
    targetMttrValues.push(getMttrHours(targetData));
    actualMtbfValues.push(getMtbfHours(actualData));
    targetMtbfValues.push(getMtbfHours(targetData));
    actualTicketCounts.push(actualData?.count || 0);
    targetTicketCounts.push(targetData?.count || 0);
  });

  // Destroy old charts
  if (mttrChart) mttrChart.destroy();
  if (mtbfChart) mtbfChart.destroy();

  const hasData = labels.length > 0;
  if (mttrEmpty) mttrEmpty.textContent = "No MTTR data for this month.";
  if (mtbfEmpty) mtbfEmpty.textContent = "No MTBF data for this month.";
  setChartEmptyState("mttrChart", mttrEmpty, !hasData);
  setChartEmptyState("mtbfChart", mtbfEmpty, !hasData);

  if (!hasData) {
    el("mttrChart").parentElement.style.height = "320px";
    el("mtbfChart").parentElement.style.height = "320px";
    return;
  }

  el("mttrChart").parentElement.style.height = "560px";
  el("mtbfChart").parentElement.style.height = "560px";

  // MTTR
  const mttrOptions = getSharedChartOptions("h", "Average repair time");
  const mtbfOptions = getSharedChartOptions("h", "Estimated time between failures");

  mttrChart = new Chart(el("mttrChart"), {
    type: "bar",
    plugins: [barValueLabelPlugin],
    data: {
      labels,
      datasets: [
        {
          label: "Target MTTR (May-Jul 2026)",
          data: targetMttrValues,
          backgroundColor: MTTR_TARGET_COLOR,
          borderColor: MTTR_TARGET_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        },
        {
          label: "Actual MTTR",
          data: actualMttrValues,
          backgroundColor: ACTUAL_COLOR,
          borderColor: ACTUAL_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        }
      ]
    },
    options: {
      ...mttrOptions,
      plugins: {
        ...mttrOptions.plugins,
        tooltip: {
          ...mttrOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              const isTarget = context.datasetIndex === 0;
              const count = isTarget
                ? targetTicketCounts[context.dataIndex]
                : actualTicketCounts[context.dataIndex];
              const label = isTarget ? "Target repair time" : "Actual repair time";
              return [
                `${label}: ${context.parsed.y.toFixed(2)}h`,
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
      datasets: [
        {
          label: "Target MTBF (May-Jul 2026)",
          data: targetMtbfValues,
          backgroundColor: MTBF_TARGET_COLOR,
          borderColor: MTBF_TARGET_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        },
        {
          label: "Actual MTBF",
          data: actualMtbfValues,
          backgroundColor: ACTUAL_COLOR,
          borderColor: ACTUAL_COLOR,
          borderWidth: 0,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.42,
          barPercentage: 1,
          minBarLength: 7
        }
      ]
    },
    options: {
      ...mtbfOptions,
      plugins: {
        ...mtbfOptions.plugins,
        tooltip: {
          ...mtbfOptions.plugins.tooltip,
          callbacks: {
            label(context) {
              const isTarget = context.datasetIndex === 0;
              const count = isTarget
                ? targetTicketCounts[context.dataIndex]
                : actualTicketCounts[context.dataIndex];
              const label = isTarget ? "Target MTBF" : "Actual MTBF";
              return [
                `${label}: ${context.parsed.y.toFixed(2)}h`,
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

if (analyticsViewMode) {
  analyticsViewMode.addEventListener("change", () => {
    updateAnalyticsViewControls();
    loadAnalytics();
  });
}

if (machineFilter) {
  machineFilter.addEventListener("change", loadAnalytics);
}

if (yearFilter) {
  yearFilter.addEventListener("change", loadAnalytics);
}

populateMachineFilter();
populateYearFilter();
updateAnalyticsViewControls();

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
