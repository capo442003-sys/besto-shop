-- Sauvegarde Google Drive : compte du client (OAuth)
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS google_drive_email VARCHAR(255);
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS google_drive_refresh_token TEXT;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS google_drive_folder_id VARCHAR(100);
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS backup_auto_enabled BOOLEAN DEFAULT TRUE;
