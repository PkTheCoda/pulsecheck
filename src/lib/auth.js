import { signInWithPopup, signOut } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

export async function signInWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider);
  const user = credential.user;

  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  return user;
}

export async function signOutTeacher() {
  await signOut(auth);
}

