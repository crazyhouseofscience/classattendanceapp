import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Student {
  id: string; // Barcode is the primary key
  firstName: string;
  lastName: string;
  grade: string;
  notes: string;
  periods?: string[]; // Array of period names this student is assigned to
}

export interface PeriodConfig {
  name: string;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
}

export interface Schedule {
  id: string;
  name: string;
  periods: PeriodConfig[];
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, 2=Tue, etc
}

export interface ScanEvent {
  id: string;
  studentId: string;
  timestamp: number;
  date: string; // YYYY-MM-DD
  periodName: string;
  scheduleId: string;
  status: 'success' | 'unknown_barcode';
  isExcused?: boolean;
  manualStatus?: 'Present' | 'Late' | 'Absent';
  notes?: string;
  movementType?: 'Attendance' | 'Bathroom' | 'Nurse' | 'Office' | 'Guidance' | 'Returned';
}

export interface Settings {
  key: string;
  value: any;
}

interface AppDB extends DBSchema {
  students: {
    key: string;
    value: Student;
  };
  schedules: {
    key: string;
    value: Schedule;
  };
  scans: {
    key: string;
    value: ScanEvent;
    indexes: {
      'by-date': string;
      'by-student': string;
    };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>('barcode-scanner-db', 1, {
      upgrade(db) {
        db.createObjectStore('students', { keyPath: 'id' });
        db.createObjectStore('schedules', { keyPath: 'id' });
        
        const scanStore = db.createObjectStore('scans', { keyPath: 'id' });
        scanStore.createIndex('by-date', 'date');
        scanStore.createIndex('by-student', 'studentId');

        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

// Ensure default schedule exists
export async function initDefaultData() {
  const db = await getDB();
  const defaultSchedule = await db.get('schedules', 'default');
  if (!defaultSchedule) {
    await db.put('schedules', {
      id: 'default',
      name: 'Regular Day',
      periods: [
        { name: 'Period 1', startTime: '08:00', endTime: '08:45' },
        { name: 'Period 2', startTime: '08:50', endTime: '09:35' },
        { name: 'Period 3', startTime: '09:40', endTime: '10:25' },
        { name: 'Period 4', startTime: '10:30', endTime: '11:15' },
      ],
    });
  }
  
  const activeSetting = await db.get('settings', 'activeScheduleId');
  if (!activeSetting) {
    await db.put('settings', { key: 'activeScheduleId', value: 'default' });
  }
}
