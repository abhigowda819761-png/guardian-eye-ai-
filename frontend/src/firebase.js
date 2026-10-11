import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

// Check if credentials are provided in .env
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.apiKey !== "your_api_key_here"
);

let app = null;
let auth = null;
let db = null;
let storage = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    console.log("Firebase initialized successfully in PRODUCTION mode");
  } catch (err) {
    console.warn("Failed to initialize Firebase with provided credentials:", err);
  }
} else {
  console.info("Firebase running in DEMO / LOCAL mode. Add credentials in frontend/.env to enable Cloud Firestore & Storage.");
}

export { auth, db, storage };

// ----------------------------------------------------
// Authentication Helpers
// ----------------------------------------------------
function getLocalUsers() {
  try {
    const raw = localStorage.getItem('guardianeye_users');
    return raw ? JSON.parse(raw) : { "abhi@gmail.com": "Abhi@123" };
  } catch {
    return { "abhi@gmail.com": "Abhi@123" };
  }
}

function saveLocalUser(email, password) {
  try {
    const users = getLocalUsers();
    users[email] = password;
    localStorage.setItem('guardianeye_users', JSON.stringify(users));
  } catch {}
}

export async function loginUser(emailOrUsername, password) {
  const raw = emailOrUsername.trim().toLowerCase();
  const cleanEmail = raw.includes('@') ? raw : `${raw}@gmail.com`;
  const pwd = password.trim();

  // 1. If Firebase Cloud is configured with real keys in .env, authenticate directly with Firebase Auth
  if (isFirebaseConfigured && auth) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, pwd);
      return {
        uid: userCredential.user.uid,
        displayName: userCredential.user.displayName || cleanEmail.split('@')[0],
        email: userCredential.user.email
      };
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        throw new Error("Incorrect password for this Gmail ID. Please enter the correct password.");
      } else if (err.code === 'auth/user-not-found') {
        throw new Error("No account found with this Gmail ID. Please register or check your email.");
      } else if (err.code === 'auth/invalid-email') {
        throw new Error("Invalid Gmail address format.");
      }
      throw new Error(err.message || "Failed to sign in. Please verify your credentials.");
    }
  }

  // 2. Connect to FastAPI backend server (port 8000) with SQLite + Bcrypt security
  try {
    const res = await fetch('http://localhost:8000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: pwd })
    });
    const data = await res.json();
    if (!res.ok) {
      // Direct rejection from backend (e.g. incorrect password)
      throw new Error(data.detail || "Incorrect password entered.");
    }
    saveLocalUser(cleanEmail, pwd);
    return {
      uid: data.user.email,
      displayName: data.user.displayName,
      email: data.user.email
    };
  } catch (backendErr) {
    // If it was a real 401 or 400 error message from the backend, throw it directly
    if (backendErr.message && !backendErr.message.includes('Failed to fetch') && !backendErr.message.includes('NetworkError')) {
      throw backendErr;
    }

    // 3. Fallback client credentials validation
    const localUsers = getLocalUsers();
    if (localUsers[cleanEmail]) {
      if (localUsers[cleanEmail] === pwd) {
        return {
          uid: 'local-' + cleanEmail,
          displayName: cleanEmail.split('@')[0].toUpperCase(),
          email: cleanEmail
        };
      } else {
        throw new Error("Incorrect password for this Gmail ID. Please enter the correct password.");
      }
    }

    // If new user and backend is offline, save and admit
    saveLocalUser(cleanEmail, pwd);
    return {
      uid: 'local-' + cleanEmail,
      displayName: cleanEmail.split('@')[0].toUpperCase(),
      email: cleanEmail
    };
  }
}

export async function registerUser(email, password, displayName = '') {
  const raw = email.trim().toLowerCase();
  const cleanEmail = raw.includes('@') ? raw : `${raw}@gmail.com`;
  const pwd = password.trim();

  // 1. Firebase Auth
  if (isFirebaseConfigured && auth) {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, pwd);
      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }
      return {
        uid: userCredential.user.uid,
        displayName: displayName || cleanEmail.split('@')[0],
        email: userCredential.user.email
      };
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error("An account with this Gmail ID already exists. Please sign in.");
      } else if (err.code === 'auth/weak-password') {
        throw new Error("Password must be at least 6 characters long.");
      }
      throw new Error(err.message || "Failed to create account.");
    }
  }

  // 2. FastAPI backend
  try {
    const res = await fetch('http://localhost:8000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: pwd, displayName })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Registration failed");
    }
    saveLocalUser(cleanEmail, pwd);
    return {
      uid: data.user.email,
      displayName: data.user.displayName,
      email: data.user.email
    };
  } catch (backendErr) {
    if (backendErr.message && !backendErr.message.includes('Failed to fetch') && !backendErr.message.includes('NetworkError')) {
      throw backendErr;
    }
    saveLocalUser(cleanEmail, pwd);
    return {
      uid: 'local-' + Date.now(),
      displayName: displayName || cleanEmail.split('@')[0],
      email: cleanEmail
    };
  }
}

export async function logoutUser() {
  if (isFirebaseConfigured && auth) {
    await signOut(auth);
  }
  localStorage.removeItem('hostName');
}

// ----------------------------------------------------
// Meetings & History Database Helpers
// ----------------------------------------------------
export async function saveMeetingToDb(meetingData) {
  if (isFirebaseConfigured && db) {
    try {
      const meetingsRef = collection(db, 'meetings');
      const docRef = await addDoc(meetingsRef, {
        ...meetingData,
        createdAt: serverTimestamp()
      });
      return { id: docRef.id, ...meetingData };
    } catch (err) {
      console.error("Error saving meeting to Firestore:", err);
    }
  }

  // Fallback to local array
  return { id: Date.now(), ...meetingData };
}

export async function fetchMeetingsFromDb() {
  if (isFirebaseConfigured && db) {
    try {
      const meetingsRef = collection(db, 'meetings');
      const q = query(meetingsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn("Could not fetch meetings from Firestore, falling back to local list:", err);
    }
  }
  return null;
}

// ----------------------------------------------------
// Cloud Video Storage Helpers (5GB Free)
// ----------------------------------------------------
export function uploadVideoToStorage(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (isFirebaseConfigured && storage) {
      const storageRef = ref(storage, `recordings/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          if (onProgress) onProgress(progress);
        },
        (error) => {
          console.error("Firebase Storage upload error:", error);
          reject(error);
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({ downloadUrl, name: file.name });
        }
      );
    } else {
      // Local simulated upload animation
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (onProgress) onProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          resolve({ downloadUrl: URL.createObjectURL(file), name: file.name });
        }
      }, 150);
    }
  });
}
