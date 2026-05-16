import pytest
from typing import Generator
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.auth import create_access_token
from app.models import User
from app import schemas

# Use an isolated in-memory SQLite database for unit/integration tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    # Create tables before session starts
    Base.metadata.create_all(bind=engine)
    yield
    # Drop tables after session finishes
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def db() -> Generator:
    """
    Provides a transactional database session for each test function.
    All database modifications are committed to the isolated in-memory DB.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()

@pytest.fixture(scope="function")
def client(db) -> Generator:
    """
    Provides an HTTP TestClient with get_db overridden to use the test session.
    """
    def override_get_db():
        try:
            yield db
        finally:
            pass
            
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.fixture(scope="function")
def test_user1(db) -> User:
    """
    Creates and returns a primary test user.
    """
    user = User(
        id="user-uuid-1111-1111-111111111111",
        google_id="google-id-user1",
        email="user1@example.com",
        display_name="Poot",
        avatar_url="https://example.com/poot.jpg"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture(scope="function")
def test_user2(db) -> User:
    """
    Creates and returns a secondary test user.
    """
    user = User(
        id="user-uuid-2222-2222-222222222222",
        google_id="google-id-user2",
        email="user2@example.com",
        display_name="Mochi",
        avatar_url="https://example.com/mochi.jpg"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture(scope="function")
def test_user3(db) -> User:
    """
    Creates and returns a third test user.
    """
    user = User(
        id="user-uuid-3333-3333-333333333333",
        google_id="google-id-user3",
        email="user3@example.com",
        display_name="Ptarmi",
        avatar_url="https://example.com/ptarmi.jpg"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture(scope="function")
def auth_headers1(test_user1) -> dict:
    """
    Returns Authorization headers for test_user1.
    """
    token = create_access_token(data={"sub": test_user1.id, "email": test_user1.email})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="function")
def auth_headers2(test_user2) -> dict:
    """
    Returns Authorization headers for test_user2.
    """
    token = create_access_token(data={"sub": test_user2.id, "email": test_user2.email})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="function")
def auth_headers3(test_user3) -> dict:
    """
    Returns Authorization headers for test_user3.
    """
    token = create_access_token(data={"sub": test_user3.id, "email": test_user3.email})
    return {"Authorization": f"Bearer {token}"}
