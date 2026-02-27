// debug
console.log("report.js loaded once check:", location.href);

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

    function padSeq(num, size = 3) {
      return String(num).padStart(size, "0");
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

      const today = getTodayDate(); // get today's date
      const counterRef = doc(db, "counters", today); // refer to the counter database

      return await runTransaction(db, async (tx) => {

        const snap = await tx.get(counterRef);
        let next = 1;

        if (snap.exists()) {
          next = snap.data().next ?? 1;
        }

        const seq = padSeq(next); // 001
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

    let submitInFlight = false;

    el("form").addEventListener("submit", async (e) => {
      e.preventDefault();

      if (submitInFlight) return;
      submitInFlight = true;
      submitBtn.disabled = true;


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

        // try Telegram but don't fail submit if Telegram fails
        try {
          await sendTelegram({
            ticketId,
            machineId,
            machineName,               
            location: locationName,
            employeeName,
            problemDescription
          });
        } catch (e) {
          console.warn("Telegram failed:", e);
        }

        //  clear BEFORE replace the card
        el("problemDescription").value = "";

        setStatus(`Successfully submitted. Ticket created: ${ticketId}`, "ok");

        document.querySelector(".card").innerHTML = `
          <h1> Report Submitted</h1>
          <p style="font-size:18px;margin-top:10px;">
            Ticket: <b>${ticketId}</b>
          </p>
          <p>Please inform maintenance if urgent.</p>
          <button class="btn" onclick="location.reload()">Submit Another</button>
        `;
                
      } catch (err) {
        console.error(err);
        setStatus("Submit failed. Check internet / Firebase rules / config.", "err");
      } finally {
        submitInFlight = false;
        submitBtn.disabled = false;
      }
    });

// ------------- Telegram (TEST ONLY) -------------
async function sendTelegram({ ticketId, machineId, machineName, location, employeeName, problemDescription }) {
  const BOT_TOKEN = "8241324978:AAGL8f_LqUmXPtwrmxSB2v6rKx0Tuv6jVl0"; // <-- replace after revoking old
  const CHAT_ID = "-5223901778";

  const message =
    `New Maintenance Ticket\n\n` +
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