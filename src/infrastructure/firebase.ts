import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
 apiKey: "AIzaSyB55OA7v8uY9FjPHOQb1ZBoVumhywhbR4U",
 authDomain: "saidalete.firebaseapp.com",
 projectId: "saidalete",
 storageBucket: "saidalete.firebasestorage.app",
 messagingSenderId: "913291699685",
 appId: "1:913291699685:web:0ffe68938d83506ef17b0c",
 measurementId: "G-Q5PLKKFJ1B"
};

export const isFirebaseConfigured = true;
export { firebaseConfig };

let app;
let auth: any = null;
let db: any = null;

try {
 app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
 auth = getAuth(app);
 // explicitly configure persistence
 db = initializeFirestore(app, {
 localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
 });
} catch (err) {
 console.warn("Firebase initialization failed:", err);
 if (app) {
 db = getFirestore(app);
 }
}

export { auth, db, app };
