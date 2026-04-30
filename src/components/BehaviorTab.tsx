import React, { useState, useEffect } from 'react';
import { getDB, Student, BehaviorEvent } from '../lib/db';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './badge';
import { ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react';

const POSITIVE_CATEGORIES = ['Participation', 'Helping Others', 'On Task', 'Great Answer', 'Leadership'];
const NEGATIVE_CATEGORIES = ['Off Task', 'Disrespect', 'Unprepared', 'Disrupting Class', 'Tardy (Behavior)'];

export function BehaviorTab() {
  const [students, setStudents] = useState<Student[]>([]);
  const [behaviors, setBehaviors] = useState<(BehaviorEvent & { studentInfo?: Student })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const db = await getDB();
    const allStudents = await db.getAll('students');
    setStudents(allStudents.sort((a, b) => a.lastName.localeCompare(b.lastName)));

    const today = format(new Date(), 'yyyy-MM-dd');
    const index = db.transaction('behaviors').store.index('by-date');
    const todayBehaviors = await index.getAll(today);

    // populate student info
    const populated = await Promise.all(todayBehaviors.map(async (b) => {
      const student = await db.get('students', b.studentId);
      return { ...b, studentInfo: student };
    }));
    
    setBehaviors(populated.sort((a,b) => b.timestamp - a.timestamp));
  };

  const getStudentTotal = (studentId: string) => {
    return behaviors.filter(b => b.studentId === studentId).reduce((sum, b) => sum + b.points, 0);
  };

  const handleLogBehavior = async (studentId: string, type: 'Positive' | 'Negative', category: string, points: number) => {
    const db = await getDB();
    const now = Date.now();
    const newBehavior: BehaviorEvent = {
      id: `beh_${now}_${Math.random().toString(36).substring(2)}`,
      studentId,
      timestamp: now,
      date: format(now, 'yyyy-MM-dd'),
      type,
      category,
      points
    };
    await db.put('behaviors', newBehavior);
    toast.success(`Logged ${category} (${points > 0 ? '+' : ''}${points})`);
    loadData();
  };

  const handleDeleteBehavior = async (id: string) => {
    const db = await getDB();
    await db.delete('behaviors', id);
    loadData();
  };

  const filteredStudents = students.filter(s => 
    s.firstName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedStudent = students.find(s => s.id === selectedStudentId);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="flex flex-col gap-1 mb-4">
        <h2 className="text-xl font-black tracking-tight text-slate-800">Behavior Tracker</h2>
        <p className="text-sm text-slate-500">Log points and track incidents for today.</p>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        
        {/* Left Column: Student List */}
        <div className="w-1/3 flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden">
           <div className="p-3 border-b bg-slate-50">
             <Input 
               placeholder="Search students..." 
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               className="bg-white"
             />
           </div>
           <div className="flex-1 overflow-y-auto p-2">
              <div className="flex flex-col gap-1">
                {filteredStudents.map(student => {
                  const points = getStudentTotal(student.id);
                  const isSelected = selectedStudentId === student.id;
                  return (
                    <button 
                      key={student.id}
                      onClick={() => setSelectedStudentId(student.id)}
                      className={`flex items-center justify-between p-2 rounded-lg border text-left transition-colors ${
                        isSelected ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'hover:bg-slate-50 border-transparent'
                      }`}
                    >
                       <div className="flex flex-col">
                          <span className={`text-sm font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                            {student.firstName} {student.lastName}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">{student.id}</span>
                       </div>
                       <div className={`px-2 py-0.5 rounded text-xs font-black tabular-nums ${
                          points > 0 ? 'bg-green-100 text-green-700' : points < 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
                       }`}>
                         {points > 0 ? '+' : ''}{points}
                       </div>
                    </button>
                  )
                })}
              </div>
           </div>
        </div>

        {/* Middle Column: Quick Actions */}
        <div className="w-1/3 flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
             <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Log Behavior</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
             {!selectedStudent ? (
               <div className="text-center py-12 text-slate-400 text-sm font-medium">Select a student first</div>
             ) : (
               <div className="flex flex-col gap-6">
                  <div className="text-center pb-4 border-b">
                     <h2 className="text-lg font-black text-slate-800">{selectedStudent.firstName} {selectedStudent.lastName}</h2>
                     <p className="text-xs font-mono text-slate-400">{selectedStudent.id}</p>
                  </div>

                  <div>
                     <h4 className="flex items-center gap-2 text-xs font-bold text-green-600 uppercase mb-3 tracking-wider">
                        <ThumbsUp className="w-4 h-4" /> Positive (+1)
                     </h4>
                     <div className="flex flex-wrap gap-2">
                        {POSITIVE_CATEGORIES.map(cat => (
                           <Button 
                             key={cat} 
                             variant="outline" 
                             size="sm" 
                             onClick={() => handleLogBehavior(selectedStudent.id, 'Positive', cat, 1)}
                             className="text-xs bg-green-50/50 border-green-200 text-green-700 hover:bg-green-100"
                           >
                             {cat}
                           </Button>
                        ))}
                     </div>
                  </div>

                  <div>
                     <h4 className="flex items-center gap-2 text-xs font-bold text-red-600 uppercase mb-3 tracking-wider">
                        <ThumbsDown className="w-4 h-4" /> Negative (-1)
                     </h4>
                     <div className="flex flex-wrap gap-2">
                        {NEGATIVE_CATEGORIES.map(cat => (
                           <Button 
                             key={cat} 
                             variant="outline" 
                             size="sm" 
                             onClick={() => handleLogBehavior(selectedStudent.id, 'Negative', cat, -1)}
                             className="text-xs bg-red-50/50 border-red-200 text-red-700 hover:bg-red-100"
                           >
                             {cat}
                           </Button>
                        ))}
                     </div>
                  </div>
               </div>
             )}
          </div>
        </div>

        {/* Right Column: Activity Log */}
        <div className="w-1/3 flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-3 border-b bg-slate-50">
             <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Today's Log</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
             <Table>
                <TableHeader className="bg-white sticky top-0">
                   <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead className="text-right">Pts</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                   {behaviors.length === 0 ? (
                      <TableRow>
                         <TableCell colSpan={3} className="text-center py-8 text-slate-400 text-xs">No records for today</TableCell>
                      </TableRow>
                   ) : behaviors.map(b => (
                      <TableRow key={b.id} className="group">
                         <TableCell className="py-2">
                            <div className="flex flex-col">
                               <span className="text-xs font-bold text-slate-700">{b.studentInfo?.firstName} {b.studentInfo?.lastName}</span>
                               <span className="text-[9px] text-slate-400 tabular-nums">{format(b.timestamp, 'h:mm a')}</span>
                            </div>
                         </TableCell>
                         <TableCell className="py-2 text-xs text-slate-600 font-medium">
                            {b.category}
                         </TableCell>
                         <TableCell className="py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                               <span className={`tabular-nums text-xs font-black ${
                                  b.points > 0 ? 'text-green-600' : b.points < 0 ? 'text-red-600' : 'text-slate-500'
                               }`}>
                                  {b.points > 0 ? '+' : ''}{b.points}
                               </span>
                               <Button 
                                 variant="ghost" 
                                 size="sm" 
                                 onClick={() => handleDeleteBehavior(b.id)} 
                                 className="h-5 w-5 p-0 text-red-300 hover:text-red-600 opacity-0 group-hover:opacity-100"
                               >
                                  <Trash2 className="w-3 h-3" />
                               </Button>
                            </div>
                         </TableCell>
                      </TableRow>
                   ))}
                </TableBody>
             </Table>
          </div>
        </div>

      </div>
    </div>
  );
}
