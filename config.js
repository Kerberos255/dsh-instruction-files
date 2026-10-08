import path from 'node:path';
import { defineConfig } from './plugin-settings/remote-config.js';
import { ConfigError } from './plugin-settings/file-config.js';

const base = defineConfig({
  workspacePromptEnabled: false,
  identityAsIdentity: false,
  soulEnabled: false,
  agentsEnabled: false,
  toolsEnabled: false,
  userEnabled: false,
  memoryEnabled: false,
});
const permissions = new Set(['', 'read-only', 'workspace-write']);
const keys = ['preset', 'name', 'workspace', 'modelProvider', 'model', 'permission'];
export const schema = {
  defaults: Object.freeze({ ...base.defaults, profiles: [] }),
  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('invalid-config', '配置必须是 JSON 对象');
    const { profiles = [], ...common } = input;
    const value = base.validate(common), seen = new Set();
    if (!Array.isArray(profiles) || profiles.length > 32) throw new ConfigError('invalid-config', '角色配置最多包含 32 个预设');
    return Object.freeze({ ...value, profiles: profiles.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !keys.includes(key))) throw new ConfigError('invalid-config', '角色配置格式错误');
      const profile = { modelProvider: '', model: '', permission: '', ...item };
      if (keys.some(key => typeof profile[key] !== 'string' || profile[key].length > (key === 'workspace' ? 4096 : 200))) throw new ConfigError('invalid-config', '角色配置字段必须为文本');
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(profile.preset) || seen.has(profile.preset)) throw new ConfigError('invalid-config', '角色预设标识无效或重复');
      if (!profile.name.trim() || !path.isAbsolute(profile.workspace) || profile.workspace.includes('\0')) throw new ConfigError('invalid-config', '角色需要名称和绝对工作区路径');
      if (Boolean(profile.modelProvider.trim()) !== Boolean(profile.model.trim())) throw new ConfigError('invalid-config', '模型提供方和模型 ID 必须同时填写');
      if (!permissions.has(profile.permission)) throw new ConfigError('invalid-config', '角色默认权限无效');
      seen.add(profile.preset);
      return Object.freeze({ ...profile, name: profile.name.trim(), modelProvider: profile.modelProvider.trim(), model: profile.model.trim() });
    }) });
  },
};
