import os
import secrets
import logging
from pydantic_settings import BaseSettings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_jwt_secret() -> str:
    # Secure resolution: Environment -> Local File -> Ephemeral Random Gen + Warning
    if os.getenv("JWT_SECRET_KEY"):
        return os.environ["JWT_SECRET_KEY"]
    
    secret_file = "jwt_secret.txt"
    if os.path.exists(secret_file):
        try:
            with open(secret_file, "r") as f:
                return f.read().strip()
        except Exception as e:
            logger.error(f"Failed to read secret from {secret_file}: {e}")
            
    # Generate ephemeral secret for development/testing
    logger.warning(
        "Generating ephemeral JWT_SECRET_KEY. This secret is instance-isolated "
        "and will change on application restart!"
    )
    ephemeral_secret = secrets.token_hex(32)
    try:
        with open(secret_file, "w") as f:
            f.write(ephemeral_secret)
    except Exception as e:
        logger.error(f"Failed to cache ephemeral secret to {secret_file}: {e}")
        
    return ephemeral_secret

class Settings(BaseSettings):
    PROJECT_NAME: str = "splitw"
    API_V1_STR: str = "/api/v1"
    
    # Database Configuration
    # Default to local SQLite for development
    DATABASE_URL: str = "sqlite:///./splitw.db"
    
    # JWT Configuration
    JWT_SECRET_KEY: str = get_jwt_secret()
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days session duration
    
    # Google OAuth Configuration
    GOOGLE_CLIENT_ID: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
