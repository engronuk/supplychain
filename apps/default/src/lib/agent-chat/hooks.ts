import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type ClientOptions,
  createConversation as createConversationApi,
  sendMessage as sendMessageApi,
} from './client';
import { AgentChatStream } from './stream';
import type { ErrorEvent, MessageState, StreamOptions } from './types';

/**
 * Options for useAgentChat hook
 */
export interface UseAgentChatOptions extends StreamOptions {
  /** Auto-connect stream on mount (default: true) */
  autoConnect?: boolean;
}

/**
 * Return type for useAgentChat hook
 */
export interface UseAgentChatReturn {
  /** Send a message to the conversation */
  sendMessage: (text: string) => Promise<void>;
  /** Array of messages (sorted by creation order) */
  messages: MessageState[];
  /** Whether stream is currently connected */
  isConnected: boolean;
  /** Current error, if any */
  error: Error | null;
  /** Current conversation ID */
  conversationId: string | null;
  /** Create a new conversation (stream stays open, switches to new conversation) */
  createConversation: () => Promise<string>;
  /** Switch to a different conversation (stream stays open) */
  switchConversation: (conversationId: string) => void;
  /** Manually connect the stream (useful when autoConnect is false) */
  connect: () => void;
}

/**
 * React hook for managing agent chat conversation
 *
 * Requires a conversationId to be provided. The stream is opened when conversationId is available
 * and stays open throughout the conversation lifecycle.
 *
 * @param agentId - The agent ID
 * @param conversationId - The conversation ID (required - must be created manually)
 * @param options - Configuration options
 * @returns Chat state and methods
 *
 * @example
 * ```typescript
 * function ChatComponent() {
 *   const [conversationId, setConversationId] = useState<string | null>(null);
 *   const { sendMessage, messages, isConnected } = useAgentChat('agent-456', conversationId);
 *
 *   // Create conversation manually
 *   const handleStartChat = async () => {
 *     const { conversationId: newId } = await createConversation('agent-456');
 *     setConversationId(newId);
 *   };
 *
 *   return (
 *     <div>
 *       {!conversationId && <button onClick={handleStartChat}>Start Chat</button>}
 *       {messages.map(msg => (
 *         <div key={msg.id}>{msg.content}</div>
 *       ))}
 *       <button onClick={() => sendMessage('Hello!')}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgentChat(
  agentId: string,
  conversationId: string | null,
  options?: UseAgentChatOptions,
): UseAgentChatReturn {
  const [messagesMap, setMessagesMap] = useState<Map<string, MessageState>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId);
  const streamRef = useRef<AgentChatStream | null>(null);
  const listenersRef = useRef<Array<() => void>>([]);
  const streamAgentIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | null>(conversationId);
  const previousConversationIdRef = useRef<string | null>(conversationId);

  // Sync currentConversationId with prop when prop changes externally
  // This ensures the hook's internal state stays in sync with external prop updates
  useEffect(() => {
    const previousId = previousConversationIdRef.current;
    const newId = conversationId;

    // Clear messages when conversationId changes to a different non-null value
    // This handles the case where the prop changes externally (not via createConversation/switchConversation)
    if (previousId !== newId && newId != null && previousId != null) {
      setMessagesMap(new Map());
      // Also clear stream's message states if stream exists
      if (streamRef.current) {
        streamRef.current.clearMessages();
      }
    }

    setCurrentConversationId(newId);
    currentConversationIdRef.current = newId;
    previousConversationIdRef.current = newId;
  }, [conversationId]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.disconnect();
        streamRef.current = null;
        streamAgentIdRef.current = null;
      }
    };
  }, []);

  // Convert messages map to sorted array
  const messages = useMemo(() => {
    const allMessages = Array.from(messagesMap.values());
    // Sort by message ID (ULID) - ULIDs are lexicographically sortable and encode timestamp
    // This ensures chronological order regardless of message role
    allMessages.sort((a, b) => {
      return a.id.localeCompare(b.id);
    });
    return allMessages;
  }, [messagesMap]);

  // Initialize stream when conversationId is available
  // Uses currentConversationId to ensure we're working with the latest state
  // (which may have been updated by createConversation/switchConversation)
  useEffect(() => {
    // Don't initialize if no conversationId
    if (!currentConversationId) {
      // Clean up existing stream if conversationId is removed
      if (streamRef.current) {
        streamRef.current.clearMessages(); // Clear stream's message states
        streamRef.current.disconnect();
        streamRef.current = null;
        streamAgentIdRef.current = null;
        setIsConnected(false);
      }
      // Clear messages when conversation is removed
      setMessagesMap(new Map());
      currentConversationIdRef.current = null;
      return;
    }

    // Update ref to track current conversation ID
    currentConversationIdRef.current = currentConversationId;

    // Clean up previous listeners before setting up new ones
    // This ensures we don't accumulate duplicate listeners when reusing the stream
    listenersRef.current.forEach((unsub) => unsub());
    listenersRef.current = [];

    const unsubscribeFunctions: Array<() => void> = [];
    let isMounted = true;

    // Register cleanup function first to ensure it's available immediately
    // This prevents race conditions where component unmounts before cleanup is registered
    const cleanup = () => {
      isMounted = false;
      unsubscribeFunctions.forEach((unsub) => unsub());
      // Note: We don't disconnect the stream here because:
      // 1. The stream may be reused in the next effect run (when switching conversations)
      // 2. Disconnection is handled when conversationId becomes null (early return above)
      // 3. On component unmount, React will call cleanup, but the stream will be garbage collected
      //    when the ref is cleared by the early return path if conversationId becomes null
    };

    try {
      // Ensure we have valid agentId before creating stream
      // Note: currentConversationId is already validated above (early return if falsy)
      if (!agentId) {
        throw new Error(`Invalid parameters: agentId is required`);
      }

      // Helper function to update messages from stream state
      // Defined inline here since it only uses refs and setState (both stable)
      const updateMessages = () => {
        const currentStream = streamRef.current;
        if (currentStream) {
          setMessagesMap((prev) => {
            const next = new Map(prev);
            // Add/update stream messages (assistant responses)
            for (const [id, streamMsg] of currentStream.messages) {
              // Only update if this is an assistant message (or doesn't exist yet)
              // Preserve user messages - they should never be overwritten by stream
              const existing = prev.get(id);
              if (!existing || existing.role === 'assistant') {
                // Merge with existing to preserve content if stream message is missing it
                // Stream message should have latest content, but fallback to existing as safety
                const mergedMsg: MessageState = {
                  ...existing,
                  ...streamMsg,
                  id, // Ensure ID is preserved
                  role: 'assistant' as const,
                  // Prefer stream message content if it exists and is non-empty, otherwise preserve existing
                  content:
                    typeof streamMsg.content === 'string' && streamMsg.content.length > 0
                      ? streamMsg.content
                      : existing?.content || '',
                };
                next.set(id, mergedMsg);
              }
            }
            return next;
          });
        }
      };

      let stream: AgentChatStream;

      // Check if we need to recreate the stream (agentId changed or stream doesn't exist)
      const existingStream = streamRef.current;
      const agentIdChanged = existingStream && streamAgentIdRef.current !== agentId;

      if (agentIdChanged && existingStream) {
        // AgentId changed - preserve messages from old stream before disconnecting
        // The hook's messagesMap should already have all messages, but we ensure
        // any messages in the stream's state are preserved in the hook's state
        setMessagesMap((prev) => {
          const next = new Map(prev);
          // Preserve any messages from the old stream that aren't already in the map
          for (const [id, streamMsg] of existingStream.messages) {
            if (!next.has(id)) {
              next.set(id, streamMsg);
            } else {
              // If message exists, preserve user messages and merge assistant messages
              const existing = prev.get(id);
              if (existing?.role === 'user') {
                // Keep user message as-is
                continue;
              }
              // Merge assistant messages
              if (existing?.role === 'assistant' || !existing) {
                next.set(id, {
                  ...existing,
                  ...streamMsg,
                  id,
                  role: 'assistant' as const,
                });
              }
            }
          }
          return next;
        });
        // Now disconnect the old stream
        existingStream.disconnect();
        streamRef.current = null;
        streamAgentIdRef.current = null;
      }

      // If stream exists and agentId hasn't changed, update its conversation ID and reuse it
      // We still need to re-register event listeners to ensure fresh closures
      if (streamRef.current && !agentIdChanged) {
        stream = streamRef.current;
        // Update conversation ID if needed - this handles disconnection/reconnection
        stream.setConversationId(currentConversationId);
      } else {
        // Create new stream
        const streamOptions: StreamOptions = {
          baseUrl: options?.baseUrl,
          autoReconnect: options?.autoReconnect ?? true,
          reconnectDelay: options?.reconnectDelay,
          onError: (err) => {
            if (isMounted) {
              setError(err);
            }
            options?.onError?.(err);
          },
        };
        stream = new AgentChatStream(agentId, currentConversationId, streamOptions);
        streamRef.current = stream;
        streamAgentIdRef.current = agentId;
      }

      // Always set up event listeners to ensure fresh closures
      // Even if stream exists, we need to re-register listeners with current closures
      // (isMounted, updateMessages, etc.)

      // Subscribe to events
      // Note: We always re-register listeners even if stream exists to ensure fresh closures
      const unsubscribeOpen = stream.on('open', () => {
        if (isMounted) {
          setIsConnected(true);
          setError(null);
        }
      });
      unsubscribeFunctions.push(unsubscribeOpen);

      const unsubscribeClose = stream.on('close', () => {
        if (isMounted) {
          setIsConnected(false);
        }
      });
      unsubscribeFunctions.push(unsubscribeClose);

      const unsubscribeTextDelta = stream.on('text-delta', () => {
        if (isMounted) {
          updateMessages();
        }
      });
      unsubscribeFunctions.push(unsubscribeTextDelta);

      const unsubscribeFinish = stream.on('finish', () => {
        if (isMounted) {
          updateMessages();
        }
      });
      unsubscribeFunctions.push(unsubscribeFinish);

      const unsubscribeError = stream.on('error', (event: ErrorEvent) => {
        if (isMounted) {
          setError(new Error(event.errorText));
        }
      });
      unsubscribeFunctions.push(unsubscribeError);

      // Store unsubscribe functions for cleanup on next effect run
      listenersRef.current = unsubscribeFunctions;

      // Connect stream if autoConnect is enabled (default: true)
      if (options?.autoConnect !== false) {
        stream.connect();
      }
    } catch (err) {
      if (isMounted) {
        const initError = err instanceof Error ? err : new Error('Failed to initialize chat');
        setError(initError);
        console.error('[useAgentChat] Initialization error:', initError);
      }
    }

    // Return cleanup function
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentId,
    currentConversationId, // Use currentConversationId instead of prop to react to internal updates
    options?.baseUrl,
    options?.autoReconnect,
    options?.reconnectDelay,
    options?.autoConnect,
    options?.onError,
    // Note: updateMessages is defined inline in the effect and only uses refs/setState (stable)
  ]);

  // Send message function
  const sendMessage = useCallback(
    async (text: string) => {
      // Use currentConversationId to ensure we're using the latest state
      const convoId = currentConversationId;
      if (!convoId) {
        throw new Error('No conversation available. Create a conversation first.');
      }

      const clientOptions: ClientOptions = {
        baseUrl: options?.baseUrl,
      };

      try {
        setError(null);
        const response = await sendMessageApi(agentId, convoId, text, clientOptions);

        // Check if conversation is still active before adding message
        // This prevents race condition where conversation switches while API call is pending
        // Use ref to check latest conversation ID (closure value might be stale)
        if (currentConversationIdRef.current !== convoId) {
          // Conversation changed during API call, don't add message (it belongs to old conversation)
          return;
        }

        // Add user message with the messageId from the API response
        const userMessage: MessageState = {
          id: response.messageId,
          content: text,
          isComplete: true,
          role: 'user',
        };
        // Add user message to messages map
        setMessagesMap((prev) => {
          const next = new Map(prev);
          next.set(response.messageId, userMessage);
          return next;
        });
      } catch (err) {
        const sendError = err instanceof Error ? err : new Error('Failed to send message');
        setError(sendError);
        throw sendError;
      }
    },
    [agentId, currentConversationId, options?.baseUrl],
  );

  /**
   * Create a new conversation
   *
   * Creates a new conversation and switches the stream to it. The hook's internal state
   * is updated automatically. If you're managing conversationId as a prop, you should
   * also update it to keep it in sync:
   *
   * @example
   * ```typescript
   * const [conversationId, setConversationId] = useState<string | null>(null);
   * const { createConversation } = useAgentChat(agentId, conversationId);
   *
   * const handleNewChat = async () => {
   *   const newId = await createConversation();
   *   setConversationId(newId); // Update prop to keep it in sync
   * };
   * ```
   *
   * @returns The new conversation ID
   */
  const createConversation = useCallback(async (): Promise<string> => {
    const clientOptions: ClientOptions = {
      baseUrl: options?.baseUrl,
    };
    const { conversationId: newConvoId } = await createConversationApi(agentId, clientOptions);

    // Update internal state first - this will trigger useEffect to reinitialize stream
    setCurrentConversationId(newConvoId);
    currentConversationIdRef.current = newConvoId;
    // Clear messages when switching to new conversation
    setMessagesMap(new Map());

    // If stream exists, update it to the new conversation ID
    // This handles the case where stream was already initialized
    if (streamRef.current) {
      streamRef.current.setConversationId(newConvoId);
    }

    return newConvoId;
  }, [agentId, options?.baseUrl]);

  /**
   * Switch to a different conversation
   *
   * Switches the stream to an existing conversation. The hook's internal state
   * is updated automatically. If you're managing conversationId as a prop, you should
   * also update it to keep it in sync:
   *
   * @example
   * ```typescript
   * const [conversationId, setConversationId] = useState<string | null>(null);
   * const { switchConversation } = useAgentChat(agentId, conversationId);
   *
   * const handleSwitchChat = (existingConvoId: string) => {
   *   switchConversation(existingConvoId);
   *   setConversationId(existingConvoId); // Update prop to keep it in sync
   * };
   * ```
   *
   * @param convoId - The conversation ID to switch to
   */
  const switchConversation = useCallback((convoId: string) => {
    // Update internal state first - this will trigger useEffect to reinitialize stream
    setCurrentConversationId(convoId);
    currentConversationIdRef.current = convoId;
    // Clear messages when switching conversations
    setMessagesMap(new Map());

    // If stream exists, update it to the new conversation ID
    // This handles the case where stream was already initialized
    if (streamRef.current) {
      streamRef.current.setConversationId(convoId);
    }
  }, []);

  /**
   * Manually connect the stream
   *
   * Useful when `autoConnect` is set to `false`. The stream must have a valid
   * conversationId before connecting.
   *
   * @example
   * ```typescript
   * const { connect, conversationId } = useAgentChat(agentId, conversationId, {
   *   autoConnect: false,
   * });
   *
   * // Connect manually after conversation is created
   * const handleStartChat = async () => {
   *   const { conversationId: newId } = await createConversation(agentId);
   *   setConversationId(newId);
   *   // Stream will be initialized but not connected due to autoConnect: false
   *   // Manually connect it
   *   connect();
   * };
   * ```
   */
  const connect = useCallback(() => {
    if (!currentConversationId) {
      throw new Error('Cannot connect: no conversation available. Create a conversation first.');
    }

    if (!streamRef.current) {
      throw new Error('Cannot connect: stream not initialized. Ensure conversationId is provided.');
    }

    streamRef.current.connect();
  }, [currentConversationId]);

  return {
    sendMessage,
    messages,
    isConnected,
    error,
    conversationId: currentConversationId,
    createConversation,
    switchConversation,
    connect,
  };
}
