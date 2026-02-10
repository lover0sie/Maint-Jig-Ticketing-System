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
    async function createTicket({ employeeName, problemDescription }) {
      const counterRef = doc(db, "counters", "tickets");

      // Transaction ensures sequence is safe under concurrency
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        let next = 1;

        if (snap.exists()) {
          const data = snap.data();
          next = typeof data.next === "number" ? data.next : 1;
        }

        const ticketNo = next;
        const ticketId = `T-${pad(ticketNo)}`;

        // increment counter
        tx.set(counterRef, { next: ticketNo + 1 }, { merge: true });

        // store ticket doc under tickets/{ticketId}
        const ticketRef = doc(db, "tickets", ticketId);

        tx.set(ticketRef, {
          ticketNo,
          ticketId,
          version: version || null,
          machine: {
            id: machineId || null,
            name: machineName || null,
            location: locationName || null
          },
          employeeName,
          problemDescription,
          status: "open",
          createdAt: serverTimestamp()
        });

        return { ticketNo, ticketId };
      });

      return result;
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
        setStatus(`Successfully submitted. Ticket created: ${ticketId}`, "ok");

        // optional: clear problem description but keep employee
        el("problemDescription").value = "";
      } catch (err) {
        console.error(err);
        setStatus("Submit failed. Check internet / Firebase rules / config.", "err");
      } finally {
        submitBtn.disabled = false;
      }
    });