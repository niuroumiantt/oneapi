-- Where an agent recording came from: a live recording session, or a format the gateway learned from real employee calls.
ALTER TABLE agent_recordings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'recorded' CHECK (source IN ('recorded','learned'));
