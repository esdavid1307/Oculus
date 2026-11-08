import { describe, expect, it } from 'vitest';
import { buildRequest, firstMessage, SYSTEM_PROMPT, toolsetEntry } from './request';
import { AGENT_MAX_TOKENS, DISABLED_MEMBERS, type Screenshot } from './types';

const frame = { x: 0, y: 0, width: 100, height: 50, imageWidth: 100, imageHeight: 50 };
const shot: Screenshot = { png: Buffer.from([1, 2, 3]), frame, savedTo: null };

describe('toolsetEntry', () => {
  it('disables the seven unimplemented members and carries no name', () => {
    const entry = toolsetEntry();
    expect(entry).not.toHaveProperty('name');
    expect(entry.type).toBe('computer_toolset_20260801');
    expect(Object.keys(entry.configs ?? {}).sort()).toEqual([...DISABLED_MEMBERS].sort());
    expect(DISABLED_MEMBERS).toHaveLength(7);
    for (const config of Object.values(entry.configs ?? {})) expect(config).toEqual({ enabled: false });
  });
});

describe('buildRequest', () => {
  it('has exactly the verified shape', () => {
    const messages = [firstMessage('Open Notes', shot)];
    const request = buildRequest({ model: 'claude-sonnet-5-5', effort: 'low' }, messages);
    expect(request).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: AGENT_MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      tools: [toolsetEntry()],
      messages,
    });
    for (const key of ['thinking', 'tool_choice', 'temperature']) expect(request).not.toHaveProperty(key);
  });
});

describe('firstMessage', () => {
  it('sends the goal with the screenshot as base64 png', () => {
    expect(firstMessage('Open Notes', shot)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Open Notes' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
      ],
    });
  });
});
