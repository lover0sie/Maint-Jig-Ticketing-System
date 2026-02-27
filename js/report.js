// ------------- Firebase SDK (Firestore) -------------
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
    import {
      getFirestore, doc, runTransaction, setDoc, serverTimestamp
    } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

    // Firebase config
    const firebaseConfig = {
        apiKey: "AIzaSyD8giDD5ClZ8qOmdpg9KiUm6iwZuBGZ11Y",
        authDomain: "maint-jig-ticketing-system.firebaseapp.com",
        projectId: "maint-jig-ticketing-system",
        storageBucket: "maint-jig-ticketing-system.firebasestorage.app",
        messagingSenderId: "277492702880",
        appId: "1:277492702880:web:e27883dc63a7078b2c73c5"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

// ------------- Read machine details from URL -------------
    const params = new URLSearchParams(location.search);
    const version = params.get("v") ?? "";
    const machineId = params.get("mid") ?? "";
    const machineName = params.get("name") ?? "";
    const locationName = params.get("loc") ?? "";

    const el = (id) => document.getElementById(id);
    el("vText").textContent = version || "-";
    el("midText").textContent = machineId || "-";
    el("nameText").textContent = machineName || "-";
    el("locText").textContent = locationName || "-";

    const statusEl = el("status");
    const submitBtn = el("submitBtn");

    function setStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className = "status " + (type === "ok" ? "ok" : type === "err" ? "err" : "");
    }

    function pad(num, size = 6) {
      const s = String(num);
      return s.length >= size ? s : "0".repeat(size - s.length) + s;
    }

    // ------------- Ticket creation (sequence + timestamp) -------------
    function getTodayDate() {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${year}${month}${day}`;
    }

    async function createTicket({ employeeName, problemDescription }) {

      const today = getTodayDate(); // 20260210
      const counterRef = doc(db, "counters", today);

      return await runTransaction(db, async (tx) => {

        const snap = await tx.get(counterRef);
        let next = 1;

        if (snap.exists()) {
          next = snap.data().next ?? 1;
        }

        const seq = pad(next); // 001
        const ticketId = `MCH-${today}-${seq}`;

        // update counter
        tx.set(counterRef, { next: next + 1 }, { merge:true });

        // create ticket
        const ticketRef = doc(db, "tickets", ticketId);

        tx.set(ticketRef, {
          ticketId: ticketId,
          sequence: next,
          date: today,

          version: version || null,
          machine: {
            id: machineId || null,
            name: machineName || null,
            location: locationName || null
          },

          employeeName,
          problemDescription,
          status: "OPEN",

          createdAt: serverTimestamp()
        });

        return { ticketId };
      });
    }


    // ------------- Form submit -------------
    el("form").addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!machineId || !machineName || !locationName) {
        setStatus("Missing machine details. Please scan the QR code again.", "err");
        return;
      }

      const employeeName = el("employeeName").value.trim();
      const problemDescription = el("problemDescription").value.trim();

      if (!employeeName || !problemDescription) {
        setStatus("Please fill Employee Name and Problem Description.", "err");
        return;
      }

      submitBtn.disabled = true;
      setStatus("Submitting…", "");

      try {
        const { ticketId } = await createTicket({ employeeName, problemDescription });

        await sendTelegram({
          ticketId,
          machineId,
          location: locationName,
          employeeName,
          problemDescription
        });
        setStatus(`Successfully submitted. Ticket created: ${ticketId}`, "ok");

        document.querySelector(".card").innerHTML = `
          <h1> Report Submitted</h1>
          <p style="font-size:18px;margin-top:10px;">
            Ticket: <b>${ticketId}</b>
          </p>
          <p>Please inform maintenance if urgent.</p>
          <button class="btn" onclick="location.reload()">Submit Another</button>
        `;

        // optional: clear problem description but keep employee
        el("problemDescription").value = "";
      } catch (err) {
        console.error(err);
        setStatus("Submit failed. Check internet / Firebase rules / config.", "err");
      } finally {
        submitBtn.disabled = false;
      }
    });


function padSeq(num, size = 3) {
  return String(num).padStart(size, "0");
}

// ------------- Telegram (TEST ONLY) -------------
async function sendTelegram({ ticketId, machineId, machineName, location, employeeName, problemDescription }) {
  const BOT_TOKEN = "8241324978:AAG5IWOW5GDaxQGmbE4w8okZM_o1YvAXnvw"; // <-- replace after revoking old
  const CHAT_ID = "-5223901778";

  const message =
    `🛠️ New Maintenance Ticket\n\n` +
    `Ticket: ${ticketId}\n` +
    `Machine: ${machineId} — ${machineName}\n` +
    `Location: ${location}\n` +
    `Reported by: ${employeeName}\n` +
    `Problem: ${problemDescription}`;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram send failed");
}

// ------------- Form submit -------------
el("form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!machineId || !machineName || !locationName) {
    setStatus("Missing machine details. Please scan the QR code again.", "err");
    return;
  }

  const employeeName = el("employeeName").value.trim();
  const problemDescription = el("problemDescription").value.trim();

  if (!employeeName || !problemDescription) {
    setStatus("Please fill Employee Name and Problem Description.", "err");
    return;
  }

  submitBtn.disabled = true;
  setStatus("Submitting…", "");

  let ticketId = "";

  try {
    // 1) Always create the ticket first
    ({ ticketId } = await createTicket({ employeeName, problemDescription }));

    // 2) Try Telegram, but don't fail the whole submit if Telegram fails
    try {
      await sendTelegram({
        ticketId,
        machineId,
        machineName,
        location: locationName,
        employeeName,
        problemDescription,
      });
    } catch (tgErr) {
      console.warn("Telegram failed:", tgErr);
      // show as info only
      setStatus(`Ticket created: ${ticketId}. (Telegram notification failed)`, "err");
    }

    // UI success
    if (statusEl.textContent.includes("Telegram notification failed")) {
      // keep your message already set
    } else {
      setStatus(`Successfully submitted. Ticket created: ${ticketId}`, "ok");
    }

    document.querySelector(".card").innerHTML = `
      <h1>Report Submitted</h1>
      <p style="font-size:18px;margin-top:10px;">
        Ticket: <b>${ticketId}</b>
      </p>
      <p>Please inform maintenance if urgent.</p>
      <button class="btn" onclick="location.reload()">Submit Another</button>
    `;

    el("problemDescription").value = "";
  } catch (err) {
    console.error(err);
    setStatus(
      ticketId
        ? `Ticket created: ${ticketId}, but something else failed.`
        : "Submit failed. Check internet / Firebase rules / config.",
      "err"
    );
  } finally {
    submitBtn.disabled = false;
  }
});