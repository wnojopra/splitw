import pytest
from fastapi import status
from app.models import Group

def test_create_group(client, auth_headers1, test_user1):
    """
    Tests that a user can successfully create a group and is automatically added as a member.
    """
    group_data = {
        "name": "Hawaii Trip 2026",
        "description": "Shared expenses for the vacation"
    }
    
    response = client.post(
        "/api/v1/",
        json=group_data,
        headers=auth_headers1
    )
    
    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["name"] == group_data["name"]
    assert data["description"] == group_data["description"]
    assert "id" in data
    
    # Creator should be in the members list
    members_emails = [m["email"] for m in data["members"]]
    assert test_user1.email in members_emails

def test_list_groups(client, auth_headers1, test_user1, db):
    """
    Tests that list_groups returns only the groups that the current user belongs to.
    """
    # Create a group with test_user1 as owner
    group1 = Group(id="group-uuid-1", name="Home Expenses", description="Rent/utilities")
    group1.members.append(test_user1)
    db.add(group1)
    db.commit()
    
    response = client.get("/api/v1/", headers=auth_headers1)
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    assert len(data) == 1
    assert data[0]["id"] == "group-uuid-1"
    assert data[0]["name"] == "Home Expenses"

def test_get_group_details_unauthorized(client, auth_headers2, test_user1, db):
    """
    Tests that a user cannot access details of a group they are not a member of.
    """
    # Group with only user1 in it
    group1 = Group(id="group-uuid-secret", name="Secret Group")
    group1.members.append(test_user1)
    db.add(group1)
    db.commit()
    
    # User2 (auth_headers2) tries to view it
    response = client.get(f"/api/v1/{group1.id}", headers=auth_headers2)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["detail"] == "You are not a member of this group"

def test_invite_group_member(client, auth_headers1, test_user1, test_user2, db):
    """
    Tests that an existing member can invite/add a registered user to the group by email.
    """
    # Create group with user1
    group = Group(id="group-uuid-invite", name="Ski Trip")
    group.members.append(test_user1)
    db.add(group)
    db.commit()
    
    # User1 invites User2 using email
    response = client.post(
        f"/api/v1/{group.id}/members?email={test_user2.email}",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    assert data["email"] == test_user2.email
    assert data["display_name"] == test_user2.display_name
    
    # Verify DB membership
    db.refresh(group)
    assert test_user2 in group.members
