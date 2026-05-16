from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.models import User
from app import schemas, crud

router = APIRouter()

@router.post("/", response_model=schemas.GroupResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    group_in: schemas.GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new group of friends.
    Automatically adds the creator as a member.
    """
    return crud.create_group(db, group_in=group_in, owner=current_user)

@router.get("/", response_model=List[schemas.GroupResponse])
def list_groups(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all groups the current user is a member of.
    """
    return crud.get_user_groups(db, user_id=current_user.id)

@router.get("/{group_id}", response_model=schemas.GroupResponse)
def get_group_details(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get detailed information of a group.
    User must be a member of the group.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    if current_user not in db_group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this group"
        )
        
    return db_group

@router.post("/{group_id}/members", response_model=schemas.UserResponse)
def add_group_member(
    group_id: str,
    invite_request: schemas.GoogleAuthRequest,  # Reuse class or send payload with email. Let's use simple body/query.
    # Wait! Let's design email request. To keep it simple and type-safe, let's just accept a dictionary or query param.
    email: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Invite/add a user to the group using their email address.
    The user must already be registered in the database.
    Only existing members of the group can invite others.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        
    if current_user not in db_group.members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group members can invite others"
        )
        
    return crud.add_group_member_by_email(db, db_group=db_group, email=email)
