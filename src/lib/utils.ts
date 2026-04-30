import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Student } from "./db"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isStudentInPeriod = (student: Student, periodName: string) => {
    if (!student.periods || student.periods.length === 0) return false;
    
    // Extract the core identifier of the period, e.g., "1" from "Period 1", "3" from "Period 3 (Chem)"
    const matchPeriodId = periodName.match(/\b(\d+[A-Z]?)\b/i);
    const periodId = matchPeriodId ? matchPeriodId[1].toLowerCase() : periodName.toLowerCase();
    
    return student.periods.some(p => {
       if (p === periodName) return true;
       
       const pLower = p.toLowerCase();
       
       // Handle exact or boundary matches
       const regex = new RegExp(`^${periodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
       if (regex.test(p)) return true;
       
       // Handle "Pd 1", "P 1", "P1", "Pd1", "1", etc.
       // Only if we successfully extracted a short ID like "1"
       if (matchPeriodId) {
          const pMatch = pLower.match(/\b(?:p|pd|period|sec|section)?\s*(\d+[a-z]?)\b/i);
          if (pMatch && pMatch[1].toLowerCase() === periodId) {
             return true;
          }
       }
       
       return false;
    });
};
