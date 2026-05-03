import React, { useState, useEffect } from 'react';
import { getDB, ScanEvent, Student, Schedule, BehaviorEvent } from '../lib/db';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { format } from 'date-fns';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { FileDown, CloudUpload } from 'lucide-react';
import { toast } from 'sonner';

interface ReportsTabProps {
  activePeriodName: string | null;
  activeScheduleId: string | null;
  activeSchedule?: Schedule;
}

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

export function ReportsTab({ activePeriodName, activeScheduleId, activeSchedule }: ReportsTabProps) {
  const [activeTab, setActiveTab] = useState<'logs' | 'student-summary' | 'class-summary'>('logs');
  const [scans, setScans] = useState<(ScanEvent & { studentInfo?: Student })[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [allBehaviors, setAllBehaviors] = useState<BehaviorEvent[]>([]);
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sortBy, setSortBy] = useState<'time' | 'firstName' | 'lastName' | 'rank' | 'pos' | 'neg' | 'abs' | 'late' | 'status'>('lastName');
  const [gracePeriod, setGracePeriod] = useState(5);
  const [manualStartTimes, setManualStartTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
    loadSettings();
  }, [startDate, endDate, activePeriodName, sortBy, activeTab]);

  async function loadSettings() {
    const db = await getDB();
    const gpSetting = await db.get('settings', 'grace_period');
    if (gpSetting) setGracePeriod(gpSetting.value);

    // Load overrides for the visible range (simple approach: load all starting with 'override_')
    const allSettings = await db.getAll('settings');
    const overrides: Record<string, string> = {};
    allSettings.forEach(s => {
      if (s.key.startsWith('override_') && !s.key.startsWith('override_end_')) {
        overrides[s.key] = s.value;
      }
    });
    setManualStartTimes(overrides);
  }

  async function loadData() {
    const db = await getDB();
    
    const students = await db.getAll('students');
    setAllStudents(students);

    if (activeTab === 'logs') {
      const index = db.transaction('scans').store.index('by-date');
      const allScans = await index.getAll(startDate);

      const populated = await Promise.all(allScans.map(async (scan) => {
        const student = students.find(s => s.id === scan.studentId);
        return { ...scan, studentInfo: student };
      }));

      let filtered = (activePeriodName && activePeriodName !== 'all') 
        ? populated.filter(s => s.periodName === activePeriodName)
        : populated;

      if (sortBy === 'time') {
        filtered.sort((a, b) => b.timestamp - a.timestamp);
      } else if (sortBy === 'lastName') {
        filtered.sort((a, b) => (a.studentInfo?.lastName || '').localeCompare(b.studentInfo?.lastName || ''));
      } else if (sortBy === 'firstName') {
        filtered.sort((a, b) => (a.studentInfo?.firstName || '').localeCompare(b.studentInfo?.firstName || ''));
      } else if (sortBy === 'rank') {
        filtered.sort((a, b) => parseInt(a.studentInfo?.gradebookRank || '9999') - parseInt(b.studentInfo?.gradebookRank || '9999'));
    } else if (sortBy === 'id') {
        filtered.sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
      } else if (sortBy === 'status') {
        filtered.sort((a, b) => {
          const statusA = getScanStatus(a).status;
          const statusB = getScanStatus(b).status;
          return statusA.localeCompare(statusB);
        });
      }
      setScans(filtered);
    } else {
      const behaviorStore = db.transaction('behaviors').store;
      const scanStore = db.transaction('scans').store;
      
      const rawScans = await scanStore.getAll();
      const rawBehaviors = await behaviorStore.getAll();
      
      const filteredScans = rawScans.filter(s => {
        if (s.date < startDate || s.date > endDate) return false;
        if (activePeriodName && activePeriodName !== 'all' && s.periodName !== activePeriodName) return false;
        return true;
      });
      const filteredBehaviors = rawBehaviors.filter((b: any) => {
        if (b.date < startDate || b.date > endDate) return false;
        if (activePeriodName && activePeriodName !== 'all' && b.periodName && b.periodName !== activePeriodName) return false;
        return true;
      });
      
      setScans(filteredScans as any);
      setAllBehaviors(filteredBehaviors);
    }
  }

  const getScanStatus = (scan: ScanEvent) => {
    const effectiveMovementType = scan.movementType || (['Bathroom', 'Nurse', 'Office', 'Guidance', 'Returned'].includes(scan.notes || '') ? scan.notes : undefined);
    if (effectiveMovementType && effectiveMovementType !== 'Attendance') {
      return { status: effectiveMovementType.toUpperCase(), color: 'bg-blue-100 text-blue-800' };
    }
    
    if (scan.status === 'unknown_barcode') return { status: 'NOT FOUND', color: 'bg-red-100 text-red-800' };
    if (scan.status === 'not_in_period') return { status: 'NOT IN ROSTER', color: 'bg-amber-100 text-amber-800' };

    if (scan.manualStatus) {
      return { 
        status: scan.manualStatus.toUpperCase(), 
        color: scan.manualStatus === 'Late' ? 'bg-amber-600 text-white' : scan.manualStatus === 'Absent' ? 'bg-red-600 text-white' : 'bg-green-600 text-white' 
      };
    }

    const periodConfig = activeSchedule?.periods.find(p => p.name === scan.periodName);
    const overrideKey = `override_${scan.date}_${activeScheduleId}_${scan.periodName}`;
    const manualStartTime = manualStartTimes[overrideKey];
    const effectiveStartTime = manualStartTime || periodConfig?.startTime;

    if (effectiveStartTime) {
        const [baseH, baseM] = effectiveStartTime.split(':').map(Number);
        const baseMinutes = baseH * 60 + baseM;
        const cutoffMinutes = baseMinutes + gracePeriod;

        const scanDate = new Date(scan.timestamp);
        const scanMinutes = scanDate.getHours() * 60 + scanDate.getMinutes();

        if (scanMinutes > cutoffMinutes) {
            return { status: 'LATE', color: 'bg-amber-600 text-white' };
        }
    }
    
    return { status: 'ON TIME', color: 'bg-green-600 text-white' };
  };

  const getStatsForStudent = (studentId: string) => {
    const studentScans = scans.filter(s => s.studentId === studentId);
    const studentBehaviors = allBehaviors.filter(b => b.studentId === studentId);

    const pos = studentBehaviors.filter(b => b.type === 'Positive').length;
    const neg = studentBehaviors.filter(b => b.type === 'Negative').length;
    const neu = studentBehaviors.filter(b => b.type === 'Neutral').length;

    const abs = studentScans.filter(s => s.manualStatus === 'Absent').length;
    const lates = studentScans.filter(s => {
      if (s.manualStatus === 'Late') return true;
      const status = getScanStatus(s);
      return status.status === 'LATE';
    }).length;

    return { pos, neg, neu, abs, lates, total: pos - neg };
  };

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

  const studentsToDisplay = (activePeriodName && activePeriodName !== 'all')
    ? allStudents.filter(s => isStudentInPeriod(s, activePeriodName))
    : allStudents;

  if (activeTab === 'student-summary') {
      if (sortBy === 'lastName') {
          studentsToDisplay.sort((a, b) => a.lastName.localeCompare(b.lastName));
      } else if (sortBy === 'firstName') {
          studentsToDisplay.sort((a, b) => a.firstName.localeCompare(b.firstName));
      } else if (sortBy === 'id') {
          studentsToDisplay.sort((a, b) => a.id.localeCompare(b.id));
      } else if (sortBy === 'rank') {
          studentsToDisplay.sort((a, b) => parseInt(a.gradebookRank || '9999') - parseInt(b.gradebookRank || '9999'));
      } else if (sortBy === 'pos') {
          studentsToDisplay.sort((a, b) => getStatsForStudent(b.id).pos - getStatsForStudent(a.id).pos);
      } else if (sortBy === 'neg') {
          studentsToDisplay.sort((a, b) => getStatsForStudent(b.id).neg - getStatsForStudent(a.id).neg);
      } else if (sortBy === 'abs') {
          studentsToDisplay.sort((a, b) => getStatsForStudent(b.id).abs - getStatsForStudent(a.id).abs);
      } else if (sortBy === 'late') {
          studentsToDisplay.sort((a, b) => getStatsForStudent(b.id).lates - getStatsForStudent(a.id).lates);
      }
  }

  const exportToCSV = () => {
    if (scans.length === 0 && allBehaviors.length === 0) {
      toast.error('No data to export');
      return;
    }

    let headers: string[] = [];
    let rows: any[][] = [];
    let fileName = '';

    if (activeTab === 'logs') {
      headers = ['Timestamp', 'Date', 'Period', 'Barcode/ID', 'First Name', 'Last Name', 'Status', 'Pass', 'Reason/Notes'];
      rows = scans.map(s => [
        format(new Date(s.timestamp), 'h:mm:ss a'),
        s.date,
        s.periodName,
        s.studentId,
        s.studentInfo?.firstName || 'Unknown',
        s.studentInfo?.lastName || 'Unknown',
        getScanStatus(s).status,
        s.isExcused ? 'Pass' : s.hasNoPass ? 'No Pass' : '',
        (s.notes || '').replace(/,/g, ';')
      ]);
      fileName = `attendance_report_${startDate}.csv`;
    } else if (activeTab === 'student-summary') {
      headers = ['Barcode/ID', 'First Name', 'Last Name', 'Absences', 'Lates', 'Positive', 'Negative', 'Total Score'];
      rows = studentsToDisplay.map(s => {
        const stats = getStatsForStudent(s.id);
        return [s.id, s.firstName, s.lastName, stats.abs, stats.lates, stats.pos, stats.neg, stats.total];
      });
      fileName = `student_summary_${startDate}_to_${endDate}.csv`;
    } else {
        const stats = studentsToDisplay.reduce((acc, s) => {
            const sStat = getStatsForStudent(s.id);
            acc.abs += sStat.abs;
            acc.late += sStat.lates;
            acc.pos += sStat.pos;
            acc.neg += sStat.neg;
            return acc;
        }, { abs: 0, late: 0, pos: 0, neg: 0 });

        headers = ['Metric', 'Value'];
        rows = [
            ['Total Absences', stats.abs],
            ['Total Lates', stats.late],
            ['Total Positive Behaviors', stats.pos],
            ['Total Negative Behaviors', stats.neg],
            ['Student Count', studentsToDisplay.length]
        ];
        fileName = `class_summary_${startDate}_to_${endDate}.csv`;
    }

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Report exported to CSV');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-800">Reports & Analytics</h2>
          <div className="flex gap-4 mt-1">
              <button 
                onClick={() => setActiveTab('logs')}
                className={cn("text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-colors", activeTab === 'logs' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
              >Daily Logs</button>
              <button 
                onClick={() => setActiveTab('student-summary')}
                className={cn("text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-colors", activeTab === 'student-summary' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
              >Student Summary</button>
              <button 
                onClick={() => setActiveTab('class-summary')}
                className={cn("text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-colors", activeTab === 'class-summary' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
              >Class Summary</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
              <Input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
                className="w-32 h-7 text-[10px] font-bold border-none bg-transparent shadow-none focus-visible:ring-0" 
              />
              {activeTab !== 'logs' && (
                  <>
                    <span className="text-[10px] font-bold text-slate-300">/</span>
                    <Input 
                      type="date" 
                      value={endDate} 
                      onChange={e => setEndDate(e.target.value)} 
                      className="w-32 h-7 text-[10px] font-bold border-none bg-transparent shadow-none focus-visible:ring-0" 
                    />
                  </>
              )}
          </div>
          <Button 
            onClick={exportToCSV} 
            variant="outline" 
            size="sm" 
            className="h-9 gap-2 text-[10px] font-black uppercase text-indigo-600 border-indigo-200 hover:bg-indigo-50 shadow-sm"
          >
            <FileDown className="w-3.5 h-3.5" /> Export
          </Button>
          <Button 
            onClick={async () => {
              try {
                toast.info('Starting backup...');
                const { backupToDrive } = await import('../lib/gdrive');
                await backupToDrive();
                toast.success('Backup complete!');
              } catch (e: any) {
                toast.error('Backup failed. Check settings.');
              }
            }} 
            variant="default" 
            size="sm" 
            className="h-9 gap-2 text-[10px] font-black uppercase bg-indigo-600 hover:bg-indigo-700 shadow-sm"
          >
            <CloudUpload className="w-3.5 h-3.5" /> Backup
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
         <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">Sort:</span>
         <div className="flex bg-slate-100 rounded-lg p-0.5 shrink-0">
             <Button variant={sortBy === 'lastName' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('lastName')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'lastName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Last</Button>
             <Button variant={sortBy === 'firstName' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('firstName')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'firstName' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>First</Button>
             <Button variant={sortBy === 'id' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('id')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'id' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>ID</Button>
             <Button variant={sortBy === 'rank' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('rank')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'rank' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Rank</Button>
             {activeTab === 'logs' && (
               <>
                <Button variant={sortBy === 'time' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('time')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'time' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Time</Button>
                <Button variant={sortBy === 'status' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('status')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'status' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Status</Button>
               </>
             )}
             {activeTab === 'student-summary' && (
                 <>
                    <Button variant={sortBy === 'pos' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('pos')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'pos' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Pos</Button>
                    <Button variant={sortBy === 'neg' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('neg')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'neg' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Neg</Button>
                    <Button variant={sortBy === 'abs' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('abs')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'abs' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Abs</Button>
                    <Button variant={sortBy === 'late' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortBy('late')} className={`h-7 px-3 text-[10px] font-bold uppercase ${sortBy === 'late' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Late</Button>
                 </>
             )}
         </div>
      </div>

      <div className="border rounded-xl bg-white overflow-x-auto shadow-sm border-slate-200 min-w-0">
        {activeTab === 'logs' && (
            <Table className="min-w-[600px]">
              <TableHeader className="bg-slate-50/50">
                <TableRow className="hover:bg-transparent border-slate-200">
                  <TableHead onClick={() => setSortBy('time')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">Time</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-slate-500 h-10">Period</TableHead>
                  <TableHead onClick={() => setSortBy('id')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">ID</TableHead>
                  <TableHead onClick={() => setSortBy(sortBy === 'lastName' ? 'firstName' : 'lastName')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">Student Name</TableHead>
                  <TableHead onClick={() => setSortBy('status')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-16 text-xs font-medium italic">No scans found for this selection.</TableCell></TableRow>
                ) : (
                  scans.map(s => (
                    <TableRow key={s.id} className="hover:bg-slate-50/50 transition-colors border-slate-100">
                      <TableCell className="text-[11px] font-medium text-slate-600">{format(new Date(s.timestamp), 'h:mm a')}</TableCell>
                      <TableCell className="text-[11px] font-medium text-slate-500">{s.periodName}</TableCell>
                      <TableCell className="text-[11px] font-mono text-slate-400">{s.studentId}</TableCell>
                      <TableCell className="text-[11px] font-bold text-slate-700">
                        {s.studentInfo ? `${s.studentInfo.firstName} ${s.studentInfo.lastName}` : <span className="text-red-400">Unknown</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-black uppercase text-[9px]">
                        {(() => {
                            const { status, color } = getScanStatus(s);
                            return <span className={cn("px-2 py-0.5 rounded shadow-sm", color)}>{status}</span>;
                        })()}
                        {s.isExcused && <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm">PASS</span>}
                        {s.hasNoPass && <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 shadow-sm">NO PASS</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        )}

        {activeTab === 'student-summary' && (
            <Table className="min-w-[600px]">
              <TableHeader className="bg-slate-50/50">
                <TableRow className="hover:bg-transparent border-slate-200">
                  <TableHead onClick={() => setSortBy('id')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">ID</TableHead>
                  <TableHead onClick={() => setSortBy(sortBy === 'lastName' ? 'firstName' : 'lastName')} className="text-[10px] font-bold uppercase text-slate-500 h-10 cursor-pointer hover:text-indigo-600">Student Name</TableHead>
                  <TableHead onClick={() => setSortBy('abs')} className="text-[10px] font-bold uppercase text-slate-500 text-center h-10 cursor-pointer hover:text-indigo-600">Abs</TableHead>
                  <TableHead onClick={() => setSortBy('late')} className="text-[10px] font-bold uppercase text-slate-500 text-center h-10 cursor-pointer hover:text-indigo-600">Late</TableHead>
                  <TableHead onClick={() => setSortBy('pos')} className="text-[10px] font-bold uppercase text-slate-500 text-center h-10 cursor-pointer hover:text-indigo-600">Pos</TableHead>
                  <TableHead onClick={() => setSortBy('neg')} className="text-[10px] font-bold uppercase text-slate-500 text-center h-10 cursor-pointer hover:text-indigo-600">Neg</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-slate-500 text-right h-10">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {studentsToDisplay.map(student => {
                  const stats = getStatsForStudent(student.id);
                  return (
                    <TableRow key={student.id} className="hover:bg-slate-50/50 transition-colors border-slate-100">
                      <TableCell className="text-[11px] font-mono text-slate-500">{student.id}</TableCell>
                      <TableCell className="text-[11px] font-bold text-slate-700">{student.firstName} {student.lastName}</TableCell>
                      <TableCell className="text-[11px] text-center font-mono text-red-500 font-bold">{stats.abs}</TableCell>
                      <TableCell className="text-[11px] text-center font-mono text-amber-600 font-bold">{stats.lates}</TableCell>
                      <TableCell className="text-[11px] text-center font-mono text-emerald-600 font-bold">{stats.pos}</TableCell>
                      <TableCell className="text-[11px] text-center font-mono text-red-600 font-bold">{stats.neg}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono font-black text-indigo-600">{stats.total}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        )}

        {activeTab === 'class-summary' && (
            <div className="p-8 bg-slate-50/30">
                {(() => {
                    const stats = studentsToDisplay.reduce((acc, s) => {
                        const sStat = getStatsForStudent(s.id);
                        acc.abs += sStat.abs;
                        acc.late += sStat.lates;
                        acc.pos += sStat.pos;
                        acc.neg += sStat.neg;
                        return acc;
                    }, { abs: 0, late: 0, pos: 0, neg: 0 });

                    return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <StatCard label="Absences" value={stats.abs} color="red" />
                            <StatCard label="Lates" value={stats.late} color="amber" />
                            <StatCard label="Pos Behavior" value={stats.pos} color="emerald" />
                            <StatCard label="Neg Behavior" value={stats.neg} color="slate" />
                        </div>
                    );
                })()}
            </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string, value: number, color: string }) {
    const colors: Record<string, string> = {
        red: "bg-red-50 border-red-100 text-red-600",
        amber: "bg-amber-50 border-amber-100 text-amber-600",
        emerald: "bg-emerald-50 border-emerald-100 text-emerald-600",
        slate: "bg-slate-100 border-slate-200 text-slate-700"
    };
    return (
        <div className={cn("p-5 rounded-2xl border shadow-sm transition-transform hover:scale-[1.02]", colors[color])}>
            <span className="block text-[10px] font-black uppercase opacity-60 tracking-wider mb-1">{label}</span>
            <span className="text-4xl font-black">{value}</span>
        </div>
    );
}
