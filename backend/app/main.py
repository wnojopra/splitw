from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import engine, Base
from app.api.endpoints import auth, groups, expenses, sync

# Create SQLite database tables automatically on startup for easy developer onboarding
# Note: In production with Postgres, we should use Alembic migrations instead.
if settings.DATABASE_URL.startswith("sqlite"):
    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Strict and secure CORS configurations
# Allow local development origins
origins = [
    "http://localhost:5173",  # Vite default React port
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Router paths
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"])
app.include_router(groups.router, prefix=f"{settings.API_V1_STR}", tags=["Groups"])
app.include_router(expenses.router, prefix=f"{settings.API_V1_STR}", tags=["Expenses"])
app.include_router(sync.router, prefix=f"{settings.API_V1_STR}/sync", tags=["Offline Sync"])

@app.get("/")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API! Settle up with ease."}
