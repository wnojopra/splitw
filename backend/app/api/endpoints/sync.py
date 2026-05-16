from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select, or_

from app.db import get_db
from app.auth import get_current_user
from app.models import User, Group, Expense
from app import schemas, crud

router = APIRouter()

@router.post("/push", response_model=schemas.SyncPushResponse)
def sync_push(
    payload: schemas.SyncPushRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Pushes offline-created or modified groups and expenses to the server.
    Resolves updates idempotently using client-provided UUID primary keys.
    """
    successful_groups = []
    successful_expenses = []
    
    # 1. Sync groups first
    for group_in in payload.groups:
        try:
            crud.create_group(db, group_in=group_in, owner=current_user)
            successful_groups.append(group_in.id)
        except Exception as e:
            # Log and continue syncing other entities
            continue
            
    # 2. Sync expenses
    for expense_in in payload.expenses:
        try:
            # Identify which group the expense belongs to
            # Ensure the current user is indeed a member of that group before writing
            db_group = crud.get_group(db, expense_in.group_id)
            if not db_group or current_user not in db_group.members:
                continue
                
            crud.create_expense(db, group_id=expense_in.group_id, expense_in=expense_in)
            successful_expenses.append(expense_in.id)
        except Exception as e:
            continue
            
    return schemas.SyncPushResponse(
        successful_groups=successful_groups,
        successful_expenses=successful_expenses
    )

@router.get("/pull", response_model=schemas.SyncPullResponse)
def sync_pull(
    since: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Pulls newly updated groups and expenses that have changed since the last synchronization time.
    """
    server_time = datetime.utcnow()
    
    # Get all groups the user is a member of
    user_groups = crud.get_user_groups(db, user_id=current_user.id)
    group_ids = [g.id for g in user_groups]
    
    # If no timestamp is provided, fetch everything
    if since is None:
        # Convert datetime.min to tz-naive if needed, or a default far in the past
        since = datetime(2020, 1, 1)
        
    # Pull updated groups
    updated_groups = []
    for g in user_groups:
        if g.updated_at > since:
            updated_groups.append(g)
            
    # Pull updated expenses (including soft-deleted ones so they can delete locally)
    updated_expenses = []
    if group_ids:
        updated_expenses = db.query(Expense).filter(
            Expense.group_id.in_(group_ids),
            Expense.updated_at > since
        ).all()
        
    return schemas.SyncPullResponse(
        groups=updated_groups,
        expenses=updated_expenses,
        server_time=server_time
    )
