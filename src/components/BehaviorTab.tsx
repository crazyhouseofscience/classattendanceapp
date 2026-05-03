import React, { useState, useEffect } from 'react';
import { getDB, Student, BehaviorEvent, ScanEvent } from '../lib/db';
import { triggerAutoBackup } from '../lib/gdrive';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { DndContext, closestCenter, DragEndEvent, useDraggable, useSensors, useSensor, PointerSensor } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Layout, Users as UsersIcon, Undo2, GripHorizontal, Settings, X, Plus, Trash2, Upload } from 'lucide-react';
import { cn, isStudentInPeriod } from '../lib/utils';

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

export function BehaviorTab({ activePeriodName, activeScheduleId }: { activePeriodName?: string | null, activeScheduleId?: string | null }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [behaviorsHistory, setBehaviorsHistory] = useState<BehaviorEvent[]>([]);
  const [behaviors, setBehaviors] = useState(DEFAULT_BEHAVIORS);
  const [absentStudents, setAbsentStudents] = useState<Set<string>>(new Set());
  const [lateStudents, setLateStudents] = useState<Set<string>>(new Set());
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [sortBy, setSortBy] = useState<'lastName' | 'firstName' | 'points' | 'rank' | 'id'>('lastName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<Student | null>(null);
  const [newComment, setNewComment] = useState('');
  const [layoutMode, setLayoutMode] = useState<'grid' | 'freeform'>('grid');
  const [compactMode, setCompactMode] = useState(false);
  const [showBehaviorManager, setShowBehaviorManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ...


  // Setup sensors for DND kit to ensure clicks inside draggable cards aren't blocked easily
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [activePeriodName, showOnlyActive, sortBy, sortOrder]);

  const loadData = async () => {
    const db = await getDB();
    const allStudents = await db.getAll('students');
    
    let filteredStudents = allStudents;
    if (activePeriodName && activePeriodName !== 'all') {
       filteredStudents = allStudents.filter(s => isStudentInPeriod(s, activePeriodName));
    }
    
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const index = db.transaction('behaviors').store.index('by-date');
    const todayBehaviors = await index.getAll(todayStr);
    setBehaviorsHistory(todayBehaviors);

    if (showOnlyActive) {
       filteredStudents = filteredStudents.filter(s => todayBehaviors.some(b => b.studentId === s.id));
    }
    
    if (searchQuery) {
       filteredStudents = filteredStudents.filter(s => 
           `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.toLowerCase())
       );
    }
    
    // Sort students
    filteredStudents.sort((a, b) => {
        if (sortBy === 'lastName') {
            return sortOrder === 'asc' 
                ? a.lastName.localeCompare(b.lastName) 
                : b.lastName.localeCompare(a.lastName);
        } else if (sortBy === 'firstName') {
            return sortOrder === 'asc' 
                ? a.firstName.localeCompare(b.firstName) 
                : b.firstName.localeCompare(a.firstName);
        } else if (sortBy === 'rank') {
            return sortOrder === 'asc' 
                ? parseInt(a.gradebookRank || '9999') - parseInt(b.gradebookRank || '9999')
                : parseInt(b.gradebookRank || '9999') - parseInt(a.gradebookRank || '9999');
        } else if (sortBy === 'id') {
            return sortOrder === 'asc' 
                ? a.id.localeCompare(b.id) 
                : b.id.localeCompare(a.id);
        } else {
            const aPoints = todayBehaviors.filter(beh => beh.studentId === a.id).reduce((sum, beh) => sum + beh.points, 0);
            const bPoints = todayBehaviors.filter(beh => beh.studentId === b.id).reduce((sum, beh) => sum + beh.points, 0);
            return sortOrder === 'asc' ? aPoints - bPoints : bPoints - aPoints;
        }
    });

    setStudents(filteredStudents);
    
    const settingsStore = db.transaction('settings').store;
    const customBehaviors = await settingsStore.get('custom_behaviors');
    if (customBehaviors) {
       setBehaviors(customBehaviors.value);
    }
    
    const scansIndex = db.transaction('scans').store.index('by-date');
    const todayScans = await scansIndex.getAll(todayStr);
    const absentIds = new Set<string>();
    const lateIds = new Set<string>();
    
    filteredStudents.forEach(s => {
       const sScans = todayScans.filter(scan => scan.studentId === s.id && scan.periodName === activePeriodName);
       
       const manualAbsent = sScans.some(scan => ((scan.manualStatus as string) || '') === 'Absent' && (!scan.movementType || scan.movementType === 'Attendance'));
       const hasAttendanceScan = sScans.some(scan => (!scan.movementType || scan.movementType === 'Attendance'));
       
       if (manualAbsent || !hasAttendanceScan) {
          absentIds.add(s.id);
       }
       
       const manualLate = sScans.some(scan => ((scan.manualStatus as string) || '') === 'Late' && (!scan.movementType || scan.movementType === 'Attendance'));
       if (manualLate) {
          lateIds.add(s.id);
       }
    });
    setAbsentStudents(absentIds);
    setLateStudents(lateIds);
  };


  const trackBehavior = async (studentId: string, b: any, comment?: string) => {
    const db = await getDB();
    const now = Date.now();
    const newBehavior: BehaviorEvent = {
        id: `beh_${now}_${Math.random().toString(36).substring(2)}`,
        studentId,
        timestamp: now,
        date: format(now, 'yyyy-MM-dd'),
        type: b.type as any,
        category: b.name,
        points: b.points,
        notes: comment,
        periodName: activePeriodName
    };
    await db.put('behaviors', newBehavior);
    
    // Link to movement if it's Bathroom, Nurse, or Office
    if (['Bathroom', 'Nurse', 'Office'].includes(b.name) && activeScheduleId) {
        const newScan: ScanEvent = {
            id: `scan_${now}_${Math.random().toString(36).substring(2)}`,
            studentId,
            timestamp: now,
            date: format(now, 'yyyy-MM-dd'),
            periodName: activePeriodName || '',
            scheduleId: activeScheduleId,
            status: 'success',
            movementType: b.name as any,
            notes: comment
        };
        await db.put('scans', newScan);
    }

    toast.success(`Logged ${b.name} (${b.points > 0 ? '+' : ''}${b.points})`);
    loadData();
    triggerAutoBackup();
  };

  const undoLastBehavior = async (studentId: string) => {
    const db = await getDB();
    const studentBehaviorsList = behaviorsHistory.filter(b => b.studentId === studentId);
    if (studentBehaviorsList.length > 0) {
       const latest = studentBehaviorsList.sort((a,b) => b.timestamp - a.timestamp)[0];
       await db.delete('behaviors', latest.id);
       toast.success(`Undo successful`);
       loadData();
       triggerAutoBackup();
    }
  };

  const saveBehaviors = async (newBehaviors: any[]) => {
    const db = await getDB();
    await db.put('settings', { key: 'custom_behaviors', value: newBehaviors });
    setBehaviors(newBehaviors);
    triggerAutoBackup();
  };

  const importOldBackup = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (Array.isArray(data)) {
          const db = await getDB();
          let allBehaviorsFromOld: any[] = [];
          
          for (const oldClass of data) {
             for (const b of (oldClass.behaviors || [])) {
                 if (!allBehaviorsFromOld.find(ex => ex.name === b.name)) {
                     allBehaviorsFromOld.push({
                         id: crypto.randomUUID(),
                         name: b.name,
                         points: b.points,
                         type: b.type === 'Positive' || b.type === 'positive' ? 'Positive' : 'Negative'
                     });
                 }
             }

             for (const s of (oldClass.students || [])) {
                 const nameParts = s.name.split(' ');
                 const firstName = nameParts[0];
                 const lastName = nameParts.slice(1).join(' ');
                 
                 const existingS = await db.get('students', s.id);
                 if (existingS) {
                     if (!existingS.periods?.includes(oldClass.name)) {
                         existingS.periods = [...(existingS.periods || []), oldClass.name];
                         await db.put('students', existingS);
                     }
                 } else {
                     await db.put('students', {
                         id: s.id,
                         firstName,
                         lastName,
                         grade: '',
                         notes: '',
                         periods: [oldClass.name],
                         x: s.x,
                         y: s.y
                     });
                 }
                 
                 for (const log of (s.logs || [])) {
                    const b = oldClass.behaviors?.find((be: any) => be.id === log.behaviorId);
                    if (b || log.type === 'neutral') {
                       const category = log.type === 'neutral' ? 'Note' : (b?.name || 'Unknown');
                       await db.put('behaviors', {
                           id: log.id || crypto.randomUUID(),
                           studentId: s.id,
                           timestamp: log.timestamp,
                           date: format(log.timestamp, 'yyyy-MM-dd'),
                           type: log.type === 'positive' ? 'Positive' : log.type === 'negative' ? 'Negative' : 'Neutral',
                           category: category,
                           points: log.points || b?.points || 0,
                           notes: log.comment
                       });
                    }
                 }
             }
          }
          
          const settingsStore = db.transaction('settings').store;
          const currentB = await settingsStore.get('custom_behaviors');
          const mergedBehaviors = [...(currentB?.value || DEFAULT_BEHAVIORS)];
          for (const ob of allBehaviorsFromOld) {
             if (!mergedBehaviors.find(mb => mb.name === ob.name)) {
                mergedBehaviors.push(ob);
             }
          }
          await db.put('settings', { key: 'custom_behaviors', value: mergedBehaviors });
          toast.success("Successfully imported data from old tracker!");
          loadData();
        } else {
           toast.error("Invalid file format");
        }
      } catch (err) {
        toast.error("Failed to parse file");
      }
    };
    reader.readAsText(file);
  };

  const exportBackup = async () => {
    const db = await getDB();
    const allStudents = await db.getAll('students');
    const allBehaviors = await db.getAll('behaviors');
    const allSettings = await db.getAll('settings');
    const backupData = {
        students: allStudents,
        behaviorsEvents: allBehaviors,
        settings: allSettings,
        exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `behavior_backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
    link.click();
    toast.success("Backup exported!");
  };


  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, delta } = event;
    if (layoutMode === 'freeform') {
      if (!delta || (delta.x === 0 && delta.y === 0)) return;
      
      const db = await getDB();
      const student = await db.get('students', active.id as string);
      if (student) {
        // Fallback for unset x/y
        const index = students.findIndex(s => s.id === student.id);
        const startX = student.x !== undefined ? student.x : (index % 5) * (compactMode ? 160 : 240) + 20;
        const startY = student.y !== undefined ? student.y : Math.floor(index / 5) * (compactMode ? 80 : 120) + 20;

        const updated = {
           ...student,
           x: startX + delta.x,
           y: startY + delta.y
        };
        await db.put('students', updated);
        loadData();
        triggerAutoBackup();
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0 bg-white p-3 rounded-xl shadow-sm border border-slate-100 relative z-20">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-800 leading-none">Behavior Tracker</h2>
          <p className="text-sm text-slate-500">Track and manage student behavior</p>
        </div>

        <div className="flex items-center gap-2">
            <Input 
                placeholder="Search students..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 text-xs h-8"
            />
            <button
                onClick={exportBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 shadow-sm transition-all"
            >
                <Upload size={14} />
                Export
            </button>
            <button
                onClick={() => {
                   const input = document.createElement('input');
                   input.type = 'file';
                   input.accept = '.json';
                   input.onchange = (e) => {
                     const file = (e.target as HTMLInputElement).files?.[0];
                     if (file) {
                       importOldBackup(file);
                     }
                   };
                   input.click();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 shadow-sm transition-all"
            >
                <Upload size={14} />
                Import
            </button>

            <button
                onClick={() => setShowBehaviorManager(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 shadow-sm transition-all"
            >
                <Settings size={14} />
                Behaviors
            </button>

            <button
                onClick={() => {
                    if (sortBy === 'lastName') {
                        setSortBy('firstName');
                        setSortOrder('asc');
                    } else if (sortBy === 'firstName') {
                        setSortBy('rank');
                        setSortOrder('asc');
                    } else if (sortBy === 'rank') {
                        setSortBy('id');
                        setSortOrder('asc');
                    } else if (sortBy === 'id') {
                        setSortBy('points');
                        setSortOrder('desc');
                    } else {
                        setSortBy('lastName');
                        setSortOrder('asc');
                    }
                }}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border",
                    "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
            >
                Sort: {sortBy === 'lastName' ? 'Last Name' : sortBy === 'firstName' ? 'First Name' : sortBy === 'rank' ? 'Rank' : sortBy === 'id' ? 'ID' : 'Points'} ({sortOrder === 'asc' ? 'A-Z' : 'Desc'})
            </button>

            <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border",
                    "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
            >
                {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            </button>

            <button
                onClick={() => setShowOnlyActive(!showOnlyActive)}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border",
                    showOnlyActive ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
            >
                {showOnlyActive ? "Show All" : "Show Only Active"}
            </button>

            <button
                onClick={() => setCompactMode(!compactMode)}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border",
                    compactMode ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
            >
                {compactMode ? "Expanded View" : "Compact View"}
            </button>

            <button
                onClick={() => setLayoutMode(prev => prev === 'grid' ? 'freeform' : 'grid')}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border",
                    layoutMode === 'freeform' ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
            >
                {layoutMode === 'freeform' ? <Layout size={14} /> : <UsersIcon size={14} />}
                {layoutMode === 'grid' ? "Grid View" : "Seating Chart"}
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
               {layoutMode === 'grid' ? (
                 <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-1">
                    {students.map(student => (
                        <div key={student.id} className="relative">
                           <InlineStudentCard 
                             student={student} 
                             behaviors={behaviors} 
                             studentBehaviors={behaviorsHistory.filter(b => b.studentId === student.id)}
                             onTrack={(b: any) => trackBehavior(student.id, b)}
                             onUndo={() => undoLastBehavior(student.id)}
                             compactMode={compactMode}
                             isAbsent={absentStudents.has(student.id)}
                             isLate={lateStudents.has(student.id)}
                           />
                        </div>
                    ))}
                 </div>
              ) : (
                 <div className="relative w-full min-h-[800px] border border-gray-200 bg-slate-50 rounded-xl overflow-hidden shadow-inner">
                    {students.map((student, index) => {
                        const x = student.x !== undefined ? student.x : (index % 5) * (compactMode ? 160 : 240) + 20;
                        const y = student.y !== undefined ? student.y : Math.floor(index / 5) * (compactMode ? 80 : 120) + 20;
                        return (
                            <DraggableStudentCard
                                key={student.id}
                                student={student}
                                x={x}
                                y={y}
                                behaviors={behaviors}
                                studentBehaviors={behaviorsHistory.filter(b => b.studentId === student.id)}
                                onTrack={(b: any) => trackBehavior(student.id, b)}
                                onUndo={() => undoLastBehavior(student.id)}
                                compactMode={compactMode}
                                isAbsent={absentStudents.has(student.id)}
                                isLate={lateStudents.has(student.id)}
                            />
                        )
                    })}
                 </div>
              )}
          </DndContext>
      </div>
      {showBehaviorManager && (
         <BehaviorSettingsModal 
           behaviors={behaviors} 
           onSave={saveBehaviors} 
           onClose={() => setShowBehaviorManager(false)} 
         />
      )}
    </div>
  );
}

function BehaviorSettingsModal({ behaviors, onSave, onClose }: any) {
    const [localBehaviors, setLocalBehaviors] = useState(behaviors);
    const [name, setName] = useState('');
    const [points, setPoints] = useState(1);
    const [type, setType] = useState('Positive');

    const handleAdd = () => {
       if (!name.trim()) return;
       const newB = { id: crypto.randomUUID(), name, points: type === 'Positive' ? Math.abs(points) : type === 'Neutral' ? 0 : -Math.abs(points), type, isPrimary: true };
       setLocalBehaviors([...localBehaviors, newB]);
       setName('');
    };

    const handleRemove = (id: string) => {
       setLocalBehaviors(localBehaviors.filter((b: any) => b.id !== id));
    };

    const togglePrimary = (id: string) => {
       setLocalBehaviors(localBehaviors.map((b: any) => b.id === id ? { ...b, isPrimary: b.isPrimary === false ? true : false } : b));
    };

    return (
       <div className="fixed right-4 top-16 z-50 p-4" onClick={onClose}>
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 p-4 w-80 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm text-slate-800 tracking-tight">Add New Behavior</h3>
              <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <X size={16} />
              </button>
            </div>
            
            <div className="space-y-3 mb-4">
               <Input placeholder="Behavior Name (e.g. On Task)" value={name} onChange={e => setName(e.target.value)} className="text-sm h-9" />
               <div className="flex gap-2">
                  <div className="flex-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block tracking-wider">Type</label>
                     <select value={type} onChange={e => setType(e.target.value)} className="w-full border rounded-lg h-9 px-2 text-sm bg-white border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="Positive">Positive</option>
                        <option value="Negative">Negative</option>
                        <option value="Neutral">Neutral</option>
                     </select>
                  </div>
                  <div className="w-20">
                     <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block tracking-wider">Points</label>
                     <Input type="number" value={points} onChange={e => setPoints(parseInt(e.target.value) || 0)} disabled={type === 'Neutral'} className="h-9 text-sm" />
                  </div>
               </div>
               
               <button onClick={handleAdd} className="w-full py-2 bg-black text-white font-bold text-sm rounded-lg hover:bg-slate-800 transition-colors">
                  Add Behavior
               </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col mt-2 border-t pt-4">
               <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-wider">Current Behaviors</label>
               <div className="overflow-y-auto space-y-1.5 flex-1 pr-1">
                   {localBehaviors.map((b: any) => (
                      <div key={b.id} className="flex flex-col border border-slate-100 rounded-lg bg-slate-50 overflow-hidden group">
                        <div className="flex items-center justify-between p-2.5">
                           <span className="text-sm font-medium text-slate-700 truncate min-w-0 pr-2">{b.name}</span>
                           <div className="flex items-center gap-2 shrink-0">
                              <span className={cn("text-xs font-bold text-right min-w-[20px]", b.type === 'Positive' ? "text-emerald-500" : b.type === 'Neutral' ? "text-slate-500" : "text-red-500")}>
                                 {b.type === 'Positive' ? '+' : ''}{b.points}
                              </span>
                              <button 
                                onClick={() => togglePrimary(b.id)}
                                className={cn(
                                   "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors min-w-[60px] text-center",
                                   b.isPrimary !== false 
                                      ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200" 
                                      : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                )}
                              >
                                 {b.isPrimary !== false ? 'Primary' : 'Addl'}
                              </button>
                              <button onClick={() => handleRemove(b.id)} className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1">
                                 <Trash2 size={14} />
                              </button>
                           </div>
                        </div>
                      </div>
                   ))}
               </div>
            </div>
            
            <div className="pt-3 mt-2 border-t flex justify-end">
               <button onClick={() => { onSave(localBehaviors); onClose(); }} className="px-4 py-2 bg-indigo-600 text-white font-bold text-sm rounded-lg hover:bg-indigo-700 transition-colors">
                  Save Changes
               </button>
            </div>
          </div>
       </div>
    );
}

/*
function DraggableStudentCard({ student, x, y, behaviors, studentBehaviors, onTrack, onUndo, compactMode, isAbsent }: any) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: student.id });
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : 1,
        position: 'absolute',
        left: x,
        top: y,
        width: compactMode ? '160px' : '220px',
    };
    return (
        <div ref={setNodeRef} style={style} className={cn("relative shadow-sm rounded-lg hover:shadow-md transition-shadow", isDragging && "opacity-80 scale-105")}>
            <InlineStudentCard 
                student={student} 
                behaviors={behaviors} 
                studentBehaviors={studentBehaviors} 
                onTrack={onTrack} 
                onUndo={onUndo}
                compactMode={compactMode} 
                dragHandleProps={{...attributes, ...listeners}}
                isAbsent={isAbsent} 
            />
        </div>
    );
}
*/

function InlineStudentCard({ student, behaviors, studentBehaviors, onTrack, onUndo, compactMode, dragHandleProps, isAbsent, isLate }: any) {
    const [comment, setComment] = useState('');
    const getSumForBehavior = (bName: string) => {
        return studentBehaviors
            .filter((ev: any) => ev.category === bName)
            .reduce((total: number, ev: any) => total + ev.points, 0);
    };

    // Define common quick actions
    const quickActions = (behaviors || []).filter(b => ['On Task', 'Off Task', 'Bathroom'].includes(b.name));

    const posBehaviors = behaviors.filter((b: any) => b.type === 'Positive');
    const negBehaviors = behaviors.filter((b: any) => b.type === 'Negative');
    const neutralBehaviors = behaviors.filter((b: any) => b.type === 'Neutral');
    
    // Sort so primary shows up first
    posBehaviors.sort((a: any, b: any) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    negBehaviors.sort((a: any, b: any) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    neutralBehaviors.sort((a: any, b: any) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    
    const displayPos = studentBehaviors.filter((b: any) => b.type === 'Positive').reduce((sum: number, b: any) => sum + b.points, 0);
    const displayNeg = studentBehaviors.filter((b: any) => b.type === 'Negative').reduce((sum: number, b: any) => sum + Math.abs(b.points), 0);
    const displayNeu = studentBehaviors.filter((b: any) => b.type === 'Neutral').length;

    const [showMore, setShowMore] = useState(false);
    const hasMore = behaviors.some((b: any) => b.isPrimary === false);

    return (
        <div className={cn("bg-white rounded-lg border shadow-sm flex flex-col overflow-hidden border-slate-200", isAbsent && "opacity-60")}>
            <div className="p-2 border-b border-gray-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-1 min-w-0 flex-1 pr-2">
                    {dragHandleProps && (
                        <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-slate-400 p-0.5 hover:text-slate-600 transition-colors">
                            <GripHorizontal size={12} />
                        </div>
                    )}
                    <span className={cn(
                        "font-bold text-sm truncate text-slate-800",
                        isAbsent && "text-red-600 line-through",
                        isLate && "text-amber-600"
                    )}>{student.firstName} {student.lastName}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {isAbsent && <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded shadow-sm">Absent</span>}
                    {isLate && <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shadow-sm">Late</span>}
                    <span className="text-[10px] sm:text-xs font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm" title="Positive">+{displayPos}</span>
                    <span className="text-[10px] sm:text-xs font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded shadow-sm" title="Neutral">{displayNeu}</span>
                    <span className="text-[10px] sm:text-xs font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded shadow-sm" title="Negative">{-1 * displayNeg}</span>
                </div>
            </div>
            
            {/* Quick Actions Strip */}
            {!isAbsent && (
                <div className="flex gap-1 p-1.5 border-b border-gray-100 bg-white">
                    {quickActions.map(b => (
                        <button key={b.id} onClick={() => {onTrack(b, comment); setComment('');}} className={cn("flex-1 text-[10px] py-1 px-1 rounded-sm border font-medium transition-colors", b.type === 'Positive' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : b.type === 'Negative' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-700 border-slate-200')}>
                            {b.name}
                        </button>
                    ))}
                </div>
            )}

            {!compactMode && !isAbsent && (
                <div className="p-1.5 flex-1 flex flex-col gap-1.5">
                    {posBehaviors.length > 0 && (
                       <div className="grid grid-cols-2 gap-1 px-0.5">
                           {posBehaviors.filter((b: any) => b.isPrimary || showMore).map((b: any) => (
                               <button key={b.id} onClick={() => {onTrack(b, comment); setComment('');}} className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] font-medium py-1 px-1.5 rounded border transition-colors active:scale-95 truncate bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-100" title={b.name}>
                                   <span className="truncate">{b.name}</span>
                                   <span className="font-bold px-1 rounded bg-emerald-200/50">{getSumForBehavior(b.name) > 0 ? `+${getSumForBehavior(b.name)}` : getSumForBehavior(b.name)}</span>
                               </button>
                           ))}
                       </div>
                    )}
                    {neutralBehaviors.length > 0 && (
                       <div className="grid grid-cols-2 gap-1 px-0.5 mt-0.5">
                           {neutralBehaviors.filter((b: any) => b.isPrimary || showMore).map((b: any) => (
                               <button key={b.id} onClick={() => {onTrack(b, comment); setComment('');}} className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] font-medium py-1 px-1.5 rounded border transition-colors active:scale-95 truncate bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200" title={b.name}>
                                   <span className="truncate">{b.name}</span>
                                   <span className="font-bold px-1 rounded bg-slate-200/50">{getSumForBehavior(b.name)}</span>
                               </button>
                           ))}
                       </div>
                    )}
                    {negBehaviors.length > 0 && (
                       <div className="grid grid-cols-2 gap-1 px-0.5 mt-0.5">
                           {negBehaviors.filter((b: any) => b.isPrimary || showMore).map((b: any) => (
                               <button key={b.id} onClick={() => {onTrack(b, comment); setComment('');}} className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] font-medium py-1 px-1.5 rounded border transition-colors active:scale-95 truncate bg-red-50 hover:bg-red-100 text-red-700 border-red-100" title={b.name}>
                                   <span className="truncate">{b.name}</span>
                                   <span className="font-bold px-1 rounded bg-red-200/50">{getSumForBehavior(b.name)}</span>
                               </button>
                           ))}
                       </div>
                    )}
                    
                    <div className="flex items-center justify-between px-1 mt-1 border-t border-slate-100 pt-1">
                       <button onClick={onUndo} disabled={studentBehaviors.length === 0} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 font-medium disabled:opacity-50">
                          <Undo2 size={12} />
                          Undo
                       </button>
                       {hasMore && (
                          <button onClick={() => setShowMore(!showMore)} className="text-[10px] text-slate-500 hover:text-indigo-600 font-medium uppercase tracking-wider">
                             {showMore ? 'Less' : 'More'}
                          </button>
                       )}
                    </div>
                    {/* Add note input moved here */}
                    <Input 
                        placeholder="Add note..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="text-[10px] h-7"
                    />
                </div>
            )}
            {isAbsent && !compactMode && (
               <div className="p-2 text-center text-xs font-bold text-slate-400 bg-slate-50 uppercase tracking-widest">
                  Absent
               </div>
            )}
        </div>
    );
}

function DraggableStudentCard({ student, x, y, behaviors, studentBehaviors, onTrack, onUndo, compactMode, isAbsent, isLate }: any) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: student.id });
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : 1,
        position: 'absolute',
        left: x,
        top: y,
        width: compactMode ? '160px' : '220px',
    };
    return (
        <div ref={setNodeRef} style={style} className={cn("relative shadow-sm rounded-lg hover:shadow-md transition-shadow", isDragging && "opacity-80 scale-105")}>
            <InlineStudentCard 
                student={student} 
                behaviors={behaviors} 
                studentBehaviors={studentBehaviors} 
                onTrack={onTrack} 
                onUndo={onUndo}
                compactMode={compactMode} 
                dragHandleProps={{...attributes, ...listeners}}
                isAbsent={isAbsent} 
                isLate={isLate}
            />
        </div>
    );
}
