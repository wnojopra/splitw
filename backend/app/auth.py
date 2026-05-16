from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from sqlalchemy.orm import Session
import logging

from app.config import settings
from app.db import get_db
from app.models import User
from app import schemas, crud

logger = logging.getLogger(__name__)

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def verify_google_token(token: str) -> dict:
    """
    Verifies a Google ID Token.
    Supports dev mock mode if GOOGLE_CLIENT_ID is not set or for 'dev-token-' prefixes.
    """
    if not settings.GOOGLE_CLIENT_ID or token.startswith("dev-token-"):
        logger.warning("DEVELOPMENT MODE: Skipping Google signature verification.")
        # Extract simulated email from dev token: dev-token-name@example.com -> email: name@example.com
        email = "user@example.com"
        name = "Test User"
        if token.startswith("dev-token-"):
            parts = token.split("-", 2)
            if len(parts) == 3:
                email = parts[2]
                name = email.split("@")[0].title()
        
        return {
            "sub": f"dev-google-id-{email}",
            "email": email,
            "name": name,
            "picture": "https://www.gravatar.com/avatar/?d=mp"
        }
        
    try:
        # Verify token using google-auth library
        idinfo = id_token.verify_oauth2_token(
            token, 
            google_requests.Request(), 
            settings.GOOGLE_CLIENT_ID
        )
        
        # Validate token issuer
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise ValueError('Wrong issuer.')
            
        return idinfo
    except Exception as e:
        logger.error(f"Google Token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google ID token"
        )

def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if not token:
        raise credentials_exception
        
    try:
        # Explicitly specify HS256 algorithm and secret to prevent algorithm breakout
        payload = jwt.decode(
            token, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.JWT_ALGORITHM]
        )
        email: str = payload.get("email")
        user_id: str = payload.get("sub")
        if email is None or user_id is None:
            raise credentials_exception
        token_data = schemas.TokenPayload(sub=user_id, email=email)
    except JWTError:
        raise credentials_exception
        
    user = crud.get_user(db, user_id=token_data.sub)
    if user is None:
        raise credentials_exception
        
    return user
