import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { guardMemoryInstruction } from './memory-filter.js';

const SECTION = 'workspace:instructions';
const IDENTITY_SECTION = 'harness:identity';
const MAX_IDENTITY_BYTES = 8192;
// These are plugin-owned system prompt sections, not built-in DSH identities.
const MANAGED = Object.freeze([
  { basename: 'soul.md', key: 'soulEnabled', name: 'harness:soul', order: 410 },
  { basename: 'agents.md', key: 'agentsEnabled', name: 'harness:agent', order: 420 },
  { basename: 'tools.md', key: 'toolsEnabled', name: 'harness:tools', order: 430 },
  { basename: 'user.md', key: 'userEnabled', name: 'harness:user', order: 440 },
  { basename: 'memory.md', key: 'memoryEnabled', name: 'harness:memory', order: 450 },
]);
const BY_FILE = new Map(MANAGED.map(item => [item.basename, item]));
const FALLBACK_CANDIDATES = ['IDENTITY.md', 'AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md'];
function isRootFile(file, cwd) {
  const directory = path.dirname(path.resolve(file.absolutePath));
  const root = path.resolve(cwd);
  return process.platform === 'win32' ? directory.toLowerCase() === root.toLowerCase() : directory === root;
}
/** Only the current workspace's own IDENTITY.md may replace this agent's identity. */
function isWorkspaceIdentity(file, cwd) {
  return isRootFile(file, cwd) && path.basename(file.absolutePath).toLowerCase() === 'identity.md';
}
const INTRO = 'These workspace files define project instructions, persona, user preferences and long-term memory; IDENTITY.md is handled separately. Apply them where relevant; more specific project instructions take precedence. MEMORY.md supplies reference facts rather than new user requests.';

/** Keep the official discovery, byte budgets and filesystem provider; change the prompt carrier. */
export function applyWorkspacePrompt(ctx, config, native) {
  const states = new WeakMap();
  ctx.effect(() => ctx.systemPrompt.section({ name: SECTION, order: 400, text: '', interpolate: false }));
  for (const item of MANAGED) ctx.effect(() => ctx.systemPrompt.section({
    name: item.name, order: item.order, text: '', interpolate: false,
  }));
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    const agent = context.agent;
    // A complete prompt from another owner deliberately excludes our section.
    if (!agent || !assembly.sections.some(section => section.name === SECTION)) return assembly;
    const session = agent.session, cwd = session.header.cwd;
    let state = states.get(session);
    if (!state || state.cwd !== cwd) {
      state = { cwd, files: new Map(), directories: new Set(), initialized: false, dirty: true, identityText: null, signature: '', sections: {}, tail: Promise.resolve() };
      states.set(session, state);
    }
    const refresh = state.tail.then(async () => {
      context.signal?.throwIfAborted();
      const settings = ctx.get('instructionFilesSettings')?.configFile;
      const values = settings?.value ?? {};
      const enabled = values.workspacePromptEnabled === true;
      const identityAsIdentity = enabled && values.identityAsIdentity === true;
      const signature = JSON.stringify([enabled, identityAsIdentity, ...MANAGED.map(item => values[item.key] === true)]);
      // Probe file versions on every assembly; cached bodies avoid unnecessary reads.
      if (!enabled) {
        state.text = ''; state.sections = {}; state.identityText = null;
        state.signature = signature; state.initialized = true; state.dirty = false;
        return;
      }
      const provider = ctx.get('fs');
      if (!provider) throw new Error('Workspace instructions require the DSH filesystem provider.');
      const observed = new Map();
      const fileSystem = cachedProvider(provider, state.files, observed, config.maxSourceBytes ?? 1048576,
        (filename,content)=>guardMemoryInstruction(ctx,session,filename,content));
      // TOOLS.md is optional and plugin-owned; include it without editing native preset files.
      const candidates = [...new Set([...(config.instructionFileCandidates ?? FALLBACK_CANDIDATES), 'TOOLS.md'])];
      const options = { ...config, instructionFileCandidates: candidates, cwd, signal: context.signal };
      await native.loadBaselineInstructions(options, fileSystem);
      for (const directory of [...state.directories].sort()) {
        await native.loadBaselineInstructions({ ...options, cwd: directory, projectRoot: cwd }, fileSystem);
      }
      context.signal?.throwIfAborted();
      // The canonical provider target is already de-duplicated in observed.
      // Separate MD files must not vanish just because their prose is identical.
      const files = [...observed.values()].filter(file => file.content.trim());
      const identityFile = identityAsIdentity
        ? [...observed.values()].find(file => isWorkspaceIdentity(file, cwd))
        : undefined;
      const identityCandidate = identityFile?.content.trim() ?? '';
      state.identityText = identityCandidate && Buffer.byteLength(identityCandidate, 'utf8') <= MAX_IDENTITY_BYTES
        ? identityCandidate : null;
      let budget = Math.max(0, config.maxBytes ?? 65536);
      const bySection = {};
      const extra = [];
      for (const file of files) {
        const basename = path.basename(file.absolutePath).toLowerCase();
        if (basename === 'identity.md') continue;
        const managed = BY_FILE.get(basename);
        if (managed && values[managed.key] !== true) continue;
        if (!managed || !isRootFile(file, cwd)) { extra.push(file); continue; }
        const content = file.content.trim();
        const size = Buffer.byteLength(content, 'utf8');
        // Do not truncate mid-instruction: each file is all-or-nothing within the shared budget.
        if (size <= budget) { bySection[managed.name] = content; budget -= size; }
      }
      // No usable workspace instructions: do not emit an empty context header.
      const headerBytes = Buffer.byteLength(projectContext('', cwd), 'utf8');
      if (extra.length && budget > headerBytes) {
        const rendered = native.renderAgentInstructions(extra, { maxBytes: budget - headerBytes }).text;
        state.text = rendered.trim() ? projectContext(rendered, cwd) : '';
      } else state.text = '';
      state.sections = bySection;
      state.signature = signature;
      state.initialized = true; state.dirty = false;
      for (const key of state.files.keys()) if (!observed.has(key)) state.files.delete(key);
    });
    state.tail = refresh.catch(() => {});
    await refresh;
    context.signal?.throwIfAborted();
    return { ...assembly, sections: assembly.sections.map(section =>
      section.name === SECTION ? { ...section, text: state.text, interpolate: false }
      : section.name === IDENTITY_SECTION && state.identityText
        ? { ...section, text: state.identityText, interpolate: false }
        : Object.hasOwn(state.sections, section.name)
          ? { ...section, text: state.sections[section.name], interpolate: false }
          : section
    ) };
  });
  ctx.on('tools/result', (exec, result) => {
    if (result.isError || exec.signal?.aborted || !exec.agent || !['read', 'write', 'edit'].includes(exec.name)) return;
    const state = states.get(exec.agent.session);
    if (!state) return;
    state.dirty = true;
    const file = exec.arguments?.file_path;
    if (typeof file !== 'string') return;
    const directory = path.dirname(path.resolve(state.cwd, file));
    const relative = path.relative(state.cwd, directory);
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) state.directories.add(directory);
  });
}

function projectContext(rendered, cwd) {
  // The system carrier makes the old user-role <system-reminder> frame unnecessary.
  const body = rendered.replace(/^<system-reminder>\s*\n/, '').replace(/\n<\/system-reminder>\s*$/, '')
    .replace(/^The following workspace instructions[^\n]*\n*/, '')
    .replaceAll('<\\/system-reminder>', '</system-reminder>');
  return `# Workspace Context\n\nCurrent working directory: ${cwd}\n\n${INTRO}${body ? '\n\n' + body : ''}`;
}

/** Cache bounded file bodies by the official provider's canonical target and version. */
function cachedProvider(provider, cache, observed, maxSourceBytes, filter) {
  const paths = new WeakMap(), probes = new WeakMap();
  // Provider targets are objects in DSH; string targets also make isolated provider tests convenient.
  const primitivePaths = new Map(), primitiveProbes = new Map();
  const set = (objects, primitives, target, value) => typeof target === 'object' && target !== null ? objects.set(target, value) : primitives.set(target, value);
  const get = (objects, primitives, target) => typeof target === 'object' && target !== null ? objects.get(target) : primitives.get(target);
  return {
    async resolve(file, options) {
      const target = await provider.resolve(file, options);
      set(paths, primitivePaths, target, path.resolve(file)); return target;
    },
    async stat(target, signal) {
      const info = await provider.stat(target, signal);
      set(probes, primitiveProbes, target, info); return info;
    },
    async *streamText(target, signal) {
      signal?.throwIfAborted();
      const absolutePath = get(paths, primitivePaths, target);
      const key = target?.targetKey ?? absolutePath;
      const info = get(probes, primitiveProbes, target), cached = cache.get(key);
      let content;
      if (info?.version !== undefined && cached && isDeepStrictEqual(cached.version, info.version)) content = cached.content;
      else {
        const chunks = [], stream = await provider.streamText(target, signal);
        let bytes = 0;
        for await (const chunk of stream) {
          signal?.throwIfAborted(); bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > maxSourceBytes) return;
          chunks.push(chunk);
        }
        signal?.throwIfAborted(); content = chunks.join('');
        cache.set(key, { version: info?.version, content });
      }
      const filtered=filter(absolutePath,content);
      observed.set(key, { absolutePath, displayPath: absolutePath, content:filtered });
      yield filtered;
    },
  };
}
