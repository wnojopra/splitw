from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import verify_google_token, create_access_token
from app import schemas, crud

router = APIRouter()

@router.post("/google", response_model=schemas.Token)
def authenticate_google(
    request: schemas.GoogleAuthRequest,
    db: Session = Depends(get_db)
):
    """
    Verifies Google ID Token, logs in / registers the user, and issues a backend JWT token.
    """
    # 1. Verify ID Token
    google_info = verify_google_token(request.id_token)
    
    google_id = google_info.get("sub")
    email = google_info.get("email")
    display_name = google_info.get("name", email.split("@")[0])
    avatar_url = google_info.get("picture")
    
    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google authentication payload missing identifier or email"
        )
        
    # 2. Check if user exists, if not, create user
    user = crud.get_user_by_google_id(db, google_id=google_id)
    if not user:
        # Check if user with same email exists to merge google_id
        user_by_email = crud.get_user_by_email(db, email=email)
        if user_by_email:
            user_by_email.google_id = google_id
            db.commit()
            user = user_by_email
        else:
            user_create = schemas.UserCreate(
                google_id=google_id,
                email=email,
                display_name=display_name,
                avatar_url=avatar_url
            )
            user = crud.create_user(db, user_in=user_create)
            
    # 3. Issue Access Token
    access_token = create_access_token(
        data={"sub": user.id, "email": user.email}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }
