import Dexie, { type Table } from 'dexie';

export interface LocalUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
}

export interface LocalGroup {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  members: LocalUser[];
  syncState: 'synced' | 'pending';
}

export interface LocalExpenseSplit {
  user_id: string;
  owed_amount: string; // string to keep full decimal precision
}

export interface LocalExpense {
  id: string;
  group_id: string;
  paid_by_id: string;
  description: string;
  amount: string; // string to keep full decimal precision
  currency: string;
  date: string;
  is_settlement: boolean;
  splits: LocalExpenseSplit[];
  is_deleted: number; // 0 for active, 1 for soft-deleted
  created_at: string;
  updated_at: string;
  syncState: 'synced' | 'pending';
}

export class SplitwDatabase extends Dexie {
  groups!: Table<LocalGroup>;
  expenses!: Table<LocalExpense>;

  constructor() {
    super('SplitwDatabase');
    this.version(1).stores({
      groups: 'id, syncState, updated_at',
      expenses: 'id, group_id, paid_by_id, syncState, date, [group_id+syncState]'
    });
  }
}

export const db = new SplitwDatabase();
