import { Config, loadBaselineInstructions, renderAgentInstructions } from '@deepseek-ai/dsh-agent-instructions';
import { applyWorkspacePrompt } from './workspace-prompt.js';
export { Config };
export const inject = ['systemPrompt'];
export function apply(ctx, config) {
  applyWorkspacePrompt(ctx, config, { loadBaselineInstructions, renderAgentInstructions });
}
