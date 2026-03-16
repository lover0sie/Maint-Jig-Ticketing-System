import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";

const el = (id) => document.getElementById(id);

const loginForm = el("loginForm");
const employeeIdInput = el("employeeId");
const passwordInput = el("password");
const loginBtn = el("loginBtn");
const alertEl = el("alert");

function showAlert(msg, kind = "err") {
  alertEl.textContent = msg;
  alertEl.className = `alert show ${kind}`;
}

function clearAlert() {
  alertEl.textContent = "";
  alertEl.className = "alert";
}

const loadingOverlay = el("loadingOverlay");
const loadingText = el("loadingText");

function showLoading(message = "Loading...") {
  loadingText.textContent = message;
  loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  loadingOverlay.classList.add("hidden");
}

let loginInFlight = false;

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (loginInFlight) return;

  loginInFlight = true;
  loginBtn.disabled = true;

  try {
    clearAlert();

    const employeeId = employeeIdInput.value.trim();
    const password = passwordInput.value;

    if (!employeeId) {
      showAlert("Please enter Employee ID.", "err");
      employeeIdInput.focus();
      return;
    }

    if (!password) {
      showAlert("Please enter password.", "err");
      passwordInput.focus();
      return;
    }

    showLoading("Signing in...");

    const email = `${employeeId}@maintenance.local`;
    await setPersistence(auth, browserLocalPersistence);

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showAlert("User profile not found in Firestore.", "err");
      return;
    }

    const userData = userSnap.data();

    if (!userData.active) {
      showAlert("This account is inactive.", "err");
      return;
    }

    if (userData.role !== "maintenance") {
      showAlert("You do not have maintenance access.", "err");
      return;
    }

    showLoading("Login successful. Opening dashboard...");
    window.location.href = "maintenance-dashboard.html";  

  } catch (err) {
    console.error(err);
    hideLoading();

    if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
      showAlert("Invalid Employee ID or password.", "err");
    } else {
      showAlert("Login failed. Please try again.", "err");
    }
  } finally {
    loginInFlight = false;
    loginBtn.disabled = false;
    
  }
});