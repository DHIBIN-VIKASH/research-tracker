import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ============================================================================
// Firebase configuration — research-tracker-sync-9a424
// ============================================================================
//
// Project : research-tracker-sync-9a424   (display name: research-tracker-sync)
// Owner   : dhibinvikash1@gmail.com
// Region  : asia-south1 (Mumbai) — chosen for latency from India, PERMANENT
// Created : replaces the older r-tracker-e507e project
//
// NOTE ON `apiKey`: this is NOT a secret. Firebase web API keys are public
// identifiers by design — they identify the project, they do not authorise
// anything. Committing this to a public repo is normal and expected.
//
// What DOES protect the data is firestore.rules. The previous project had the
// same public config but effectively no rules, which meant anyone who read the
// repo could download or overwrite every paper. That is closed here: writes are
// gated on Firebase Auth (isEditor(), see firestore.rules) — only signed-in
// editors on the allowlist can write, and the daily sync writes via the Admin
// SDK (which bypasses rules by design regardless).
//
// If you ever see the dashboard's add/edit buttons fail, that means you are
// not signed in as an editor — see the "Sign in" control in the top bar.
// ============================================================================

const firebaseConfig = {
    apiKey: "AIzaSyB83pimvOCPPIrz_ivIAqEwrQBL1fPYucI",
    authDomain: "research-tracker-sync-9a424.firebaseapp.com",
    projectId: "research-tracker-sync-9a424",
    storageBucket: "research-tracker-sync-9a424.firebasestorage.app",
    messagingSenderId: "130888728408",
    appId: "1:130888728408:web:c085eb1e068d1b68642f2d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export {
    db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy,
    auth, googleProvider, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
};