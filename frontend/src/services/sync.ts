import { db, type LocalGroup, type LocalExpense } from '../db';
import { apiRequest } from './api';

const LAST_SYNC_TIME_KEY = 'splitw_last_sync_time';

export interface SyncPushResponse {
  successful_groups: string[];
  successful_expenses: string[];
}

export interface SyncPullResponse {
  groups: Array<Omit<LocalGroup, 'syncState'>>;
  expenses: Array<Omit<LocalExpense, 'syncState' | 'is_deleted'> & { is_deleted: boolean }>;
  server_time: string;
}

export async function pushLocalChanges(): Promise<void> {
  const pendingGroups = await db.groups.where('syncState').equals('pending').toArray();
  const pendingExpenses = await db.expenses.where('syncState').equals('pending').toArray();

  if (pendingGroups.length === 0 && pendingExpenses.length === 0) {
    return;
  }

  const payload = {
    groups: pendingGroups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      member_emails: g.members.map(m => m.email)
    })),
    expenses: pendingExpenses.map(e => ({
      id: e.id,
      group_id: e.group_id,
      paid_by_id: e.paid_by_id,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      date: e.date,
      is_settlement: e.is_settlement,
      splits: e.splits.map(s => ({
        user_id: s.user_id,
        owed_amount: s.owed_amount
      }))
    }))
  };

  try {
    const result = await apiRequest<SyncPushResponse>('/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (result.successful_groups.length > 0) {
      await db.groups.where('id').anyOf(result.successful_groups).modify({ syncState: 'synced' });
    }

    if (result.successful_expenses.length > 0) {
      await db.expenses.where('id').anyOf(result.successful_expenses).modify({ syncState: 'synced' });
    }
  } catch (err) {
    console.error('Sync push failed:', err);
    throw err;
  }
}

export async function pullServerChanges(): Promise<void> {
  const lastSyncTime = localStorage.getItem(LAST_SYNC_TIME_KEY);
  const queryParam = lastSyncTime ? `?since=${encodeURIComponent(lastSyncTime)}` : '';

  try {
    const result = await apiRequest<SyncPullResponse>(`/sync/pull${queryParam}`);

    for (const group of result.groups) {
      await db.groups.put({
        ...group,
        syncState: 'synced'
      });
    }

    for (const expense of result.expenses) {
      if (expense.is_deleted) {
        await db.expenses.delete(expense.id);
      } else {
        await db.expenses.put({
          ...expense,
          is_deleted: 0,
          syncState: 'synced'
        });
      }
    }

    localStorage.setItem(LAST_SYNC_TIME_KEY, result.server_time);
  } catch (err) {
    console.error('Sync pull failed:', err);
    throw err;
  }
}

export async function syncAll(): Promise<void> {
  if (!navigator.onLine) {
    console.log('Offline, skipping sync.');
    return;
  }

  console.log('Starting full synchronization...');
  try {
    await pushLocalChanges();
    await pullServerChanges();
    console.log('Synchronization complete!');
  } catch (err) {
    console.error('Synchronization failed:', err);
  }
}

export function clearSyncTime() {
  localStorage.removeItem(LAST_SYNC_TIME_KEY);
}
