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

def test_sync_placeholder_and_healing(client, auth_headers1, test_user1, db):
    """
    Tests that:
    1. Pushing a group with a non-existent email creates a placeholder user.
    2. Pushing an expense involving that placeholder user (via dev-google-id-email)
       successfully resolves their ID and heals group membership.
    3. The placeholder user can sign up later and is merged.
    """
    group_uuid = "sync-group-placeholder-uuid"
    expense_uuid = "sync-expense-placeholder-uuid"
    friend_email = "newfriend@example.com"
    friend_placeholder_id = f"dev-google-id-{friend_email}"
    
    # 1. Push group inviting newfriend@example.com (who doesn't exist)
    sync_payload = {
        "groups": [
            {
                "id": group_uuid,
                "name": "Trip with New Friend",
                "description": "Planning",
                "member_emails": [test_user1.email, friend_email]
            }
        ],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "Train tickets",
                "amount": 50.00,
                "paid_by_id": test_user1.id,
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 25.00},
                    {"user_id": friend_placeholder_id, "owed_amount": 25.00}
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
    
    # Verify placeholder user was created in DB
    from app.models import User, Group, Expense
    placeholder_user = db.query(User).filter(User.email == friend_email).first()
    assert placeholder_user is not None
    assert placeholder_user.google_id == f"placeholder-{friend_email}"
    
    # Verify they were added to the group
    group = db.query(Group).filter(Group.id == group_uuid).first()
    assert placeholder_user in group.members
    
    # Verify the expense splits use the placeholder's real DB UUID, not the dev-google-id
    expense = db.query(Expense).filter(Expense.id == expense_uuid).first()
    assert expense.paid_by_id == test_user1.id
    split_user_ids = {s.user_id for s in expense.splits}
    assert placeholder_user.id in split_user_ids
    assert friend_placeholder_id not in split_user_ids
    
    # 2. Simulate the new friend signing up
    signup_payload = {
        "id_token": f"dev-token-{friend_email}"
    }
    auth_response = client.post(
        "/api/v1/auth/google",
        json=signup_payload
    )
    assert auth_response.status_code == status.HTTP_200_OK
    
    # Verify the placeholder user was merged (google_id updated)
    db.refresh(placeholder_user)
    assert placeholder_user.google_id == f"dev-google-id-{friend_email}"
    
    # Verify they are still in the group
    assert placeholder_user in group.members


def test_sync_push_unauthorized_group_and_expense(client, auth_headers1, auth_headers2, test_user1, test_user2, db):
    """
    Tests that a user cannot push updates to a group they do not belong to,
    nor add expenses to a group they do not belong to.
    """
    # 1. Create a group belonging ONLY to test_user1
    from app.models import Group, Expense
    group = Group(id="alice-private-group", name="Alice Private")
    group.members.append(test_user1)
    db.add(group)
    db.commit()

    # 2. test_user2 (auth_headers2) tries to push a group update and an expense to it
    sync_payload = {
        "groups": [
            {
                "id": group.id,
                "name": "Hacked Group Name",
                "description": "Charlie trying to modify",
                "member_emails": [test_user1.email, test_user2.email]
            }
        ],
        "expenses": [
            {
                "id": "hacked-expense-uuid",
                "group_id": group.id,
                "description": "Charlie's secret dinner",
                "amount": 100.00,
                "paid_by_id": test_user2.id,
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 100.00}
                ]
            }
        ]
    }

    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload,
        headers=auth_headers2
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()

    # Both should have failed (not in the successful lists)
    assert group.id not in data["successful_groups"]
    assert "hacked-expense-uuid" not in data["successful_expenses"]

    # Verify DB was NOT modified
    db.refresh(group)
    assert group.name == "Alice Private"  # Name remained unchanged
    assert test_user2 not in group.members  # User2 was not added

    # Verify no expense was created
    expense = db.query(Expense).filter(Expense.id == "hacked-expense-uuid").first()
    assert expense is None


def test_sync_push_expense_paid_by_other_member(client, auth_headers1, test_user1, test_user2, db):
    """
    Tests that when User 1 (Alice) pushes an expense paid by User 2 (Charlie),
    it correctly saves all splits.
    """
    import uuid
    from datetime import datetime
    from app.models import Group, Expense
    from fastapi import status

    group_uuid = str(uuid.uuid4())
    expense_uuid = str(uuid.uuid4())

    # 1. Alice pushes a group containing Charlie
    sync_payload = {
        "groups": [
            {
                "id": group_uuid,
                "name": "Alice-Charlie",
                "member_emails": [test_user1.email, test_user2.email]
            }
        ],
        "expenses": []
    }
    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload,
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    assert group_uuid in response.json()["successful_groups"]

    # 2. Alice pushes an expense paid by Charlie, split equally
    sync_payload2 = {
        "groups": [],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "Dinner",
                "amount": 100.00,
                "paid_by_id": test_user2.id, # Paid by Charlie
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 50.00},
                    {"user_id": test_user2.id, "owed_amount": 50.00}
                ]
            }
        ]
    }
    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload2,
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    assert expense_uuid in response.json()["successful_expenses"]

    # 3. Verify DB has both splits
    expense = db.query(Expense).filter(Expense.id == expense_uuid).first()
    assert expense is not None
    assert expense.paid_by_id == test_user2.id
    assert len(expense.splits) == 2
    
    split_users = {s.user_id for s in expense.splits}
    assert test_user1.id in split_users
    assert test_user2.id in split_users


def test_sync_invited_member_adds_expense(client, auth_headers1, auth_headers2, test_user1, test_user2, db):
    """
    Tests that when the invited user (Charlie/user2) pulls the group,
    adds an expense, and pushes it, it correctly saves all splits.
    """
    import uuid
    from datetime import datetime
    from app.models import Group, Expense
    from fastapi import status

    group_uuid = str(uuid.uuid4())
    expense_uuid = str(uuid.uuid4())

    # 1. Alice (user1) pushes the group containing Charlie (user2)
    sync_payload = {
        "groups": [
            {
                "id": group_uuid,
                "name": "Alice-Charlie",
                "member_emails": [test_user1.email, test_user2.email]
            }
        ],
        "expenses": []
    }
    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload,
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK

    # 2. Charlie (user2) pushes the expense
    sync_payload2 = {
        "groups": [],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "Dinner",
                "amount": 100.00,
                "paid_by_id": test_user2.id, # Paid by Charlie
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 50.00},
                    {"user_id": test_user2.id, "owed_amount": 50.00}
                ]
            }
        ]
    }
    response = client.post(
        "/api/v1/sync/push",
        json=sync_payload2,
        headers=auth_headers2 # Pushed by Charlie!
    )
    assert response.status_code == status.HTTP_200_OK
    assert expense_uuid in response.json()["successful_expenses"]

    # 3. Verify DB has both splits
    expense = db.query(Expense).filter(Expense.id == expense_uuid).first()
    assert expense is not None
    assert len(expense.splits) == 2


def test_sync_push_delete_expense(client, auth_headers1, test_user1, test_user2, db):
    """
    Tests that pushing an expense with is_deleted=True correctly soft-deletes it on the server.
    """
    import uuid
    from datetime import datetime
    from app.models import Group, Expense
    from fastapi import status

    group_uuid = str(uuid.uuid4())
    expense_uuid = str(uuid.uuid4())

    # 1. Create group
    sync_payload = {
        "groups": [
            {
                "id": group_uuid,
                "name": "Test Group",
                "member_emails": [test_user1.email, test_user2.email]
            }
        ],
        "expenses": []
    }
    response = client.post("/api/v1/sync/push", json=sync_payload, headers=auth_headers1)
    assert response.status_code == status.HTTP_200_OK

    # 2. Push expense
    sync_payload2 = {
        "groups": [],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "To Be Deleted",
                "amount": 10.00,
                "paid_by_id": test_user1.id,
                "date": datetime.utcnow().isoformat(),
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 5.00},
                    {"user_id": test_user2.id, "owed_amount": 5.00}
                ]
            }
        ]
    }
    response = client.post("/api/v1/sync/push", json=sync_payload2, headers=auth_headers1)
    assert response.status_code == status.HTTP_200_OK
    assert expense_uuid in response.json()["successful_expenses"]

    # Verify it exists and is NOT deleted
    expense = db.query(Expense).filter(Expense.id == expense_uuid).first()
    assert expense is not None
    assert expense.is_deleted is False

    # 3. Push same expense with is_deleted=True
    sync_payload3 = {
        "groups": [],
        "expenses": [
            {
                "id": expense_uuid,
                "group_id": group_uuid,
                "description": "To Be Deleted",
                "amount": 10.00,
                "paid_by_id": test_user1.id,
                "date": datetime.utcnow().isoformat(),
                "is_deleted": True, # DELETED!
                "splits": [
                    {"user_id": test_user1.id, "owed_amount": 5.00},
                    {"user_id": test_user2.id, "owed_amount": 5.00}
                ]
            }
        ]
    }
    response = client.post("/api/v1/sync/push", json=sync_payload3, headers=auth_headers1)
    assert response.status_code == status.HTTP_200_OK
    assert expense_uuid in response.json()["successful_expenses"]

    # Verify it is now deleted in the DB
    db.refresh(expense)
    assert expense.is_deleted is True




