import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import { PluginConfig } from './plugin-settings/remote-config.js';
import { schema } from './config.js';

const canonical = directory => {
  if (!fs.statSync(directory).isDirectory()) throw new Error('工作区路径需要指向已有目录');
  return fs.realpathSync(directory);
};
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sameModel = (a, b) => a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort;

/** Native workspaces, presets, model intent and permissions remain their own source of truth. */
export class InstructionSettings extends PluginConfig {
  constructor(ctx, legacy = {}) {
    super(ctx, { service: 'instructionFilesSettings', packageName: 'dsh-instruction-files', schema }, legacy);
    this.context = ctx; this.workspaceScope = null; this.tail = Promise.resolve(); this.errors = new Map(); this.defaults = new WeakMap(); this.roles = new Map();
    for (const initialize of initializers) initialize.call(this);
    this.configFile.subscribe(() => this.registerLater());
    ctx.inject(['workspaceRegistry', 'agentPresets'], scope => {
      this.workspaceScope = scope;
      this.registerLater();
      scope.effect(() => async () => { if (this.workspaceScope === scope) this.workspaceScope = null; await this.tail; for(const row of this.roles.values())await row.dispose();this.roles.clear(); });
    });
    // Retry after declarative rows enter the official loader; the base preset may
    // register later than this settings row during startup. No polling is needed.
    ctx.on('loader/entry-init', () => this.registerLater(), { global: true });
    // Session announcement occurs AFTER API Session installs its selection cache.
    // Seed the official intent, then bridge only the first assembly to that intent.
    ctx.on('session/created', session => this.seed(session), { global: true });
    ctx.on('agent/created', ({ agent }) => this.bridge(agent), { global: true });
    ctx.effect(() => async () => { await this.tail; });
  }
  registerLater() {
    const scope = this.workspaceScope, snapshot = this.configFile.snapshot();
    if (!scope || this.configFile.closed || snapshot.error) return;
    const run = this.tail.then(async () => {
      const wanted=new Map(snapshot.value.profiles.filter(row=>row.preset!=='agent').map(row=>[row.preset,row]));
      for(const [id,row]of this.roles)if(!wanted.has(id)||row.name!==wanted.get(id).name){await row.dispose();this.roles.delete(id);}
      let composition;
      for (const profile of snapshot.value.profiles) {
        if (this.configFile.closed || scope !== this.workspaceScope || snapshot.revision !== this.configFile.revision) return;
        try {
          const directory = canonical(profile.workspace);
          await scope.workspaceRegistry.create(directory, profile.name);
          if(profile.preset!=='agent'&&!this.roles.has(profile.preset)){
            composition??=load((await scope.agentPresets.readDocument('agent')).content,{schema:entryListSchema});
            const dispose=await scope.agentPresets.register({id:profile.preset,name:profile.name,description:'从工作区指令文件读取人设与规则。',order:10,plugins:composition});
            this.roles.set(profile.preset,{name:profile.name,dispose});
          }
          this.errors.delete(profile.preset);
        } catch (error) { this.errors.set(profile.preset, error instanceof Error ? error.message : String(error)); }
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }
  setConfig(value,revision){
    if(this.configFile.value.profiles.some(row=>row.preset==='agent')&&!value?.profiles?.some(row=>row.preset==='agent'))throw new RemoteError('workspace-profile/default-protected','默认角色不能删除',{});
    return super.setConfig(value,revision);
  }
  seed(session) {
    const { header } = session;
    if (this.configFile.closed || this.configFile.error || session.firstLiveSeq !== 0 || header.isSeeded || header.parentSession || !header.cwd || session.requestHeader()) return;
    const profile = this.configFile.value.profiles.find(value => value.preset === header.agentPreset);
    if (!profile) return;
    let directory;
    try { directory = canonical(profile.workspace); } catch { return; }
    if (!samePath(directory, header.cwd)) return;
    const state = this.context.get('sessionProjections')?.stateOf(session, 'modelSelection');
    if (profile.model && state && !state.pending && !state.lastUsed) {
      const selected = { provider: profile.modelProvider, model: profile.model };
      session.append('model/selection', selected);
      this.defaults.set(session, selected);
    }
    // Canonical setters persist Session-local facts; global permission defaults stay unchanged.
    if (profile.permission) {
      setSandboxMode(session, profile.permission);
      setApprovalPolicy(session, 'ask');
    }
  }
  bridge(agent) {
    const selected = this.defaults.get(agent.session);
    if (!selected) return;
    let assembled;
    agent.ctx.on('system-prompt/assemble', async (_value, context, next) => {
      const state = this.context.get('sessionProjections')?.stateOf(agent.session, 'modelSelection');
      assembled = !agent.session.requestHeader() && sameModel(state?.pending, selected) ? selected : undefined;
      const snapshot = assembled, result = await next();
      context.signal?.throwIfAborted();
      return snapshot ? { ...result, variables: { ...result.variables, provider: snapshot.provider, model: snapshot.model } } : result;
    }, { prepend: true });
    agent.ctx.on('agent/request', async (_value, next) => {
      const snapshot = assembled, result = await next();
      if (!snapshot) return result;
      const { reasoningEffort: _effort, ...config } = result;
      return { ...config, ...snapshot };
    }, { prepend: true });
  }
  async getProfiles() {
    await this.registerLater();
    await this.tail;
    const registry = this.context.get('workspaceRegistry'), presets = this.context.get('agentPresets');
    const roster = presets ? await presets.list() : [];
    return { ...this.getConfig(), profiles: this.configFile.value.profiles.map(profile => {
      let directory, error = this.errors.get(profile.preset) ?? '';
      try { directory = canonical(profile.workspace); } catch (failure) { error = failure.message; }
      const workspace = directory && registry?.list().find(value => samePath(value.path, directory));
      const preset = roster.find(value => value.id === profile.preset);
      if (preset?.broken) error = preset.broken;
      return { ...profile, workspaceId: workspace?.id ?? '', workspaceTitle: workspace?.title ?? '', registered: Boolean(workspace && preset && !preset.broken), error: error || (!registry ? '原生工作区服务暂不可用' : !preset ? '原生预设暂不可用' : '') };
    }) };
  }
  async createProfileSession(preset, revision) {
    const snapshot = this.configFile.reload();
    if (this.configFile.closed || snapshot.error || snapshot.revision !== revision) throw new RemoteError('plugin-config/config-conflict', '角色配置已变化，请重新载入页面后创建会话', {});
    const profile = snapshot.value.profiles.find(value => value.preset === preset);
    if (!profile) throw new RemoteError('workspace-profile/not-found', '角色未配置', {});
    const native = this.context.get('sessionController'), registry = this.context.get('workspaceRegistry');
    if (!native || !registry) throw new RemoteError('workspace-profile/unavailable', '原生会话或工作区服务暂不可用', {});
    const presets = this.context.get('agentPresets'), llm = this.context.get('llm');
    if (!presets || (profile.model && !llm)) throw new RemoteError('workspace-profile/unavailable', '原生预设或模型服务暂不可用', {});
    await presets.resolve(profile.preset);
    if (profile.model) await llm.resolveCallConfig({ provider: profile.modelProvider, model: profile.model });
    const directory = canonical(profile.workspace), workspace = await registry.create(directory, profile.name);
    if (this.configFile.closed || this.configFile.reload().revision !== revision) throw new RemoteError('plugin-config/config-conflict', '配置已变化，尚未创建会话', {});
    return native.create({ workspaceId: workspace.id, agentPreset: profile.preset });
  }
}
const initializers = [];
for (const name of ['getProfiles', 'createProfileSession']) Remote(InstructionSettings.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer: initialize => initializers.push(initialize),
});
