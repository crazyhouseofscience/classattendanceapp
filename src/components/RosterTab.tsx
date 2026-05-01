import React, { useState, useEffect, useRef } from 'react';
import { getDB, MasterStudent } from '../lib/db';
import { triggerAutoBackup } from '../lib/gdrive';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from './ui/dialog';
import { Label } from './ui/label';
import { Search, Upload, Download, Trash2, RefreshCw, Users, Plus, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RosterTab() {
  const [masterRoster, setMasterRoster] = useState<MasterStudent[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [sortBy, setSortBy] = useState<'firstName' | 'lastName' | 'rank' | 'id'>('lastName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<MasterStudent | null>(null);
  const [formData, setFormData] = useState({
    id: '',
    firstName: '',
    lastName: '',
    gradebookRank: '',
    homeroom: '',
    email: ''
  });

  useEffect(() => {
    loadRoster();
  }, []);

  async function loadRoster() {
    const db = await getDB();
    const students = await db.getAll('roster') as MasterStudent[];
    setMasterRoster(students);
  }

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n');
        const db = await getDB();
        let imported = 0;

        // Skip header
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
          if (parts.length >= 3) {
            const student: MasterStudent = {
              id: parts[0], // barcode
              firstName: parts[1],
              lastName: parts[2],
              gradebookRank: parts[3] || '',
              homeroom: parts[4] || '',
              email: parts[5] || ''
            };
            await db.put('roster', student);
            imported++;
          }
        }
        
        toast.success(`Successfully imported ${imported} students to Master Roster`);
        loadRoster();
        triggerAutoBackup();
      } catch (err) {
        toast.error("Failed to parse CSV. Use format: Barcode,FirstName,LastName,Rank,Homeroom,Email");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleExportCSV = () => {
    if (masterRoster.length === 0) return;
    const headers = "Barcode,FirstName,LastName,Rank,Homeroom,Email";
    const rows = masterRoster.map(s => `${s.id},${s.firstName},${s.lastName},${s.gradebookRank || ''},${s.homeroom || ''},${s.email || ''}`);
    const csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + rows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "master_roster.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearRoster = async () => {
    if (!window.confirm("Are you sure? This will delete the entire stored Master Roster. This does NOT delete scanning data, just the source student list.")) return;
    const db = await getDB();
    await db.clear('roster');
    loadRoster();
    triggerAutoBackup();
    toast.success("Master Roster cleared");
  };

  const handleOpenAddModal = () => {
    setEditingStudent(null);
    setFormData({ id: '', firstName: '', lastName: '', gradebookRank: '', homeroom: '', email: '' });
    setIsStudentModalOpen(true);
  };

  const handleOpenEditModal = (student: MasterStudent) => {
    setEditingStudent(student);
    setFormData({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      gradebookRank: student.gradebookRank || '',
      homeroom: student.homeroom || '',
      email: student.email || ''
    });
    setIsStudentModalOpen(true);
  };

  const handleSaveStudent = async () => {
    if (!formData.id || !formData.firstName || !formData.lastName) {
      toast.error("ID, First Name, and Last Name are required");
      return;
    }
    
    try {
      const db = await getDB();
      const student: MasterStudent = { ...formData };
      await db.put('roster', student);
      
      toast.success(editingStudent ? "Student updated" : "Student added");
      setIsStudentModalOpen(false);
      loadRoster();
      triggerAutoBackup();
    } catch (error) {
      toast.error("Failed to save student");
    }
  };

  const handleDeleteStudent = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name} from the master roster?`)) return;
    
    try {
      const db = await getDB();
      await db.delete('roster', id);
      toast.success("Student removed from master roster");
      loadRoster();
      triggerAutoBackup();
    } catch (error) {
      toast.error("Failed to delete student");
    }
  };

  const rolloutToActive = async () => {
    if (masterRoster.length === 0) {
      toast.error("Master Roster is empty. Import a CSV first.");
      return;
    }

    if (!window.confirm(`Roll out ${masterRoster.length} students to Active Roster? This will update existing students and add new ones (it won't delete scans).`)) return;

    try {
      const db = await getDB();
      let updated = 0;
      let added = 0;

      for (const ms of masterRoster) {
        const existing = await db.get('students', ms.id);
        if (existing) {
          // Update details but keep periods and coordinates
          const updatedStudent = {
            ...existing,
            firstName: ms.firstName,
            lastName: ms.lastName,
            gradebookRank: ms.gradebookRank || existing.gradebookRank
          };
          await db.put('students', updatedStudent);
          updated++;
        } else {
          // New student
          await db.put('students', {
            id: ms.id,
            firstName: ms.firstName,
            lastName: ms.lastName,
            gradebookRank: ms.gradebookRank,
            grade: ms.grade || '',
            notes: '',
            periods: []
          });
          added++;
        }
      }

      toast.success(`Rollout complete: ${added} added, ${updated} updated in active records.`);
      triggerAutoBackup();
    } catch (e) {
      toast.error("Rollout failed");
    }
  };

  const filtered = masterRoster.filter(s => 
    `${s.firstName} ${s.lastName} ${s.id} ${s.homeroom}`.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    let result = 0;
    if (sortBy === 'firstName') {
      result = (a.firstName || '').localeCompare(b.firstName || '');
    } else if (sortBy === 'lastName') {
      result = (a.lastName || '').localeCompare(b.lastName || '');
    } else if (sortBy === 'id') {
      result = (a.id || '').localeCompare(b.id || '');
    } else if (sortBy === 'rank') {
      result = parseInt(a.gradebookRank || '9999') - parseInt(b.gradebookRank || '9999');
    }
    return sortOrder === 'asc' ? result : -result;
  });

  const toggleSort = (field: 'firstName' | 'lastName' | 'rank' | 'id') => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="p-4 bg-white border-b flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Master Roster</h2>
            <p className="text-xs text-slate-500">Store and manage your source student database</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              className="pl-9 w-64 h-9 text-sm" 
              placeholder="Search master list..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Button variant="default" size="sm" onClick={handleOpenAddModal} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Add Student
          </Button>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".csv" 
            onChange={handleImportCSV}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="gap-2">
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="default" size="sm" onClick={rolloutToActive} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <RefreshCw className="w-4 h-4" /> Roll Out
          </Button>
          <Button variant="ghost" size="sm" onClick={clearRoster} className="text-red-500 hover:text-red-600 hover:bg-red-50">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="w-24 font-bold cursor-pointer hover:text-indigo-600" onClick={() => toggleSort('id')}>ID / Barcode</TableHead>
                <TableHead className="font-bold cursor-pointer hover:text-indigo-600" onClick={() => toggleSort('lastName')}>Last Name</TableHead>
                <TableHead className="font-bold cursor-pointer hover:text-indigo-600" onClick={() => toggleSort('firstName')}>First Name</TableHead>
                <TableHead className="font-bold cursor-pointer hover:text-indigo-600" onClick={() => toggleSort('rank')}>Rank</TableHead>
                <TableHead className="font-bold">Homeroom</TableHead>
                <TableHead className="font-bold">Email</TableHead>
                <TableHead className="font-bold w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-400">
                    No students in master roster. Import a CSV to get started.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(student => (
                  <TableRow key={student.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs">{student.id}</TableCell>
                    <TableCell className="font-medium">{student.lastName}</TableCell>
                    <TableCell>{student.firstName}</TableCell>
                    <TableCell className="text-slate-500">{student.gradebookRank}</TableCell>
                    <TableCell className="text-slate-500">{student.homeroom}</TableCell>
                    <TableCell className="text-slate-500 text-xs">{student.email}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-indigo-600" onClick={() => handleOpenEditModal(student)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-600" onClick={() => handleDeleteStudent(student.id, `${student.firstName} ${student.lastName}`)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 p-4 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-sm">
          <strong>Note:</strong> Rolling out will sync your master list with active scanning records. It updates names/ranks but <strong>will not</strong> erase current attendance, points, or period enrollments.
        </div>
      </div>

      <Dialog open={isStudentModalOpen} onOpenChange={setIsStudentModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStudent ? 'Edit Student' : 'Add Student'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="id" className="text-right">Barcode ID</Label>
              <Input
                id="id"
                value={formData.id}
                onChange={(e) => setFormData(p => ({ ...p, id: e.target.value }))}
                className="col-span-3"
                disabled={!!editingStudent}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="firstName" className="text-right">First Name</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => setFormData(p => ({ ...p, firstName: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="lastName" className="text-right">Last Name</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) => setFormData(p => ({ ...p, lastName: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="gradebookRank" className="text-right">Rank</Label>
              <Input
                id="gradebookRank"
                value={formData.gradebookRank}
                onChange={(e) => setFormData(p => ({ ...p, gradebookRank: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="homeroom" className="text-right">Homeroom</Label>
              <Input
                id="homeroom"
                value={formData.homeroom}
                onChange={(e) => setFormData(p => ({ ...p, homeroom: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStudentModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveStudent}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
