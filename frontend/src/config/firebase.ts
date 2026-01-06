import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyBuRfa47FdTj7kd4O6uNE-PmWiFEZfkRo4",
  authDomain: "tigon-iot.firebaseapp.com",
  projectId: "tigon-iot",
  storageBucket: "tigon-iot.firebasestorage.app",
  messagingSenderId: "470095494000",
  appId: "1:470095494000:web:2a26f0f8a2b7336608edb5",
  measurementId: "G-1VN3C3ZDBT"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export default app;
