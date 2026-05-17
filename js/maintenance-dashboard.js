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
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { auth, db } from "./firebase.js";

const el = (id) => document.getElementById(id);

const storage = getStorage();

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

const sideUserInitial = el("sideUserInitial");
const sideUserName = el("sideUserName");
const sideUserEmail = el("sideUserEmail");
const logoutBtn = el("logoutBtn");
const menuToggle = el("menuToggle");
const sidebarBackdrop = el("sidebarBackdrop");
const ticketList = el("ticketList");
const alertEl = el("alert");
const dashboardTitle = el("dashboardTitle");

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
const searchMachine = el("searchMachine");
const clearFiltersBtn = el("clearFiltersBtn");

const evidencePhotos = el("evidencePhotos");
const selectedPhotoList = el("selectedPhotoList");

const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");

const imagePreviewModal = el("imagePreviewModal");
const previewLargeImage = el("previewLargeImage");
const closeImagePreview = el("closeImagePreview");

const updateDate = el("updateDate");
const updateTime = el("updateTime");

let currentUserProfile = null;
const requestedStatus = new URLSearchParams(window.location.search).get("status");
let currentStatusFilter = STATUS_LABELS[requestedStatus] ? requestedStatus : "OPEN";
let selectedTicket = null;
let saveInFlight = false;
let selectedPhotoFiles = [];
let alertTimeout = null;

const UPDATE_LOADING_MIN_MS = 2200;
const UPDATE_SUCCESS_MS = 2800;
const UPDATE_ERROR_MS = 2800;

function formatStoredDate(dateStr) {
  if (!dateStr) return "-";

  const d = new Date(dateStr);

  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function getCurrentDateMY() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur"
  });
}

function getCurrentTimeMY() {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}


function openImagePreview(url) {
  previewLargeImage.src = url;
  imagePreviewModal.classList.remove("hidden");
}

function closeImagePreviewModal() {
  previewLargeImage.src = "";
  imagePreviewModal.classList.add("hidden");
}

closeImagePreview.addEventListener("click", closeImagePreviewModal);

imagePreviewModal.addEventListener("click", (e) => {
  if (e.target === imagePreviewModal) {
    closeImagePreviewModal();
  }
});

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
  loadingOverlay.classList.remove("success");
  loadingOverlay.classList.remove("error");
  loadingOverlay.classList.remove("hidden");
}

function showSuccessLoading(message = "Ticket updated successfully.") {
  loadingText.textContent = message;
  loadingOverlay.classList.remove("error");
  loadingOverlay.classList.add("success");
  loadingOverlay.classList.remove("hidden");
}

function showErrorLoading(message = "Failed to update ticket.") {
  loadingText.textContent = message;
  loadingOverlay.classList.remove("success");
  loadingOverlay.classList.add("error");
  loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  loadingOverlay.classList.remove("success");
  loadingOverlay.classList.remove("error");
  loadingOverlay.classList.add("hidden");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMinimumDuration(startTime, minDurationMs) {
  const elapsed = Date.now() - startTime;
  if (elapsed < minDurationMs) {
    await wait(minDurationMs - elapsed);
  }
}

function setActiveStatusFilter(status) {
  currentStatusFilter = status;
  const title = getStatusTitle(status);

  if (dashboardTitle) dashboardTitle.textContent = title;
  document.title = title;

  document.querySelectorAll(".chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === status);
  });
}


function showAlert(msg, kind = "err", duration = 30000) {
  clearTimeout(alertTimeout);

  alertEl.textContent = msg;
  alertEl.className = `alert show ${kind}`;

  alertTimeout = setTimeout(() => {
    clearAlert();
  }, duration);
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

function getStatusTitle(status) {
  return `${formatStatus(status)} Tickets`;
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

async function compressImage(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };

    img.onload = () => {
      const canvas = document.createElement("canvas");

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Image compression failed."));
            return;
          }

          const compressedFile = new File(
            [blob],
            file.name.replace(/\.[^/.]+$/, "") + ".jpg",
            {
              type: "image/jpeg",
              lastModified: Date.now()
            }
          );

          resolve(compressedFile);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = reject;
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderSelectedPhotos() {
  if (!selectedPhotoList) return;

  if (!selectedPhotoFiles.length) {
    selectedPhotoList.innerHTML = "";
    return;
  }

  selectedPhotoList.innerHTML = selectedPhotoFiles.map((file, index) => `
    <div class="selected-photo-item">
      <div class="selected-photo-text">
        Picture - ${escapeHtml(file.name)} selected
      </div>
      <button
        type="button"
        class="remove-photo-btn"
        data-index="${index}"
      >
        Remove
      </button>
    </div>
  `).join("");

  selectedPhotoList.querySelectorAll(".remove-photo-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeSelectedPhoto(Number(btn.dataset.index));
    });
  });
}

function syncEvidencePhotosInput() {
  const dt = new DataTransfer();
  selectedPhotoFiles.forEach((file) => dt.items.add(file));
  evidencePhotos.files = dt.files;
}

function removeSelectedPhoto(removeIndex) {
  selectedPhotoFiles = selectedPhotoFiles.filter((_, index) => index !== removeIndex);
  syncEvidencePhotosInput();
  renderSelectedPhotos();
}


async function openModal(ticket) {
  selectedTicket = ticket;

  modalTicketId.textContent = ticket.ticketId || "-";
  modalMachine.textContent = `${ticket.machine?.id || "-"} — ${ticket.machine?.name || "-"}`;
  modalLocation.textContent = ticket.machine?.location || "-";

  actionTaken.value = "";
  actionCount.textContent = "0";
  evidencePhotos.value = "";

  populateStatusOptions(ticket.status || "OPEN");

  const isClosed = ticket.status === "CLOSED";
  actionTaken.disabled = isClosed;
  saveUpdateBtn.disabled = isClosed;
  evidencePhotos.disabled = isClosed;

  selectedPhotoFiles = [];
  evidencePhotos.value = "";
  renderSelectedPhotos();

  updateModal.classList.remove("hidden");
  await loadTicketTimeline(ticket.id, ticket);

  setSidebarOpen(false);
  document.body.classList.add("modal-open");
  document.body.style.overflow = "hidden";

  updateDate.value = getCurrentDateMY();
  updateTime.value = getCurrentTimeMY().slice(0, 5);
}

function closeModal() {
  selectedTicket = null;
  updateForm.reset();
  actionCount.textContent = "0";
  selectedPhotoFiles = [];
  evidencePhotos.value = "";
  renderSelectedPhotos();
  document.body.classList.remove("modal-open");
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
    setActiveStatusFilter(btn.dataset.status);
    setSidebarOpen(false);
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

    // Search by machine ID, machine name, or location
    const searchValue = searchMachine ? searchMachine.value.trim().toUpperCase() : "";

    if (searchValue) {
      docs = docs.filter((t) => {
        const machineId = String(t.machine?.id || "").toUpperCase();
        const machineName = String(t.machine?.name || "").toUpperCase();
        const location = String(t.machine?.location || "").toUpperCase();

        return (
          machineId.includes(searchValue) ||
          machineName.includes(searchValue) ||
          location.includes(searchValue)
        );
      });
}

    if (!docs.length) {
      ticketList.innerHTML = `<div class="empty">No tickets match the selected filters.</div>`;
      return;
    }

    ticketList.innerHTML = docs.map((t) => {
    const latestPhotos = Array.isArray(t.latestPhotos) ? t.latestPhotos : [];
    const line = t.machine?.location || "";

    return `
      <article class="ticket-card" data-line="${escapeHtml(line)}">
        <div class="ticket-head">
          <div>
            <h3 class="ticket-title">${escapeHtml(t.ticketId || "-")}</h3>
            <p class="ticket-sub">${escapeHtml(t.machine?.id || "-")} — ${escapeHtml(t.machine?.name || "-")}</p>
          </div>
          <span class="badge ${escapeHtml(t.status)}">${escapeHtml(formatStatus(t.status || "-"))}</span>
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

        <div class="ticket-actions">
          <button class="btn open-ticket-btn" data-ticket-id="${escapeHtml(t.ticketId)}">Update Status</button>
        </div>
      </article>
    `;
  }).join("");

      document.querySelectorAll(".previewable-img").forEach((img) => {
      img.addEventListener("click", () => {
        const rawUrl = img.dataset.url;
        if (rawUrl) {
          openImagePreview(rawUrl);
        }
      });
    });

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
      createdAt: ticketData.createdAt,
      photos: ticketData.photos || []
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
        type: d.status,
        title: formatStatus(d.status),
        by: d.updatedByName,
        text: d.actionTaken,
        createdAt: d.createdAt,
        updateDate: d.updateDate,
        updateTime: d.updateTime,
        photos: d.photos || []
      });
    });

    if (!items.length) {
      timelineEl.innerHTML = `<div class="empty">No history available.</div>`;
      return;
    }

    timelineEl.innerHTML = items.map((item) => {
      const dt = formatDateTime(item.createdAt);

      const displayDate = item.updateDate
          ? formatStoredDate(item.updateDate)
          : dt.date;
      const displayTime = item.updateTime || dt.time;
      return `
        <div class="timeline-item">
          <div class="timeline-time">
            <div class="timeline-date">${escapeHtml(displayDate)}</div>
            <div class="timeline-hour">${escapeHtml(displayTime)}</div>
          </div>

          <div class="timeline-track">
            <div class="timeline-dot ${escapeHtml(item.type)}"></div>
            <div class="timeline-line"></div>
          </div>

          <div class="timeline-content">
           ${item.photos?.length ? `
            <div class="timeline-images">
              ${item.photos.map(url => `
               <img 
                  src="${escapeHtml(url)}" 
                  data-url="${escapeHtml(url)}"
                  class="timeline-img previewable-img"
                  loading="lazy"
                />
              `).join("")}
            </div>
            ` : ""}
            <div class="timeline-title">${escapeHtml(item.title)}</div>
            <div class="timeline-meta">${escapeHtml(item.by)}</div>
            <div class="timeline-text">${escapeHtml(item.text)}</div>
          </div>
        </div>
      `;
    }).join("");
    timelineEl.querySelectorAll(".previewable-img").forEach((img) => {
      img.addEventListener("click", () => {
        const url = img.dataset.url;
        if (url) openImagePreview(url);
      });
    });
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

if (filterDate) {
  filterDate.addEventListener("change", async () => {
    await loadTickets(currentStatusFilter);
  });
}

if (searchMachine) {
  searchMachine.addEventListener("input", async () => {
    await loadTickets(currentStatusFilter);
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener("click", async () => {
    if (filterDate) filterDate.value = "";
    if (searchMachine) searchMachine.value = "";
    await loadTickets(currentStatusFilter);
  });
}

updateForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const selectedUpdateDate = updateDate.value;
  const selectedUpdateTime = updateTime.value;

  if (!selectedUpdateDate) {
    showAlert("Please select update date.", "err");
    updateDate.focus();
    return;
  }

  if (!selectedUpdateTime) {
    showAlert("Please select update time.", "err");
    updateTime.focus();
    return;
  }

  if (!selectedTicket || saveInFlight) return;
  if (selectedTicket.status === "CLOSED") {
    saveUpdateBtn.disabled = true;
    return;
  }

  saveInFlight = true;
  saveUpdateBtn.disabled = true;
  let updateStartedAt = null;

  try {
    clearAlert();

    const newStatus = updateStatus.value;
    const action = actionTaken.value.trim();

    if (!action) {
      showAlert("Please enter action taken.", "err");
      actionTaken.focus();
      return;
    }

    const files = Array.from(evidencePhotos.files || []);
    const photoUrls = [];
    const MAX_SIZE_MB = 2;


    if (files.length > 1) {
      showAlert("You can upload 1 photo only.", "err");
      return;
    }

    updateStartedAt = Date.now();
    showLoading(`Updating ticket ${selectedTicket.ticketId}...`);

      for (const file of files) {
        const compressedFile = await compressImage(file);

        const safeName = compressedFile.name.replace(/[^\w.-]+/g, "_");
        const filePath = `ticket_photos/${selectedTicket.ticketId}/${Date.now()}_${safeName}`;

        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, compressedFile, {
          contentType: "image/jpeg"
        });

        const downloadURL = await getDownloadURL(storageRef);
        photoUrls.push(downloadURL);
      }

    const updateDate = getCurrentDateMY();
    const updateTime = getCurrentTimeMY();

    await addDoc(collection(db, "tickets", selectedTicket.id, "updates"), {
      status: newStatus,
      actionTaken: action,
      updatedByUid: auth.currentUser.uid,
      updatedByEmployeeId: currentUserProfile.employeeId || currentUserProfile.employeeID,
      updatedByName: currentUserProfile.name,
      createdAt: serverTimestamp(),
      updateDate: selectedUpdateDate,
      updateTime: selectedUpdateTime,
      photos: photoUrls
    });

    const payload = {
      status: newStatus,
      assignedTo: currentUserProfile.employeeId || currentUserProfile.employeeID,
      assignedToName: currentUserProfile.name,
      latestAction: action,
      latestUpdatedBy: currentUserProfile.employeeId || currentUserProfile.employeeID,
      latestUpdatedByName: currentUserProfile.name,
      latestUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      latestPhotos: photoUrls
    };

    await updateDoc(doc(db, "tickets", selectedTicket.id), payload);

    await waitForMinimumDuration(updateStartedAt, UPDATE_LOADING_MIN_MS);
    showSuccessLoading(`Ticket ${selectedTicket.ticketId} updated successfully.`);
    await wait(UPDATE_SUCCESS_MS);

    closeModal();
    setActiveStatusFilter(newStatus);
    await loadStatusCounts();
    await loadTickets(newStatus);

  } catch (err) {
    console.error("SAVE UPDATE FAILED:", err);
    if (updateStartedAt) {
      await waitForMinimumDuration(updateStartedAt, UPDATE_LOADING_MIN_MS);
      showErrorLoading("Failed to update ticket.");
      await wait(UPDATE_ERROR_MS);
    }
    showAlert(`Failed to save ticket update: ${err.message}`, "err");
  } finally {
    hideLoading();
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
    if (sideUserInitial) sideUserInitial.textContent = (profile.name || "M").trim().charAt(0).toUpperCase();
    if (sideUserName) sideUserName.textContent = profile.name || "Maintenance";
    if (sideUserEmail) sideUserEmail.textContent = user.email || profile.email || profile.employeeId || "Maintenance";

    setActiveStatusFilter(currentStatusFilter);
    await loadStatusCounts();
    await loadTickets(currentStatusFilter);
  } catch (err) {
    console.error(err);
    showAlert("Could not verify user access.", "err");
  }
});

evidencePhotos.addEventListener("change", () => {
  clearAlert();

  const files = Array.from(evidencePhotos.files || []);

  if (!files.length) {
    selectedPhotoFiles = [];
    renderSelectedPhotos();
    return;
  }

  const file = files[0];

  if (!file.type.startsWith("image/")) {
    showAlert("Please upload image file only.", "err");
    evidencePhotos.value = "";
    selectedPhotoFiles = [];
    renderSelectedPhotos();
    return;
  }

  selectedPhotoFiles = [file];
  syncEvidencePhotosInput();
  renderSelectedPhotos();
});


