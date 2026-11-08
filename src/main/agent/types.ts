import type Anthropic from '@anthropic-ai/sdk';

// The contract between the agent check modules (#6). Everything here is in the main process.

// Sonnet over Opus for the lowest latency per call; OCULUS_AGENT_MODEL overrides it.
export const AGENT_MODEL = 'claude-sonnet-5-5';
export const AGENT_EFFORT: Effort = 'low';
export const AGENT_MAX_STEPS = 5;
export const AGENT_MAX_TOKENS = 16000;
// Server-side refusal fallback, routed by refusal category. Needs the beta messages endpoint.
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// GA on the Claude API, no beta header. Takes no name and no display size.
export const COMPUTER_TOOLSET_TYPE = 'computer_toolset_20260801';
// Every member tool_use carries this, and every tool_result must echo it.
export const COMPUTER_TOOLSET_NAME = 'computer';
// Members the executor doesn't implement, switched off in the toolset's configs.
export const DISABLED_MEMBERS = ['zoom', 'left_click_drag', 'left_mouse_down', 'left_mouse_up', 'middle_click', 'hold_key', 'cursor_position'] as const;
export const HALT_TEXT = 'Not executed: an earlier computer action in this turn failed.';
// A smaller image than the display keeps each call fast. Well under the model's 2576px limit.
export const MODEL_MAX_LONG_EDGE = 1280;
// Time for the compositor to drop the overlay before the capture.
export const OVERLAY_HIDE_SETTLE_MS = 150;
export const LOG_PREFIX = '[agent-check]';
// The error of a run cut short by the Stop Gesture (an aborted AbortSignal).
export const STOPPED_ERROR = 'Stopped by the user';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// claude-code runs Claude Code in the background on the user's own login. api calls the Claude API with ANTHROPIC_API_KEY.
export type AgentBackend = 'claude-code' | 'api';

export type Point = { x: number; y: number };

// Where one screenshot sits on screen. x, y, width and height are display bounds in screen points,
// the space Electron's screen API and CGEvent share. The model sees imageWidth x imageHeight pixels.
export type ScreenFrame = { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number };

// png is exactly the bytes sent to the model, and savedTo is where the same bytes were written.
export type Screenshot = { png: Buffer; frame: ScreenFrame; savedTo: string | null };

export type Capture = () => Promise<Screenshot>;

export type Modifier = 'cmd' | 'ctrl' | 'alt' | 'shift';

// The model speaks xdotool names ("super", "ctrl"), and macOS has cmd. Keys are lowercase.
export const MODIFIER_NAMES: Record<string, Modifier> = {
  cmd: 'cmd',
  command: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  win: 'cmd',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

// One computer use member call, already in screen points. at: null means where the cursor is.
export type ComputerAction =
  | { type: 'click'; at: Point | null; button: 'left' | 'right'; count: 1 | 2 | 3; modifiers: Modifier[] }
  | { type: 'move'; at: Point }
  | { type: 'scroll'; at: Point | null; direction: ScrollDirection; amount: number; modifiers: Modifier[] }
  | { type: 'type'; text: string }
  // keys is the model's own combo, such as "cmd+l" or "Return". The executor parses it.
  | { type: 'key'; keys: string; repeat: number }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot' };

// What reaches the OS. The loop handles screenshot and wait itself.
export type InputAction = Exclude<ComputerAction, { type: 'screenshot' | 'wait' }>;

// Rejects with an Error whose message the model can read.
export type Execute = (action: InputAction) => Promise<void>;

// The slice of the SDK the loop uses, so tests can pass a fake. new Anthropic().beta.messages fits it.
export type MessagesApi = {
  create(
    params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Beta.Messages.BetaMessage>;
};

export type ModelCall = {
  step: number;
  ms: number;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  toolCalls: string[];
  text: string;
};

export type ActionRecord = {
  step: number;
  name: string;
  input: unknown;
  action: ComputerAction | null;
  ok: boolean;
  error: string | null;
};

// ok means no error and at least one input action reached the OS.
export type AgentCheckResult = {
  ok: boolean;
  goal: string;
  model: string;
  calls: ModelCall[];
  actions: ActionRecord[];
  screenshots: string[];
  finalText: string;
  error: string | null;
};

export type AgentConfig = {
  goal: string;
  backend: AgentBackend;
  model: string;
  effort: Effort;
  maxSteps: number;
  // A negative control: leaves the overlay in the screenshots, to prove hiding it matters.
  showOverlayInShots: boolean;
  quitWhenDone: boolean;
};

export type AgentRunOptions = Pick<AgentConfig, 'goal' | 'model' | 'effort' | 'maxSteps'>;

export type AgentDeps = {
  messages: MessagesApi;
  capture: Capture;
  execute: Execute;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // Aborted by the Stop Gesture: no further model call or action, and the result's error is STOPPED_ERROR.
  signal?: AbortSignal;
};
