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
  
  if (!defaultSchedule || defaultSchedule.periods[0].endTime === '08:40' || defaultSchedule.periods[0].endTime === '08:45') {
    await db.put('schedules', {
      id: 'default',
      name: 'Regular Day',
      periods: [
        { name: 'Period 1', startTime: '08:00', endTime: '08:42' },
        { name: 'Period 2', startTime: '08:46', endTime: '09:28' },
        { name: 'HR', startTime: '09:28', endTime: '09:39' },
        { name: 'Period 3', startTime: '09:43', endTime: '10:25' },
        { name: 'Period 4', startTime: '10:29', endTime: '11:11' },
        { name: 'Period 5', startTime: '11:15', endTime: '11:57' },
        { name: 'Period 6', startTime: '12:01', endTime: '12:43' },
        { name: 'Period 7', startTime: '12:47', endTime: '13:29' },
        { name: 'Period 8', startTime: '13:33', endTime: '14:15' },
        { name: 'Period 9', startTime: '14:19', endTime: '15:01' },
      ],
    });
  }
  
  const activeSetting = await db.get('settings', 'activeScheduleId');
  if (!activeSetting) {
    await db.put('settings', { key: 'activeScheduleId', value: 'default' });
  }
}
