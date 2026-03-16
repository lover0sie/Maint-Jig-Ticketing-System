import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD8giDD5ClZ8qOmdpg9KiUm6iwZuBGZ11Y",
  authDomain: "maint-jig-ticketing-system.firebaseapp.com",
  projectId: "maint-jig-ticketing-system",
  storageBucket: "maint-jig-ticketing-system.firebasestorage.app",
  messagingSenderId: "277492702880",
  appId: "1:277492702880:web:e27883dc63a7078b2c73c5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };