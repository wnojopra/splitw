#!/bin/bash
# splitw — Deployment Script
# Automates building and deploying the frontend and backend to the GCP VM.

# Exit immediately if a command exits with a non-zero status
set -e

# Configurations
VM_NAME="splitw-vm"
ZONE="us-central1-a"
PROJECT="nojo-client"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

function log_info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

function log_success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

function log_warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

function log_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

function usage() {
    echo "Usage: $0 [all|frontend|backend]"
    echo "  all      : Deploys both frontend and backend (default)"
    echo "  frontend : Deploys frontend only"
    echo "  backend  : Deploys backend only"
    exit 1
}

# Determine what to deploy
TARGET=${1:-all}

if [ "$TARGET" != "all" ] && [ "$TARGET" != "frontend" ] && [ "$TARGET" != "backend" ]; then
    usage
fi

# Ensure we are in the root of the repository
if [ ! -d "frontend" ] || [ ! -d "backend" ]; then
    log_error "This script must be run from the root of the splitw repository."
    exit 1
fi

# Function to deploy Frontend
deploy_frontend() {
    log_info "Starting Frontend Deployment..."
    
    log_info "1. Building frontend locally..."
    npm --prefix frontend run build
    
    log_info "2. Cleaning old distribution on VM..."
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="rm -rf ~/dist"
    
    log_info "3. Uploading new build to VM..."
    gcloud compute scp --recurse frontend/dist "$VM_NAME":~ --zone="$ZONE" --project="$PROJECT"
    
    log_info "4. Setting permissions on VM..."
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="chmod -R 755 ~/dist"
    
    log_success "Frontend deployed successfully!"
}

# Function to deploy Backend
deploy_backend() {
    log_info "Starting Backend Deployment..."
    
    log_info "1. Packaging backend locally..."
    tar -czf backend.tar.gz \
        --exclude='venv' \
        --exclude='__pycache__' \
        --exclude='*.db' \
        --exclude='jwt_secret.txt' \
        --exclude='.pytest_cache' \
        backend
        
    log_info "2. Uploading package to VM..."
    gcloud compute scp backend.tar.gz "$VM_NAME":~ --zone="$ZONE" --project="$PROJECT"
    
    log_info "3. Extracting package on VM..."
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="tar -xzf backend.tar.gz && rm backend.tar.gz"
    
    log_info "4. Running database migrations on VM..."
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="cd ~/backend && venv/bin/alembic upgrade head"
    
    log_info "5. Restarting backend service..."
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="sudo systemctl restart splitw-backend"
    
    log_info "6. Cleaning up local tarball..."
    rm -f backend.tar.gz
    
    log_success "Backend deployed successfully!"
}

# Execute deployment
case "$TARGET" in
    frontend)
        deploy_frontend
        ;;
    backend)
        deploy_backend
        ;;
    all)
        deploy_frontend
        deploy_backend
        log_success "Full deployment completed successfully!"
        ;;
esac
