import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyWorkspacePrompt } from '../workspace-prompt.js';

const FILES = ['IDENTITY.md', 'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'USER.md', 'MEMORY.md'];
const SETTINGS = ['workspacePromptEnabled', 'identityAsIdentity', 'soulEnabled', 'agentsEnabled', 'toolsEnabled', 'userEnabled', 'memoryEnabled'];

function harness(values = {}, { origin = 'desktop', maxBytes = 65536 } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-instructions-public-'));
  const state = { ...Object.fromEntries(SETTINGS.map(k => [k, true])), ...values };
  const session = { id: 'test-session', header: { id: 'test-session', cwd, origin } };
  const agent = { session };
  const sections = [{ name: 'harness:identity', text: 'Native DSH identity', order: 10 }];
  const events = new Map();
  let reads = 0;
  const provider = {
    async resolve(filename) { return { targetKey: path.resolve(filename) }; },
    async stat(target) {
      try {
        const stat = fs.statSync(target.targetKey, { bigint: true });
        return { type: stat.isFile() ? 'file' : 'directory', size: Number(stat.size),
          version: [stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString()] };
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async *streamText(target) { reads++; yield fs.readFileSync(target.targetKey, 'utf8'); },
  };
  const native = {
    async loadBaselineInstructions(options, proxy) {
      for (const filename of options.instructionFileCandidates) {
        const resolved = await proxy.resolve(path.join(options.cwd, filename));
        const stat = await proxy.stat(resolved);
        if (stat?.type !== 'file') continue;
        for await (const _chunk of proxy.streamText(resolved)) { /* canonical provider records content */ }
      }
    },
    renderAgentInstructions(files) {
      return { text: files.map(file => file.content).join('\n\n') };
    },
  };
  const ctx = {
    systemPrompt: { section(section) { sections.push(section); return () => {}; } },
    effect(callback) { callback(); },
    on(name, callback) { events.set(name, callback); },
    get(name) {
      if (name === 'instructionFilesSettings') return { configFile: { value: state, closed: false } };
      if (name === 'fs') return provider;
      return undefined;
    },
  };
  applyWorkspacePrompt(ctx, { maxBytes, maxSourceBytes: 1048576, instructionFileCandidates: FILES.filter(f => f !== 'TOOLS.md') }, native);
  return {
    cwd, state, get reads() { return reads; },
    write(file, content) { fs.writeFileSync(path.join(cwd, file), content); },
    async assemble() {
      return events.get('system-prompt/assemble')(null, { agent }, async () => ({
        sections: sections.map(s => ({ ...s })), tools: [{ name: 'read' }],
      }));
    },
    close() { fs.rmSync(cwd, { recursive: true, force: true }); },
  };
}
const section = (assembly, name) => assembly.sections.find(x => x.name === name)?.text;
const count = (assembly, marker) => assembly.sections.reduce((n, s) => n + s.text.split(marker).length - 1, 0);

test('identity alone replaces native identity; other files occupy exactly one plugin-owned section', async () => {
  const h = harness();
  try {
    for (const [file, content] of Object.entries({
      'IDENTITY.md': 'CUSTOM IDENTITY',
      'AGENTS.md': 'AGENT RULES', 'SOUL.md': 'VOICE GUIDE',
      'TOOLS.md': 'TOOL HINTS', 'USER.md': 'USER PROFILE',
      'MEMORY.md': 'PERSONAL FACTS',
    })) h.write(file, content);
    const a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'CUSTOM IDENTITY');
    for (const [slot, marker] of [
      ['harness:agent', 'AGENT RULES'], ['harness:soul', 'VOICE GUIDE'],
      ['harness:tools', 'TOOL HINTS'], ['harness:user', 'USER PROFILE'],
      ['harness:memory', 'PERSONAL FACTS'],
    ]) {
      assert.equal(section(a, slot), marker);
      assert.equal(count(a, marker), 1);
    }
    assert.equal(count(a, 'CUSTOM IDENTITY'), 1);
    assert.equal(a.tools[0].name, 'read');
  } finally { h.close(); }
});

test('global and individual toggles operate without affecting native tool guidance', async () => {
  const h = harness();
  try {
    h.write('IDENTITY.md', 'CUSTOM IDENT');
    h.write('SOUL.md', 'SOUL TEXT');
    h.write('TOOLS.md', 'TOOLS TEXT');
    h.state.soulEnabled = false;
    let a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), '');
    assert.equal(section(a, 'harness:tools'), 'TOOLS TEXT');
    h.state.workspacePromptEnabled = false;
    a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'Native DSH identity');
    assert.equal(section(a, 'harness:tools'), '');
    h.state.workspacePromptEnabled = true;
    h.state.soulEnabled = true;
    a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'CUSTOM IDENT');
    assert.equal(section(a, 'harness:soul'), 'SOUL TEXT');
  } finally { h.close(); }
});

test('hot updates change the next prompt and reuse cached text when unchanged', async () => {
  const h = harness();
  try {
    h.write('SOUL.md', 'before');
    let a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), 'before');
    const before = h.reads;
    await h.assemble();
    assert.equal(h.reads, before, 'unchanged files must use cached content');
    h.write('SOUL.md', 'after - revised');
    a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), 'after - revised');
    assert.equal(h.reads, before + 1);
    fs.unlinkSync(path.join(h.cwd, 'SOUL.md'));
    a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), '');
  } finally { h.close(); }
});

test('missing and oversized IDENTITY preserve native identity', async () => {
  const h = harness();
  try {
    let a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'Native DSH identity');
    h.write('IDENTITY.md', 'x'.repeat(9000));
    a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'Native DSH identity');
  } finally { h.close(); }
});

test('untrusted channel sessions never expose workspace MEMORY.md', async () => {
  const h = harness({}, { origin: 'feishu' });
  try {
    h.write('MEMORY.md', 'PRIVATE NEVER SHOW');
    h.write('AGENTS.md', 'PUBLIC RULES');
    const a = await h.assemble();
    assert.equal(section(a, 'harness:memory'), '');
    assert.equal(count(a, 'PRIVATE NEVER SHOW'), 0);
    assert.equal(section(a, 'harness:agent'), 'PUBLIC RULES');
  } finally { h.close(); }
});

test('all seven controls are off by default and no file injection occurs', async () => {
  const example = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
  for (const key of SETTINGS) assert.equal(example[key], false, key);
  const disabled = Object.fromEntries(SETTINGS.map(key => [key, false]));
  const h = harness(disabled);
  try {
    h.write('SOUL.md', 'EXISTING SOUL');
    h.write('AGENTS.md', 'EXISTING AGENT');
    const a = await h.assemble();
    assert.equal(section(a, 'harness:identity'), 'Native DSH identity');
    assert.equal(section(a, 'workspace:instructions'), '');
    for (const name of ['harness:soul', 'harness:agent', 'harness:tools', 'harness:user', 'harness:memory']) {
      assert.equal(section(a, name), '', name);
    }
  } finally { h.close(); }
});

test('enabled toggles without actual Markdown content do not inject text or a context header', async () => {
  const h = harness();
  try {
    let a = await h.assemble();
    assert.equal(section(a, 'workspace:instructions'), '');
    assert.equal(section(a, 'harness:identity'), 'Native DSH identity');
    for (const name of ['harness:soul', 'harness:agent', 'harness:tools', 'harness:user', 'harness:memory']) {
      assert.equal(section(a, name), '', name);
    }
    h.write('SOUL.md', '   \n');
    a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), '');
    assert.equal(section(a, 'workspace:instructions'), '');
    h.write('SOUL.md', 'NOW PRESENT');
    a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), 'NOW PRESENT');
    assert.equal(section(a, 'harness:tools'), '', 'missing TOOLS must remain empty');
    assert.equal(section(a, 'workspace:instructions'), '');
    fs.unlinkSync(path.join(h.cwd, 'SOUL.md'));
    a = await h.assemble();
    assert.equal(section(a, 'harness:soul'), '');
  } finally { h.close(); }
});

test('public settings expose only enabled sections; autoRefresh has been removed', () => {
  const pages = JSON.parse(fs.readFileSync(new URL('../tools/settings/pages.json', import.meta.url), 'utf8'));
  const keys = pages['dsh-instruction-files'].fields.map(field => field.key);
  assert.deepEqual(keys, ['workspacePromptEnabled', 'identityAsIdentity', 'soulEnabled', 'agentsEnabled', 'toolsEnabled', 'userEnabled', 'memoryEnabled']);
  const fields = pages['dsh-instruction-files'].fields;
  assert.equal(fields.find(field => field.key === 'identityAsIdentity').label, 'IDENTITY.md · harness:identity');
  const expectedHelp = {
    workspacePromptEnabled: '总开关；关闭时保留 DSH 原生身份，不注入插件管理的 Markdown 区块。',
    identityAsIdentity: '替换 DSH 原生身份区块。',
    soulEnabled: '注入性格与表达风格。',
    agentsEnabled: '注入工作区执行规则。',
    toolsEnabled: '注入工具使用说明。',
    userEnabled: '注入当前工作区的用户偏好说明。',
    memoryEnabled: '注入允许访问的人工维护记忆。',
  };
  for (const field of fields) assert.equal(field.help, expectedHelp[field.key]);
  assert(!JSON.stringify(pages).includes('autoRefresh'));
  assert(!JSON.stringify(JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)))).includes('autoRefresh'));
});
