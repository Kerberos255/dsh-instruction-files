import path from 'node:path';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { ConfigFile, ConfigError } from './file-config.js';

export function defineConfig(defaults, rules = {}) {
  defaults = { schemaVersion: 1, ...defaults };
  const validate = input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('invalid-config', '配置必须是 JSON 对象');
    for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new ConfigError('invalid-config', `未知配置项：${key}`);
    const value = structuredClone({ ...defaults, ...input });
    for (const [key, fallback] of Object.entries(defaults)) {
      if (Array.isArray(fallback) ? !Array.isArray(value[key]) || value[key].some(x => typeof x !== 'string') : typeof value[key] !== typeof fallback)
        throw new ConfigError('invalid-config', `配置项类型错误：${key}`);
      if (key === 'schemaVersion' && value[key] !== 1) throw new ConfigError('invalid-config', 'schemaVersion 必须为 1');
      if (rules[key] && !rules[key](value[key], value)) throw new ConfigError('invalid-config', `配置项取值无效：${key}`);
    }
    return Object.freeze(value);
  };
  return { defaults: validate(defaults), validate };
}

/** Each plugin owns its service and file; the official Gateway owns authentication. */
export class PluginConfig extends TypertRemoteService {
  constructor(ctx, { service, packageName, schema, details, action }, legacy = {}) {
    if (Object.keys(legacy).length) throw new ConfigError('config-migration', `${packageName} 的设置已移入插件目录 config.json，请先迁移并移除 Cordis config 覆盖`);
    super(ctx, service);
    this.settingsContext = ctx;
    this.details = details;
    this.action = action;
    this.configFile = new ConfigFile(path.resolve(ctx.dshHomePath(), '..', 'plugins', packageName, 'config.json'), {
      ...schema, onError: error => console.warn(`[${packageName}]`, error.code, error.message),
    });
    ctx.effect(() => () => this.configFile.close());
    for (const initialize of initializers) initialize.call(this);
  }
  getConfig() { return { ...this.configFile.reload(), details: this.details?.() ?? null }; }
  async modelCatalog(kind) {
    if (this.configFile.closed) throw new RemoteError('plugin-config/unavailable', '插件已停用', {});
    if (kind === 'embedding') return this.embeddingCatalog ? await this.embeddingCatalog() : { groups: [] };
    if (kind !== 'chat') throw new RemoteError('plugin-config/invalid-model-kind', '模型目录类型无效', {});
    const native = this.settingsContext.get('sessionController');
    return native ? await native.modelCatalog() : { groups: [] };
  }
  setConfig(value, revision) {
    try { this.configFile.save(value, revision); return this.getConfig(); }
    catch (error) { if (error instanceof ConfigError) throw new RemoteError('plugin-config/' + error.code, error.message, {}); throw error; }
  }
  async runAction() {
    if (this.configFile.closed || !this.action) throw new RemoteError('plugin-config/action-unavailable', '操作不可用', {});
    await this.action(); return this.getConfig();
  }
}
const initializers = [];
for (const name of ['getConfig', 'setConfig', 'runAction', 'modelCatalog']) Remote(PluginConfig.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer: initialize => initializers.push(initialize),
});
