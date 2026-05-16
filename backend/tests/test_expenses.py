import pytest
from datetime import datetime
from fastapi import status
from app.models import Group

@pytest.fixture(scope="function")
def test_group(db, test_user1, test_user2, test_user3) -> Group:
    """
    Pre-populates a test group containing user1, user2, and user3.
    """
    group = Group(id="group-uuid-testing", name="Ski Trip 2026", description="Shared expenses for cabin")
    group.members.append(test_user1)
    group.members.append(test_user2)
    group.members.append(test_user3)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group

def test_create_expense_valid(client, auth_headers1, test_group, test_user1, test_user2, test_user3):
    """
    Tests creating a valid equal split expense in a group.
    """
    expense_data = {
        "id": "expense-uuid-1",
        "description": "Cabin Rental",
        "amount": 90.00,
        "currency": "USD",
        "date": datetime.utcnow().isoformat(),
        "paid_by_id": test_user1.id,
        "is_settlement": False,
        "splits": [
            {"user_id": test_user1.id, "owed_amount": 30.00},
            {"user_id": test_user2.id, "owed_amount": 30.00},
            {"user_id": test_user3.id, "owed_amount": 30.00}
        ]
    }
    
    response = client.post(
        f"/api/v1/groups/{test_group.id}/expenses",
        json=expense_data,
        headers=auth_headers1
    )
    
    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["description"] == "Cabin Rental"
    assert float(data["amount"]) == 90.00
    assert len(data["splits"]) == 3

def test_create_expense_invalid_split_sum(client, auth_headers1, test_group, test_user1, test_user2, test_user3):
    """
    Tests that an expense creation fails if the sum of splits does not match the total amount.
    """
    expense_data = {
        "description": "Steak Dinner",
        "amount": 100.00,
        "paid_by_id": test_user1.id,
        "date": datetime.utcnow().isoformat(),
        "splits": [
            {"user_id": test_user1.id, "owed_amount": 30.00},
            {"user_id": test_user2.id, "owed_amount": 30.00},
            {"user_id": test_user3.id, "owed_amount": 30.00}  # Sum is 90.00 instead of 100.00
        ]
    }
    
    response = client.post(
        f"/api/v1/groups/{test_group.id}/expenses",
        json=expense_data,
        headers=auth_headers1
    )
    
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "does not equal the total expense amount" in response.json()["detail"]

def test_create_expense_non_member_payer(client, auth_headers1, test_group, test_user1, db):
    """
    Tests that an expense creation fails if the payer is not a member of the group.
    """
    # Create an isolated user not in the group
    from app.models import User
    stray_user = User(id="user-stray", google_id="stray", email="stray@example.com", display_name="Stray")
    db.add(stray_user)
    db.commit()
    
    expense_data = {
        "description": "Cab",
        "amount": 15.00,
        "paid_by_id": stray_user.id,
        "date": datetime.utcnow().isoformat(),
        "splits": [
            {"user_id": test_user1.id, "owed_amount": 15.00}
        ]
    }
    
    response = client.post(
        f"/api/v1/groups/{test_group.id}/expenses",
        json=expense_data,
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "Payer must be a member of the group" in response.json()["detail"]

def test_get_group_balances_and_simplification(client, auth_headers1, test_group, test_user1, test_user2, test_user3):
    """
    Scenario:
    1. User1 pays $90 for dinner. Split equally among User1, User2, User3 ($30 each).
    2. User2 pays $30 for drinks. Split equally among User1, User2, User3 ($10 each).
    
    Net Balances expected:
    - User1: Paid 90. Owed 30 (dinner) + 10 (drinks) = 40. Net = +$50.
    - User2: Paid 30. Owed 30 (dinner) + 10 (drinks) = 40. Net = -$10.
    - User3: Paid 0. Owed 30 (dinner) + 10 (drinks) = 40. Net = -$40.
    
    Greedy Simplified Debts expected:
    - User3 pays User1 $40.
    - User2 pays User1 $10.
    """
    # 1. User1 adds dinner expense
    client.post(
        f"/api/v1/groups/{test_group.id}/expenses",
        headers=auth_headers1,
        json={
            "description": "Dinner",
            "amount": 90.00,
            "paid_by_id": test_user1.id,
            "date": datetime.utcnow().isoformat(),
            "splits": [
                {"user_id": test_user1.id, "owed_amount": 30.00},
                {"user_id": test_user2.id, "owed_amount": 30.00},
                {"user_id": test_user3.id, "owed_amount": 30.00}
            ]
        }
    )
    
    # 2. User2 adds drinks expense (use User1 token since both are group members, or user2 token, either works!)
    client.post(
        f"/api/v1/groups/{test_group.id}/expenses",
        headers=auth_headers1,
        json={
            "description": "Drinks",
            "amount": 30.00,
            "paid_by_id": test_user2.id,
            "date": datetime.utcnow().isoformat(),
            "splits": [
                {"user_id": test_user1.id, "owed_amount": 10.00},
                {"user_id": test_user2.id, "owed_amount": 10.00},
                {"user_id": test_user3.id, "owed_amount": 10.00}
            ]
        }
    )
    
    # 3. Fetch balances
    response = client.get(f"/api/v1/groups/{test_group.id}/balances", headers=auth_headers1)
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    # Verify net balances
    assert float(data["balances"][test_user1.id]) == 50.0
    assert float(data["balances"][test_user2.id]) == -10.0
    assert float(data["balances"][test_user3.id]) == -40.0
    
    # Verify simplified debts
    debts = data["simplified_debts"]
    assert len(debts) == 2
    
    # Confirm User3 pays User1 $40
    debt_u3_to_u1 = next(d for d in debts if d["from_user_id"] == test_user3.id)
    assert debt_u3_to_u1["to_user_id"] == test_user1.id
    assert float(debt_u3_to_u1["amount"]) == 40.0
    
    # Confirm User2 pays User1 $10
    debt_u2_to_u1 = next(d for d in debts if d["from_user_id"] == test_user2.id)
    assert debt_u2_to_u1["to_user_id"] == test_user1.id
    assert float(debt_u2_to_u1["amount"]) == 10.0
