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

let isLoggingOut = false;
let allTickets = [];

const sideUserInitial = el("sideUserInitial");
const sideUserName = el("sideUserName");
const sideUserEmail = el("sideUserEmail");
const logoutBtn = el("logoutBtn");
const menuToggle = el("menuToggle");
const sidebarBackdrop = el("sidebarBackdrop");
const ticketList = el("ticketList");
const alertEl = el("alert");
const searchMachine = el("searchMachine");
const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatStatus(status) {
  return STATUS_LABELS[status] || status || "-";
}

function ticketMatchesSearch(ticket, searchValue) {
  if (!searchValue) return true;

  const machineId = String(ticket.machine?.id || "").toUpperCase();
  const machineName = String(ticket.machine?.name || "").toUpperCase();
  const location = String(ticket.machine?.location || "").toUpperCase();

  return (
    machineId.includes(searchValue) ||
    machineName.includes(searchValue) ||
    location.includes(searchValue)
  );
}

function renderTickets() {
  const searchValue = searchMachine.value.trim().toUpperCase();
  const docs = allTickets.filter((ticket) => ticketMatchesSearch(ticket, searchValue));

  if (!searchValue) {
    ticketList.innerHTML = `<div class="empty">Type a machine ID, machine name, or location to search across all statuses.</div>`;
    return;
  }

  if (!docs.length) {
    ticketList.innerHTML = `<div class="empty">No tickets match your search.</div>`;
    return;
  }

  ticketList.innerHTML = docs.map((t) => {
    const latestPhotos = Array.isArray(t.latestPhotos) ? t.latestPhotos : [];

    return `
      <article class="ticket-card">
        <div class="ticket-head">
          <div>
            <h3 class="ticket-title">${escapeHtml(t.ticketId || "-")}</h3>
            <p class="ticket-sub">${escapeHtml(t.machine?.id || "-")} - ${escapeHtml(t.machine?.name || "-")}</p>
          </div>
          <span class="badge ${escapeHtml(t.status)}">${escapeHtml(formatStatus(t.status))}</span>
        </div>

        <div class="ticket-body">
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

          <aside class="ticket-photo-panel">
            <b>Photo Evidence</b>
            ${
              latestPhotos.length
                ? `
                  <div class="ticket-images">
                    ${latestPhotos.map((url) => `
                      <img
                        src="${escapeHtml(url)}"
                        data-url="${escapeHtml(url)}"
                        class="ticket-img previewable-img"
                        loading="lazy"
                        alt="Ticket photo evidence"
                      />
                    `).join("")}
                  </div>
                `
                : `<span>-</span>`
            }
          </aside>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".previewable-img").forEach((img) => {
    img.addEventListener("click", () => {
      const rawUrl = img.dataset.url;
      if (rawUrl) window.open(rawUrl, "_blank");
    });
  });
}

async function loadAllTickets() {
  ticketList.innerHTML = `<div class="empty">Loading tickets...</div>`;

  try {
    const q = query(collection(db, "tickets"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    allTickets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTickets();
  } catch (err) {
    console.error(err);
    ticketList.innerHTML = `<div class="empty">Failed to load tickets.</div>`;
    showAlert("Could not load tickets. Check Firestore indexes/rules.", "err");
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

searchMachine.addEventListener("input", renderTickets);

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
    await loadAllTickets();
    searchMachine.focus();
  } catch (err) {
    console.error(err);
    showAlert("Could not verify user access.", "err");
  }
});
