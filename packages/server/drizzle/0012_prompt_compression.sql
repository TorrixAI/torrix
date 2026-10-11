ALTER TABLE projects ADD COLUMN prompt_compression TEXT DEFAULT 'off';
ALTER TABLE projects ADD COLUMN compression_words TEXT;
