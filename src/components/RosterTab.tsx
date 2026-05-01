import React, { useState, useEffect, useRef } from 'react';
import { getDB, MasterStudent } from '../lib/db';
import { triggerAutoBackup } from '../lib/gdrive';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Search, Upload, Download, Trash2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function RosterTab() {
  const [masterRoster, setMasterRoster] = useState<MasterStudent[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadRoster();
  }, []);

  async function loadRoster() {
    const db = await getDB();
    const students = await db.getAll('roster') as MasterStudent[];
    setMasterRoster(students.sort((a, b) => a.lastName.localeCompare(b.lastName)));
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
  );

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
                <TableHead className="w-24 font-bold">ID / Barcode</TableHead>
                <TableHead className="font-bold">Last Name</TableHead>
                <TableHead className="font-bold">First Name</TableHead>
                <TableHead className="font-bold">Rank</TableHead>
                <TableHead className="font-bold">Homeroom</TableHead>
                <TableHead className="font-bold">Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-400">
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
    </div>
  );
}
