import { z } from 'zod';

/**
 * SSE Event schemas matching backend AgentPublicConversationMessageStreamResponseSchema
 */
export const StreamEventSchema = z.union([
  z.object({
    type: z.literal('start'),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('text-start'),
    id: z.string(),
  }),
  z.object({
    type: z.literal('text-delta'),
    id: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('text-end'),
    id: z.string(),
  }),
  z.object({
    type: z.literal('tool-input-start'),
    toolCallId: z.string(),
    toolName: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-input-delta'),
    toolCallId: z.string(),
    inputTextDelta: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-input-available'),
    toolCallId: z.string(),
    input: z.unknown(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-output-available'),
    toolCallId: z.string(),
    output: z.unknown(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-call-end'),
    toolCallId: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('finish'),
  }),
  z.object({
    type: z.literal('error'),
    errorText: z.string(),
  }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

/**
 * Specific event types for type narrowing
 */
export type StartEvent = Extract<StreamEvent, { type: 'start' }>;
export type TextStartEvent = Extract<StreamEvent, { type: 'text-start' }>;
export type TextDeltaEvent = Extract<StreamEvent, { type: 'text-delta' }>;
export type TextEndEvent = Extract<StreamEvent, { type: 'text-end' }>;
export type ToolInputStartEvent = Extract<StreamEvent, { type: 'tool-input-start' }>;
export type ToolInputDeltaEvent = Extract<StreamEvent, { type: 'tool-input-delta' }>;
export type ToolInputAvailableEvent = Extract<StreamEvent, { type: 'tool-input-available' }>;
export type ToolOutputAvailableEvent = Extract<StreamEvent, { type: 'tool-output-available' }>;
export type ToolCallEndEvent = Extract<StreamEvent, { type: 'tool-call-end' }>;
export type FinishEvent = Extract<StreamEvent, { type: 'finish' }>;
export type ErrorEvent = Extract<StreamEvent, { type: 'error' }>;

/**
 * API Response types
 */
export interface CreateConversationResponse {
  ok: boolean;
  conversationId: string;
}

export interface SendMessageResponse {
  ok: boolean;
  messageId: string;
}

/**
 * Configuration options for stream
 */
export interface StreamOptions {
  /** Base URL for API requests (defaults to relative paths) */
  baseUrl?: string;
  /** Automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Delay in ms before reconnecting (default: 1000) */
  reconnectDelay?: number;
  /**
   * Callback for stream errors
   * @default Logs to console.error
   * @remarks In production, provide your own error handler to properly handle errors
   */
  onError?: (error: Error) => void;
}

/**
 * Accumulated message state
 */
export interface MessageState {
  id: string;
  content: string;
  isComplete: boolean;
  role: 'user' | 'assistant';
  toolCalls?: ToolCallState[];
}

/**
 * Tool call state
 */
export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  isComplete: boolean;
}

/**
 * Event handler types
 */
export type StreamEventHandler = (event: StreamEvent) => void;
export type TextDeltaHandler = (event: TextDeltaEvent) => void;
export type FinishHandler = (event: FinishEvent) => void;
export type ErrorHandler = (event: ErrorEvent) => void;
