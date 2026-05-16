import { Chat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  UIMessage,
  isToolUIPart,
} from 'ai';
import { ulid } from 'ulidx';

import type { ClientOptions } from './client';

export type ExtractInputMessagesResult = {
  history: UIMessage[];
  messages: UIMessage[];
};

/**
 * Generic version of the TAA helper:
 * - Separates "history" from the latest actionable message(s) to send to the server.
 * - Handles agentic tool-call loops where the last assistant message contains tool parts.
 */
function extractInputMessages(messages: UIMessage[]): ExtractInputMessagesResult {
  if (messages.length === 0) {
    return { history: messages, messages: [] };
  }

  const lastMessageIndex = messages.length - 1;
  const lastMessage = messages[lastMessageIndex];
  if (lastMessage == null) {
    return { history: messages, messages: [] };
  }

  if (lastMessage.role === 'user') {
    const history = messages.slice(0, lastMessageIndex);
    return { history, messages: [lastMessage] };
  }

  if (lastMessage.role === 'assistant') {
    const parts = lastMessage.parts;
    if (parts != null && parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart != null && isToolUIPart(lastPart)) {
        if (lastPart.state === 'output-available' || lastPart.state === 'output-error') {
          const history = messages.slice(0, lastMessageIndex);
          return { history, messages: [lastMessage] };
        }
      }
    }
  }

  const history = messages.slice(0, lastMessageIndex);
  return { history, messages: [lastMessage] };
}

const MAX_HISTORY_MESSAGES = 6;

/**
 * Creates a Chat instance configured for a Taskade agent public conversation.
 *
 * Use with `useChat` from `@ai-sdk/react` to build chat interfaces.
 *
 * IMPORTANT: `useChat` requires a real `Chat` instance — it crashes if passed undefined.
 * Always guard with a conditional render so `useChat` is only called after `chat` is created.
 *
 * @param agentId - The agent ID
 * @param conversationId - The conversation ID (from createConversation)
 * @param options - Optional client configuration
 * @returns A Chat instance ready to use with useChat
 *
 * Tool approval: `useChat`'s `addToolApprovalResponse` expects `{ id, approved }` where `id` is
 * `toolUIPart.approval.id` — **not** `toolCallId`. Passing `toolCallId` will not update any part.
 *
 * @example
 * ```typescript
 * import { useChat } from '@ai-sdk/react';
 * import { createConversation, createAgentChat } from '@/lib/agent-chat/v2';
 *
 * function ChatComponent() {
 *   const [chat, setChat] = useState<ReturnType<typeof createAgentChat> | null>(null);
 *
 *   const handleStartChat = async () => {
 *     const { conversationId } = await createConversation(agentId);
 *     setChat(createAgentChat(agentId, conversationId));
 *   };
 *
 *   if (!chat) return <button onClick={handleStartChat}>Start Chat</button>;
 *   return <ActiveChat chat={chat} />;
 * }
 *
 * function ActiveChat({ chat }: { chat: ReturnType<typeof createAgentChat> }) {
 *   const { messages, status } = useChat({ chat, id: chat.id });
 *   // ...
 * }
 * ```
 */
export function createAgentChat(
  agentId: string,
  conversationId: string,
  options?: ClientOptions,
): Chat<UIMessage> {
  const baseUrl = options?.baseUrl ?? '';
  const api = `${baseUrl}/api/taskade/agents/${encodeURIComponent(agentId)}/public-conversations/${encodeURIComponent(conversationId)}/chat`;

  const chatState = new Chat<UIMessage>({
    messages: [],
    transport: new DefaultChatTransport({
      api,
      prepareSendMessagesRequest: (opts) => {
        const { history, messages } = extractInputMessages(opts.messages);

        const maxHistory = Math.max(0, MAX_HISTORY_MESSAGES - messages.length);
        const trimmedHistory = maxHistory === 0 ? [] : history.slice(-maxHistory);

        return {
          body: {
            messages,
            history: trimmedHistory,
          },
        };
      },
    }),
    id: conversationId,
    generateId: ulid,
    sendAutomaticallyWhen: (options) => {
      const shouldSendAutomatically =
        lastAssistantMessageIsCompleteWithToolCalls(options) ||
        lastAssistantMessageIsCompleteWithApprovalResponses(options);
      if (!shouldSendAutomatically) {
        return false;
      }
      if (chatState.error != null) {
        return false;
      }
      return true;
    },
  });

  return chatState;
}
