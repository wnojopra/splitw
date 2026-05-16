from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, StringConstraints
from typing_extensions import Annotated

# --- Token & Auth Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenPayload(BaseModel):
    sub: Optional[str] = None
    email: Optional[str] = None

class GoogleAuthRequest(BaseModel):
    id_token: str

# --- User Schemas ---
class UserBase(BaseModel):
    email: EmailStr
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    avatar_url: Optional[str] = None

class UserCreate(UserBase):
    google_id: str

class UserUpdate(BaseModel):
    display_name: Optional[Annotated[str, StringConstraints(min_length=1, max_length=100)]] = None
    avatar_url: Optional[str] = None

class UserResponse(UserBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Expense Split Schemas ---
class ExpenseSplitBase(BaseModel):
    user_id: str
    owed_amount: Decimal = Field(..., max_digits=12, decimal_places=2)

class ExpenseSplitCreate(ExpenseSplitBase):
    pass

class ExpenseSplitResponse(ExpenseSplitBase):
    class Config:
        from_attributes = True

# --- Expense Schemas ---
class ExpenseBase(BaseModel):
    description: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    amount: Decimal = Field(..., max_digits=12, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    date: datetime
    is_settlement: bool = False

class ExpenseCreate(ExpenseBase):
    id: Optional[str] = None  # Client-provided UUID for offline sync support
    group_id: Optional[str] = None
    paid_by_id: str
    splits: List[ExpenseSplitCreate]

class ExpenseUpdate(BaseModel):
    description: Optional[Annotated[str, StringConstraints(min_length=1, max_length=255)]] = None
    amount: Optional[Decimal] = Field(None, max_digits=12, decimal_places=2)
    paid_by_id: Optional[str] = None
    date: Optional[datetime] = None
    is_settlement: Optional[bool] = None
    splits: Optional[List[ExpenseSplitCreate]] = None

class ExpenseResponse(ExpenseBase):
    id: str
    group_id: str
    paid_by_id: str
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    splits: List[ExpenseSplitResponse]

    class Config:
        from_attributes = True

# --- Group Schemas ---
class GroupBase(BaseModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    description: Optional[Annotated[str, StringConstraints(max_length=255)]] = None

class GroupCreate(GroupBase):
    id: Optional[str] = None  # Client-provided UUID for offline sync support
    member_emails: List[EmailStr] = []

class GroupUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(min_length=1, max_length=100)]] = None
    description: Optional[Annotated[str, StringConstraints(max_length=255)]] = None

class GroupResponse(GroupBase):
    id: str
    created_at: datetime
    updated_at: datetime
    members: List[UserResponse] = []

    class Config:
        from_attributes = True

# --- Debt & Settle Schemas ---
class DebtItem(BaseModel):
    from_user_id: str
    to_user_id: str
    amount: Decimal

class GroupBalancesResponse(BaseModel):
    group_id: str
    balances: dict  # Map user_id -> balance amount (Decimal)
    simplified_debts: List[DebtItem]

# --- Sync Schemas ---
class SyncPushRequest(BaseModel):
    groups: List[GroupCreate] = []
    expenses: List[ExpenseCreate] = []

class SyncPushResponse(BaseModel):
    successful_groups: List[str] = []
    successful_expenses: List[str] = []

class SyncPullResponse(BaseModel):
    groups: List[GroupResponse] = []
    expenses: List[ExpenseResponse] = []
    server_time: datetime
