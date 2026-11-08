import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_GOAL, readAgentConfig } from './config';
import { AGENT_EFFORT, AGENT_MAX_STEPS, AGENT_MODEL } from './types';

describe('readAgentConfig', () => {
  it('is null for the env trigger without a goal', () => {
    expect(readAgentConfig({}, 'env')).toBeNull();
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: '   ' }, 'env')).toBeNull();
  });

  it('reads the env trigger with defaults, quitting when done', () => {
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: '  open Notes ' }, 'env')).toEqual({
      goal: 'open Notes',
      backend: 'claude-code',
      model: AGENT_MODEL,
      effort: AGENT_EFFORT,
      maxSteps: AGENT_MAX_STEPS,
      showOverlayInShots: false,
      quitWhenDone: true,
    });
  });

  it('runs on Claude Code unless OCULUS_AGENT_BACKEND=api', () => {
    expect(readAgentConfig({ OCULUS_AGENT_BACKEND: 'api' }, 'shortcut')?.backend).toBe('api');
    expect(readAgentConfig({ OCULUS_AGENT_BACKEND: 'other' }, 'shortcut')?.backend).toBe('claude-code');
  });

  it('stays open with OCULUS_AGENT_KEEP_OPEN=1', () => {
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: 'x', OCULUS_AGENT_KEEP_OPEN: '1' }, 'env')?.quitWhenDone).toBe(false);
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: 'x', OCULUS_AGENT_KEEP_OPEN: '0' }, 'env')?.quitWhenDone).toBe(true);
  });

  it('falls back to the default goal for the shortcut, and never quits', () => {
    const config = readAgentConfig({}, 'shortcut');
    expect(config?.goal).toBe(DEFAULT_AGENT_GOAL);
    expect(config?.quitWhenDone).toBe(false);
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: 'x' }, 'shortcut')?.goal).toBe('x');
    expect(readAgentConfig({ OCULUS_AGENT_CHECK: ' ' }, 'shortcut')?.goal).toBe(DEFAULT_AGENT_GOAL);
  });

  it('reads model and effort overrides', () => {
    const config = readAgentConfig({ OCULUS_AGENT_MODEL: 'claude-opus-x', OCULUS_AGENT_EFFORT: 'high' }, 'shortcut');
    expect(config).toMatchObject({ model: 'claude-opus-x', effort: 'high' });
  });

  it('ignores an invalid or empty model and effort', () => {
    const config = readAgentConfig({ OCULUS_AGENT_MODEL: '', OCULUS_AGENT_EFFORT: 'turbo' }, 'shortcut');
    expect(config).toMatchObject({ model: AGENT_MODEL, effort: AGENT_EFFORT });
  });

  it('reads max steps, capped at 20', () => {
    const steps = (value: string) => readAgentConfig({ OCULUS_AGENT_MAX_STEPS: value }, 'shortcut')?.maxSteps;
    expect(steps('3')).toBe(3);
    expect(steps('20')).toBe(20);
    expect(steps('99')).toBe(20);
  });

  it('falls back to the default max steps when invalid', () => {
    const steps = (value: string) => readAgentConfig({ OCULUS_AGENT_MAX_STEPS: value }, 'shortcut')?.maxSteps;
    for (const bad of ['0', '-2', '2.5', 'many', '']) expect(steps(bad)).toBe(AGENT_MAX_STEPS);
  });

  it('shows the overlay in screenshots only with OCULUS_AGENT_SHOW_OVERLAY=1', () => {
    expect(readAgentConfig({ OCULUS_AGENT_SHOW_OVERLAY: '1' }, 'shortcut')?.showOverlayInShots).toBe(true);
    expect(readAgentConfig({ OCULUS_AGENT_SHOW_OVERLAY: 'true' }, 'shortcut')?.showOverlayInShots).toBe(false);
  });
});
