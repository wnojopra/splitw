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

def test_join_group_success(client, auth_headers2, test_user1, test_user2, db):
    """
    Tests that a user can join a group via the join endpoint.
    """
    # User 1 creates group
    group = Group(id="group-uuid-join-test", name="Camping Trip")
    group.members.append(test_user1)
    db.add(group)
    db.commit()

    # User 2 joins the group via POST /{group_id}/join
    response = client.post(
        f"/api/v1/{group.id}/join",
        headers=auth_headers2
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == group.id
    member_emails = [m["email"] for m in data["members"]]
    assert test_user1.email in member_emails
    assert test_user2.email in member_emails

    # Verify DB state
    db.refresh(group)
    assert test_user2 in group.members

def test_join_group_idempotent(client, auth_headers1, test_user1, db):
    """
    Tests that joining a group you are already in is idempotent and succeeds without duplicates.
    """
    group = Group(id="group-uuid-idempotent", name="Coffee Club")
    group.members.append(test_user1)
    db.add(group)
    db.commit()

    response = client.post(
        f"/api/v1/{group.id}/join",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert len(data["members"]) == 1
    assert data["members"][0]["email"] == test_user1.email

def test_join_group_not_found(client, auth_headers1):
    """
    Tests that joining a non-existent group returns 404.
    """
    response = client.post(
        "/api/v1/non-existent-group-uuid/join",
        headers=auth_headers1
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Group not found"

def test_join_group_unauthorized(client, test_user1, db):
    """
    Tests that joining without an auth token returns 401.
    """
    group = Group(id="group-uuid-unauth", name="Private Group")
    group.members.append(test_user1)
    db.add(group)
    db.commit()

    response = client.post(f"/api/v1/{group.id}/join")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED

