import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from './ui/card';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { getDB, Student, ScanEvent, Schedule, BehaviorEvent } from '../lib/db';
import { triggerAutoBackup } from '../lib/gdrive';
import { format } from 'date-fns';
import { CheckCircle, XCircle, AlertTriangle, Clock, Edit2, FileText, Star, Smile, Frown, MessageSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from './ui/dialog';
import { Input } from './ui/input';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup
} from './ui/dropdown-menu';

interface ScannerTabProps {
  activeScheduleId: string | null;
  activePeriodName: string | null;
  activeSchedule?: Schedule;
}

const DEFAULT_BEHAVIORS = [
  { id: 'b1', name: 'On Task', points: 1, type: 'Positive' },
  { id: 'b2', name: 'Helping Others', points: 1, type: 'Positive' },
  { id: 'b3', name: 'Great Answer', points: 1, type: 'Positive' },
  { id: 'b4', name: 'Off Task', points: -1, type: 'Negative' },
  { id: 'b5', name: 'Disrespect', points: -2, type: 'Negative' },
  { id: 'b6', name: 'Unprepared', points: -1, type: 'Negative' },
  { id: 'b7', name: 'Late', points: -1, type: 'Negative' },
  { id: 'b8', name: 'Bathroom', points: 0, type: 'Neutral' },
  { id: 'b9', name: 'Nurse', points: 0, type: 'Neutral' },
  { id: 'b10', name: 'Office', points: 0, type: 'Neutral' }
];

export function ScannerTab({ activeScheduleId, activePeriodName, activeSchedule }: ScannerTabProps) {
  const [barcode, setBarcode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [lastScan, setLastScan] = useState<{ student: Student | null, barcode?: string, status: 'success' | 'unknown_barcode' | 'not_in_period', timestamp: number } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [scans, setScans] = useState<(ScanEvent & { studentInfo?: Student })[]>([]);
  const [behaviors, setBehaviors] = useState(DEFAULT_BEHAVIORS);
  const [gracePeriod, setGracePeriodState] = useState(5);
  const [scanReason, setScanReason] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recentScans, setRecentScans] = useState<(ScanEvent & { studentInfo?: Student })[]>([]);

  const [editingScanId, setEditingScanId] = useState<string | null>(null);
  const [editingTimeStr, setEditingTimeStr] = useState<string>('');
  
  const [noteStudent, setNoteStudent] = useState<Student | null>(null);
  const [noteText, setNoteText] = useState('');

  const [isFocused, setIsFocused] = useState(false);
  const [windowFocused, setWindowFocused] = useState(true);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [view, setView] = useState<'attendance' | 'movement'>('attendance');

  const [sortBy, setSortBy] = useState<'firstName' | 'lastName' | 'status' | 'rank' | 'id' | 'time'>('lastName');
  const [behaviorsHistory, setBehaviorsHistory] = useState<BehaviorEvent[]>([]);
  const [markArrivalTime, setMarkArrivalTime] = useState(format(new Date(), 'HH:mm'));
  const [elapsedTime, setElapsedTime] = useState<string>('00:00');
  const [manualStartTimeInternal, setManualStartTimeInternal] = useState<string | null>(null);
  const [manualEndTimeInternal, setManualEndTimeInternal] = useState<string | null>(null);

  const getOverrideKey = () => `override_${viewDate}_${activeScheduleId}_${activePeriodName}`;
  const getOverrideEndKey = () => `override_end_${viewDate}_${activeScheduleId}_${activePeriodName}`;

  const trackBehavior = async (studentId: string, behavior: { name: string, points: number, type: string }, notes?: string) => {
    const db = await getDB();
    const newBehavior: BehaviorEvent = {
        id: `behavior_${studentId}_${Date.now()}`,
        studentId,
        timestamp: Date.now(),
        date: format(new Date(), 'yyyy-MM-dd'),
        type: behavior.type as any,
        category: behavior.name,
        points: behavior.points,
        notes,
        periodName: activePeriodName
    };
    await db.put('behaviors', newBehavior);
  };

  const addNote = async () => {
    if (!noteStudent || !noteText.trim()) return;
    const db = await getDB();
    const newBehavior: BehaviorEvent = {
        id: `note_${noteStudent.id}_${Date.now()}`,
        studentId: noteStudent.id,
        timestamp: Date.now(),
        date: format(new Date(), 'yyyy-MM-dd'),
        type: 'Neutral',
        category: 'Note',
        points: 0,
        notes: noteText,
        periodName: activePeriodName
    };
    await db.put('behaviors', newBehavior);
    setNoteStudent(null);
    setNoteText('');
    toast.success('Note added.');
  };

  const openEditTime = (scanId: string, currentTimeMs: number) => {
     setEditingScanId(scanId);
     const d = new Date(currentTimeMs);
     const h = d.getHours().toString().padStart(2, '0');
     const m = d.getMinutes().toString().padStart(2, '0');
     setEditingTimeStr(`${h}:${m}`);
  };

  const saveEditTime = async () => {
    if (!editingScanId || !editingTimeStr) return;
    const db = await getDB();
    const scan = await db.get('scans', editingScanId);
    if (scan) {
       const [h, m] = editingTimeStr.split(':').map(Number);
       const d = new Date(scan.timestamp);
       d.setHours(h, m, 0, 0);
       scan.timestamp = d.getTime();
       await db.put('scans', scan);
       await loadData();
       toast.success('Time updated manually.');
    }
    setEditingScanId(null);
  };

  async function loadSettings() {
    const db = await getDB();
    const gpSetting = await db.get('settings', 'grace_period');
    if (gpSetting) setGracePeriodState(gpSetting.value);
    
    const customBehaviors = await db.get('settings', 'custom_behaviors');
    if (customBehaviors) setBehaviors(customBehaviors.value);

    const key = getOverrideKey();
    const endKey = getOverrideEndKey();
    const startSetting = await db.get('settings', key);
    const endSetting = await db.get('settings', endKey);
    setManualStartTimeInternal(startSetting?.value || null);
    setManualEndTimeInternal(endSetting?.value || null);
  }

  const setGracePeriod = async (val: number) => {
    const db = await getDB();
    await db.put('settings', { key: 'grace_period', value: val });
    setGracePeriodState(val);
  };

  useEffect(() => {
    const loadScannerSetting = async () => {
      const db = await getDB();
      const setting = await db.get('settings', 'scanner_enabled');
      if (setting !== undefined) setScannerEnabled(setting.value);
    };
    loadScannerSetting();
  }, []);

  const toggleScanner = async () => {
    const newValue = !scannerEnabled;
    setScannerEnabled(newValue);
    const db = await getDB();
    await db.put('settings', { key: 'scanner_enabled', value: newValue });
    if (newValue) {
      toast.success('Scanner focus alerts enabled');
    } else {
      toast.warning('Scanner focus alerts disabled');
    }
  };

  useEffect(() => {
    const handleFocus = () => setWindowFocused(true);
    const handleBlur = () => setWindowFocused(false);
    
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    
    return () => {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const isReady = activePeriodName && activePeriodName !== 'all' && activeScheduleId;
  const currentPeriodConfig = activeSchedule?.periods.find(p => p.name === activePeriodName);

  const getStudentStatus = (student: Student) => {
     // Attendance status is based on the EARLIEST Attendance scan
     const studentScans = scans.filter(s => 
       s.studentId === student.id && 
       (s.movementType === 'Attendance' || (!s.movementType && !['Bathroom', 'Nurse', 'Office', 'Guidance', 'Water', 'Returned'].includes(s.notes || '')))
     );
     // scans is sorted descending, so the earliest is the last element
     const scan = studentScans[studentScans.length - 1];

     if (!scan) return { status: 'Absent', text: 'Absent', time: null, scanId: null, leftEarly: false };
     
     const leftEarly = !!scan.leftEarly;
     
     if (scan.manualStatus) {
        return { 
          status: scan.manualStatus as any, 
          text: scan.manualStatus, 
          time: scan.timestamp, 
          excused: !!scan.isExcused, 
          noPass: !!scan.hasNoPass, 
          scanId: scan.id,
          leftEarly
        };
     }

     const effectiveStartTime = manualStartTime || currentPeriodConfig?.startTime;

     if (effectiveStartTime) {
         const [baseH, baseM] = effectiveStartTime.split(':').map(Number);
         const baseMinutes = baseH * 60 + baseM;
         const cutoffMinutes = baseMinutes + gracePeriod;

         const scanDate = new Date(scan.timestamp);
         const scanH = scanDate.getHours();
         const scanM = scanDate.getMinutes();
         const scanMinutes = scanH * 60 + scanM;

         if (scanMinutes > cutoffMinutes) {
             return { status: 'Late', text: 'Late', time: scan.timestamp, excused: !!scan.isExcused, noPass: !!scan.hasNoPass, scanId: scan.id, leftEarly };
         }
     }
     
     return { status: 'OnTime', text: 'On Time', time: scan.timestamp, excused: !!scan.isExcused, noPass: !!scan.hasNoPass, scanId: scan.id, leftEarly };
  };

  const setManualStartTime = async (time: string | null) => {
    const key = getOverrideKey();
    const db = await getDB();
    if (time) await db.put('settings', { key, value: time });
    else await db.delete('settings', key);
    setManualStartTimeInternal(time);
  };

  const setManualEndTime = async (time: string | null) => {
    const key = getOverrideEndKey();
    const db = await getDB();
    if (time) await db.put('settings', { key, value: time });
    else await db.delete('settings', key);
    setManualEndTimeInternal(time);
  };

  const manualStartTime = manualStartTimeInternal;
  const manualEndTime = manualEndTimeInternal;

  useEffect(() => {
    loadSettings();
  }, [activePeriodName, activeScheduleId, viewDate]);

  useEffect(() => {
    const timer = setInterval(() => {
      const startTimeStr = manualStartTime || currentPeriodConfig?.startTime;
      const endTimeStr = manualEndTime || currentPeriodConfig?.endTime;
      
      if (startTimeStr) {
        const now = new Date();
        const [hours, minutes] = startTimeStr.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(hours, minutes, 0, 0);

        let endTime = new Date();
        if (endTimeStr) {
           const [eHours, eMinutes] = endTimeStr.split(':').map(Number);
           endTime.setHours(eHours, eMinutes, 0, 0);
        }

        const effectiveNow = endTimeStr && now > endTime ? endTime : now;
        const diff = effectiveNow.getTime() - startTime.getTime();
        
        if (diff > 0) {
          const totalSeconds = Math.floor(diff / 1000);
          const mins = Math.floor(totalSeconds / 60);
          const secs = totalSeconds % 60;
          setElapsedTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
        } else {
          setElapsedTime('00:00');
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [currentPeriodConfig, manualStartTime, manualEndTime]);

  const sortedStudents = [...students].sort((a, b) => {
    if (sortBy === 'time') {
       const timeA = getStudentStatus(a).time || 0;
       const timeB = getStudentStatus(b).time || 0;
       // Arrival time sorted asc, but absent get stuck at the end
       if (timeA === 0 && timeB === 0) return 0;
       if (timeA === 0) return 1;
       if (timeB === 0) return -1;
       return timeA - timeB;
    }

    if (sortBy === 'status') {
      const statusA = getStudentStatus(a).status;
      const statusB = getStudentStatus(b).status;
      if (statusA !== statusB) return statusA.localeCompare(statusB);
      if (a.gradebookRank && b.gradebookRank) {
          const numA = Number(a.gradebookRank.replace(/[^0-9.]/g, ''));
          const numB = Number(b.gradebookRank.replace(/[^0-9.]/g, ''));
          if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
          const cmp = a.gradebookRank.localeCompare(b.gradebookRank, undefined, {numeric: true});
          if (cmp !== 0) return cmp;
      }
      return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    }
    
    if (sortBy === 'firstName') {
       return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
    }

    if (sortBy === 'id') {
       return a.id.localeCompare(b.id);
    }

    if (sortBy === 'rank') {
       if (a.gradebookRank && !b.gradebookRank) return -1;
       if (!a.gradebookRank && b.gradebookRank) return 1;
       if (a.gradebookRank && b.gradebookRank) {
          const numA = Number(a.gradebookRank.replace(/[^0-9.]/g, ''));
          const numB = Number(b.gradebookRank.replace(/[^0-9.]/g, ''));
          if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
          const cmp = a.gradebookRank.localeCompare(b.gradebookRank, undefined, {numeric: true});
          if (cmp !== 0) return cmp;
       }
       return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    }

    return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  });

  const isStudentInPeriod = (student: Student, periodName: string) => {
    if (!student.periods || student.periods.length === 0) return false;
    const matchPeriodId = periodName.match(/\b(\d+[A-Z]?)\b/i);
    const periodId = matchPeriodId ? matchPeriodId[1].toLowerCase() : periodName.toLowerCase();
    
    return student.periods.some(p => {
       if (p === periodName) return true;
       const pLower = p.toLowerCase();
       const regex = new RegExp(`^${periodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
       if (regex.test(p)) return true;
       if (matchPeriodId) {
          const pMatch = pLower.match(/\b(?:p|pd|period|sec|section)?\s*(\d+[a-z]?)\b/i);
          if (pMatch && pMatch[1].toLowerCase() === periodId) return true;
       }
       return false;
    });
  };

  const loadData = async () => {
    if (!activePeriodName) {
      setStudents([]);
      return;
    }
    const db = await getDB();
    const today = viewDate;
    
    let allStudents = await db.getAll('students');
    let periodRoster = (activePeriodName !== 'all')
      ? allStudents.filter(s => isStudentInPeriod(s, activePeriodName))
      : allStudents;
      
    if (searchQuery) {
       const q = searchQuery.toLowerCase();
       periodRoster = periodRoster.filter(s => 
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || 
          s.id.toLowerCase().includes(q)
       );
    }

    periodRoster.sort((a,b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    setStudents(periodRoster);

    const index = db.transaction('scans').store.index('by-date');
    const todayScans = await index.getAll(today);
    
    const populated = await Promise.all(todayScans.map(async (scan) => {
      let student = await db.get('students', scan.studentId);
      
      // If scan was unknown but we now have the student, update it
      let updatedScan = scan;
      if (scan.status === 'unknown_barcode' && student) {
        updatedScan = { ...scan, status: 'success' };
        await db.put('scans', updatedScan);
      }
      
      return { ...updatedScan, studentInfo: student };
    }));

    const filteredScans = (activePeriodName && activePeriodName !== 'all')
        ? populated.filter(s => s.periodName === activePeriodName)
        : populated;
        
    filteredScans.sort((a,b) => b.timestamp - a.timestamp);
    setScans(filteredScans);
    setRecentScans(filteredScans.slice(0, 10));

    // Get today's behaviors for the sidebar display
    const behaviorsIndex = db.transaction('behaviors').store.index('by-date');
    const todayBehaviors = await behaviorsIndex.getAll(today);
    setBehaviorsHistory((activePeriodName && activePeriodName !== 'all') 
       ? todayBehaviors.filter(b => b.periodName === activePeriodName)
       : todayBehaviors);

    const unknownScans = filteredScans.filter(s => s.status === 'unknown_barcode');
    const uniqueUnknownIds = Array.from(new Set(unknownScans.map(s => s.studentId)));
    const unknownStudents: Student[] = uniqueUnknownIds.map(id => ({
      id,
      firstName: 'Unknown ID',
      lastName: `(${id})`,
      grade: '',
      email: '',
      notes: ''
    }));

    // Update students state with unknown IDs as well
    setStudents([...periodRoster, ...unknownStudents]);
  };

  useEffect(() => {
    loadData();
  }, [activePeriodName, activeScheduleId, viewDate, searchQuery]);

  // Keep focus on input for hand scanner, but only if no other input is active
  useEffect(() => {
    const handleGlobalFocus = () => {
      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT' && document.activeElement?.tagName !== 'TEXTAREA' && inputRef.current) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('click', handleGlobalFocus);
    return () => window.removeEventListener('click', handleGlobalFocus);
  }, []);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    const purpose = scanReason;
    setScanReason(null);

    const effectivePeriodName = (activePeriodName && activePeriodName !== 'all') ? activePeriodName : 'Unspecified Period';
    const effectiveScheduleId = activeScheduleId || 'N/A';

    const db = await getDB();
    const student = await db.get('students', code);
    
    const now = Date.now();
    const todayStr = viewDate;
    const todayScans = await db.transaction('scans').store.index('by-date').getAll(todayStr);
    const studentScans = todayScans.filter(s => s.studentId === code && s.periodName === effectivePeriodName);
    studentScans.sort((a, b) => a.timestamp - b.timestamp);
    
    // Movement type determination
    let movementType = 'Attendance';
    if (purpose) {
        movementType = purpose;
    } else if (studentScans.length > 0) {
        const lastScanType = studentScans[studentScans.length - 1].movementType;
        if (['Bathroom', 'Water', 'Nurse', 'Office', 'Guidance'].includes(lastScanType)) {
            movementType = 'Returned';
        } else {
            movementType = 'Attendance'; // duplicate attendance scan
        }
    }

    const isAttendanceScan = movementType === 'Attendance';
    
    let manualStatus: 'Late' | undefined = undefined;

    // Attendance calculation logic - only for Attendance scans
    const effectiveStartTime = manualStartTime || currentPeriodConfig?.startTime;
    if (isAttendanceScan && effectiveStartTime) {
         const parseTime = (timeStr: string) => {
              let [h, m] = timeStr.split(':');
              let hours = parseInt(h, 10);
              let minutes = parseInt(m, 10);
              const upper = timeStr.toUpperCase();
              
              if (upper.includes('PM') && hours < 12) hours += 12;
              if (upper.includes('AM') && hours === 12) hours = 0;
              
              // Heuristic: If no AM/PM and it's an afternoon period (e.g. 6-9), assume PM
              if (!upper.includes('AM') && !upper.includes('PM') && hours < 12 && hours > 0) {
                 const periodName = currentPeriodConfig?.name || '';
                 if (periodName.match(/Period\s*[6-9]/i)) {
                     hours += 12;
                 }
              }
              return hours * 60 + minutes;
         };
         const baseMinutes = parseTime(effectiveStartTime);
         const cutoffMinutes = baseMinutes + gracePeriod;
         const scanDate = new Date(now);
         const scanMinutes = scanDate.getHours() * 60 + scanDate.getMinutes();

         if (scanMinutes > cutoffMinutes) {
             manualStatus = 'Late';
         }
    }

    let status: 'success' | 'unknown_barcode' | 'not_in_period' = 'success';
    
    if (!student) {
       status = 'unknown_barcode';
    } else if (student.periods && student.periods.length > 0 && activePeriodName && activePeriodName !== 'all' && !isStudentInPeriod(student, activePeriodName)) {
       status = 'not_in_period';
    }
    
    const scanEvent: ScanEvent = {
        id: `${code}_${now}`,
        studentId: code,
        timestamp: now,
        date: todayStr,
        periodName: effectivePeriodName,
        scheduleId: effectiveScheduleId,
        status: status === 'success' || status === 'not_in_period' ? 'success' : 'unknown_barcode',
        notes: purpose || undefined,
        movementType: movementType as any,
        manualStatus
    };

    await db.put('scans', scanEvent);
    setLastScan({ student: student || null, barcode: code, status, timestamp: now });
    await loadData();
    triggerAutoBackup();

    if (status === 'success' || status === 'not_in_period') {
       setView(isAttendanceScan ? 'attendance' : 'movement');
    }

    if (status === 'success') {
      toast.success(`Scanned: ${student!.firstName} ${student!.lastName}${purpose ? ` (${purpose})` : ''}`);
    } else if (status === 'not_in_period') {
       toast.warning(`${student!.firstName} ${student!.lastName} is not in roster`);
    } else {
       toast.warning(`Unknown student scanned: ${code}`);
    }
  };

  const manualMark = async (student: Student, forceStatus?: 'Present' | 'Late' | 'Absent' | 'Cut' | 'Left Early', isExcused = false) => {
    if (!activePeriodName || activePeriodName === 'all' || !activeScheduleId) return;
    const db = await getDB();
    const now = Date.now();
    
    const studentScans = scans.filter(s => s.studentId === student.id).sort((a,b) => a.timestamp - b.timestamp);
    const primaryScan = studentScans[0];

    if (forceStatus === 'Absent') {
       if (primaryScan) {
          await db.delete('scans', primaryScan.id);
       }
       await loadData();
       toast.success(`${student.firstName} marked Absent`);
       return;
    }

    if (primaryScan) {
       if (forceStatus === 'Left Early') {
          const updated = { ...primaryScan, leftEarly: !primaryScan.leftEarly };
          await db.put('scans', updated);
          toast.success(`${student.firstName} ${updated.leftEarly ? 'marked as' : 'removed from'} Left Early`);
       } else {
          const updated = { ...primaryScan, manualStatus: forceStatus || 'Present', isExcused };
          await db.put('scans', updated);
          toast.success(`${student.firstName} marked ${forceStatus || 'Present'}${isExcused ? ' (Excused)' : ''}`);
       }
    } else {
       if (forceStatus === 'Left Early') {
          toast.error("Cannot mark Left Early for absent student");
          return;
       }
       const scanEvent: ScanEvent = {
         id: `manual_${student.id}_${now}`,
         studentId: student.id,
         timestamp: now,
         date: viewDate,
         periodName: activePeriodName,
         scheduleId: activeScheduleId,
         status: 'success',
         manualStatus: forceStatus || 'Present',
         isExcused,
         movementType: 'Attendance'
       };
       await db.put('scans', scanEvent);
       toast.success(`${student.firstName} marked ${forceStatus || 'Present'}${isExcused ? ' (Excused)' : ''}`);
    }

    await loadData();
    triggerAutoBackup();
  };

  const markAllArrived = async () => {
    if (!activePeriodName || activePeriodName === 'all' || !activeScheduleId) return;
    const db = await getDB();
    
    // Parse the arrival time
    const [h, m] = markArrivalTime.split(':').map(Number);
    const date = new Date(viewDate); // Use viewDate instead of current date for consistency
    date.setHours(h, m, 0, 0);
    const timestamp = date.getTime();
    
    // Iterate students who are present (not absent)
    const presentStudents = students.filter(s => getStudentStatus(s).status !== 'Absent');
    
    for (const student of presentStudents) {
       const { scanId } = getStudentStatus(student);
       if (scanId) {
           const scan = await db.get('scans', scanId);
           if (scan) {
               await db.put('scans', { ...scan, timestamp: timestamp });
           }
       }
    }
    await loadData();
    toast.success(`Attendance times updated to ${markArrivalTime}.`);
 };

  const toggleExcused = async (studentToToggle: Student) => {
    const studentScans = scans.filter(s => s.studentId === studentToToggle.id).sort((a,b) => a.timestamp - b.timestamp);
    const scan = studentScans[0];
    if (!scan) return;
    
    const db = await getDB();
    const updated = { ...scan, isExcused: !scan.isExcused };
    await db.put('scans', updated);
    await loadData();
    triggerAutoBackup();
  };

  const toggleNoPass = async (studentToToggle: Student) => {
    const studentScans = scans.filter(s => s.studentId === studentToToggle.id).sort((a,b) => a.timestamp - b.timestamp);
    const scan = studentScans[0];
    if (!scan) return;
    
    const db = await getDB();
    const updated = { ...scan, hasNoPass: !scan.hasNoPass };
    await db.put('scans', updated);
    await loadData();
    triggerAutoBackup();
  };

  const deleteMovement = async (logId: string) => {
    const db = await getDB();
    await db.delete('scans', logId);
    await loadData();
    triggerAutoBackup();
    toast.success('Movement log deleted');
  };

  const logMovement = async (student: Student, reason: string | null) => {
    if (!activePeriodName || activePeriodName === 'all' || !activeScheduleId) return;
    const db = await getDB();
    const now = Date.now();
    
    const scanEvent: ScanEvent = {
      id: `${student.id}_log_${now}`,
      studentId: student.id,
      timestamp: now,
      date: viewDate,
      periodName: activePeriodName,
      scheduleId: activeScheduleId,
      status: 'success',
      notes: reason || 'Returned',
      movementType: (reason as any) || 'Returned'
    };

    await db.put('scans', scanEvent);
    await loadData();
    setView('movement');
    toast.success(`${student.firstName} ${reason ? `sent to ${reason}` : 'returned'}`);
    triggerAutoBackup();
  };

  const updateLogReason = async (logId: string, newReason: string | null) => {
     const db = await getDB();
     const existing = await db.get('scans', logId);
     if (!existing) return;
     
     const updated = { ...existing, notes: newReason || undefined, movementType: newReason as any || 'Returned' };
     await db.put('scans', updated);
     await loadData();
     triggerAutoBackup();
  };

  const getActivityLog = () => {
    // Show all scans that are NOT the attendance scan
    return scans.filter(s => {
      const isLegacyAttendance = !s.movementType && !['Bathroom', 'Nurse', 'Office', 'Guidance', 'Water', 'Returned'].includes(s.notes || '');
      return s.movementType !== 'Attendance' && !isLegacyAttendance;
    }).sort((a,b) => b.timestamp - a.timestamp);
  };

  const rosterStudentIds = new Set(students.map(s => s.id));
  const logEntries = getActivityLog();

  const getMovementStatus = (studentId: string) => {
     const studentLogs = logEntries.filter(l => l.studentId === studentId);
     if (studentLogs.length === 0) return null;
     const latest = studentLogs[0]; // sorted desc
     if (['Bathroom', 'Nurse', 'Office', 'Guidance', 'Water'].includes(latest.notes || '')) {
        return { out: true, reason: latest.notes, logId: latest.id, time: latest.timestamp };
     }
     return null;
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden bg-slate-50 relative group/tab">
      <div className="flex-1 flex flex-col min-w-0 p-4 pt-0 overflow-hidden">
        {!windowFocused && scannerEnabled && (
          <div className="fixed inset-0 z-50 bg-red-600/90 flex items-center justify-center pointer-events-none p-10 animate-pulse">
              <div className="bg-white p-10 rounded-2xl shadow-2xl text-center border-4 border-red-700">
                  <h1 className="text-6xl font-black text-red-600 mb-4">SCANNER NOT FOCUSED</h1>
                  <p className="text-2xl font-bold text-slate-800">CLICK TO REACTIVATE</p>
              </div>
          </div>
      )}
      {/* Fixed Sticky Header */}
      <div className="sticky top-0 z-10 bg-slate-50 border-b pb-1 mb-1">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2">
          <div className="flex items-center gap-3">
             <h2 className="text-xl font-black tracking-tight text-slate-800 leading-none">
                {isReady ? activePeriodName : 'Scanner Mode'}
             </h2>
             <Input 
                type="date"
                value={viewDate}
                onChange={e => setViewDate(e.target.value)}
                className="w-36 h-8 text-xs font-bold"
             />
          </div>
          
          <div className="flex-1 flex justify-center items-center gap-6">
             {isReady && currentPeriodConfig ? (
               <>
                 <div className="flex flex-col items-center gap-1 group/manual">
                    <div className="flex items-center gap-2">
                       <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Start</span>
                       <input 
                         type="time" 
                         className="text-base bg-white border border-slate-300 rounded px-2.5 h-8 font-bold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                         value={manualStartTime || currentPeriodConfig?.startTime || ''}
                         onChange={(e) => setManualStartTime(e.target.value)}
                         title="Override Period Start Time"
                       />
                       {manualStartTime && (
                          <button 
                            onClick={() => setManualStartTime(null)}
                            className="text-xs font-bold text-red-500 hover:text-red-700 uppercase bg-red-50 px-2 py-1 rounded"
                          >
                             Reset
                          </button>
                       )}
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">End</span>
                       <input 
                         type="time" 
                         className="text-base bg-white border border-slate-300 rounded px-2.5 h-8 font-bold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                         value={manualEndTime || currentPeriodConfig?.endTime || ''}
                         onChange={(e) => setManualEndTime(e.target.value)}
                         title="Override Period End Time"
                       />
                       {manualEndTime && (
                          <button 
                            onClick={() => setManualEndTime(null)}
                            className="text-xs font-bold text-red-500 hover:text-red-700 uppercase bg-red-50 px-2 py-1 rounded"
                          >
                             Reset
                          </button>
                       )}
                    </div>
                 </div>

                 <span className="text-sm shadow-sm bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-md font-black tabular-nums border border-indigo-200">
                   {elapsedTime} ELAPSED
                 </span>
               </>
             ) : (
               <p className="text-sm text-slate-500 font-bold uppercase tracking-wider leading-none">
                  Select period above
               </p>
             )}
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-md border shadow-sm h-9">
             <Label className="text-[10px] font-black text-slate-400 uppercase leading-none">Alerts</Label>
             <Button 
                variant="ghost" 
                size="sm" 
                onClick={toggleScanner}
                className={`h-6 px-2 text-[10px] font-black uppercase transition-all ${scannerEnabled ? 'text-green-600 bg-green-50 hover:bg-green-100 ring-1 ring-green-200' : 'text-red-400 bg-red-50/50 hover:bg-red-50 ring-1 ring-red-100'}`}
             >
                {scannerEnabled ? 'ON' : 'OFF'}
             </Button>
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-md border shadow-sm h-9">
             <Label className="text-xs font-bold text-slate-400 uppercase">Grace Mode:</Label>
             <select 
               className="border-none bg-transparent focus:ring-0 text-base font-black p-0 pr-6"
               value={gracePeriod}
               onChange={e => setGracePeriod(parseInt(e.target.value))}
             >
                {[...Array(11).keys()].map(i => <option key={i} value={i}>{i}m</option>)}
             </select>
          </div>
        </div>

        <Card className={`border shadow-sm transition-all duration-300 overflow-hidden ${
          isReady 
            ? (isFocused ? 'border-green-500 bg-green-50 ring-2 ring-green-100' : 'border-green-200 bg-white') 
            : 'border-red-500 bg-red-50'
        }`}>
          <CardContent className="p-0">
            <form onSubmit={handleScan} className="flex h-10 items-stretch">
              <input 
                ref={inputRef}
                type="text" 
                className={`flex-1 text-base px-3 focus:outline-none font-mono tracking-widest transition-all bg-transparent min-w-0 ${isReady ? 'text-green-900 placeholder:text-green-300' : 'text-red-900 placeholder:text-red-300'}`}
                autoFocus
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="PROMPT TO SCAN..."
              />
              <div className="hidden lg:flex bg-slate-50 px-2 items-center border-l gap-1">
                {['Bathroom', 'Water', 'Nurse', 'Office', 'Guidance'].map(reason => (
                   <Button 
                      key={reason}
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setScanReason(scanReason === reason ? null : reason)}
                      className={`h-6 px-2 text-[10px] font-bold uppercase transition-all ${scanReason === reason ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-inner' : 'text-slate-400 hover:bg-slate-200'}`}
                   >
                      {reason}
                   </Button>
                ))}
              </div>
              <button type="submit" className="px-6 bg-indigo-600 text-white font-black text-[10px] uppercase hover:bg-indigo-700 transition-colors whitespace-nowrap">
                 SCAN {scanReason && <span className="ml-1 opacity-80 text-xs font-normal">({scanReason})</span>}
              </button>
            </form>
          </CardContent>
        </Card>

        {lastScan && (
          <div className={`mt-2 p-1.5 rounded-lg flex items-center justify-between gap-3 border shadow-sm animate-in fade-in slide-in-from-top-1
            ${lastScan.status === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 
              lastScan.status === 'not_in_period' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-red-50 text-red-900 border-red-200'}`}>
            
            <div className="flex items-center gap-2">
              {lastScan.status === 'success' ? (
                 <CheckCircle className="w-5 h-5 text-green-500" />
              ) : lastScan.status === 'not_in_period' ? (
                 <AlertTriangle className="w-5 h-5 text-amber-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
    
              <div className="leading-tight">
                <h2 className="text-sm font-black">
                  {lastScan.status !== 'unknown_barcode' && lastScan.student 
                    ? `${lastScan.student.firstName} ${lastScan.student.lastName}`
                    : `ID: ${lastScan.barcode}`}
                </h2>
                <p className="text-[9px] font-bold uppercase opacity-60 leading-none">
                  {lastScan.status === 'success' ? 'MATCH' : 
                   lastScan.status === 'not_in_period' ? 'OUT OF PERIOD' : 'NOT FOUND'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 ml-4 py-0.5">
              {lastScan.status !== 'unknown_barcode' && lastScan.student && (
                <div className="flex items-center gap-1.5 animate-in fade-in zoom-in duration-300">
                  <div className="w-[1px] h-6 bg-slate-200 mx-1" />
                  {[
                    { name: 'On Task', icon: Smile, color: 'text-green-600 bg-green-100 hover:bg-green-200 border-green-200' },
                    { name: 'Great Answer', icon: Star, color: 'text-amber-600 bg-amber-100 hover:bg-amber-200 border-amber-200' },
                    { name: 'Off Task', icon: Frown, color: 'text-red-600 bg-red-100 hover:bg-red-200 border-red-200' },
                  ].map(btn => {
                    const b = behaviors.find(x => x.name === btn.name);
                    if (!b) return null;
                    return (
                      <Button 
                        key={b.id}
                        size="sm"
                        variant="ghost"
                        className={`h-7 px-2 text-[9px] font-black uppercase border shadow-sm transition-all hover:scale-105 active:scale-95 ${btn.color}`}
                        onClick={async () => {
                          await trackBehavior(lastScan.student!.id, b);
                          toast.success(`Logged ${b.name} for ${lastScan.student!.firstName}`);
                        }}
                      >
                        <btn.icon size={12} className="mr-1" />
                        {b.name}
                      </Button>
                    );
                  })}
                  <Button 
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[9px] font-black uppercase text-indigo-600 bg-indigo-50 border border-indigo-200 shadow-sm hover:bg-indigo-100 transition-all hover:scale-105 active:scale-95"
                    onClick={() => setNoteStudent(lastScan.student)}
                  >
                    <MessageSquare size={12} className="mr-1" />
                    Note
                  </Button>
                </div>
              )}
            </div>
            <span className="text-[10px] font-mono opacity-50 tabular-nums shrink-0">{format(new Date(lastScan.timestamp), 'h:mm:ss a')}</span>
          </div>
        )}
      </div>
      
      {/* Body Area */}
      <div className="flex-1 overflow-hidden flex flex-col gap-2">
        
        {/* Navigation Tabs & Sorting Options */}
          <div className="flex items-center justify-between gap-2">
             <div className="flex items-center gap-2">
                <div className="flex gap-1 p-0.5 bg-slate-200/50 rounded-md">
                    <Button 
                        variant={view === 'attendance' ? 'default' : 'ghost'} 
                        size="sm" 
                        onClick={() => setView('attendance')}
                        className={`h-7 px-4 text-[10px] font-bold uppercase ${view === 'attendance' ? 'bg-indigo-600 shadow-sm' : 'text-slate-500'}`}
                    >
                        Attendance
                    </Button>
                    <Button 
                        variant={view === 'movement' ? 'default' : 'ghost'} 
                        size="sm" 
                        onClick={() => setView('movement')}
                        className={`h-7 px-4 text-[10px] font-bold uppercase relative ${view === 'movement' ? 'bg-indigo-600 shadow-sm' : 'text-slate-500'}`}
                    >
                        Movement
                        {logEntries.some(l => ['Bathroom', 'Water', 'Nurse', 'Office', 'Guidance'].includes(l.notes || '')) && (
                            <span className="absolute -top-1 -right-0.5 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                            </span>
                        )}
                    </Button>
                </div>

                <div className="h-6 w-px bg-slate-200 mx-1" />

                {view === 'attendance' && (
                    <div className="flex gap-1 p-0.5 bg-slate-200/50 rounded-md">
                        <Button 
                            variant={viewMode === 'table' ? 'default' : 'ghost'} 
                            size="sm" 
                            onClick={() => setViewMode('table')}
                            className={`h-7 px-3 text-[10px] font-bold uppercase ${viewMode === 'table' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                        >
                            Table
                        </Button>
                        <Button 
                            variant={viewMode === 'grid' ? 'default' : 'ghost'} 
                            size="sm" 
                            onClick={() => setViewMode('grid')}
                            className={`h-7 px-3 text-[10px] font-bold uppercase ${viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                        >
                            Grid
                        </Button>
                    </div>
                )}
             </div>

             <div className="flex items-center gap-2">
                {view === 'attendance' && (
                   <div className="relative">
                      <Input 
                         placeholder="Search Student..."
                         value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)}
                         className="h-8 w-48 text-[10px] font-bold uppercase pl-8 bg-white border-slate-200"
                      />
                      <Star className="absolute left-2 top-2 text-slate-300 w-3.5 h-3.5" />
                   </div>
                )}
                
                {view === 'attendance' && (
                   <div className="flex items-center gap-1.5 p-0.5 bg-slate-200/50 rounded-md">
                      <span className="text-[8px] font-black text-slate-400 uppercase ml-2 mr-1">Sort:</span>
                      {['status', 'firstName', 'lastName', 'rank', 'time'].map((s: any) => (
                         <Button 
                            key={s}
                            variant={sortBy === s ? 'secondary' : 'ghost'} 
                            size="sm" 
                            onClick={() => setSortBy(s)}
                            className={`h-6 px-2 text-[9px] font-bold uppercase ${sortBy === s ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                         >
                            {s === 'firstName' ? 'First' : s === 'lastName' ? 'Last' : s === 'status' ? 'Status' : s === 'rank' ? 'Rank' : 'Arrival'}
                         </Button>
                      ))}
                   </div>
                )}

                <Button 
                   variant="ghost" 
                   size="sm" 
                   onClick={() => setSidebarOpen(!sidebarOpen)}
                   className={`h-8 px-2 text-[10px] font-black uppercase ${sidebarOpen ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
                >
                   {sidebarOpen ? 'Hide Activities' : 'Show Activities'}
                </Button>
             </div>
          </div>

        {view === 'attendance' ? (
           <div className="flex-1 flex flex-col min-h-0">
             {viewMode === 'table' ? (
                <div className="flex-1 flex flex-col border rounded-lg bg-white shadow-sm overflow-hidden min-h-0">
                   <div className="bg-slate-50 px-3 py-1 border-b flex justify-between items-center shrink-0">
                      <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Attendance Roster</h3>
                      <span className="text-[9px] text-slate-400 font-bold">{students.length} Students</span>
                   </div>
                   <div className="flex-1 overflow-auto min-w-0">
                      <div className="flex justify-end p-2 gap-2">
                         <Input 
                            type="time"
                            value={markArrivalTime}
                            onChange={(e) => setMarkArrivalTime(e.target.value)}
                            className="w-24 h-5 text-[9px]"
                         />
                         <Button variant="outline" size="sm" onClick={markAllArrived} className="h-5 text-[9px] font-black uppercase px-2 py-0 border-indigo-200 text-indigo-700 hover:bg-indigo-50">Mark Arrival Now</Button>
                      </div>
                      <Table className="min-w-[600px]">
                         {/* ... rest of table ... */}
                 <TableHeader className="bg-slate-50/90 sticky top-0 z-20 backdrop-blur-sm shadow-sm">
                   <TableRow className="h-6 border-b-2 bg-slate-50">
                     <TableHead className="w-[150px] text-[10px] font-black uppercase py-0 px-2 h-6">Student Name</TableHead>
                     <TableHead className="w-[240px] text-[10px] font-black uppercase py-0 px-2 h-6 text-left text-slate-500">Quick Actions</TableHead>
                     <TableHead className="w-[85px] text-[10px] font-black uppercase py-0 px-2 h-6 text-left text-slate-500">Status</TableHead>
                     <TableHead className="w-[90px] text-[10px] font-black uppercase py-0 px-2 h-6 text-center text-slate-500">Arrival</TableHead>
                     <TableHead className="w-[120px] text-[10px] font-black uppercase py-0 px-2 h-6 text-left text-slate-500">Flags</TableHead>
                     <TableHead className="w-full"></TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {sortedStudents.length === 0 ? (
                      <TableRow>
                         <TableCell colSpan={4} className="text-center text-slate-400 py-12 italic">
                             No students found in the roster.
                         </TableCell>
                      </TableRow>
                   ) : (
                      sortedStudents.map((student, idx) => {
                        const statusInfo = getStudentStatus(student);
                        const moveStatus = getMovementStatus(student.id);
                        
                        let rowColor = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';
                        let nameColor = 'text-slate-700';
                        if (statusInfo.status === 'Absent' || statusInfo.status === 'Cut') {
                          rowColor = 'bg-red-50/40';
                          nameColor = 'text-red-700';
                        } else if (statusInfo.status === 'Present' || statusInfo.status === 'OnTime') {
                          rowColor = 'bg-green-50/20';
                          nameColor = 'text-green-800';
                        } else if (statusInfo.status === 'Late') {
                          rowColor = 'bg-amber-50/30';
                          nameColor = 'text-amber-800';
                        }

                        return (
                             <TableRow 
                               key={student.id} 
                               className={`h-7 border-b group transition-colors ${rowColor}`}
                            >
                               <TableCell className="w-[150px] py-0 px-2">
                                  <div className="flex items-center gap-2 overflow-hidden">
                                     <span className={`text-xs font-bold leading-none truncate ${nameColor}`}>{student.firstName} {student.lastName}</span>
                                     {student.gradebookRank && <span className="text-[9px] bg-indigo-50 text-indigo-500 font-black px-1 rounded-sm shadow-sm ring-1 ring-indigo-200">#{student.gradebookRank}</span>}
                                     <span className="text-[10px] text-slate-500 font-mono tracking-tighter leading-none uppercase shrink-0">{student.id}</span>
                                     {moveStatus?.out && (
                                        <span className="inline-flex items-center gap-1 font-black text-[10px] text-amber-600 uppercase bg-amber-50 px-2 rounded ring-1 ring-amber-100 leading-none py-1.5">
                                           {moveStatus.reason}
                                        </span>
                                     )}
                                  </div>
                               </TableCell>
                               <TableCell className="w-[240px] py-0 px-1.5 text-left">
                                  <div className="flex justify-start items-center gap-2">
                                    {statusInfo.status === 'Absent' ? (
                                       <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <Button variant="outline" size="sm" onClick={() => manualMark(student, 'Present')} className="h-6 text-xs font-bold bg-green-50 text-green-700 px-3 border-green-200 uppercase">IN</Button>
                                          <Button variant="outline" size="sm" onClick={() => manualMark(student, 'Late')} className="h-6 text-xs font-bold bg-amber-50 text-amber-700 px-3 border-amber-200 uppercase">LATE</Button>
                                          <Button variant="ghost" size="sm" onClick={() => { trackBehavior(student.id, { name: 'Cut Class', points: -2, type: 'Negative' }, 'Student cut class'); manualMark(student, 'Cut'); }} className="h-6 px-2 text-[10px] tracking-tight font-black uppercase text-slate-400 hover:bg-slate-100 transition-colors ml-1">CUT</Button>
                                       </div>
                                    ) : (
                                       <div className="flex items-center gap-2.5">
                                          <Button variant="ghost" size="sm" onClick={() => toggleExcused(student)} className={`h-6 px-3 text-xs font-bold uppercase transition-colors ${statusInfo.excused ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-slate-600'}`}>
                                             {statusInfo.excused ? 'EXC' : 'PASS'}
                                          </Button>
                                          <Button variant="ghost" size="sm" onClick={() => toggleNoPass(student)} className={`h-6 px-3 text-[10px] tracking-tight font-black uppercase transition-colors ${statusInfo.noPass ? 'bg-red-600 text-white' : 'text-slate-300 hover:text-slate-600'}`}>
                                             NO PASS
                                          </Button>
                                          <Button variant="ghost" size="sm" onClick={() => manualMark(student, 'Absent')} className="h-6 w-6 p-0 text-sm text-red-200 hover:text-red-500 hover:bg-red-50 transition-colors uppercase font-black ml-1">X</Button>
                                          <Button variant="ghost" size="sm" onClick={() => { trackBehavior(student.id, { name: 'Cut Class', points: -2, type: 'Negative' }, 'Student cut class'); manualMark(student, 'Cut'); }} className="h-6 px-2 text-[10px] tracking-tight font-black uppercase text-slate-400 hover:bg-slate-100 transition-colors ml-1">CUT</Button>
                                          <Button variant="ghost" size="sm" onClick={() => manualMark(student, 'Left Early')} className={`h-6 px-2 text-[10px] tracking-tight font-black uppercase transition-colors ml-1 ${statusInfo.leftEarly ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:text-blue-500 hover:bg-blue-50'}`}>LEFT EARLY</Button>
                                       </div>
                                    )}
                                  </div>
                               </TableCell>
                               <TableCell className="w-[85px] py-0 px-1.5 text-left border-l border-slate-100/50">
                                   <div className="flex items-center justify-start gap-1">
                                    {statusInfo.status === 'OnTime' && <span className="px-2.5 py-1 rounded-[2px] text-[11px] font-black bg-green-100 text-green-700 border border-green-200 uppercase whitespace-nowrap">ON TIME</span>}
                                    {statusInfo.status === 'Late' && <span className="px-2.5 py-1 rounded-[2px] text-[11px] font-black bg-amber-100 text-amber-700 border border-amber-200 uppercase whitespace-nowrap">LATE</span>}
                                    {statusInfo.status === 'Present' && <span className="px-2.5 py-1 rounded-[2px] text-[11px] font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase whitespace-nowrap">PRESENT</span>}
                                    {statusInfo.status === 'Absent' && <span className="px-2.5 py-1 rounded-[2px] text-[11px] font-black bg-slate-50 text-slate-300 border border-slate-100 uppercase whitespace-nowrap">ABSENT</span>}
                                    {statusInfo.status === 'Cut' && <span className="px-2.5 py-1 rounded-[2px] text-[11px] font-black bg-red-100 text-red-700 border border-red-200 uppercase whitespace-nowrap">CUT</span>}
                                    
                                    <DropdownMenu>
                                       <DropdownMenuTrigger render={(props) => (
                                          <Button {...props} variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-300 hover:text-amber-500 hover:bg-amber-50 rounded-full transition-all opacity-0 group-hover:opacity-100">
                                             <Star size={14} fill={statusInfo.status === 'Absent' ? 'none' : 'currentColor'} className={statusInfo.status === 'Absent' ? 'opacity-30' : ''} />
                                          </Button>
                                       )} />
                                       <DropdownMenuContent align="end" className="w-56 font-sans">
                                          <DropdownMenuGroup>
                                             <DropdownMenuLabel className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
                                                <Star size={12} fill="currentColor" className="text-amber-500" />
                                                Quick Behavior: {student.firstName}
                                             </DropdownMenuLabel>
                                             <DropdownMenuSeparator />
                                             <div className="p-1 space-y-1">
                                                {behaviors.filter(b => b.type === 'Positive').length > 0 && (
                                                   <>
                                                      <div className="grid grid-cols-1 gap-0.5">
                                                         {behaviors.filter(b => b.type === 'Positive').map(b => (
                                                            <DropdownMenuItem 
                                                               key={b.id} 
                                                               className="flex items-center justify-between text-[11px] font-bold cursor-pointer hover:bg-green-50 text-green-700 p-1.5 focus:text-green-800 focus:bg-green-50"
                                                               onClick={async () => { await trackBehavior(student.id, b); toast.success(`Logged ${b.name} for ${student.firstName}`); }}
                                                            >
                                                               <div className="flex items-center gap-2">
                                                                  <Smile size={14} />
                                                                  {b.name}
                                                               </div>
                                                               <span className="bg-green-100 px-1 rounded">+{b.points}</span>
                                                            </DropdownMenuItem>
                                                         ))}
                                                      </div>
                                                      <DropdownMenuSeparator />
                                                   </>
                                                )}
                                                {behaviors.filter(b => b.type === 'Negative').length > 0 && (
                                                   <>
                                                      <div className="grid grid-cols-1 gap-0.5">
                                                         {behaviors.filter(b => b.type === 'Negative').map(b => (
                                                            <DropdownMenuItem 
                                                               key={b.id} 
                                                               className="flex items-center justify-between text-[11px] font-bold cursor-pointer hover:bg-red-50 text-red-700 p-1.5 focus:text-red-800 focus:bg-red-50"
                                                               onClick={async () => { await trackBehavior(student.id, b); toast.success(`Logged ${b.name} for ${student.firstName}`); }}
                                                            >
                                                               <div className="flex items-center gap-2">
                                                                  <Frown size={14} />
                                                                  {b.name}
                                                               </div>
                                                               <span className="bg-red-100 px-1 rounded">{b.points}</span>
                                                            </DropdownMenuItem>
                                                         ))}
                                                      </div>
                                                      <DropdownMenuSeparator />
                                                   </>
                                                )}
                                                <div className="grid grid-cols-1 gap-0.5">
                                                   {behaviors.filter(b => b.type === 'Neutral' && b.name !== 'Note').map(b => (
                                                      <DropdownMenuItem 
                                                         key={b.id} 
                                                         className="flex items-center justify-between text-[11px] font-bold cursor-pointer hover:bg-slate-50 text-slate-700 p-1.5 focus:text-slate-800 focus:bg-slate-50"
                                                         onClick={async () => { await trackBehavior(student.id, b); toast.success(`Logged ${b.name} for ${student.firstName}`); }}
                                                      >
                                                         <div className="flex items-center gap-2">
                                                            <Clock size={14} />
                                                            {b.name}
                                                         </div>
                                                         <span className="bg-slate-100 px-1 rounded">0</span>
                                                      </DropdownMenuItem>
                                                   ))}
                                                   <DropdownMenuItem 
                                                      className="flex items-center gap-2 text-[11px] font-bold cursor-pointer hover:bg-indigo-50 text-indigo-700 p-1.5 focus:text-indigo-800 focus:bg-indigo-50"
                                                      onClick={() => setNoteStudent(student)}
                                                   >
                                                      <MessageSquare size={14} />
                                                      Add Custom Note...
                                                   </DropdownMenuItem>
                                                </div>
                                             </div>
                                          </DropdownMenuGroup>
                                       </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                               </TableCell>
                               <TableCell className="w-[90px] py-0 px-1.5 text-center border-l border-slate-100/50">
                                  {statusInfo.time && (
                                     <div className="flex items-center justify-center gap-1 group/time h-7">
                                        <span className="text-sm text-slate-400 font-mono font-bold leading-none whitespace-nowrap">{format(new Date(statusInfo.time), 'h:mm a')}</span>
                                        <button onClick={() => statusInfo.scanId && openEditTime(statusInfo.scanId, statusInfo.time!)} className="opacity-0 group-hover/time:opacity-100 p-0.5 text-slate-300 hover:text-indigo-600 transition-opacity" title="Edit Time">
                                           <Edit2 className="w-3 h-3" />
                                        </button>
                                     </div>
                                  )}
                               </TableCell>
                               <TableCell className="w-[120px] py-0 px-1.5 text-left border-l border-slate-100/50">
                                  <div className="flex items-center gap-1.5 overflow-hidden">
                                     {statusInfo.leftEarly && <span className="px-1.5 py-0.5 rounded-[2px] text-[9px] font-black bg-blue-600 text-white shadow-sm uppercase whitespace-nowrap">Left Early</span>}
                                     {statusInfo.excused && <span className="px-1.5 py-0.5 rounded-[2px] text-[9px] font-black bg-blue-600 text-white shadow-sm uppercase whitespace-nowrap">Pass</span>}
                                     {statusInfo.noPass && <span className="px-1.5 py-0.5 rounded-[2px] text-[9px] font-black bg-red-600 text-white shadow-sm uppercase whitespace-nowrap">No Pass</span>}
                                  </div>
                               </TableCell>
                               <TableCell className="w-full"></TableCell>
                            </TableRow>
                        );
                      })
                   )}
                 </TableBody>
               </Table>
             </div>
          </div>
        ) : (
           <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 rounded-xl border border-slate-200/60 shadow-inner">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                 {sortedStudents.map(student => (
                   <CompactStudentCard 
                      key={student.id}
                      student={student}
                      behaviors={behaviors}
                      statusInfo={getStudentStatus(student)}
                      moveStatus={getMovementStatus(student.id)}
                      onStatusClick={(status: any) => manualMark(student, status)}
                      onTrackBehavior={(b: any) => trackBehavior(student.id, b)}
                   />
                 ))}
              </div>
           </div>
        )}
      </div>
    ) : (
           <div className="flex-1 flex flex-row gap-4 overflow-hidden min-h-0">
              {/* Column 1: ROSTER */}
              <div className="w-[30%] flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden min-h-0">
                 <div className="bg-slate-50 px-3 py-2 border-b flex flex-col gap-2 shrink-0">
                    <div className="flex justify-between items-center">
                       <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Student Roster</h3>
                       <span className="text-[10px] text-slate-400 font-bold">{sortedStudents.length}</span>
                    </div>
                    <div className="flex items-center gap-1">
                       <span className="text-[8px] font-bold text-slate-400 uppercase">Sort:</span>
                       <Button variant={sortBy === 'firstName' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('firstName')} className={`h-5 px-1.5 text-[9px] font-bold uppercase ${sortBy === 'firstName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>First</Button>
                       <Button variant={sortBy === 'lastName' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('lastName')} className={`h-5 px-1.5 text-[9px] font-bold uppercase ${sortBy === 'lastName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Last</Button>
                       <Button variant={sortBy === 'id' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('id')} className={`h-5 px-1.5 text-[9px] font-bold uppercase ${sortBy === 'id' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>ID</Button>
                       <Button variant={sortBy === 'rank' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('rank')} className={`h-5 px-1.5 text-[9px] font-bold uppercase ${sortBy === 'rank' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Rank</Button>
                    </div>
                 </div>
                 <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
                    {sortedStudents.length === 0 ? (
                       <div className="text-center text-slate-400 py-12 italic text-sm">No students found.</div>
                    ) : (
                       <div className="flex flex-col gap-1">
                          {sortedStudents.map(student => {
                             const moveStatus = getMovementStatus(student.id);
                             if (moveStatus?.out) return null; // Hide from roster if out
                             return (
                                <div key={student.id} className="p-2 border border-slate-100 rounded-lg hover:bg-slate-50 flex flex-col gap-1.5 group cursor-pointer" onClick={() => logMovement(student, 'Bathroom')}>
                                   <div className="flex justify-between items-start">
                                      <div className="flex flex-col">
                                         <span className="text-xs font-bold text-slate-700">{student.firstName} {student.lastName}</span>
                                         <span className="text-[9px] text-slate-400 font-mono">{student.id}</span>
                                      </div>
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                         {['B', 'W', 'N', 'O', 'G'].map(char => {
                                            const labelMap: Record<string, string> = { 'B': 'Bathroom', 'W': 'Water', 'N': 'Nurse', 'O': 'Office', 'G': 'Guidance' };
                                            return (
                                               <Button 
                                                  key={char}
                                                  variant="ghost" 
                                                  size="sm" 
                                                  onClick={(e) => { e.stopPropagation(); logMovement(student, labelMap[char]); }}
                                                  className="h-6 w-6 p-0 text-[10px] font-bold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 bg-white"
                                                  title={labelMap[char]}
                                               >
                                                  {char}
                                               </Button>
                                            )
                                         })}
                                      </div>
                                   </div>
                                </div>
                             );
                          })}
                       </div>
                    )}
                 </div>
              </div>

              {/* Middle Column: ACTIVE MOVEMENT */}
              <div className="w-[20%] flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden min-h-0">
                 <div className="bg-amber-100/50 px-4 py-2 border-b flex justify-between items-center">
                    <h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Out of Class</h3>
                    <span className="text-[10px] text-amber-600 font-bold bg-white px-2 py-0.5 rounded-full border border-amber-200">
                       {logEntries.filter(l => ['Bathroom', 'Nurse', 'Office', 'Guidance'].includes(l.notes || '')).length}
                    </span>
                 </div>
                 <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                    {students.filter(s => getMovementStatus(s.id)?.out).length === 0 ? (
                       <div className="flex flex-col items-center justify-center h-full opacity-40">
                          <Clock className="w-8 h-8 text-slate-300 mb-2" />
                          <p className="text-xs font-medium text-slate-400">All students present</p>
                       </div>
                    ) : (
                       students.filter(s => getMovementStatus(s.id)?.out).map(student => {
                          const move = getMovementStatus(student.id)!;
                          return (
                             <Card key={student.id} className="border-amber-200 bg-amber-50/30">
                                <CardContent className="p-3">
                                   <div className="flex justify-between items-start mb-2">
                                      <div className="flex flex-col">
                                         <span className="text-xs font-bold text-slate-700">{student.lastName}, {student.firstName}</span>
                                         <span className="text-[10px] text-amber-600 font-bold uppercase tracking-tighter">Loc: {move.reason}</span>
                                      </div>
                                      <div className="flex items-center gap-1 group/mtime">
                                         <span className="text-[10px] font-mono text-slate-400">{format(new Date(move.time), 'hh:mm a')}</span>
                                         <button onClick={() => openEditTime(move.logId, move.time)} className="opacity-0 group-hover/mtime:opacity-100 p-0 text-slate-300 hover:text-indigo-600 transition-opacity" title="Edit Time">
                                            <Edit2 className="w-3.5 h-3.5" />
                                         </button>
                                      </div>
                                   </div>
                                   <Button 
                                      size="sm" 
                                      className="w-full h-8 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] uppercase rounded-md shadow-sm"
                                      onClick={() => logMovement(student, null)}
                                   >
                                      Record Return
                                   </Button>
                                </CardContent>
                             </Card>
                          )
                       })
                    )}
                 </div>
              </div>

              {/* Right Column: HISTORY LOG */}
              <div className="flex-1 flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden min-h-0">
                 <div className="bg-slate-100/50 px-4 py-2 border-b flex justify-between items-center">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Movement Log</h3>
                    <span className="text-[10px] text-slate-400 font-medium">Full History</span>
                 </div>
                 <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <Table className="w-full table-fixed">
                       <TableHeader className="bg-slate-50 sticky top-0 z-20">
                          <TableRow>
                             <TableHead className="w-2/5">Student</TableHead>
                             <TableHead className="w-2/5">Activity</TableHead>
                             <TableHead className="w-1/5 text-right">Time</TableHead>
                          </TableRow>
                       </TableHeader>
                       <TableBody>
                          {logEntries.map(log => (
                             <TableRow key={log.id} className="group hover:bg-slate-50/50 h-10">
                                <TableCell className="py-1">
                                   <div className="flex flex-col">
                                      <span className="text-xs font-semibold text-slate-700">{log.studentInfo ? `${log.studentInfo.lastName}, ${log.studentInfo.firstName}` : log.studentId}</span>
                                      <span className="text-[9px] text-slate-400 font-mono">{log.studentId}</span>
                                   </div>
                                </TableCell>
                                <TableCell className="py-1">
                                   <div className="flex items-center gap-1">
                                      {['Bathroom', 'Water', 'Nurse', 'Office', 'Guidance', 'Returned'].map(r => (
                                         <button
                                            key={r}
                                            onClick={() => updateLogReason(log.id, r === 'Returned' ? null : r)}
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all border
                                               ${(log.notes === r || (log.movementType === r)) || (!log.notes && r === 'Returned' && log.movementType === 'Returned')
                                                  ? 'bg-slate-800 text-white border-slate-900 shadow-sm' 
                                                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                               }`}
                                         >
                                            {r}
                                         </button>
                                      ))}
                                   </div>
                                </TableCell>
                                <TableCell className="text-right py-1">
                                   <div className="flex flex-col items-end">
                                      <div className="flex items-center justify-end gap-1 group/mtime">
                                         <button onClick={() => openEditTime(log.id, log.timestamp)} className="opacity-0 group-hover/mtime:opacity-100 p-0 text-slate-300 hover:text-indigo-600 transition-opacity" title="Edit Time">
                                            <Edit2 className="w-3 h-3" />
                                         </button>
                                         <span className="text-slate-500 tabular-nums text-[10px] font-semibold">{format(new Date(log.timestamp), 'hh:mm:ss a')}</span>
                                      </div>
                                      <Button variant="ghost" size="sm" onClick={async () => {
                                         if(!window.confirm('Delete this movement event?')) return;
                                         const db = await getDB();
                                         await db.delete('scans', log.id);
                                         loadData();
                                      }} className="h-4 px-1 text-[8px] text-red-300 hover:text-red-500 font-bold uppercase opacity-50 hover:opacity-100 transition-opacity">Delete</Button>
                                   </div>
                                </TableCell>
                             </TableRow>
                          ))}
                       </TableBody>
                    </Table>
                 </div>
              </div>
           </div>
        )}

         <Dialog open={!!editingScanId} onOpenChange={(open) => !open && setEditingScanId(null)}>
            <DialogContent className="sm:max-w-sm">
               <DialogHeader>
                  <DialogTitle>Edit Scan Time</DialogTitle>
               </DialogHeader>
               <div className="py-4">
                  <Label className="mb-2 block text-xs font-bold text-slate-500 uppercase tracking-widest">Marked Time</Label>
                  <Input 
                     type="time" 
                     value={editingTimeStr}
                     onChange={(e) => setEditingTimeStr(e.target.value)}
                     className="text-lg font-mono"
                  />
               </div>
               <DialogFooter>
                  <Button variant="ghost" onClick={() => setEditingScanId(null)}>Cancel</Button>
                  <Button onClick={saveEditTime} className="bg-indigo-600 hover:bg-indigo-700">Save Time</Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

         <Dialog open={!!noteStudent} onOpenChange={(open) => !open && setNoteStudent(null)}>
            <DialogContent className="sm:max-w-md">
               <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-indigo-600">
                     <MessageSquare className="w-5 h-5" />
                     Add Note for {noteStudent?.firstName}
                  </DialogTitle>
               </DialogHeader>
               <div className="py-4 space-y-4">
                  <div className="space-y-2">
                     <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Behavior / Status Note</Label>
                     <textarea 
                        className="w-full h-32 p-4 text-sm border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none resize-none transition-all placeholder:text-slate-300 font-medium"
                        placeholder="Type important details about this student's current status or behavior. This will appear in the behavior log."
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        autoFocus
                     />
                  </div>
               </div>
               <DialogFooter className="bg-slate-50/50 p-4 border-t rounded-b-xl gap-3">
                  <Button variant="ghost" onClick={() => setNoteStudent(null)} className="font-bold text-slate-500">Cancel</Button>
                  <Button onClick={addNote} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-10 px-6 rounded-lg shadow-md underline-none" disabled={!noteText.trim()}>Save Note</Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

      </div>
    </div>

      {/* Right Side Sidebar - Activity & Quick Select */}
      {sidebarOpen && (
        <aside className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 animate-in slide-in-from-right-1 duration-300">
           <div className="p-4 border-b bg-slate-50/50">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                 <Clock size={14} className="text-indigo-500" />
                 Recent Activities
              </h3>
           </div>
           
           <div className="flex-1 overflow-y-auto p-3 space-y-6">
              {/* Recent Scans */}
              <section>
                 <div className="flex items-center justify-between mb-2 px-1">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Arrivals / Scans</h4>
                    <span className="text-[9px] font-bold text-slate-400">{recentScans.length}</span>
                 </div>
                 <div className="space-y-1.5">
                    {recentScans.length === 0 ? (
                       <p className="text-[10px] text-slate-400 italic text-center py-4">No scans yet today</p>
                    ) : (
                       recentScans.map(scan => (
                          <div key={scan.id} className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between group">
                             <div className="min-w-0 pr-2">
                                <div className="text-[11px] font-black text-slate-700 truncate">
                                   {scan.studentInfo ? `${scan.studentInfo.firstName} ${scan.studentInfo.lastName}` : scan.studentId}
                                </div>
                                <div className="text-[8px] font-bold text-slate-400 uppercase">
                                   {format(new Date(scan.timestamp), 'h:mm:ss a')} • {scan.movementType || 'Scan'}
                                </div>
                             </div>
                          </div>
                       ))
                    )}
                 </div>
              </section>

              {/* Recent Behaviors */}
              <section>
                 <div className="flex items-center justify-between mb-2 px-1">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Recent Behaviors</h4>
                 </div>
                 <div className="space-y-1.5">
                    {behaviorsHistory.length === 0 ? (
                       <p className="text-[10px] text-slate-400 italic text-center py-4">Nothing logged yet</p>
                    ) : (
                       behaviorsHistory.sort((a,b) => b.timestamp - a.timestamp).slice(0, 8).map(event => {
                          const student = students.find(s => s.id === event.studentId);
                          const iconColor = event.type === 'Positive' ? 'text-green-500' : event.type === 'Negative' ? 'text-red-500' : 'text-slate-400';
                          return (
                             <div key={event.id} className="p-2 rounded-lg bg-white border border-slate-100 flex flex-col gap-1">
                                <div className="flex justify-between items-center">
                                   <span className="text-[10px] font-bold text-slate-800 truncate pr-2">{student ? student.firstName : 'Unknown'}</span>
                                   <span className={`text-[10px] font-black ${iconColor}`}>
                                      {event.points > 0 ? `+${event.points}` : event.points}
                                   </span>
                                </div>
                                <div className="flex justify-between items-center">
                                   <span className="text-[9px] font-black uppercase text-slate-400">{event.category}</span>
                                   <span className="text-[8px] font-mono text-slate-300">{format(new Date(event.timestamp), 'h:mm a')}</span>
                                </div>
                             </div>
                          );
                       })
                    )}
                 </div>
              </section>
           </div>
        </aside>
      )}
    </div>
  );
}

function CompactStudentCard({ student, behaviors, statusInfo, moveStatus, onStatusClick, onTrackBehavior }: any) {
  const isAbsent = statusInfo.status === 'Absent' || statusInfo.status === 'Cut';
  const isLate = statusInfo.status === 'Late';
  const isPresent = statusInfo.status === 'Present' || statusInfo.status === 'OnTime';

  const onTrackSafe = (name: string) => {
    const b = behaviors.find((x: any) => x.name === name);
    if (b) onTrackBehavior(b);
  };

  return (
     <Card className={`overflow-hidden border transition-all duration-200 group ${isAbsent ? 'bg-red-50/30 border-red-100 opacity-60' : isLate ? 'bg-amber-50/30 border-amber-100' : isPresent ? 'bg-green-50/30 border-green-100' : 'bg-white border-slate-200'}`}>
        <CardContent className="p-2.5">
           <div className="flex justify-between items-start mb-2">
              <div className="min-w-0 pr-2">
                 <h4 className={`text-xs font-black truncate ${isAbsent ? 'text-red-800' : 'text-slate-800'}`}>
                    {student.firstName} {student.lastName}
                 </h4>
                 <p className="text-[9px] font-mono text-slate-400 leading-none mt-0.5">{student.id}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                 {statusInfo.status !== 'Absent' ? (
                    <div className="px-1.5 py-0.5 rounded text-[8px] font-black bg-white border shadow-xs uppercase">
                       {statusInfo.status}
                    </div>
                 ) : (
                    <div className="px-1.5 py-0.5 rounded text-[8px] font-black bg-red-100 text-red-600 border border-red-200 uppercase">
                       ABSENT
                    </div>
                 )}
              </div>
           </div>

           <div className="flex gap-1.5 mb-2">
              {isAbsent ? (
                 <>
                    <Button variant="outline" size="sm" onClick={() => onStatusClick('Present')} className="flex-1 h-6 text-[9px] font-black bg-green-50 text-green-700 border-green-200 uppercase">IN</Button>
                    <Button variant="outline" size="sm" onClick={() => onStatusClick('Late')} className="flex-1 h-6 text-[9px] font-black bg-amber-50 text-amber-700 border-amber-200 uppercase">LATE</Button>
                 </>
              ) : (
                 <div className="flex-1 flex gap-1 items-center overflow-x-auto no-scrollbar">
                    <Button 
                       variant="ghost" 
                       size="sm" 
                       onClick={() => onTrackSafe('On Task')} 
                       className="h-6 w-6 p-0 text-green-600 bg-green-100 hover:bg-green-200 rounded-full"
                    >
                       <Smile size={12} />
                    </Button>
                    <Button 
                       variant="ghost" 
                       size="sm" 
                       onClick={() => onTrackSafe('Off Task')} 
                       className="h-6 w-6 p-0 text-red-600 bg-red-100 hover:bg-red-200 rounded-full"
                    >
                       <Frown size={12} />
                    </Button>
                    <Button 
                       variant="ghost" 
                       size="sm" 
                       onClick={() => onTrackSafe('Great Answer')} 
                       className="h-6 w-6 p-0 text-amber-600 bg-amber-100 hover:bg-amber-200 rounded-full"
                    >
                       <Star size={12} />
                    </Button>
                    <div className="flex-1" />
                    <button onClick={() => onStatusClick('Absent')} className="h-6 w-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-50">
                       <XCircle size={14} />
                    </button>
                 </div>
              )}
           </div>

           {moveStatus?.out && (
              <div className="mt-1 px-2 py-1 rounded bg-amber-100 text-amber-700 text-[9px] font-black uppercase text-center flex items-center justify-center gap-1">
                 <Clock size={10} />
                 {moveStatus.reason} ({format(new Date(moveStatus.time), 'h:mm')})
              </div>
           )}
        </CardContent>
     </Card>
  );
}
