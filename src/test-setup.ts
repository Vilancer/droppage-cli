import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test run gets its own empty session folder, so a test that reaches the
// real services by mistake finds nobody signed in instead of using the
// developer's own ~/.droppage session. Tests that need a session sign in here.
process.env.DROPPAGE_HOME = mkdtempSync(join(tmpdir(), 'droppage-test-'));
