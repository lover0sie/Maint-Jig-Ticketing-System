import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getCountFromServer
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

// List of allowed status transiitions
const ALLOWED_STATUS_TRANSITIONS = {
  OPEN: ["IN_PROGRESS", "WAITING_SPARE_PARTS", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_SPARE_PARTS", "RESOLVED", "CLOSED"],
  WAITING_SPARE_PARTS: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "WAITING_SPARE_PARTS", "CLOSED"],
  CLOSED: []
};


let isLoggingOut = false;

const welcomeText = el("welcomeText");
const logoutBtn = el("logoutBtn");
const ticketList = el("ticketList");
const alertEl = el("alert");

const updateModal = el("updateModal");
const closeModalBtn = el("closeModalBtn");
const cancelBtn = el("cancelBtn");
const updateForm = el("updateForm");
const saveUpdateBtn = el("saveUpdateBtn");

const modalTicketId = el("modalTicketId");
const modalMachine = el("modalMachine");
const modalLocation = el("modalLocation");
const updateStatus = el("updateStatus");
const actionTaken = el("actionTaken");
const actionCount = el("actionCount");

const filterDate = el("filterDate");
const searchTicket = el("searchTicket");
const clearFiltersBtn = el("clearFiltersBtn");

let currentUserProfile = null;
let currentStatusFilter = "OPEN";
let selectedTicket = null;
let saveInFlight = false;



const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");

function populateStatusOptions(currentStatus) {
  updateStatus.innerHTML = "";

  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];

  if (allowed.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Closed ticket cannot be updated";
    updateStatus.appendChild(opt);
    updateStatus.disabled = true;
    return;
  }

  updateStatus.disabled = false;

  for (const status of allowed) {
    const opt = document.createElement("option");
    opt.value = status;
    opt.textContent = STATUS_LABELS[status] || status;
    updateStatus.appendChild(opt);
  }
}

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

function clearAlert() {
  alertEl.textContent = "";
  alertEl.className = "alert";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatStatus(status) {
  return STATUS_LABELS[status] || status;
}

function formatDateTime(ts) {
  if (!ts?.toDate) return { date: "-", time: "-" };
  const d = ts.toDate();

  return {
    date: d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }),
    time: d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}


async function openModal(ticket) {
  selectedTicket = ticket;

  modalTicketId.textContent = ticket.ticketId || "-";
  modalMachine.textContent = `${ticket.machine?.id || "-"} — ${ticket.machine?.name || "-"}`;
  modalLocation.textContent = ticket.machine?.location || "-";

  actionTaken.value = "";
  actionCount.textContent = "0";

  populateStatusOptions(ticket.status || "OPEN");

  const isClosed = ticket.status === "CLOSED";

  actionTaken.disabled = isClosed;
  saveUpdateBtn.disabled = isClosed;
  el("evidencePhotos").disabled = isClosed;

  updateModal.classList.remove("hidden");

  await loadTicketTimeline(ticket.ticketId, ticket);

  document.body.style.overflow = "hidden";
}

function closeModal() {
  selectedTicket = null;
  updateForm.reset();
  actionCount.textContent = "0";
  document.body.style.overflow = "";
  updateModal.classList.add("hidden");
}

actionTaken.addEventListener("input", () => {
  actionCount.textContent = String(actionTaken.value.length);
});

closeModalBtn.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

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

document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatusFilter = btn.dataset.status;
    await loadStatusCounts();
    await loadTickets(currentStatusFilter);
  });
});

async function loadTickets(status) {
  ticketList.innerHTML = `<div class="empty">Loading tickets...</div>`;

  try {
    const q = query(
      collection(db, "tickets"),
      where("status", "==", status),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      ticketList.innerHTML = `<div class="empty">No ${escapeHtml(formatStatus(status).toLowerCase())} tickets found.</div>`;
      return;
    }

    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Filter by selected date
    if (filterDate.value) {
      const selectedDate = filterDate.value; // yyyy-mm-dd
      docs = docs.filter((t) => {
        if (!t.createdAt?.toDate) return false;
        const d = t.createdAt.toDate();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}` === selectedDate;
      });
    }

    // Search by ticket ID
    const searchValue = searchTicket.value.trim().toUpperCase();
    if (searchValue) {
      docs = docs.filter((t) =>
        String(t.ticketId || "").toUpperCase().includes(searchValue)
      );
    }

    if (!docs.length) {
      ticketList.innerHTML = `<div class="empty">No tickets match the selected filters.</div>`;
      return;
    }

    ticketList.innerHTML = docs.map((t) => `
      <article class="ticket-card">
        <div class="ticket-head">
          <div>
            <h3 class="ticket-title">${escapeHtml(t.ticketId || "-")}</h3>
            <p class="ticket-sub">${escapeHtml(t.machine?.id || "-")} — ${escapeHtml(t.machine?.name || "-")}</p>
          </div>
          <span class="badge ${escapeHtml(t.status)}">${escapeHtml(formatStatus(t.status || "-"))}</span>
        </div>

        <div class="ticket-grid">
          <div>
            <b>Location</b>
            <span>${escapeHtml(t.machine?.location || "-")}</span>
          </div>
          <div>
            <b>Reported By</b>
            <span>${escapeHtml(t.employeeName || "-")}</span>
          </div>
          <div>
            <b>Problem</b>
            <span>${escapeHtml(t.problemDescription || "-")}</span>
          </div>
          <div>
            <b>Latest Action</b>
            <span>${escapeHtml(t.latestAction || "-")}</span>
          </div>
        </div>

        <div class="ticket-actions">
          <button class="btn open-ticket-btn" data-ticket-id="${escapeHtml(t.ticketId)}">Update Status</button>
        </div>
      </article>
    `).join("");

    document.querySelectorAll(".open-ticket-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ticket = docs.find((x) => x.ticketId === btn.dataset.ticketId);
        if (ticket) openModal(ticket);
      });
    });

  } catch (err) {
    console.error(err);
    ticketList.innerHTML = `<div class="empty">Failed to load tickets.</div>`;
    showAlert("Could not load tickets. Check Firestore indexes/rules.", "err");
  }
}

async function loadTicketTimeline(ticketId, ticketData) {
  const timelineEl = document.getElementById("ticketTimeline");
  if (!timelineEl) return;

  timelineEl.innerHTML = `<div class="empty">Loading history...</div>`;

  try {
    const items = [];

    // First event: ticket created
    items.push({
      type: "OPEN",
      title: "Ticket Created",
      by: ticketData.employeeName || "-",
      text: ticketData.problemDescription || "-",
      createdAt: ticketData.createdAt
    });

    // Other events: updates subcollection
    const q = query(
      collection(db, "tickets", ticketId, "updates"),
      orderBy("createdAt", "asc")
    );

    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      items.push({
        type: d.status || "OPEN",
        title: formatStatus(d.status || "OPEN"),
        by: d.updatedByName || "-",
        text: d.actionTaken || "-",
        createdAt: d.createdAt
      });
    });

    if (!items.length) {
      timelineEl.innerHTML = `<div class="empty">No history available.</div>`;
      return;
    }

    timelineEl.innerHTML = items.map((item) => {
      const dt = formatDateTime(item.createdAt);
      return `
        <div class="timeline-item">
          <div class="timeline-time">
            <div class="timeline-date">${escapeHtml(dt.date)}</div>
            <div class="timeline-hour">${escapeHtml(dt.time)}</div>
          </div>

          <div class="timeline-track">
            <div class="timeline-dot ${escapeHtml(item.type)}"></div>
            <div class="timeline-line"></div>
          </div>

          <div class="timeline-content">
            <div class="timeline-title">${escapeHtml(item.title)}</div>
            <div class="timeline-meta">${escapeHtml(item.by)}</div>
            <div class="timeline-text">${escapeHtml(item.text)}</div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error(err);
    timelineEl.innerHTML = `<div class="empty">Failed to load history.</div>`;
  }
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

filterDate.addEventListener("change", async () => {
  await loadTickets(currentStatusFilter);
});

searchTicket.addEventListener("input", async () => {
  await loadTickets(currentStatusFilter);
});


clearFiltersBtn.addEventListener("click", async () => {
  filterDate.value = "";
  searchTicket.value = "";
  await loadTickets(currentStatusFilter);
});

updateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("Save update clicked");
  console.log("selectedTicket:", selectedTicket);
  console.log("saveInFlight:", saveInFlight);
  console.log("status:", updateStatus.value);
  console.log("action:", actionTaken.value);

  if (!selectedTicket || saveInFlight) return;

  saveInFlight = true;
  saveUpdateBtn.disabled = true;

  try {
    clearAlert();

    const newStatus = updateStatus.value;
    const action = actionTaken.value.trim();

    if (!action) {
      showAlert("Please enter action taken.", "err");
      actionTaken.focus();
      return;
    }

    console.log("1. Adding history record...");

    await addDoc(collection(db, "tickets", selectedTicket.ticketId, "updates"), {
      status: newStatus,
      actionTaken: action,
      updatedByUid: auth.currentUser.uid,
      updatedByEmployeeId: currentUserProfile.employeeId || currentUserProfile.employeeID,
      updatedByName: currentUserProfile.name,
      createdAt: serverTimestamp(),
      photos: []
    });

    console.log("2. History record added successfully");

    const payload = {
      status: newStatus,
      assignedTo: currentUserProfile.employeeId || currentUserProfile.employeeID,
      assignedToName: currentUserProfile.name,
      latestAction: action,
      latestUpdatedBy: currentUserProfile.employeeId || currentUserProfile.employeeID,
      latestUpdatedByName: currentUserProfile.name,
      latestUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    console.log("3. Updating main ticket...", selectedTicket.ticketId, payload);

    await updateDoc(doc(db, "tickets", selectedTicket.ticketId), payload);

    console.log("4. Main ticket updated successfully");

    showAlert(`Ticket ${selectedTicket.ticketId} updated successfully.`, "ok");
    closeModal();
    await loadStatusCounts();
    await loadTickets(currentStatusFilter);

  } catch (err) {
    console.error("SAVE UPDATE FAILED:", err);
    showAlert(`Failed to save ticket update: ${err.message}`, "err");
  } finally {
    saveInFlight = false;
    saveUpdateBtn.disabled = false;
  }
});

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

    currentUserProfile = profile;
    welcomeText.textContent = `Signed in as ${profile.name} (${profile.employeeId})`;

    await loadStatusCounts();
    await loadTickets(currentStatusFilter);
  } catch (err) {
    console.error(err);
    showAlert("Could not verify user access.", "err");
  }
});