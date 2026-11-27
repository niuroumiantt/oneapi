// Local-only UI fixture; the shared host enforces loopback and a *_test database.
process.env.LOCAL_PREVIEW_PORT ||= '4299';
process.env.LOCAL_PREVIEW_SCOPES = 'true';
await import('./model-pack-preview.mjs');
