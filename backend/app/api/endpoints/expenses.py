from typing import List
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.models import User
from app import schemas, crud

router = APIRouter()

@router.post("/groups/{group_id}/expenses", response_model=schemas.ExpenseResponse, status_code=status.HTTP_201_CREATED)
def create_group_expense(
    group_id: str,
    expense_in: schemas.ExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new expense in a group.
    Must be a member of the group.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    if current_user not in db_group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of the group to add expenses"
        )
        
    return crud.create_expense(db, group_id=group_id, expense_in=expense_in)

@router.get("/groups/{group_id}/expenses", response_model=List[schemas.ExpenseResponse])
def list_group_expenses(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all expenses in a group.
    Must be a member of the group.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    if current_user not in db_group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of the group to view expenses"
        )
        
    return crud.get_group_expenses(db, group_id=group_id)

@router.delete("/expenses/{expense_id}", response_model=schemas.ExpenseResponse)
def delete_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Soft-delete an expense.
    Only group members of the expense's group can delete it.
    """
    db_expense = crud.get_expense(db, expense_id=expense_id)
    if not db_expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
        
    if current_user not in db_expense.group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this expense"
        )
        
    return crud.delete_expense(db, db_expense=db_expense)

@router.get("/groups/{group_id}/balances", response_model=schemas.GroupBalancesResponse)
def get_group_balances_and_debts(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Calculate net balances and return simplified debts for the group.
    Must be a member of the group.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    if current_user not in db_group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of this group"
        )
        
    # 1. Initialize balances for all group members to 0.00
    balances = {member.id: Decimal("0.00") for member in db_group.members}
    
    # 2. Loop through non-deleted expenses and update balances
    expenses = crud.get_group_expenses(db, group_id=group_id)
    for expense in expenses:
        payer_id = expense.paid_by_id
        amount = Decimal(str(expense.amount))
        
        # Payer's balance increases by the paid amount
        if payer_id in balances:
            balances[payer_id] += amount
            
        # Subtract owed amounts for each participant in splits
        for split in expense.splits:
            debtor_id = split.user_id
            owed = Decimal(str(split.owed_amount))
            if debtor_id in balances:
                balances[debtor_id] -= owed
                
    # Convert balances dict to JSON-friendly string format for transmission
    json_balances = {uid: float(bal) for uid, bal in balances.items()}
    
    # 3. Debt Simplification Algorithm
    # Separate into debtors and creditors
    debtors = []    # (user_id, absolute_debt_amount)
    creditors = []   # (user_id, credit_amount)
    
    for uid, bal in balances.items():
        # Use a tiny epsilon to avoid floating point noise (e.g. 0.009)
        if bal < Decimal("-0.009"):
            debtors.append([uid, abs(bal)])
        elif bal > Decimal("0.009"):
            creditors.append([uid, bal])
            
    simplified_debts = []
    
    # Greedy match
    while debtors and creditors:
        # Sort so that largest is at the end
        debtors.sort(key=lambda x: x[1])
        creditors.sort(key=lambda x: x[1])
        
        debtor = debtors[-1]
        creditor = creditors[-1]
        
        settle_amount = min(debtor[1], creditor[1])
        
        simplified_debts.append(
            schemas.DebtItem(
                from_user_id=debtor[0],
                to_user_id=creditor[0],
                amount=settle_amount
            )
        )
        
        # Update balances
        debtor[1] -= settle_amount
        creditor[1] -= settle_amount
        
        # Remove if fully settled
        if debtor[1] < Decimal("0.009"):
            debtors.pop()
        if creditor[1] < Decimal("0.009"):
            creditors.pop()
            
    return schemas.GroupBalancesResponse(
        group_id=group_id,
        balances=json_balances,
        simplified_debts=simplified_debts
    )
