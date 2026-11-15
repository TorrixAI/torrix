ALTER TABLE api_keys ADD COLUMN session INTEGER NOT NULL DEFAULT 0;
UPDATE api_keys SET session = 1 WHERE name LIKE 'Session key %';
