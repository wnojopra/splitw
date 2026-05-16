from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from app import models, schemas

# --- User CRUD ---
def get_user(db: Session, user_id: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()

def get_user_by_google_id(db: Session, google_id: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.google_id == google_id).first()

def create_user(db: Session, user_in: schemas.UserCreate) -> models.User:
    db_user = models.User(
        google_id=user_in.google_id,
        email=user_in.email,
        display_name=user_in.display_name,
        avatar_url=user_in.avatar_url
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user(db: Session, db_user: models.User, user_in: schemas.UserUpdate) -> models.User:
    if user_in.display_name is not None:
        db_user.display_name = user_in.display_name
    if user_in.avatar_url is not None:
        db_user.avatar_url = user_in.avatar_url
    db_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_user)
    return db_user

# --- Group CRUD ---
def get_group(db: Session, group_id: str) -> Optional[models.Group]:
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_user_groups(db: Session, user_id: str) -> List[models.Group]:
    return db.query(models.Group).join(models.Group.members).filter(models.User.id == user_id).all()

def create_group(db: Session, group_in: schemas.GroupCreate, owner: models.User) -> models.Group:
    # Handle custom client-provided UUID for offline sync support
    group_id = group_in.id if group_in.id else models.generate_uuid_str()
    
    # Ensure group ID is unique
    existing_group = get_group(db, group_id)
    if existing_group:
        return existing_group

    db_group = models.Group(
        id=group_id,
        name=group_in.name,
        description=group_in.description
    )
    # Automatically add the owner as the first member
    db_group.members.append(owner)
    
    # Add other members if emails are provided
    for email in group_in.member_emails:
        if email == owner.email:
            continue
        member = get_user_by_email(db, email)
        if member:
            db_group.members.append(member)
            
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

def add_group_member_by_email(db: Session, db_group: models.Group, email: str) -> models.User:
    member = get_user_by_email(db, email)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {email} not found. Ask them to sign up first."
        )
    if member in db_group.members:
        return member
    db_group.members.append(member)
    db_group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_group)
    return member

# --- Expense CRUD ---
def get_expense(db: Session, expense_id: str) -> Optional[models.Expense]:
    return db.query(models.Expense).filter(models.Expense.id == expense_id, models.Expense.is_deleted == False).first()

def get_group_expenses(db: Session, group_id: str) -> List[models.Expense]:
    return db.query(models.Expense).filter(
        models.Expense.group_id == group_id,
        models.Expense.is_deleted == False
    ).order_by(models.Expense.date.desc()).all()

def create_expense(db: Session, group_id: str, expense_in: schemas.ExpenseCreate) -> models.Expense:
    # Verify that the sum of splits equals the total amount
    total_split_amount = sum(Decimal(str(split.owed_amount)) for split in expense_in.splits)
    if abs(total_split_amount - Decimal(str(expense_in.amount))) > Decimal("0.01"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The sum of splits ({total_split_amount}) does not equal the total expense amount ({expense_in.amount})"
        )
        
    # Verify group membership for creator and all split members
    db_group = get_group(db, group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    member_ids = {user.id for user in db_group.members}
    if expense_in.paid_by_id not in member_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payer must be a member of the group"
        )
        
    for split in expense_in.splits:
        if split.user_id not in member_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"User {split.user_id} involved in split is not a member of the group"
            )

    # Support client-provided UUID for offline sync
    expense_id = expense_in.id if expense_in.id else models.generate_uuid_str()
    
    # Handle idempotent creates for offline synchronization sync loops
    existing_expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if existing_expense:
        # If it was soft deleted, restore it and update
        existing_expense.is_deleted = False
        existing_expense.description = expense_in.description
        existing_expense.amount = expense_in.amount
        existing_expense.paid_by_id = expense_in.paid_by_id
        existing_expense.date = expense_in.date
        existing_expense.is_settlement = expense_in.is_settlement
        existing_expense.updated_at = datetime.utcnow()
        # Clear and rewrite splits
        db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense_id).delete()
        for split in expense_in.splits:
            db_split = models.ExpenseSplit(
                expense_id=expense_id,
                user_id=split.user_id,
                owed_amount=split.owed_amount
            )
            db.add(db_split)
        db.commit()
        db.refresh(existing_expense)
        return existing_expense

    db_expense = models.Expense(
        id=expense_id,
        group_id=group_id,
        paid_by_id=expense_in.paid_by_id,
        description=expense_in.description,
        amount=expense_in.amount,
        currency=expense_in.currency,
        date=expense_in.date,
        is_settlement=expense_in.is_settlement
    )
    db.add(db_expense)
    
    # Create expense splits
    for split in expense_in.splits:
        db_split = models.ExpenseSplit(
            expense_id=expense_id,
            user_id=split.user_id,
            owed_amount=split.owed_amount
        )
        db.add(db_split)
        
    # Update group's updated_at to trigger synching updates for other users
    db_group.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_expense)
    return db_expense

def delete_expense(db: Session, db_expense: models.Expense) -> models.Expense:
    # Soft delete so it can sync delete to offline clients
    db_expense.is_deleted = True
    db_expense.updated_at = datetime.utcnow()
    
    # Trigger parent group updated_at update
    db_expense.group.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_expense)
    return db_expense
