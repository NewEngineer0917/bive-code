import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBIrIGJgGfVvpRB84hPpFOAV-ATWM-wwCU",
  authDomain: "vibe-code-95c8c.firebaseapp.com",
  projectId: "vibe-code-95c8c",
  storageBucket: "vibe-code-95c8c.firebasestorage.app",
  messagingSenderId: "440276444009",
  appId: "1:440276444009:web:c9f45ca796196298ca53f8",
  measurementId: "G-3DL42NGD0K"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { auth };
