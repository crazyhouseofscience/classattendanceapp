/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { ScannerTab } from './components/ScannerTab';
import { StudentsTab } from './components/StudentsTab';
import { SchedulesTab } from './components/SchedulesTab';
import { ReportsTab } from './components/ReportsTab';
import { BehaviorTab } from './components/BehaviorTab';
import { initDefaultData, getDB, Schedule } from './lib/db';
import { backupToDrive, initGoogleIdentity } from './lib/gdrive';
import { Toaster, toast } from 'sonner';
import { CloudUpload, WifiOff, RefreshCw, Clock, Download, ShieldCheck, Upload } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-1.5 text-slate-500 font-bold bg-slate-50 px-2 py-1 rounded border border-slate-200">
      <Clock className="w-3 h-3 text-indigo-500" />
      <span className="text-[10px] uppercase tracking-tighter tabular-nums">
        {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}

export default function App() {
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [activePeriodName, setActivePeriodName] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isAutoSync, setIsAutoSync] = useState(true);

  useEffect(() => {
    initDefaultData().then(async () => {
      const db = await getDB();
      const allSchedules = await db.getAll('schedules');
      allSchedules.sort((a, b) => {
        const aDay = a.daysOfWeek?.[0] ?? 99;
        const bDay = b.daysOfWeek?.[0] ?? 99;
        return aDay - bDay;
      });
      setSchedules(allSchedules);
      
      const activeScheduleSetting = await db.get('settings', 'activeScheduleId');
      if (activeScheduleSetting) setActiveScheduleId(activeScheduleSetting.value);

      const activePeriod = await db.get('settings', 'activePeriodName');
      if (activePeriod) setActivePeriodName(activePeriod.value);
    });
    
    initGoogleIdentity();

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Time-based auto-sync for schedule and period
  useEffect(() => {
    if (!isAutoSync || schedules.length === 0) return;

    const checkTime = () => {
      const now = new Date();
      const currentDay = now.getDay();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      // 1. Find today's schedule
      let targetSchedule = schedules.find(s => s.daysOfWeek?.includes(currentDay));
      if (!targetSchedule) {
         targetSchedule = schedules.find(s => s.id === activeScheduleId) || schedules[0];
      }

      if (targetSchedule) {
        if (activeScheduleId !== targetSchedule.id) {
           setActiveScheduleId(targetSchedule.id);
           getDB().then(db => db.put('settings', { key: 'activeScheduleId', value: targetSchedule.id }));
        }

        // 2. Find current or next period based on time
        let targetPeriod = targetSchedule.periods.find(p => p.startTime <= timeStr && p.endTime >= timeStr);
        if (!targetPeriod) {
           // If between periods, auto-select the next upcoming period
           targetPeriod = targetSchedule.periods.find(p => p.startTime > timeStr);
        }

        if (targetPeriod && activePeriodName !== targetPeriod.name) {
           setActivePeriodName(targetPeriod.name);
           getDB().then(db => db.put('settings', { key: 'activePeriodName', value: targetPeriod.name }));
        }
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [isAutoSync, schedules, activeScheduleId, activePeriodName]);

  const handleActiveScheduleChange = async (val: string) => {
    setIsAutoSync(false);
    setActiveScheduleId(val);
    const db = await getDB();
    await db.put('settings', { key: 'activeScheduleId', value: val });
    
    // Auto-select first period of the new schedule if none is selected
    const schedule = schedules.find(s => s.id === val);
    if (schedule && schedule.periods && schedule.periods.length > 0) {
      handleActivePeriodChange(schedule.periods[0].name, false);
    } else {
      handleActivePeriodChange('all', false);
    }
  };

  const handleActivePeriodChange = async (val: string, manual = true) => {
    if (manual) setIsAutoSync(false);
    setActivePeriodName(val);
    const db = await getDB();
    await db.put('settings', { key: 'activePeriodName', value: val });
  };

  const activeSchedule = schedules.find(s => s.id === activeScheduleId);

  const handleBackup = async () => {
    try {
      toast.info('Starting backup...');
      const res = await backupToDrive();
      toast.success('Backup complete!');
    } catch (e: any) {
      toast.error('Backup failed. Missing Google Drive Client ID in settings, or user cancelled.');
    }
  };

  const handleLocalExport = async () => {
    try {
      const db = await getDB();
      const students = await db.getAll('students');
      const schedules = await db.getAll('schedules');
      const scans = await db.getAll('scans');
      const settings = await db.getAll('settings');
      
      const exportData = {
        students,
        schedules,
        scans,
        settings,
        exportDate: new Date().toISOString(),
        version: '1.0'
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `k12_scanner_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Data exported locally!');
    } catch (e: any) {
      toast.error('Export failed');
    }
  };

  const handleLocalImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
             const data = JSON.parse(event.target?.result as string);
             if (!data.version || !data.students) throw new Error("Invalid format");
             
             const db = await getDB();
             
             await db.clear('students');
             await db.clear('schedules');
             await db.clear('scans');
             
             if (data.students) for (const item of data.students) await db.put('students', item);
             if (data.schedules) for (const item of data.schedules) await db.put('schedules', item);
             if (data.scans) for (const item of data.scans) await db.put('scans', item);
             if (data.settings) for (const item of data.settings) await db.put('settings', item);

             toast.success('Data imported successfully! Reloading...');
             setTimeout(() => window.location.reload(), 1000);
          } catch(err) {
             toast.error('Invalid backup file');
          }
        };
        reader.readAsText(file);
      } catch (e: any) {
        toast.error('Import failed');
      }
    };
    input.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-2">
      {/* Top Banner - Slim version */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-2 h-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-black tracking-tighter text-indigo-600">K-12 Scanner</h1>
            {isOffline && (
              <span className="flex items-center gap-1 text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                <WifiOff className="w-3 h-3" /> Offline
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <LiveClock />
            {!isAutoSync && (
              <button 
                onClick={() => setIsAutoSync(true)} 
                className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-1 rounded-full flex items-center gap-1 hover:bg-indigo-200 transition-colors"
              >
                <RefreshCw className="w-3 h-3 animate-spin duration-[3000ms]" /> Auto-Sync
              </button>
            )}
            
            <div className={`flex items-center gap-1.5 transition-opacity ${isAutoSync ? 'opacity-70' : ''}`}>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Schedule:</span>
              <Select value={activeScheduleId || ''} onValueChange={handleActiveScheduleChange}>
                <SelectTrigger className="w-[130px] h-8 text-xs font-bold border-slate-200 bg-white">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name || 'Unnamed'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className={`flex items-center gap-1.5 transition-opacity ${isAutoSync ? 'opacity-70' : ''}`}>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Period:</span>
              <Select value={activePeriodName || 'all'} onValueChange={(val) => handleActivePeriodChange(val)}>
                <SelectTrigger className="w-[120px] h-8 text-xs font-bold border-slate-200 bg-white">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Open Scan</SelectItem>
                  {activeSchedule?.periods.map(p => (
                    <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-1 h-8 bg-white border border-slate-200 rounded-md p-0.5 shadow-sm">
               <button 
                 onClick={handleLocalImport}
                 className="flex items-center gap-1.5 h-full px-2 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50 transition-colors"
                 title="Import data from your computer"
               >
                 <Upload className="w-3 h-3" /> Import
               </button>
               <button 
                 onClick={handleLocalExport}
                 className="flex items-center gap-1.5 h-full px-2 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50 transition-colors"
                 title="Download data to your computer"
               >
                 <Download className="w-3 h-3" /> Export
               </button>
               <div className="w-[1px] h-3 bg-slate-200 mx-0.5" />
               <button 
                 onClick={handleBackup}
                 className="flex items-center gap-1.5 h-full px-2 text-[9px] font-black uppercase bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                 title="Backup to your Google Drive"
               >
                 <CloudUpload className="w-3 h-3" /> Backup
               </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-2 py-1">
        <Tabs defaultValue="scanner" className="space-y-1">
          <TabsList className="bg-slate-100 border p-0.5 h-7 w-fit">
            <TabsTrigger value="scanner" className="h-6 px-3 text-[10px] font-black uppercase data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shadow-none">Scanner</TabsTrigger>
            <TabsTrigger value="students" className="h-6 px-3 text-[10px] font-black uppercase data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shadow-none">Students</TabsTrigger>
            <TabsTrigger value="reports" className="h-6 px-3 text-[10px] font-black uppercase data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shadow-none">Reports</TabsTrigger>
            <TabsTrigger value="behavior" className="h-6 px-3 text-[10px] font-black uppercase data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shadow-none">Behavior</TabsTrigger>
            <TabsTrigger value="schedules" className="h-6 px-3 text-[10px] font-black uppercase data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shadow-none">Schedules</TabsTrigger>
          </TabsList>
          
          <TabsContent value="scanner" className="pt-1">
            <ScannerTab activeScheduleId={activeScheduleId} activePeriodName={activePeriodName} activeSchedule={activeSchedule} />
          </TabsContent>
          
          <TabsContent value="students" className="pt-1">
            <StudentsTab activePeriodName={activePeriodName} activeSchedule={activeSchedule} />
          </TabsContent>

          <TabsContent value="reports" className="pt-1">
            <ReportsTab 
               activePeriodName={activePeriodName} 
               activeScheduleId={activeScheduleId} 
               activeSchedule={activeSchedule} 
               />
          </TabsContent>

          <TabsContent value="schedules" className="pt-1">
            <SchedulesTab />
          </TabsContent>

          <TabsContent value="behavior" className="pt-1">
            <BehaviorTab />
          </TabsContent>
        </Tabs>
      </main>
      
      {/* Privacy & Attribution Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-3 flex flex-col items-center gap-1.5 border-t mt-4">
         <div className="flex items-center gap-2 text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <p className="text-[10px] font-bold uppercase tracking-wider">Privacy First Data Storage</p>
         </div>
         <p className="text-[10px] text-slate-400 text-center max-w-lg leading-relaxed">
            This application stores all student data <strong>locally in your browser</strong>. 
            No data is uploaded to our servers. Your data only leaves this device if you explicitly use the "Backup" (to your personal Google Drive) or "Export" buttons above.
         </p>
         <p className="text-[9px] text-slate-400 mt-1 font-medium tracking-wide">
            Designed by Keith Chapman v 1.0 2026 with Google AI Studio
         </p>
      </footer>

      <Toaster position="top-center" richColors />
    </div>
  );
}
