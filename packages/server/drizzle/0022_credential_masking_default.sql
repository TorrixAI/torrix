INSERT OR IGNORE INTO governance_settings (
  user_id, pii_enabled, pii_types, pii_placeholder, pii_mask_input, pii_mask_output,
  human_review_enabled, audit_enabled, updated_at
)
SELECT id, 0, '["email","phone","card","ssn","api_key"]', '[redacted]', 1, 0, 0, 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users;
