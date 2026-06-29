import { type LocalGroup, type LocalExpense } from '../db';

export interface DebtItem {
  from_user_id: string;
  to_user_id: string;
  amount: string;
  currency: string;
}

export interface GroupBalances {
  balances: Record<string, Record<string, string>>; // Map currency -> user_id -> balance amount as string
  simplified_debts: DebtItem[];
}

/**
 * Calculates net balances and simplified debts locally from IndexedDB group/expense data.
 * Ensures offline-first views are fully consistent with backend outputs.
 */
export function calculateLocalBalances(group: LocalGroup, expenses: LocalExpense[]): GroupBalances {
  // Initialize balances per currency
  const balancesByCurrency: Record<string, Record<string, number>> = {};

  // Filter out deleted expenses
  const activeExpenses = expenses.filter(e => e.is_deleted !== 1);

  for (const expense of activeExpenses) {
    const curr = expense.currency || 'USD';
    if (!balancesByCurrency[curr]) {
      balancesByCurrency[curr] = {};
      for (const member of group.members) {
        balancesByCurrency[curr][member.id] = 0;
      }
    }

    const payerId = expense.paid_by_id;
    const amount = parseFloat(expense.amount);

    // Add to payer's balance
    if (payerId in balancesByCurrency[curr]) {
      balancesByCurrency[curr][payerId] += amount;
    }

    // Subtract owed amounts for each participant in splits
    for (const split of expense.splits) {
      const debtorId = split.user_id;
      const owed = parseFloat(split.owed_amount);
      if (debtorId in balancesByCurrency[curr]) {
        balancesByCurrency[curr][debtorId] -= owed;
      }
    }
  }

  // Format balances to strings with 2 decimal places
  const formattedBalances: Record<string, Record<string, string>> = {};
  for (const curr in balancesByCurrency) {
    formattedBalances[curr] = {};
    for (const uid in balancesByCurrency[curr]) {
      formattedBalances[curr][uid] = balancesByCurrency[curr][uid].toFixed(2);
    }
  }

  // Debt Simplification Algorithm (Greedy Match) per currency
  const simplified_debts: DebtItem[] = [];

  for (const curr in balancesByCurrency) {
    const balances = balancesByCurrency[curr];
    const debtors: [string, number][] = [];
    const creditors: [string, number][] = [];

    for (const uid in balances) {
      const bal = balances[uid];
      if (bal < -0.009) {
        debtors.push([uid, Math.abs(bal)]);
      } else if (bal > 0.009) {
        creditors.push([uid, bal]);
      }
    }

    while (debtors.length > 0 && creditors.length > 0) {
      // Sort in ascending order to easily pop the largest values
      debtors.sort((a, b) => a[1] - b[1]);
      creditors.sort((a, b) => a[1] - b[1]);

      const debtor = debtors[debtors.length - 1];
      const creditor = creditors[creditors.length - 1];

      const settleAmount = Math.min(debtor[1], creditor[1]);

      simplified_debts.push({
        from_user_id: debtor[0],
        to_user_id: creditor[0],
        amount: settleAmount.toFixed(2),
        currency: curr
      });

      debtor[1] -= settleAmount;
      creditor[1] -= settleAmount;

      if (debtor[1] < 0.009) {
        debtors.pop();
      }
      if (creditor[1] < 0.009) {
        creditors.pop();
      }
    }
  }

  return {
    balances: formattedBalances,
    simplified_debts
  };
}
