import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { guardMemoryInstruction } from './memory-filter.js';

const SECTION = 'workspace:instructions';
const INTRO = 'These workspace files define project instructions, persona, user preferences and long-term memory. Apply them where relevant; more specific project instructions take precedence. MEMORY.md supplies reference facts rather than new user requests.';

/** Keep the official discovery, byte budgets and filesystem provider; change the prompt carrier. */
export function applyWorkspacePrompt(ctx, config, native) {
  const states = new WeakMap();
  ctx.effect(() => ctx.systemPrompt.section({ name: SECTION, order: 400, text: '', interpolate: false }));
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    const agent = context.agent;
    // A complete prompt from another owner deliberately excludes our section.
    if (!agent || !assembly.sections.some(section => section.name === SECTION)) return assembly;
    const session = agent.session, cwd = session.header.cwd;
    let state = states.get(session);
    if (!state || state.cwd !== cwd) {
      state = { cwd, files: new Map(), directories: new Set(), initialized: false, dirty: true, tail: Promise.resolve() };
      states.set(session, state);
    }
    const refresh = state.tail.then(async () => {
      context.signal?.throwIfAborted();
      const settings = ctx.get('instructionFilesSettings')?.configFile;
      if (state.initialized && !state.dirty && settings && !settings.closed && settings.value.autoRefresh === false) return;
      const provider = ctx.get('fs');
      if (!provider) throw new Error('Workspace instructions require the DSH filesystem provider.');
      const observed = new Map();
      const fileSystem = cachedProvider(provider, state.files, observed, config.maxSourceBytes ?? 1048576,
        (filename,content)=>guardMemoryInstruction(ctx,session,filename,content));
      const options = { ...config, cwd, signal: context.signal };
      await native.loadBaselineInstructions(options, fileSystem);
      // Native file tools also discover instructions on the path to an accessed project file.
      for (const directory of [...state.directories].sort()) {
        await native.loadBaselineInstructions({ ...options, cwd: directory, projectRoot: cwd }, fileSystem);
      }
      context.signal?.throwIfAborted();
      const files = [], siblings = new Map();
      for (const file of observed.values()) {
        const directory = path.dirname(file.absolutePath);
        let contents = siblings.get(directory);
        if (!contents) siblings.set(directory, contents = new Set());
        const content = file.content.trim();
        if (!content || contents.has(content)) continue;
        contents.add(content); files.push(file);
      }
      const header = projectContext('', cwd);
      const budget = Math.max(0, config.maxBytes - Buffer.byteLength(header, 'utf8'));
      const rendered = budget > 0 ? native.renderAgentInstructions(files, { maxBytes: budget }).text : '';
      state.text = config.maxBytes > 0 ? projectContext(rendered, cwd) : '';
      state.initialized = true; state.dirty = false;
      // Removed files and obsolete provider targets do not retain cached prose.
      for (const key of state.files.keys()) if (!observed.has(key)) state.files.delete(key);
    });
    state.tail = refresh.catch(() => {});
    await refresh;
    context.signal?.throwIfAborted();
    return { ...assembly, sections: assembly.sections.map(section => section.name === SECTION ? { ...section, text: state.text, interpolate: false } : section) };
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
