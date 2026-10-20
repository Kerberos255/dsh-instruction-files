import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInstructionFiles, publishInstructionSummary, instructionSummaryReport, summarySignature, diagnosticsFor } from '../instruction-summary.js';

test('a summary reports injected sizes, budget remainder and skips', () => {
  const report = summarizeInstructionFiles({
    cwd: 'C:/ws', preset: 'agent', enabled: true, budget: 100,
    injected: [{ name: 'agents.md', bytes: 30, section: 'harness:agent' }, { name: 'soul.md', bytes: 20, section: 'harness:soul' }],
    skipped: [{ name: 'memory.md', bytes: 500, reason: 'budget' }],
    missing: ['USER.md'],
    identity: { bytes: 12, injected: true },
    projectBytes: 64,
  });
  assert.equal(report.used, 50);
  assert.equal(report.remaining, 50);
  assert.deepEqual(report.files.map(file => file.name), ['agents.md', 'soul.md']);
  assert.deepEqual(report.skipped, [{ name: 'memory.md', bytes: 500, reason: 'budget' }]);
  assert.deepEqual(report.missing, ['USER.md']);
  assert.deepEqual(report.identity, { name: 'identity.md', bytes: 12, injected: true, reason: '' });
  assert.equal(report.projectBytes, 64);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.identity), true);
});

test('remaining never goes negative and identity stays absent when no file was seen', () => {
  const report = summarizeInstructionFiles({ cwd: 'C:/x', enabled: true, budget: 10, injected: [{ name: 'a.md', bytes: 40 }] });
  assert.equal(report.remaining, 0);
  assert.equal(report.identity, null);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.missing, []);
});

test('reports are kept newest-first per workspace and bounded', () => {
  const started = instructionSummaryReport().length;
  for (let index = 0; index < 12; index += 1) publishInstructionSummary(summarizeInstructionFiles({ cwd: `C:/ws-${index}`, at: 1000 + index, enabled: true, budget: 10 }));
  const entries = instructionSummaryReport();
  assert.equal(entries.length, Math.min(Math.max(started, 8), 8), 'the report never exceeds its bound');
  assert.equal(entries[0].cwd, 'C:/ws-11', 'newest assembly first');
  publishInstructionSummary(summarizeInstructionFiles({ cwd: 'C:/ws-11', at: 2000, enabled: false, budget: 0 }));
  assert.equal(instructionSummaryReport()[0].at, 2000, 'a repeated workspace is replaced, not duplicated');
  assert.equal(instructionSummaryReport().filter(row => row.cwd === 'C:/ws-11').length, 1);
});

test('signature ignores timestamps but tracks every meaningful difference', () => {
  const base = summarizeInstructionFiles({ cwd: 'C:/s', at: 1, enabled: true, budget: 10, injected: [{ name: 'a.md', bytes: 5, section: 'harness:agent' }] });
  const later = summarizeInstructionFiles({ cwd: 'C:/s', at: 2, enabled: true, budget: 10, injected: [{ name: 'a.md', bytes: 5, section: 'harness:agent' }] });
  const bigger = summarizeInstructionFiles({ cwd: 'C:/s', at: 3, enabled: true, budget: 10, injected: [{ name: 'a.md', bytes: 6, section: 'harness:agent' }] });
  assert.equal(summarySignature(base), summarySignature(later));
  assert.notEqual(summarySignature(base), summarySignature(bigger));
  assert.equal(summarySignature(null), '');
});

test('diagnostics payload stays inside the writer allowlist', () => {
  const ok = summarizeInstructionFiles({ cwd: 'C:/d', enabled: true, budget: 10, injected: [{ name: 'a.md', bytes: 4, section: 'harness:agent' }] });
  assert.deepEqual(diagnosticsFor(ok), { count: 1, sizeBytes: 4, state: 'ok', code: 'ok' });
  const budgetSkip = summarizeInstructionFiles({ cwd: 'C:/d', enabled: true, budget: 10, skipped: [{ name: 'b.md', bytes: 50, reason: 'budget' }] });
  assert.deepEqual(diagnosticsFor(budgetSkip), { count: 0, sizeBytes: 0, state: 'skipped', code: 'budget' });
  const tooLarge = summarizeInstructionFiles({ cwd: 'C:/d', enabled: true, budget: 10, identity: { bytes: 9000, injected: false, reason: 'too-large' } });
  assert.deepEqual(diagnosticsFor(tooLarge), { count: 0, sizeBytes: 0, state: 'skipped', code: 'identity-too-large' });
  const missingRequired = summarizeInstructionFiles({ cwd: 'C:/d', enabled: true, budget: 10, missing: ['user.md'] });
  assert.deepEqual(diagnosticsFor(missingRequired), { count: 0, sizeBytes: 0, state: 'skipped', code: 'missing' }, 'an enabled but absent file degrades the run');
  const benign = summarizeInstructionFiles({ cwd: 'C:/d', enabled: true, budget: 10, skipped: [{ name: 'c.md', bytes: 5, reason: 'disabled' }], optionalMissing: ['tools.md'] });
  assert.deepEqual(diagnosticsFor(benign), { count: 0, sizeBytes: 0, state: 'ok', code: 'ok' }, 'a switched-off file or an absent optional file is not degradation');
  for (const payload of [diagnosticsFor(ok), diagnosticsFor(budgetSkip), diagnosticsFor(tooLarge), diagnosticsFor(missingRequired), diagnosticsFor(benign)]) {
    assert.equal(Number.isSafeInteger(payload.count) && payload.count >= 0, true, 'count is a non-negative integer');
    assert.equal(Number.isSafeInteger(payload.sizeBytes) && payload.sizeBytes >= 0, true, 'sizeBytes is a non-negative integer');
    assert.equal(['ok', 'skipped'].includes(payload.state), true, 'state uses a value the writer accepts');
    assert.match(payload.code, /^[a-z]+(?:-[a-z]+){0,2}$/, 'code matches the writer pattern');
  }
});
