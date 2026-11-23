ALTER TABLE customer_sms_challenges
 DROP CONSTRAINT IF EXISTS customer_sms_challenges_purpose_check,
 DROP CONSTRAINT IF EXISTS customer_sms_challenges_user_purpose_check,
 ALTER COLUMN user_id DROP NOT NULL,
 ADD CONSTRAINT customer_sms_challenges_purpose_check CHECK (purpose IN ('login','bind','register')),
 ADD CONSTRAINT customer_sms_challenges_user_purpose_check CHECK ((purpose='register')=(user_id IS NULL));
