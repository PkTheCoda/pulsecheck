import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCFWyCMtpB424ycskFoNCZlboOUY0ZTaAU",
  authDomain: "pulsecheck-fa8a4.firebaseapp.com",
  projectId: "pulsecheck-fa8a4",
  storageBucket: "pulsecheck-fa8a4.firebasestorage.app",
  messagingSenderId: "118921749958",
  appId: "1:118921749958:web:47db5d728d0f13347abec7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

