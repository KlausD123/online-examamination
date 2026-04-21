-- Run this in phpMyAdmin > SQL tab if you already have the viva_sessions table
-- (Only needed for existing databases — new installs use the updated database.sql)
ALTER TABLE viva_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE viva_sessions ADD COLUMN IF NOT EXISTS ended_at DATETIME NULL;
UPDATE viva_sessions SET status = 'active' WHERE status IS NULL OR status = '';
