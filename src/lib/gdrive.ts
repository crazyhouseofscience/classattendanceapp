// gdrive.ts
import { getDB } from './db';

// Use GIS for Google Drive API
const CLIENT_ID = (import.meta as any).env.VITE_CLIENT_ID || '293411564104-sbjgq7el71u13vhpj38irfqle0gbn86v.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

declare global {
  interface Window {
    google: any;
  }
}
declare const google: any;

let tokenClient: any;
let accessToken: string | null = null;

export function initGoogleIdentity() {
  if (!CLIENT_ID) {
    console.warn('VITE_CLIENT_ID not found. Google Drive integration will not work.');
    return;
  }
  
  if (window.google && window.google.accounts) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.access_token) {
          accessToken = response.access_token;
          // Trigger the waiting promise
          if (resolveToken) resolveToken(accessToken);
        } else {
          if (rejectToken) rejectToken(new Error('Failed to auth'));
        }
      },
    });
  }
}

let resolveToken: ((value: string) => void) | null = null;
let rejectToken: ((reason?: any) => void) | null = null;

export async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  if (!tokenClient) throw new Error('Google Identity Services not initialized. Missing VITE_CLIENT_ID?');

  return new Promise((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
    tokenClient.requestAccessToken();
  });
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
  // Actually, GIS usually needs a popup if not already authed.
  // We'll only attempt if accessToken is already set to avoid annoying popups every 5 seconds.
  if (!accessToken) return;

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
