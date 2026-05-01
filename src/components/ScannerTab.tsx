import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from './ui/card';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { getDB, Student, ScanEvent, Schedule } from '../lib/db';
import { triggerAutoBackup } from '../lib/gdrive';
import { format } from 'date-fns';
import { CheckCircle, XCircle, AlertTriangle, Clock, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from './ui/dialog';
import { Input } from './ui/input';

interface ScannerTabProps {
  activeScheduleId: string | null;
  activePeriodName: string | null;
  activeSchedule?: Schedule;
}

export function ScannerTab({ activeScheduleId, activePeriodName, activeSchedule }: ScannerTabProps) {
  const [barcode, setBarcode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [lastScan, setLastScan] = useState<{ student: Student | null, barcode?: string, status: 'success' | 'unknown_barcode' | 'not_in_period', timestamp: number } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [scans, setScans] = useState<(ScanEvent & { studentInfo?: Student })[]>([]);
  const [gracePeriod, setGracePeriodState] = useState(5);
  const [scanReason, setScanReason] = useState<string | null>(null);

  const [editingScanId, setEditingScanId] = useState<string | null>(null);
  const [editingTimeStr, setEditingTimeStr] = useState<string>('');

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

  const [view, setView] = useState<'attendance' | 'movement'>('attendance');

  const isReady = activePeriodName && activePeriodName !== 'all' && activeScheduleId;
  const currentPeriodConfig = activeSchedule?.periods.find(p => p.name === activePeriodName);

  const getStudentStatus = (student: Student) => {
     // Attendance status is based on the EARLIEST Attendance scan
     const attendanceScan = scans.find(s => s.studentId === student.id && s.movementType === 'Attendance');
     const scan = attendanceScan || scans.find(s => s.studentId === student.id); // Fallback to first scan if movementType not set yet

     if (!scan) return { status: 'Absent', text: 'Absent', time: null, scanId: null };
     
     if (scan.manualStatus) {
        return { status: scan.manualStatus as any, text: scan.manualStatus, time: scan.timestamp, excused: !!scan.isExcused, noPass: !!scan.hasNoPass, scanId: scan.id };
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
             return { status: 'Late', text: 'Late', time: scan.timestamp, excused: !!scan.isExcused, noPass: !!scan.hasNoPass, scanId: scan.id };
         }
     }
     
     return { status: 'OnTime', text: 'On Time', time: scan.timestamp, excused: !!scan.isExcused, noPass: !!scan.hasNoPass, scanId: scan.id };
  };

  const [sortBy, setSortBy] = useState<'firstName' | 'lastName' | 'status' | 'rank'>('lastName');
  const [elapsedTime, setElapsedTime] = useState<string>('00:00');
  const [manualStartTimeInternal, setManualStartTimeInternal] = useState<string | null>(null);
  const [manualEndTimeInternal, setManualEndTimeInternal] = useState<string | null>(null);

  const getOverrideKey = () => `override_${format(new Date(), 'yyyy-MM-dd')}_${activeScheduleId}_${activePeriodName}`;
  const getOverrideEndKey = () => `override_end_${format(new Date(), 'yyyy-MM-dd')}_${activeScheduleId}_${activePeriodName}`;

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
  }, [activePeriodName, activeScheduleId]);

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
    const db = await getDB();
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const allStudents = await db.getAll('students');
    const periodRoster = (activePeriodName && activePeriodName !== 'all')
      ? allStudents.filter(s => isStudentInPeriod(s, activePeriodName))
      : allStudents;
      
    periodRoster.sort((a,b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    setStudents(periodRoster);

    const index = db.transaction('scans').store.index('by-date');
    const todayScans = await index.getAll(today);
    
    const populated = await Promise.all(todayScans.map(async (scan) => {
      const student = await db.get('students', scan.studentId);
      return { ...scan, studentInfo: student };
    }));

    const filteredScans = (activePeriodName && activePeriodName !== 'all')
        ? populated.filter(s => s.periodName === activePeriodName)
        : populated;
        
    filteredScans.sort((a,b) => b.timestamp - a.timestamp);
    setScans(filteredScans);

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
  }, [activePeriodName, activeScheduleId]);

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
    const todayStr = format(now, 'yyyy-MM-dd');
    const todayScans = await db.transaction('scans').store.index('by-date').getAll(todayStr);
    const studentScans = todayScans.filter(s => s.studentId === code && s.periodName === effectivePeriodName);
    
    // Movement type determination
    // If a purpose is explicitly set, use it. Otherwise, if it's the first scan, it's Attendance.
    const movementType = purpose || (studentScans.length === 0 ? 'Attendance' : 'Returned');
    const isAttendanceScan = movementType === 'Attendance';
    
    let manualStatus: 'Late' | undefined = undefined;

    // Attendance calculation logic - only for Attendance scans
    const effectiveStartTime = manualStartTime || currentPeriodConfig?.startTime;
    if (isAttendanceScan && effectiveStartTime) {
         const [baseH, baseM] = effectiveStartTime.split(':').map(Number);
         const baseMinutes = baseH * 60 + baseM;
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

  const manualMark = async (student: Student, forceStatus?: 'Present' | 'Late' | 'Absent', isExcused = false) => {
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
       return;
    }

    if (primaryScan) {
       const updated = { ...primaryScan, manualStatus: forceStatus || 'Present', isExcused };
       await db.put('scans', updated);
    } else {
       const scanEvent: ScanEvent = {
         id: `manual_${student.id}_${now}`,
         studentId: student.id,
         timestamp: now,
         date: format(new Date(now), 'yyyy-MM-dd'),
         periodName: activePeriodName,
         scheduleId: activeScheduleId,
         status: 'success',
         manualStatus: forceStatus || 'Present',
         isExcused
       };
       await db.put('scans', scanEvent);
    }

    toast.success(`${student.firstName} marked ${forceStatus || 'Present'}${isExcused ? ' (Excused)' : ''}`);
    await loadData();
    triggerAutoBackup();
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

  const logMovement = async (student: Student, reason: string | null) => {
    if (!activePeriodName || activePeriodName === 'all' || !activeScheduleId) return;
    const db = await getDB();
    const now = Date.now();
    
    const scanEvent: ScanEvent = {
      id: `${student.id}_log_${now}`,
      studentId: student.id,
      timestamp: now,
      date: format(new Date(now), 'yyyy-MM-dd'),
      periodName: activePeriodName,
      scheduleId: activeScheduleId,
      status: 'success',
      notes: reason || 'Returned'
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
    return scans.filter(s => s.movementType !== 'Attendance').sort((a,b) => b.timestamp - a.timestamp);
  };

  const rosterStudentIds = new Set(students.map(s => s.id));
  const logEntries = getActivityLog();

  const getMovementStatus = (studentId: string) => {
     const studentLogs = logEntries.filter(l => l.studentId === studentId);
     if (studentLogs.length === 0) return null;
     const latest = studentLogs[0]; // sorted desc
     if (['Bathroom', 'Nurse', 'Office', 'Guidance'].includes(latest.notes || '')) {
        return { out: true, reason: latest.notes, logId: latest.id, time: latest.timestamp };
     }
     return null;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] relative">
      {/* Fixed Sticky Header */}
      <div className="sticky top-0 z-10 bg-slate-50 border-b pb-1 mb-1">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2">
          <h2 className="text-xl font-black tracking-tight text-slate-800 leading-none">
             {isReady ? activePeriodName : 'Scanner Mode'}
          </h2>
          
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

        <Card className="bg-white border shadow-sm transition-colors border-indigo-100 overflow-hidden">
          <CardContent className="p-0">
            <form onSubmit={handleScan} className="flex h-8 items-stretch">
              <input 
                ref={inputRef}
                type="text" 
                className="flex-1 text-base px-3 focus:outline-none font-mono tracking-widest transition-all bg-transparent min-w-0"
                autoFocus
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                placeholder="PROMPT TO SCAN..."
              />
              <div className="hidden lg:flex bg-slate-50 px-2 items-center border-l gap-1">
                {['Bathroom', 'Nurse', 'Office', 'Guidance'].map(reason => (
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
            <span className="text-[10px] font-mono opacity-50 tabular-nums shrink-0">{format(new Date(lastScan.timestamp), 'h:mm:ss a')}</span>
          </div>
        )}
      </div>
      
      {/* Body Area */}
      <div className="flex-1 overflow-hidden flex flex-col gap-2">
        
        {/* Navigation Tabs & Sorting Options */}
        <div className="flex items-center justify-between gap-2">
           <div className="flex gap-1 p-0.5 bg-slate-100 rounded-md">
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
                 {logEntries.some(l => ['Bathroom', 'Nurse', 'Office', 'Guidance'].includes(l.notes || '')) && (
                    <span className="absolute -top-1 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                 )}
              </Button>
           </div>

           {view === 'attendance' && (
              <div className="flex items-center gap-1.5 p-0.5 bg-slate-100 rounded-md">
                 <span className="text-[8px] font-black text-slate-400 uppercase ml-2 mr-1">Sort Mode:</span>
                 <Button 
                    variant={sortBy === 'firstName' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    onClick={() => setSortBy('firstName')}
                    className={`h-6 px-3 text-[9px] font-bold uppercase ${sortBy === 'firstName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                 >
                    First Name
                 </Button>
                 <Button 
                    variant={sortBy === 'lastName' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    onClick={() => setSortBy('lastName')}
                    className={`h-6 px-3 text-[9px] font-bold uppercase ${sortBy === 'lastName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                 >
                    Last Name
                 </Button>
                 <Button 
                    variant={sortBy === 'status' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    onClick={() => setSortBy('status')}
                    className={`h-6 px-3 text-[9px] font-bold uppercase ${sortBy === 'status' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                 >
                    Status
                 </Button>
                 <Button 
                    variant={sortBy === 'rank' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    onClick={() => setSortBy('rank')}
                    className={`h-6 px-3 text-[9px] font-bold uppercase ${sortBy === 'rank' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                 >
                    Rank
                 </Button>
              </div>
           )}
        </div>

        {view === 'attendance' ? (
           <div className="flex-1 flex flex-col border rounded-lg bg-white shadow-sm overflow-hidden min-h-0">
             <div className="bg-slate-50 px-3 py-1 border-b flex justify-between items-center shrink-0">
                <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Attendance Roster</h3>
                <span className="text-[9px] text-slate-400 font-bold">{students.length} Students</span>
             </div>
             <div className="flex-1 overflow-y-auto overflow-x-hidden">
               <Table>
                 <TableHeader className="bg-slate-50/90 sticky top-0 z-20 backdrop-blur-sm shadow-sm">
                   <TableRow className="h-6 border-b-2 bg-slate-50">
                     <TableHead className="w-[180px] text-[10px] font-black uppercase py-0 px-2 h-6">Student Name</TableHead>
                     <TableHead className="w-[280px] text-[10px] font-black uppercase py-0 px-2 h-6 text-left text-slate-500">Quick Actions</TableHead>
                     <TableHead className="w-[140px] text-[10px] font-black uppercase py-0 px-2 h-6 text-center text-slate-500">Status</TableHead>
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
                        if (statusInfo.status === 'Absent') {
                          rowColor = 'bg-red-50/40';
                          nameColor = 'text-red-700';
                        } else if (statusInfo.status === 'Present') {
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
                               <TableCell className="w-[180px] py-0 px-2">
                                  <div className="flex items-center gap-2 overflow-hidden">
                                     <span className={`text-xs font-bold leading-none truncate ${nameColor}`}>{student.firstName} {student.lastName}</span>
                                     {student.gradebookRank && <span className="text-[9px] bg-indigo-50 text-indigo-500 font-black px-1 rounded-sm shadow-sm ring-1 ring-indigo-200">#{student.gradebookRank}</span>}
                                     <span className="text-[10px] text-slate-300 font-mono tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity leading-none uppercase shrink-0">{student.id}</span>
                                     {moveStatus?.out && (
                                        <span className="inline-flex items-center gap-1 font-black text-[10px] text-amber-600 uppercase bg-amber-50 px-2 rounded ring-1 ring-amber-100 leading-none py-1.5">
                                           {moveStatus.reason}
                                        </span>
                                     )}
                                  </div>
                               </TableCell>
                               <TableCell className="w-[280px] py-0 px-1.5 text-left">
                                  <div className="flex justify-start items-center gap-2">
                                    {statusInfo.status === 'Absent' ? (
                                       <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <Button variant="outline" size="sm" onClick={() => manualMark(student, 'Present')} className="h-6 text-xs font-bold bg-green-50 text-green-700 px-3 border-green-200 uppercase">IN</Button>
                                          <Button variant="outline" size="sm" onClick={() => manualMark(student, 'Late')} className="h-6 text-xs font-bold bg-amber-50 text-amber-700 px-3 border-amber-200 uppercase">LATE</Button>
                                       </div>
                                    ) : (
                                       <div className="flex items-center gap-2.5">
                                          <div className="flex gap-2 mr-1 pr-1 border-r border-slate-100 opacity-20 group-hover:opacity-100 transition-opacity">
                                             {moveStatus?.out ? (
                                                <Button 
                                                   variant="secondary" 
                                                   size="sm" 
                                                   onClick={() => logMovement(student, null)}
                                                   className="h-6 px-4 text-[10px] bg-amber-500 text-white font-black uppercase hover:bg-amber-600"
                                                >
                                                   IN ROOM
                                                </Button>
                                             ) : (
                                                ['B', 'N', 'O', 'G'].map(char => {
                                                  const labelMap: Record<string, string> = { 'B': 'Bathroom', 'N': 'Nurse', 'O': 'Office', 'G': 'Guidance' };
                                                  return (
                                                      <Button 
                                                         key={char}
                                                         variant="ghost" 
                                                         size="sm" 
                                                         onClick={() => logMovement(student, labelMap[char])}
                                                         className="h-6 w-6 p-0 text-sm font-bold text-slate-300 hover:text-indigo-600 hover:bg-indigo-50"
                                                         title={labelMap[char]}
                                                      >
                                                         {char}
                                                      </Button>
                                                  )
                                                })
                                             )}
                                          </div>
                                          <Button variant="ghost" size="sm" onClick={() => toggleExcused(student)} className={`h-6 px-3 text-xs font-bold uppercase transition-colors ${statusInfo.excused ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-slate-600'}`}>
                                             {statusInfo.excused ? 'EXC' : 'PASS'}
                                          </Button>
                                          <Button variant="ghost" size="sm" onClick={() => toggleNoPass(student)} className={`h-6 px-3 text-[10px] tracking-tight font-black uppercase transition-colors ${statusInfo.noPass ? 'bg-red-600 text-white' : 'text-slate-300 hover:text-slate-600'}`}>
                                             NO PASS
                                          </Button>
                                          <Button variant="ghost" size="sm" onClick={() => manualMark(student, 'Absent')} className="h-6 w-6 p-0 text-sm text-red-200 hover:text-red-500 hover:bg-red-50 transition-colors uppercase font-black ml-1">X</Button>
                                       </div>
                                    )}
                                  </div>
                               </TableCell>
                               <TableCell className="w-[140px] py-0 px-1.5 text-center">
                                   <div className="flex items-center justify-center gap-2">
                                    {statusInfo.status === 'OnTime' && <span className="px-2.5 py-1 rounded-[2px] text-xs font-black bg-green-100 text-green-700 border border-green-200 uppercase">ON TIME</span>}
                                    {statusInfo.status === 'Late' && <span className="px-2.5 py-1 rounded-[2px] text-xs font-black bg-amber-100 text-amber-700 border border-amber-200 uppercase">LATE</span>}
                                    {statusInfo.status === 'Present' && <span className="px-2.5 py-1 rounded-[2px] text-xs font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase">PRESENT</span>}
                                    {statusInfo.status === 'Absent' && <span className="px-2.5 py-1 rounded-[2px] text-xs font-black bg-slate-50 text-slate-300 border border-slate-100 uppercase">ABSENT</span>}
                                    {statusInfo.excused && <span className="px-2.5 py-1 rounded-[2px] text-[10px] font-black bg-blue-600 text-white shadow-sm uppercase tracking-tighter">Pass</span>}
                                    {statusInfo.noPass && <span className="px-2.5 py-1 rounded-[2px] text-[10px] font-black bg-red-600 text-white shadow-sm uppercase tracking-tighter">No Pass</span>}
                                    {statusInfo.time && (
                                       <div className="flex items-center gap-1 group/time ml-2">
                                          <span className="text-base text-slate-400 font-mono opacity-70 leading-none whitespace-nowrap">{format(new Date(statusInfo.time), 'h:mm a')}</span>
                                          <button onClick={() => statusInfo.scanId && openEditTime(statusInfo.scanId, statusInfo.time!)} className="opacity-0 group-hover/time:opacity-100 p-0.5 text-slate-300 hover:text-indigo-600 transition-opacity" title="Edit Time">
                                             <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                       </div>
                                    )}
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
           <div className="flex-1 flex flex-row gap-4 overflow-hidden min-h-0">
              {/* Column 1: ROSTER */}
              <div className="w-[30%] flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden min-h-0">
                 <div className="bg-slate-50 px-3 py-2 border-b flex justify-between items-center shrink-0">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Student Roster</h3>
                    <span className="text-[10px] text-slate-400 font-bold">{sortedStudents.length}</span>
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
                                         {['B', 'N', 'O', 'G'].map(char => {
                                            const labelMap: Record<string, string> = { 'B': 'Bathroom', 'N': 'Nurse', 'O': 'Office', 'G': 'Guidance' };
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
              <div className="w-[30%] flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden min-h-0">
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
                 <div className="flex-1 overflow-y-auto">
                    <Table>
                       <TableHeader className="bg-slate-50 sticky top-0 z-20">
                          <TableRow>
                             <TableHead className="w-1/4">Student</TableHead>
                             <TableHead>Activity</TableHead>
                             <TableHead className="text-right">Time</TableHead>
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
                                      {['Bathroom', 'Nurse', 'Office', 'Guidance', 'Returned'].map(r => (
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
                                         const db = await getDB();
                                         await db.delete('scans', log.id);
                                         loadData();
                                      }} className="h-4 px-1 text-[8px] text-red-300 hover:text-red-500 font-bold uppercase invisible group-hover:visible">Delete</Button>
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

      </div>
    </div>
  );
}
