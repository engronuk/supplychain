import type {
  ErrorEvent,
  FinishEvent,
  MessageState,
  StreamEvent,
  StreamEventHandler,
  StreamOptions,
  TextDeltaEvent,
} from './types';
import { StreamEventSchema } from './types';

/**
 * Event emitter interface for stream events
 */
type EventMap = {
  event: StreamEventHandler;
  'text-delta': (event: TextDeltaEvent) => void;
  finish: (event: FinishEvent) => void;
  error: (event: ErrorEvent) => void;
  open: () => void;
  close: () => void;
};

/**
 * Manages SSE connection for agent conversation streaming
 *
 * Handles connection lifecycle, event parsing, and message state accumulation.
 * The stream stays open permanently and handles all messages in the conversation.
 *
 * **Memory Management**: The `messageStates` Map accumulates messages throughout the conversation.
 * For long-running conversations, call `clearMessages()` when switching conversations
 * or create a new stream instance for new conversations.
 *
 * @example
 * ```typescript
 * const stream = new AgentChatStream('agent-456', 'convo-789');
 * stream.on('text-delta', ({ id, delta }) => {
 *   // Append delta to message content
 * });
 * stream.connect();
 * ```
 */
export class AgentChatStream {
  private agentId: string;
  private conversationId: string;
  private options: Required<StreamOptions>;
  private eventSource: EventSource | null = null;
  private listeners: Map<keyof EventMap, Set<EventMap[keyof EventMap]>> = new Map();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageStates: Map<string, MessageState> = new Map();
  private currentMessageId: string | null = null;
  private isConnecting = false;

  constructor(agentId: string, conversationId: string, options?: StreamOptions) {
    this.agentId = agentId;
    this.conversationId = conversationId;
    this.options = {
      baseUrl: options?.baseUrl ?? '',
      autoReconnect: options?.autoReconnect ?? true,
      reconnectDelay: options?.reconnectDelay ?? 1000,
      onError:
        options?.onError ??
        ((error: Error) => {
          // Log errors by default to help with debugging
          // In production, consumers should provide their own error handler
          console.error('[AgentChatStream] Unhandled error:', error);
        }),
    };
  }

  /**
   * Clear all accumulated message states
   * Useful when switching conversations or resetting the stream state
   */
  clearMessages(): void {
    this.messageStates.clear();
    this.currentMessageId = null;
  }

  /**
   * Update the conversation ID for this stream
   * Useful when switching to a new conversation while keeping stream open
   * Automatically clears message states when switching conversations
   */
  setConversationId(conversationId: string): void {
    if (this.conversationId === conversationId) {
      return;
    }
    // Track both connected and connecting states to handle race conditions
    const wasConnected = this.isConnected;
    const wasConnecting = this.isConnecting;
    this.disconnect();
    this.conversationId = conversationId;
    // Clear message state when switching conversations
    this.clearMessages();
    // Reconnect if we were connected or in the process of connecting
    if (wasConnected || wasConnecting) {
      this.connect();
    }
  }

  /**
   * Opens SSE connection to stream endpoint
   * Stream stays open permanently - never close after first response
   */
  connect(): void {
    // Check isConnecting first since it's set synchronously before any async work
    // This prevents race conditions where connect() is called multiple times
    // before eventSource is assigned
    if (this.isConnecting) {
      return; // Already connecting
    }

    if (this.eventSource?.readyState === EventSource.OPEN) {
      return; // Already connected
    }

    this.isConnecting = true;
    this.disconnect(); // Clean up any existing connection

    const baseUrl = this.options.baseUrl;
    const url = `${baseUrl}/api/taskade/agents/${encodeURIComponent(
      this.agentId,
    )}/public-conversations/${encodeURIComponent(this.conversationId)}/stream`;

    // Validate required parameters
    if (!this.agentId || !this.conversationId) {
      const error = new Error(
        `Missing required parameters: agentId=${this.agentId || 'null'}, conversationId=${
          this.conversationId || 'null'
        }`,
      );
      this.options.onError(error);
      this.emit('error', {
        type: 'error',
        errorText: error.message,
      });
      this.isConnecting = false;
      return;
    }

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.isConnecting = false;
        this.emit('open');
      };

      this.eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const event = StreamEventSchema.parse(data);
          this.handleEvent(event);
        } catch (error) {
          const parseError = error instanceof Error ? error : new Error('Failed to parse event');
          this.options.onError(parseError);
          this.emit('error', {
            type: 'error',
            errorText: `Parse error: ${parseError.message}`,
          });
        }
      };

      this.eventSource.onerror = () => {
        this.isConnecting = false;

        // EventSource doesn't provide detailed error info, but we can check readyState
        if (this.eventSource?.readyState === EventSource.CLOSED) {
          this.emit('close');

          // Auto-reconnect if enabled
          if (this.options.autoReconnect) {
            this.scheduleReconnect();
          }
        } else if (this.eventSource?.readyState === EventSource.CONNECTING) {
          // Still connecting, might be a temporary issue
          // Don't emit error yet, wait for connection to complete or fail
        } else {
          // Connection error
          const error = new Error('EventSource connection error');
          this.options.onError(error);
          this.emit('error', {
            type: 'error',
            errorText: 'Stream connection error',
          });
        }
      };
    } catch (error) {
      // EventSource constructor threw an error (e.g., invalid URL)
      this.isConnecting = false;
      const constructorError =
        error instanceof Error ? error : new Error('Failed to create EventSource');
      this.options.onError(constructorError);
      this.emit('error', {
        type: 'error',
        errorText: `Failed to create connection: ${constructorError.message}`,
      });
    }
  }

  /**
   * Closes SSE connection
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnecting = false;
  }

  /**
   * Subscribe to stream events
   *
   * @param event - Event type to listen for
   * @param handler - Callback function
   * @returns Unsubscribe function
   */
  on<K extends keyof EventMap>(event: K, handler: EventMap[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  /**
   * Unsubscribe from stream events
   */
  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    this.listeners.get(event)?.delete(handler);
  }

  /**
   * Get current connection state
   */
  get isConnected(): boolean {
    // Check readyState directly - more reliable across browsers
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Get accumulated message states
   */
  get messages(): Map<string, MessageState> {
    return new Map(this.messageStates);
  }

  /**
   * Get message state by ID
   */
  getMessage(id: string): MessageState | undefined {
    return this.messageStates.get(id);
  }

  /**
   * Handle incoming SSE event
   */
  private handleEvent(event: StreamEvent): void {
    // Emit generic event
    this.emit('event', event);

    switch (event.type) {
      case 'start':
        this.currentMessageId = event.messageId;
        // Always create/update message on start to ensure it exists
        if (!this.messageStates.has(event.messageId)) {
          this.messageStates.set(event.messageId, {
            id: event.messageId,
            content: '',
            isComplete: false,
            role: 'assistant',
          });
        }
        break;

      case 'text-start':
        // event.id is a text segment ID, but text belongs to the current message (from 'start' event)
        // Ensure the current message exists
        if (this.currentMessageId) {
          if (!this.messageStates.has(this.currentMessageId)) {
            this.messageStates.set(this.currentMessageId, {
              id: this.currentMessageId,
              content: '',
              isComplete: false,
              role: 'assistant',
            });
          }
        }
        break;

      case 'text-delta': {
        // event.id is a text segment ID, but text belongs to the current message (from 'start' event)
        // Append delta to the current message's content
        if (this.currentMessageId) {
          const existingState = this.messageStates.get(this.currentMessageId);
          if (existingState) {
            // Create new object with updated content to ensure change detection
            const updatedState: MessageState = {
              ...existingState,
              content: existingState.content + event.delta,
            };
            this.messageStates.set(this.currentMessageId, updatedState);
          } else {
            // Create message if it doesn't exist (shouldn't happen, but handle gracefully)
            this.messageStates.set(this.currentMessageId, {
              id: this.currentMessageId,
              content: event.delta,
              isComplete: false,
              role: 'assistant',
            });
          }
        }
        this.emit('text-delta', event);
        break;
      }

      case 'text-end': {
        // event.id is a text segment ID, but text belongs to the current message (from 'start' event)
        // Text part is complete, but don't mark entire message as complete (message completes on 'finish' event)
        break;
      }

      case 'tool-input-start': {
        // Use messageId from event if available (for child segments), otherwise fall back to currentMessageId
        const messageId =
          'messageId' in event && event.messageId ? event.messageId : this.currentMessageId;
        const toolMessage = messageId ? this.messageStates.get(messageId) : undefined;
        if (toolMessage) {
          const updatedState: MessageState = {
            ...toolMessage,
            toolCalls: [
              ...(toolMessage.toolCalls ?? []),
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                isComplete: false,
              },
            ],
          };
          this.messageStates.set(toolMessage.id, updatedState);
        }
        break;
      }

      case 'tool-input-delta': {
        // Use messageId from event if available (for child segments), otherwise fall back to currentMessageId
        const messageId =
          'messageId' in event && event.messageId ? event.messageId : this.currentMessageId;
        const toolMessage = messageId ? this.messageStates.get(messageId) : undefined;
        if (toolMessage?.toolCalls) {
          const toolCallIndex = toolMessage.toolCalls.findIndex(
            (tc) => tc.toolCallId === event.toolCallId,
          );
          if (toolCallIndex !== -1) {
            const existingToolCall = toolMessage.toolCalls[toolCallIndex];
            // Accumulate inputTextDelta into input (stored as string during streaming)
            // When tool-input-available arrives, it will replace this with the parsed object
            const currentInput =
              typeof existingToolCall.input === 'string' ? existingToolCall.input : '';
            const updatedState: MessageState = {
              ...toolMessage,
              toolCalls: toolMessage.toolCalls.map((tc, index) =>
                index === toolCallIndex
                  ? { ...tc, input: currentInput + event.inputTextDelta }
                  : tc,
              ),
            };
            this.messageStates.set(toolMessage.id, updatedState);
          }
        }
        break;
      }

      case 'tool-input-available': {
        // Use messageId from event if available (for child segments), otherwise fall back to currentMessageId
        const messageId =
          'messageId' in event && event.messageId ? event.messageId : this.currentMessageId;
        const toolMessage = messageId ? this.messageStates.get(messageId) : undefined;
        if (toolMessage?.toolCalls) {
          const toolCallIndex = toolMessage.toolCalls.findIndex(
            (tc) => tc.toolCallId === event.toolCallId,
          );
          if (toolCallIndex !== -1) {
            const updatedState: MessageState = {
              ...toolMessage,
              toolCalls: toolMessage.toolCalls.map((tc, index) =>
                index === toolCallIndex ? { ...tc, input: event.input } : tc,
              ),
            };
            this.messageStates.set(toolMessage.id, updatedState);
          }
        }
        break;
      }

      case 'tool-output-available': {
        // Use messageId from event if available (for child segments), otherwise fall back to currentMessageId
        const messageId =
          'messageId' in event && event.messageId ? event.messageId : this.currentMessageId;
        const toolMessage = messageId ? this.messageStates.get(messageId) : undefined;
        if (toolMessage?.toolCalls) {
          const toolCallIndex = toolMessage.toolCalls.findIndex(
            (tc) => tc.toolCallId === event.toolCallId,
          );
          if (toolCallIndex !== -1) {
            const updatedState: MessageState = {
              ...toolMessage,
              toolCalls: toolMessage.toolCalls.map((tc, index) =>
                index === toolCallIndex ? { ...tc, output: event.output } : tc,
              ),
            };
            this.messageStates.set(toolMessage.id, updatedState);
          }
        }
        break;
      }

      case 'tool-call-end': {
        // Use messageId from event if available (for child segments), otherwise fall back to currentMessageId
        const messageId =
          'messageId' in event && event.messageId ? event.messageId : this.currentMessageId;
        const toolMessage = messageId ? this.messageStates.get(messageId) : undefined;
        if (toolMessage?.toolCalls) {
          const toolCallIndex = toolMessage.toolCalls.findIndex(
            (tc) => tc.toolCallId === event.toolCallId,
          );
          if (toolCallIndex !== -1) {
            const updatedState: MessageState = {
              ...toolMessage,
              toolCalls: toolMessage.toolCalls.map((tc, index) =>
                index === toolCallIndex ? { ...tc, isComplete: true } : tc,
              ),
            };
            this.messageStates.set(toolMessage.id, updatedState);
          }
        }
        break;
      }

      case 'finish':
        if (this.currentMessageId) {
          const finishedMessage = this.messageStates.get(this.currentMessageId);
          if (finishedMessage) {
            const updatedState: MessageState = {
              ...finishedMessage,
              isComplete: true,
            };
            this.messageStates.set(this.currentMessageId, updatedState);
          }
        }
        this.emit('finish', event);
        break;

      case 'error':
        this.emit('error', event);
        this.options.onError(new Error(event.errorText));
        break;
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (handler as (...args: any[]) => void)(...args);
        } catch (error) {
          this.options.onError(error instanceof Error ? error : new Error('Handler error'));
        }
      });
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.options.autoReconnect) {
        this.connect();
      }
    }, this.options.reconnectDelay);
  }
}
