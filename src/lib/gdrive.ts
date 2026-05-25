// gdrive.ts
import { getDB } from './db';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;

export const initGoogleIdentity = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    currentUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;
  
  // If not cached, attempt to sign in or get token
  const result = await googleSignIn();
  if (result) return result.accessToken;
  throw new Error('Authentication failed');
}

export async function backupToDrive(isAuto = false) {
  try {
    const token = await getAccessToken();
    
    // 1. Gather all data
    const db = await getDB();
    const students = await db.getAll('students');
    const roster = await db.getAll('roster');
    const schedules = await db.getAll('schedules');
    const scans = await db.getAll('scans');
    const behaviors = await db.getAll('behaviors');
    const settings = await db.getAll('settings');
    
    const exportData = {
      students,
      roster,
      schedules,
      scans,
      behaviors,
      settings,
      exportDate: new Date().toISOString(),
      version: '1.2'
    };
    
    const fileContent = JSON.stringify(exportData, null, 2);
    const file = new Blob([fileContent], { type: 'application/json' });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = isAuto 
      ? `AUTO_backup_${timestamp}.json` 
      : `manual_backup_${new Date().toISOString().split('T')[0]}.json`;

    const metadata = {
      name: fileName,
      mimeType: 'application/json',
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const params = new URLSearchParams();
    params.append('uploadType', 'multipart');

    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form
    });
    
    if (!res.ok) {
      throw new Error('Failed to upload to Google Drive');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Drive backup failed:', error);
    throw error;
  }
}

let backupTimeout: any = null;

export function triggerAutoBackup(delayMs = 5000) {
  // Check if we have a token or at least attempt to get one silently?
  // We'll only attempt if cachedAccessToken is already set to avoid annoying popups every 5 seconds.
  if (!cachedAccessToken) return;

  if (backupTimeout) clearTimeout(backupTimeout);
  backupTimeout = setTimeout(async () => {
    try {
      await backupToDrive(true);
      console.log('Auto-backup complete');
    } catch (e) {
      console.warn('Auto-backup failed:', e);
    }
  }, delayMs);
}
