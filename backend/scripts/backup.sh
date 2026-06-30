#!/bin/bash
# splitw — SQLite Database Backup Script
# Safely backs up the live SQLite database and uploads it to Google Cloud Storage (GCS).

# Exit immediately if a command exits with a non-zero status
set -e

# Configurations
DB_PATH="/home/willyn/backend/splitw.db"
BACKUP_DIR="/home/willyn/backend/backups"
BUCKET_NAME="splitw-backups-nojo-client"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_BACKUP="$BACKUP_DIR/splitw_backup_$TIMESTAMP.db"
GCS_DEST="gs://$BUCKET_NAME/daily/splitw_backup_$TIMESTAMP.db"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$TIMESTAMP] Starting database backup..."

# 1. Safely backup SQLite database using the .backup command
# This prevents copying a database in an inconsistent state if a write is happening.
if ! command -v sqlite3 &> /dev/null; then
    echo "WARNING: sqlite3 command not found. Falling back to direct cp (less safe)..."
    cp "$DB_PATH" "$TEMP_BACKUP"
else
    sqlite3 "$DB_PATH" ".backup '$TEMP_BACKUP'"
fi

# 2. Upload to Google Cloud Storage
echo "Uploading backup to $GCS_DEST..."
if command -v gcloud &> /dev/null; then
    gcloud storage cp "$TEMP_BACKUP" "$GCS_DEST"
elif command -v gsutil &> /dev/null; then
    gsutil cp "$TEMP_BACKUP" "$GCS_DEST"
else
    echo "ERROR: Neither gcloud nor gsutil found. Cannot upload to GCS."
    rm -f "$TEMP_BACKUP"
    exit 1
fi

# 3. Clean up local backup file
echo "Cleaning up local backup file..."
rm "$TEMP_BACKUP"

echo "[$TIMESTAMP] Backup successfully uploaded to GCS."
