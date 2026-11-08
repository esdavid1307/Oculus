import { AGENT_EFFORT, AGENT_MAX_STEPS, AGENT_MODEL, type AgentBackend, type AgentConfig, type Effort } from './types';

export const DEFAULT_AGENT_GOAL = 'In Google Chrome, click the address bar, type example.com and press Return.';
const MAX_STEPS_CAP = 20;
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies Effort[];

// env runs once at startup and quits, so it needs a goal. shortcut has a default goal and keeps the app open.
export function readAgentConfig(env: Record<string, string | undefined>, trigger: 'env' | 'shortcut'): AgentConfig | null {
  const envGoal = env.OCULUS_AGENT_CHECK?.trim();
  if (trigger === 'env' && !envGoal) return null;
  const steps = Number(env.OCULUS_AGENT_MAX_STEPS);
  return {
    goal: envGoal || DEFAULT_AGENT_GOAL,
    backend: env.OCULUS_AGENT_BACKEND === 'api' ? 'api' : ('claude-code' satisfies AgentBackend),
    model: env.OCULUS_AGENT_MODEL?.trim() || AGENT_MODEL,
    effort: EFFORTS.includes(env.OCULUS_AGENT_EFFORT ?? '') ? (env.OCULUS_AGENT_EFFORT as Effort) : AGENT_EFFORT,
    maxSteps: Number.isInteger(steps) && steps > 0 ? Math.min(steps, MAX_STEPS_CAP) : AGENT_MAX_STEPS,
    showOverlayInShots: env.OCULUS_AGENT_SHOW_OVERLAY === '1',
    quitWhenDone: trigger === 'env' && env.OCULUS_AGENT_KEEP_OPEN !== '1',
  };
}
