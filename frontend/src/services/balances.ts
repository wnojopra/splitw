import { type LocalGroup, type LocalExpense } from '../db';

export interface DebtItem {
  from_user_id: string;
  to_user_id: string;
  amount: string;
}

export interface GroupBalances {
  balances: Record<string, string>; // Map user_id -> balance amount as string
  simplified_debts: DebtItem[];
}

/**
 * Calculates net balances and simplified debts locally from IndexedDB group/expense data.
 * Ensures offline-first views are fully consistent with backend outputs.
 */
export function calculateLocalBalances(group: LocalGroup, expenses: LocalExpense[]): GroupBalances {
  // Initialize balances for all group members to 0.00
  const balances: Record<string, number> = {};
  for (const member of group.members) {
    balances[member.id] = 0;
  }

  // Filter out deleted expenses
  const activeExpenses = expenses.filter(e => e.is_deleted !== 1);

  for (const expense of activeExpenses) {
    const payerId = expense.paid_by_id;
    const amount = parseFloat(expense.amount);

    // Add to payer's balance
    if (payerId in balances) {
      balances[payerId] += amount;
    }

    // Subtract owed amounts for each participant in splits
    for (const split of expense.splits) {
      const debtorId = split.user_id;
      const owed = parseFloat(split.owed_amount);
      if (debtorId in balances) {
        balances[debtorId] -= owed;
      }
    }
  }

  // Format balances to strings with 2 decimal places
  const formattedBalances: Record<string, string> = {};
  for (const uid in balances) {
    formattedBalances[uid] = balances[uid].toFixed(2);
  }

  // Debt Simplification Algorithm (Greedy Match)
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

  const simplified_debts: DebtItem[] = [];

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
      amount: settleAmount.toFixed(2)
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

  return {
    balances: formattedBalances,
    simplified_debts
  };
}
