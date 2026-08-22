// debug
console.log("report.js loaded once check:", location.href);

// ------------- Firebase SDK (Firestore) -------------
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
    import {
      getFirestore, doc, runTransaction, setDoc, serverTimestamp
    } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

    import {
      getStorage,
      ref,
      uploadBytes,
      getDownloadURL
    } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

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
    const storage = getStorage(app);

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

    const submitBtn = el("submitBtn");

    const alertEl = el("alert");

    const problemField = el("problemDescription");
    const charCount = el("charCount");

    problemField.addEventListener("input", () => {
      charCount.textContent = problemField.value.length;
    });

    function showAlert(msg, kind = "warn") {
      alertEl.textContent = msg;
      alertEl.className = `alert show ${kind}`; // kind: ok | err | warn
    }

    function clearAlert() {
      alertEl.textContent = "";
      alertEl.className = "alert";
    }

    function padSeq(num, size = 3) {
      return String(num).padStart(size, "0");
    }
    // ---------- Field changing if nearing limit -------------///
    problemField.addEventListener("input", () => {
    const len = problemField.value.length;
    charCount.textContent = len;

    if (len > 450) {
      charCount.style.color = "#b00020"; // red near limit
    } else {
      charCount.style.color = "";
    }
  });

    // ------------- Ticket creation (sequence + timestamp) -------------
    function getTodayDate() {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${year}${month}${day}`;
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

              resolve(new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, "") + ".jpg",
                {
                  type: "image/jpeg",
                  lastModified: Date.now()
                }
              ));
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

    async function generateTicketData() {
      const today = getTodayDate();
      const counterRef = doc(db, "counters", today);

      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);

        let next = 1;

        if (snap.exists()) {
          next = snap.data().next ?? 1;
        }

        tx.set(counterRef, { next: next + 1 }, { merge: true });

        const seq = padSeq(next);

        return {
          today,
          sequence: next,
          ticketId: `MCH-${today}-${seq}`
        };
      });
    }

    async function createTicket({
      ticketId,
      today,
      sequence,
      employeeName,
      problemDescription,
      photoUrls = []
    }) {

      return await runTransaction(db, async (tx) => {

        // create ticket
        const ticketRef = doc(db, "tickets", ticketId);

       tx.set(ticketRef, {
          ticketId,
          sequence,
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

          photos: photoUrls,
          latestPhotos: photoUrls,

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

    try {
      clearAlert();

      // validations INSIDE try so finally always runs
      if (!machineId || !machineName || !locationName) {
        showAlert("Missing machine details. Please scan the QR code again.", "err");
        return;
      }

      const employeeName = el("employeeName").value.trim();
      const problemDescription = el("problemDescription").value.trim();

      if (!employeeName) {
        showAlert("Please fill in Employee Name.", "err");
        el("employeeName").focus();
        return;
      }
      if (!problemDescription) {
        showAlert("Please describe the problem.", "err");
        el("problemDescription").focus();
        return;
      }

      showAlert("Submitting…", "warn");

      const { ticketId, today, sequence } = await generateTicketData();

      const imageInput = el("faultImage");
      const files = Array.from(imageInput.files || []);
      const photoUrls = [];

      if (files.length > 1) {
        showAlert("You can upload 1 photo only.", "err");
        return;
      }

      if (files.length === 1) {
        const file = files[0];

        if (!file.type.startsWith("image/")) {
          showAlert("Please upload image file only.", "err");
          return;
        }

        const compressedFile = await compressImage(file);

        const safeName = compressedFile.name.replace(/[^\w.-]+/g, "_");

        const filePath =
          `ticket_photos/${ticketId}/${Date.now()}_${safeName}`;

        const storageRef = ref(storage, filePath);

        await uploadBytes(storageRef, compressedFile, {
          contentType: "image/jpeg"
        });

        const downloadURL = await getDownloadURL(storageRef);

        photoUrls.push(downloadURL);
      }

      await createTicket({
        ticketId,
        today,
        sequence,
        employeeName,
        problemDescription,
        photoUrls
      });

       showAlert(`Successfully submitted. Ticket created: ${ticketId}`, "ok");

      // Telegram optional
      try {
        await sendTelegram({
          ticketId,
          machineId,
          machineName,
          location: locationName,
          employeeName,
          problemDescription,
          photoUrls
        });
      } catch (tgErr) {
        console.warn("Telegram failed:", tgErr);
        // keep success, optionally warn:
        // showAlert(`Ticket created: ${ticketId} (Telegram failed)`, "warn");
      }

      // optional clear before replace
      el("problemDescription").value = "";
      el("faultImage").value = "";

      document.querySelector(".card").innerHTML = `
        <h1>Report Submitted</h1>
        <p style="font-size:18px;margin-top:10px;">
          Ticket: <b>${ticketId}</b>
        </p>
        <p>Please inform maintenance if urgent.</p>
        <button class="btn" onclick="location.reload()">Submit Another</button>
      `;
    } catch (err) {
      console.error(err);
      showAlert("Submit failed. Check internet / Firebase rules / config.", "err");
    } finally {
      submitInFlight = false;
      submitBtn.disabled = false;
    }
  });

// ------------- Telegram (TEST ONLY) -------------
/* async function sendTelegram({ ticketId, machineId, machineName, location, employeeName, problemDescription }) {
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
}  */

// New telegram message

async function sendTelegram({
  ticketId,
  machineId,
  machineName,
  location,
  employeeName,
  problemDescription,
  photoUrls = []
}) {

  const BOT_TOKEN = "8241324978:AAEQqfxB9N75CTphOArUz41CxTJZ8rBgYtE"; // <-- replace after revoking old
  const CHAT_ID = "-5223901778";

  const caption =
    `*New Maintenance Ticket*\n\n` +
    `*Ticket:* ${ticketId}\n` +
    `*Machine:* ${machineId} — ${machineName}\n` +
    `*Location:* ${location}\n` +
    `*Reported by:* ${employeeName}\n\n` +
    `*Problem:*\n${problemDescription}\n\n` +
    `*Link:*\nhttps://lover0sie.github.io/Maint-Jig-Ticketing-System/maintenance-login.html`;

  // If image exists → send photo
  if (photoUrls.length > 0) {

    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          photo: photoUrls[0],
          caption: caption,
          parse_mode: "Markdown"
        })
      }
    );

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.description || "Telegram photo send failed");
    }

  } else {

    // fallback text only
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: caption,
          parse_mode: "Markdown"
        })
      }
    );

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.description || "Telegram message failed");
    }
  }
}