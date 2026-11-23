ALTER TABLE customer_sms_challenges
 DROP CONSTRAINT IF EXISTS customer_sms_challenges_purpose_check,
 ADD CONSTRAINT customer_sms_challenges_purpose_check CHECK (purpose IN ('login','bind','register','password'));
