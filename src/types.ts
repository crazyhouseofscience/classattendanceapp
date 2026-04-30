export interface BehaviorLog {
  id: string;
  behaviorId: string;
  points: number;
  type: 'positive' | 'negative' | 'neutral';
  timestamp: number;
  context: 'standard' | 'lab';
  comment?: string;
}

export interface Student {
  id: string;
  name: string;
  positivePoints: number;
  negativePoints: number;
  labPositivePoints?: number;
  labNegativePoints?: number;
  logs: BehaviorLog[];
  isAbsent?: boolean;
  absentDates?: string[];
  groupId?: string;
  order?: number;
  x?: number;
  y?: number;
}

export interface Behavior {
  id: string;
  name: string;
  points: number;
  type: 'positive' | 'negative' | 'neutral';
  isPrimary?: boolean;
  context?: 'standard' | 'lab';
}

export interface Group {
  id: string;
  name: string;
}

export interface Classroom {
  id: string;
  name: string;
  students: Student[];
  behaviors: Behavior[];
  order?: number;
  groups?: Group[];
}

export const DEFAULT_BEHAVIORS: Behavior[] = [
  { id: 'b1', name: 'On Task', points: 1, type: 'positive', isPrimary: true, context: 'standard' },
  { id: 'b2', name: 'Helping Others', points: 1, type: 'positive', isPrimary: true, context: 'standard' },
  { id: 'b3', name: 'Great Answer', points: 1, type: 'positive', isPrimary: true, context: 'standard' },
  { id: 'b4', name: 'Off Task', points: -1, type: 'negative', isPrimary: true, context: 'standard' },
  { id: 'b5', name: 'Disrespect', points: -2, type: 'negative', isPrimary: true, context: 'standard' }
];

export const DEFAULT_LAB_BEHAVIORS: Behavior[] = [
  { id: 'lb1', name: 'Good Collaboration', points: 1, type: 'positive', isPrimary: true, context: 'lab' },
  { id: 'lb2', name: 'Safe Practices', points: 1, type: 'positive', isPrimary: true, context: 'lab' },
  { id: 'lb3', name: 'Unsafe Behavior', points: -2, type: 'negative', isPrimary: true, context: 'lab' }
];
