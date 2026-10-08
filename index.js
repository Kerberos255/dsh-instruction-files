import { InstructionSettings } from './profiles.js';
export const inject = ['dshHomePath'];
export function apply(ctx, config = {}) {
  const settings = new InstructionSettings(ctx, config);
  ctx.effect(() => () => settings.configFile.close());
}
