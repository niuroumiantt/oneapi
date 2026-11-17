"""Verify that published artifacts still match the recorded actual runs."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
evidence = json.loads((root / 'verification.json').read_text())
count = 0
for name, case in evidence['cases'].items():
    assert case['installed']
    assert all(run['finished'] and run['skillReadCommands'] for run in case['runs'])
    for filename, sha in case['artifacts'].items():
        assert hashlib.sha256((root / name / filename).read_bytes()).hexdigest() == sha, (name, filename)
        count += 1
    assert (root / name / 'screenshot.jpg').read_bytes().startswith(b'\xff\xd8')
assert json.loads((root / 'pdf/extracted.json').read_text()) == json.loads((root / 'pdf/expected.json').read_text())
assert evidence['cases']['react']['seededIssuesFound'] == 3
print(f'PASS: {len(evidence["cases"])} installed cases, {count} artifact hashes, {len(evidence["cases"])} screenshots, PDF held-out values')
