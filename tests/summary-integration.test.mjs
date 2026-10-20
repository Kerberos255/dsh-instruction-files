// Appended integration checks for the injection summary; see workspace-prompt.test.mjs for the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyWorkspacePrompt } from '../workspace-prompt.js';
import { diagnosticsFor, instructionSummaryReport } from '../instruction-summary.js';

const FILES = ['IDENTITY.md', 'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'USER.md', 'MEMORY.md'];
const SETTINGS = ['workspacePromptEnabled', 'identityAsIdentity', 'soulEnabled', 'agentsEnabled', 'toolsEnabled', 'userEnabled', 'memoryEnabled'];

function harness(values = {}, { maxBytes = 65536 } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-instructions-summary-'));
  const state = { ...Object.fromEntries(SETTINGS.map(key => [key, true])), ...values };
  const session = { id: 'summary-session', header: { id: 'summary-session', cwd, origin: 'desktop', agentPreset: 'agent' } };
  const agent = { session };
  const sections = [{ name: 'harness:identity', text: 'Native DSH identity', order: 10 }];
  const events = new Map();
  const provider = {
    async resolve(filename) { return { targetKey: path.resolve(filename) }; },
    async stat(target) {
      try {
        const stat = fs.statSync(target.targetKey, { bigint: true });
        return { type: stat.isFile() ? 'file' : 'directory', size: Number(stat.size), version: [stat.size.toString(), stat.mtimeNs.toString()] };
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    async *streamText(target) { yield fs.readFileSync(target.targetKey, 'utf8'); },
  };
  const native = {
    async loadBaselineInstructions(options, proxy) {
      for (const filename of options.instructionFileCandidates) {
        const resolved = await proxy.resolve(path.join(options.cwd, filename));
        const stat = await proxy.stat(resolved);
        if (stat?.type !== 'file') continue;
        for await (const _chunk of proxy.streamText(resolved)) { /* records content */ }
      }
    },
    renderAgentInstructions(files) { return { text: files.map(file => file.content).join('\n\n') }; },
  };
  const ctx = {
    systemPrompt: { section(row) { sections.push(row); return () => {}; } },
    effect(callback) { callback(); },
    on(name, callback) { events.set(name, callback); },
    get(name) {
      if (name === 'instructionFilesSettings') return { configFile: { value: state, closed: false } };
      if (name === 'fs') return provider;
      return undefined;
    },
  };
  applyWorkspacePrompt(ctx, { maxBytes, maxSourceBytes: 1048576, instructionFileCandidates: FILES.filter(file => file !== 'TOOLS.md') }, native);
  return {
    cwd,
    state,
    write(file, content) { fs.writeFileSync(path.join(cwd, file), content); },
    async assemble() {
      return events.get('system-prompt/assemble')(null, { agent }, async () => ({ sections: sections.map(row => ({ ...row })), tools: [] }));
    },
    close() { fs.rmSync(cwd, { recursive: true, force: true }); },
  };
}

const entryFor = cwd => instructionSummaryReport().find(row => row.cwd === cwd);

test('assembly records injected sizes, disabled skips, budget skips and missing candidates', async () => {
  const h = harness({ soulEnabled: false }, { maxBytes: 40 });
  try {
    h.write('IDENTITY.md', 'ID');
    h.write('SOUL.md', 'DISABLED SOUL');
    h.write('AGENTS.md', 'A'.repeat(30));
    h.write('MEMORY.md', 'M'.repeat(100));
    await h.assemble();
    const entry = entryFor(h.cwd);
    assert.ok(entry, 'summary published for the assembling workspace');
    assert.equal(entry.enabled, true);
    assert.equal(entry.budget, 40);
    assert.equal(entry.preset, 'agent');
    assert.deepEqual(entry.files.map(file => file.name), ['agents.md']);
    assert.equal(entry.used, 30);
    assert.equal(entry.remaining, 10);
    assert.ok(entry.skipped.some(row => row.name === 'soul.md' && row.reason === 'disabled'));
    assert.ok(entry.skipped.some(row => row.name === 'memory.md' && row.reason === 'budget'));
    assert.ok(entry.missing.includes('USER.md'), 'absent candidate files stay visible');
    assert.ok(!entry.missing.includes('AGENTS.md'), 'present files are not reported missing');
    assert.deepEqual(entry.identity, { name: 'identity.md', bytes: 2, injected: true, reason: '' });
  } finally { h.close(); }
});

test('only an enabled file is reported missing; optional files are listed separately', async () => {
  const h = harness({ userEnabled: false });
  try {
    h.write('AGENTS.md', 'RULES');
    await h.assemble();
    const entry = entryFor(h.cwd);
    assert.deepEqual([...entry.missing].sort(), ['IDENTITY.md', 'MEMORY.md', 'SOUL.md'], 'enabled-but-absent files are reported, the switched-off USER.md is not');
    assert.deepEqual(entry.optionalMissing, ['TOOLS.md'], 'TOOLS.md is plugin-owned and optional');
    assert.equal(diagnosticsFor(entry).code, 'missing');
  } finally { h.close(); }
});

test('the master switch and an oversized identity are reported explicitly', async () => {
  const h = harness();
  try {
    h.write('IDENTITY.md', 'x'.repeat(9000));
    await h.assemble();
    let entry = entryFor(h.cwd);
    assert.equal(entry.identity.injected, false);
    assert.equal(entry.identity.reason, 'too-large');
    assert.equal(entry.files.length, 0);
    h.state.workspacePromptEnabled = false;
    await h.assemble();
    entry = entryFor(h.cwd);
    assert.equal(entry.enabled, false);
    assert.equal(entry.files.length, 0);
    assert.equal(entry.identity, null);
  } finally { h.close(); }
});
