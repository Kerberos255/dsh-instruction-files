import { InstructionSettings } from './profiles.js';
export const inject = ['dshHomePath'];
export function apply(ctx, config = {}) {
  ctx.inject(['pluginDiagnostics'],scope=>{const diag=scope.get('pluginDiagnostics');diag.start('dsh-instruction-files');scope.effect(()=>()=>diag.stop('dsh-instruction-files'));});
  const settings = new InstructionSettings(ctx, config);
  ctx.effect(() => () => settings.configFile.close());
}
