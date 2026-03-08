import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

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
