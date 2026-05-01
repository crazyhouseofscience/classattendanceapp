import React, { useState, useEffect } from 'react';
import { getDB, Schedule, PeriodConfig } from '../lib/db';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { toast } from 'sonner';
import { Trash2, Plus, CalendarDays, Wand2 } from 'lucide-react';

const DAYS_OF_WEEK = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
];

export function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    loadSchedules();
  }, []);

  async function loadSchedules() {
    const db = await getDB();
    const all = await db.getAll('schedules');
    all.sort((a, b) => {
      const aDay = a.daysOfWeek?.[0] ?? 99;
      const bDay = b.daysOfWeek?.[0] ?? 99;
      return aDay - bDay;
    });
    setSchedules(all);
    // Removed the auto-setting of editingSchedule so that newly created ones pop up right
  }

  async function handleSave() {
    if (!editingSchedule || !editingSchedule.name) return;
    const db = await getDB();
    await db.put('schedules', editingSchedule);
    toast.success('Schedule saved');
    loadSchedules();
  }

  function addPeriod() {
    if (!editingSchedule) return;
    setEditingSchedule({
      ...editingSchedule,
      periods: [...editingSchedule.periods, { name: `Period ${editingSchedule.periods.length + 1}`, startTime: '08:00', endTime: '09:00' }]
    });
  }

  function updatePeriod(index: number, field: keyof PeriodConfig, value: string) {
    if (!editingSchedule) return;
    const newPeriods = [...editingSchedule.periods];
    newPeriods[index] = { ...newPeriods[index], [field]: value };
    setEditingSchedule({ ...editingSchedule, periods: newPeriods });
  }

  function removePeriod(index: number) {
    if (!editingSchedule) return;
    const newPeriods = editingSchedule.periods.filter((_, i) => i !== index);
    setEditingSchedule({ ...editingSchedule, periods: newPeriods });
  }

  function toggleDay(dayId: number) {
    if (!editingSchedule) return;
    const currentDays = editingSchedule.daysOfWeek || [];
    const newDays = currentDays.includes(dayId) 
      ? currentDays.filter(d => d !== dayId)
      : [...currentDays, dayId];
    setEditingSchedule({ ...editingSchedule, daysOfWeek: newDays });
  }

  async function createNewSchedule() {
    const newSchedule: Schedule = {
      id: crypto.randomUUID(),
      name: 'New Schedule',
      periods: [],
      daysOfWeek: []
    };
    const db = await getDB();
    await db.put('schedules', newSchedule);
    setEditingSchedule(newSchedule);
    loadSchedules();
  }
  
  async function generateTeacherTemplate() {
    const db = await getDB();
    
    // Define base times for 9 periods
    const times = {
      p1: { start: '08:00', end: '08:42' },
      p2: { start: '08:46', end: '09:28' },
      hr: { start: '09:28', end: '09:39' },
      p3: { start: '09:43', end: '10:25' },
      p4: { start: '10:29', end: '11:11' },
      p5: { start: '11:15', end: '11:57' },
      p6: { start: '12:01', end: '12:43' },
      p7: { start: '12:47', end: '13:29' },
      p8: { start: '13:33', end: '14:15' },
      p9: { start: '14:19', end: '15:01' }
    };

    const monPeriods = [
      { name: 'Period 1', startTime: times.p1.start, endTime: times.p1.end },
      { name: 'Period 2 (CP Chem)', startTime: times.p2.start, endTime: times.p2.end },
      { name: 'HR', startTime: times.hr.start, endTime: times.hr.end },
      { name: 'Period 3 (Honors Chem)', startTime: times.p3.start, endTime: times.p3.end },
      { name: 'Period 4', startTime: times.p4.start, endTime: times.p4.end },
      { name: 'Period 5 (Honors Chem)', startTime: times.p5.start, endTime: times.p5.end },
      { name: 'Period 6/7 Lab (CP Chem)', startTime: times.p6.start, endTime: times.p7.end },
      { name: 'Period 8', startTime: times.p8.start, endTime: times.p8.end },
      { name: 'Period 9 (Adv Robotics)', startTime: times.p9.start, endTime: times.p9.end },
    ];

    const tuePeriods = [
      { name: 'Period 1', startTime: times.p1.start, endTime: times.p1.end },
      { name: 'Period 2 (CP Chem)', startTime: times.p2.start, endTime: times.p2.end },
      { name: 'HR', startTime: times.hr.start, endTime: times.hr.end },
      { name: 'Period 3 (Honors Chem)', startTime: times.p3.start, endTime: times.p3.end },
      { name: 'Period 4', startTime: times.p4.start, endTime: times.p4.end },
      { name: 'Period 5 (Honors Chem)', startTime: times.p5.start, endTime: times.p5.end },
      { name: 'Period 6', startTime: times.p6.start, endTime: times.p6.end },
      { name: 'Period 7 (CP Chem)', startTime: times.p7.start, endTime: times.p7.end },
      { name: 'Period 8', startTime: times.p8.start, endTime: times.p8.end },
      { name: 'Period 9 (Adv Robotics)', startTime: times.p9.start, endTime: times.p9.end },
    ];

    const wedPeriods = [
      { name: 'Period 1/2 Lab (CP Chem)', startTime: times.p1.start, endTime: times.p2.end },
      { name: 'HR', startTime: times.hr.start, endTime: times.hr.end },
      { name: 'Period 3 (Honors Chem)', startTime: times.p3.start, endTime: times.p3.end },
      { name: 'Period 4', startTime: times.p4.start, endTime: times.p4.end },
      { name: 'Period 5 (Honors Chem)', startTime: times.p5.start, endTime: times.p5.end },
      { name: 'Period 6', startTime: times.p6.start, endTime: times.p6.end },
      { name: 'Period 7 (CP Chem)', startTime: times.p7.start, endTime: times.p7.end },
      { name: 'Period 8', startTime: times.p8.start, endTime: times.p8.end },
      { name: 'Period 9 (Adv Robotics)', startTime: times.p9.start, endTime: times.p9.end },
    ];

    const thuPeriods = [
      { name: 'Period 1', startTime: times.p1.start, endTime: times.p1.end },
      { name: 'Period 2 (CP Chem)', startTime: times.p2.start, endTime: times.p2.end },
      { name: 'HR', startTime: times.hr.start, endTime: times.hr.end },
      { name: 'Period 3 (Honors Chem)', startTime: times.p3.start, endTime: times.p3.end },
      { name: 'Period 4 Lab (P3 students)', startTime: times.p4.start, endTime: times.p4.end },
      { name: 'Period 5 (Honors Chem)', startTime: times.p5.start, endTime: times.p5.end },
      { name: 'Period 6', startTime: times.p6.start, endTime: times.p6.end },
      { name: 'Period 7 (CP Chem)', startTime: times.p7.start, endTime: times.p7.end },
      { name: 'Period 8', startTime: times.p8.start, endTime: times.p8.end },
      { name: 'Period 9 (Adv Robotics)', startTime: times.p9.start, endTime: times.p9.end },
    ];

    const friPeriods = [
      { name: 'Period 1', startTime: times.p1.start, endTime: times.p1.end },
      { name: 'Period 2 (CP Chem)', startTime: times.p2.start, endTime: times.p2.end },
      { name: 'HR', startTime: times.hr.start, endTime: times.hr.end },
      { name: 'Period 3 (Honors Chem)', startTime: times.p3.start, endTime: times.p3.end },
      { name: 'Period 4 Lab (P5 students)', startTime: times.p4.start, endTime: times.p4.end },
      { name: 'Period 5 (Honors Chem)', startTime: times.p5.start, endTime: times.p5.end },
      { name: 'Period 6', startTime: times.p6.start, endTime: times.p6.end },
      { name: 'Period 7 (CP Chem)', startTime: times.p7.start, endTime: times.p7.end },
      { name: 'Period 8', startTime: times.p8.start, endTime: times.p8.end },
      { name: 'Period 9 (Adv Robotics)', startTime: times.p9.start, endTime: times.p9.end },
    ];

    const generated = [
      { id: crypto.randomUUID(), name: 'Monday Schedule', daysOfWeek: [1], periods: monPeriods },
      { id: crypto.randomUUID(), name: 'Tuesday Schedule', daysOfWeek: [2], periods: tuePeriods },
      { id: crypto.randomUUID(), name: 'Wednesday Schedule', daysOfWeek: [3], periods: wedPeriods },
      { id: crypto.randomUUID(), name: 'Thursday Schedule', daysOfWeek: [4], periods: thuPeriods },
      { id: crypto.randomUUID(), name: 'Friday Schedule', daysOfWeek: [5], periods: friPeriods },
    ];

    for (const sch of generated) {
      await db.put('schedules', sch);
    }
    
    toast.success('Generated weekly templates!');
    loadSchedules();
  }

  async function deleteSchedule(id: string) {
    if (schedules.length === 1) {
      toast.error('Cannot delete the last schedule');
      return;
    }
    const db = await getDB();
    await db.delete('schedules', id);
    if (editingSchedule?.id === id) setEditingSchedule(null);
    toast.success('Schedule deleted');
    loadSchedules();
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-4 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-medium">Schedules</h2>
          <Button size="sm" variant="outline" onClick={createNewSchedule}><Plus className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-2">
          {schedules.map(s => (
            <div 
              key={s.id} 
              className={`p-4 rounded-xl border flex justify-between items-center cursor-pointer transition-colors ${editingSchedule?.id === s.id ? 'bg-slate-100 border-slate-300' : 'bg-white hover:bg-slate-50'}`}
              onClick={() => setEditingSchedule(s)}
            >
              <div>
                <span className="font-medium">{s.name || 'Unnamed Schedule'}</span>
                {s.daysOfWeek && s.daysOfWeek.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {DAYS_OF_WEEK.filter(d => s.daysOfWeek?.includes(d.id)).map(d => (
                      <span key={d.id} className="text-[10px] uppercase font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{d.label}</span>
                    ))}
                  </div>
                )}
              </div>
              <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteSchedule(s.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
            </div>
          ))}
          
          <div className="pt-8">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
               <h3 className="font-semibold text-amber-800 text-sm mb-2">Automated Setup</h3>
               <p className="text-xs text-amber-700 mb-3">Pre-populate Chemistry & Robotics schedule with your custom lab days.</p>
               <Button onClick={generateTeacherTemplate} variant="outline" size="sm" className="w-full bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50"><Wand2 className="w-3 h-3 mr-2" /> Generate My Schedule</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-8">
        {editingSchedule ? (
          <Card className="border-2 shadow-none">
            <CardHeader className="bg-slate-50 border-b pb-4">
              <div className="flex justify-between items-start">
                <CardTitle>
                  <Input 
                    value={editingSchedule.name} 
                    onChange={e => setEditingSchedule({ ...editingSchedule, name: e.target.value })}
                    className="text-2xl font-bold h-12 w-full max-w-sm"
                  />
                </CardTitle>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Auto-Select on Days</span>
                  <div className="flex gap-1">
                     {DAYS_OF_WEEK.map(day => {
                       const active = editingSchedule.daysOfWeek?.includes(day.id);
                       return (
                         <button
                           key={day.id}
                           onClick={() => toggleDay(day.id)}
                           className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                         >
                           {day.label[0]}
                         </button>
                       );
                     })}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-slate-500">Periods / Blocks</h3>
                <Button size="sm" variant="secondary" onClick={addPeriod}>Add Period</Button>
              </div>

              {editingSchedule.periods.map((p, i) => (
                <div key={i} className="flex gap-4 items-center p-4 bg-white rounded-lg border shadow-sm">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 uppercase font-semibold block mb-1">Name / Class</label>
                    <Input value={p.name} onChange={e => updatePeriod(i, 'name', e.target.value)} placeholder="e.g. Period 2 (CP Chem)" className="font-medium" />
                  </div>
                  <div className="w-36">
                    <label className="text-xs text-slate-500 uppercase font-semibold block mb-1">Start Time</label>
                    <Input type="time" value={p.startTime} onChange={e => updatePeriod(i, 'startTime', e.target.value)} />
                  </div>
                  <div className="w-36">
                    <label className="text-xs text-slate-500 uppercase font-semibold block mb-1">End Time</label>
                    <Input type="time" value={p.endTime} onChange={e => updatePeriod(i, 'endTime', e.target.value)} />
                  </div>
                  <Button variant="ghost" size="icon" className="mt-5 hover:bg-red-50" onClick={() => removePeriod(i)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}

              <div className="pt-6 border-t mt-6">
                <Button onClick={handleSave} className="w-full h-12 text-lg shadow-sm">Save Schedule & Changes</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="h-full flex items-center justify-center border-2 border-dashed rounded-xl bg-slate-50 text-slate-400 p-12 text-center">
            <div>
              <p className="text-lg font-medium mb-2">Select a schedule</p>
              <p className="text-sm">Choose a schedule from the left sidebar to edit its periods, or create a new one.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
