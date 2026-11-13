-- Channel fee for KerAPI-free settlements needs the submitted-token estimate recorded at admit time.
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS estimated_input_tokens integer;
