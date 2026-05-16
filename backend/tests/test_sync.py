import pytest
from datetime import datetime, timedelta
from fastapi import status
from app.models import Group, Expense
from app.db import SessionLocal

def test_sync_push_groups_and_expenses(client, auth_headers1, test_user1, test_user2):
    """
    Tests that a client can successfully push a new offline group and expense,
    and the server persists them using the client-provided UUIDs.
    """
    group_uuid = "client-group-uuid-111"
    expense_uuid = "client-expense-uuid-222"
    
    # Create payload with offline group and offline expense
    sync_payload = {
        "groups": [
            {
                "id": group_uuid,
                "name": "Offline Trip",
                "description": "Created while camping",
                "member_emails": [test_user1.email, test_user2.email]
            }
        ],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "Firewood",
                "amount": 30.00,
                "paid_by_id": test_user1.id,
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 15.00},
                    {"user_id": test_user2.id, "owed_amount": 15.00}
                ]
            }
        ]
    }
    
    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload,
        headers=auth_headers1
    )
    
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    assert group_uuid in data["successful_groups"]
    assert expense_uuid in data["successful_expenses"]

def test_sync_pull_updates(client, auth_headers1, test_user1, test_user2, db):
    """
    Tests that sync pull correctly returns new/updated records since a specific timestamp,
    including soft-deleted expenses.
    """
    # 1. Create group and expense manually in DB
    group = Group(id="pull-group-uuid", name="Sync Pull Group")
    group.members.append(test_user1)
    group.members.append(test_user2)
    
    expense = Expense(
        id="pull-expense-uuid",
        group_id=group.id,
        paid_by_id=test_user1.id,
        description="Gas",
        amount=20.00,
        date=datetime.utcnow()
    )
    db.add(group)
    db.add(expense)
    db.commit()
    
    # 2. Pull with a timestamp in the past (should return the group and expense)
    past_time = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    response = client.get(
        f"/api/v1/sync/pull?since={past_time}",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    assert len(data["groups"]) == 1
    assert data["groups"][0]["id"] == group.id
    assert len(data["expenses"]) == 1
    assert data["expenses"][0]["id"] == expense.id
    assert data["expenses"][0]["is_deleted"] is False
    
    # 3. Pull with a future timestamp (should return nothing)
    future_time = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    response = client.get(
        f"/api/v1/sync/pull?since={future_time}",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert len(data["groups"]) == 0
    assert len(data["expenses"]) == 0
    
    # 4. Soft-delete the expense and pull again with past timestamp (should return expense with is_deleted = True)
    expense.is_deleted = True
    expense.updated_at = datetime.utcnow()  # Update timestamp
    db.commit()
    
    response = client.get(
        f"/api/v1/sync/pull?since={past_time}",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert len(data["expenses"]) == 1
    assert data["expenses"][0]["id"] == expense.id
    assert data["expenses"][0]["is_deleted"] is True
