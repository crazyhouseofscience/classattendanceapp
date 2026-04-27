import React, { useState, useEffect } from 'react';
import { getDB, ScanEvent, Student, Schedule } from '../lib/db';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { format } from 'date-fns';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';

interface ReportsTabProps {
  activePeriodName: string | null;
  activeScheduleId: string | null;
  activeSchedule?: Schedule;
}

export function ReportsTab({ activePeriodName, activeScheduleId, activeSchedule }: ReportsTabProps) {
  const [scans, setScans] = useState<(ScanEvent & { studentInfo?: Student })[]>([]);
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    loadScans();
  }, [filterDate, activePeriodName]);

  async function loadScans() {
    const db = await getDB();
    const index = db.transaction('scans').store.index('by-date');
    const allScans = await index.getAll(filterDate);

    // Populate student info
    const populated = await Promise.all(allScans.map(async (scan) => {
      const student = await db.get('students', scan.studentId);
      return { ...scan, studentInfo: student };
    }));

    // Filter by period if needed
    const filtered = (activePeriodName && activePeriodName !== 'all') 
      ? populated.filter(s => s.periodName === activePeriodName)
      : populated;

    // Sort by most recent
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    setScans(filtered);
  }

  const getScanStatus = (scan: ScanEvent) => {
     if (scan.movementType && scan.movementType !== 'Attendance') {
       return { status: scan.movementType, color: 'bg-blue-100 text-blue-800' };
     }
     
     if (scan.status === 'unknown_barcode') return { status: 'NOT FOUND', color: 'bg-red-100 text-red-800' };
     if (scan.status === 'not_in_period') return { status: 'NOT IN ROSTER', color: 'bg-amber-100 text-amber-800' };

     if (scan.manualStatus) {
       return { 
         status: scan.manualStatus.toUpperCase(), 
         color: scan.manualStatus === 'Late' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800' 
       };
     }

     const periodConfig = activeSchedule?.periods.find(p => p.name === scan.periodName);
     const overrideKey = `override_${filterDate}_${activeScheduleId}_${scan.periodName}`;
     const manualStartTime = localStorage.getItem(overrideKey);
     const effectiveStartTime = manualStartTime || periodConfig?.startTime;
     const gracePeriod = parseInt(localStorage.getItem('grace_period') || '5');

     if (effectiveStartTime) {
         const [baseH, baseM] = effectiveStartTime.split(':').map(Number);
         const baseMinutes = baseH * 60 + baseM;
         const cutoffMinutes = baseMinutes + gracePeriod;

         const scanDate = new Date(scan.timestamp);
         const scanH = scanDate.getHours();
         const scanM = scanDate.getMinutes();
         const scanMinutes = scanH * 60 + scanM;

         if (scanMinutes > cutoffMinutes) {
             return { status: 'LATE', color: 'bg-amber-100 text-amber-800' };
         }
     }
     
     return { status: 'ON TIME', color: 'bg-green-100 text-green-800' };
  };

  const exportToCSV = () => {
    if (scans.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Timestamp', 'Date', 'Period', 'Barcode/ID', 'First Name', 'Last Name', 'Status', 'Reason/Notes'];
    const rows = scans.map(s => [
      format(new Date(s.timestamp), 'h:mm:ss a'),
      s.date,
      s.periodName,
      s.studentId,
      s.studentInfo?.firstName || 'Unknown',
      s.studentInfo?.lastName || 'Unknown',
      getScanStatus(s).status,
      (s.notes || '').replace(/,/g, ';') // Avoid CSV issues with commas
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `attendance_report_${filterDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Report exported to CSV');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-800">Scan Reports</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-0.5">
            {activePeriodName && activePeriodName !== 'all' ? `Period: ${activePeriodName}` : 'All Periods'} • {format(new Date(filterDate + 'T12:00:00'), 'MMMM do, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={filterDate} 
            onChange={e => setFilterDate(e.target.value)} 
            className="w-36 h-8 text-xs font-bold border-slate-200" 
          />
          <Button 
            onClick={exportToCSV} 
            variant="outline" 
            size="sm" 
            className="h-8 gap-2 text-[10px] font-black uppercase text-indigo-600 border-indigo-200 hover:bg-indigo-50"
          >
            <FileDown className="w-3 h-3" /> CSV Export
          </Button>
        </div>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Barcode/ID</TableHead>
              <TableHead>Student Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-8">No scans recorded on this date for this period.</TableCell></TableRow>
            ) : (
              scans.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{format(new Date(s.timestamp), 'h:mm:ss a')}</TableCell>
                  <TableCell>{s.periodName}</TableCell>
                  <TableCell className="font-mono">{s.studentId}</TableCell>
                  <TableCell>
                    {s.studentInfo 
                      ? `${s.studentInfo.firstName} ${s.studentInfo.lastName}` 
                      : <span className="text-red-500 italic">Unknown</span>}
                  </TableCell>
                  <TableCell>
                    {(() => {
                        const { status, color } = getScanStatus(s);
                        return <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${color}`}>{status}</span>;
                    })()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
