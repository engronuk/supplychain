/**
 * Agent Chat SDK for Taskade Genesis (Legacy)
 *
 * @deprecated Use `@/lib/agent-chat/v2` instead for new code.
 *
 * Low-level SDK for building AI Agent Chat interfaces in React applications.
 * Provides API client, SSE stream management, and optional React hooks.
 *
 * @example
 * ```typescript
 * // React hook usage
 * import { useAgentChat, createConversation } from '@/lib/agent-chat';
 * import { useState } from 'react';
 *
 * function ChatComponent() {
 *   const [conversationId, setConversationId] = useState<string | null>(null);
 *   const { sendMessage, messages, isConnected } = useAgentChat(agentId, conversationId);
 *
 *   const handleStartChat = async () => {
 *     const { conversationId: newId } = await createConversation(agentId);
 *     setConversationId(newId);
 *   };
 *
 *   return (
 *     <div>
 *       {!conversationId && <button onClick={handleStartChat}>Start Chat</button>}
 *       {messages.map(msg => (
 *         <div key={msg.id}>
 *           {msg.role === 'user' ? 'You: ' : 'Agent: '}
 *           {msg.content}
 *         </div>
 *       ))}
 *       <button onClick={() => sendMessage('Hello!')}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */

// Core API client (for advanced usage)
export type { ClientOptions } from './client';
export { createConversation, sendMessage } from './client';

// Stream manager (for advanced usage)
export { AgentChatStream } from './stream';

// Types
export type {
  CreateConversationResponse,
  ErrorEvent,
  ErrorHandler,
  FinishEvent,
  FinishHandler,
  MessageState,
  SendMessageResponse,
  StartEvent,
  StreamEvent,
  StreamEventHandler,
  StreamOptions,
  TextDeltaEvent,
  TextDeltaHandler,
  TextEndEvent,
  TextStartEvent,
  ToolCallEndEvent,
  ToolCallState,
  ToolInputAvailableEvent,
  ToolInputDeltaEvent,
  ToolInputStartEvent,
  ToolOutputAvailableEvent,
} from './types';

// React hook (main API)
export type { UseAgentChatOptions, UseAgentChatReturn } from './hooks';
export { useAgentChat } from './hooks';
