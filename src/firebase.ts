import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCY2SeICQqmZQAfEfboqkQPbr0uWqi0sx4',
  authDomain: 'scvampire.firebaseapp.com',
  projectId: 'scvampire',
  storageBucket: 'scvampire.firebasestorage.app',
  messagingSenderId: '1036752058185',
  appId: '1:1036752058185:web:f20480d4e248afdb9e0c98',
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Ensure the current user has a Firebase UID (anonymous or Google).
 * Called before any Firestore write so security rules can check request.auth.
 */
export async function ensureAuth(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}
