import pytest
from fastapi import status

from app.models import User

def test_google_login_new_user(client, db):
    """
    Tests login with a brand new user using Google dev-token.
    It should register the user in the DB and return a valid JWT access token.
    """
    # Submitting a dev-token for a new email
    email = "newuser@example.com"
    response = client.post(
        "/api/v1/auth/google",
        json={"id_token": f"dev-token-{email}"}
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    
    # Verify user was actually created in the database
    user = db.query(User).filter(User.email == email).first()
    assert user is not None
    assert user.display_name == "Newuser"
    assert user.google_id == f"dev-google-id-{email}"

def test_google_login_existing_user(client, db, test_user1):
    """
    Tests login with an existing registered user.
    It should return a valid JWT token without creating duplicate rows.
    """
    # Count users in db before login
    initial_count = db.query(User).count()
    
    # Submitting dev-token for existing user1
    response = client.post(
        "/api/v1/auth/google",
        json={"id_token": f"dev-token-{test_user1.email}"}
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "access_token" in data
    
    # Ensure no duplicate user was created
    final_count = db.query(User).count()
    assert final_count == initial_count

def test_access_endpoints_without_token(client):
    """
    Verifies endpoints protected by auth dependencies return 401 when called without a token.
    """
    response = client.get("/api/v1/")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
