/**
 * Agent Chat SDK v2 for Taskade Genesis
 *
 * Uses the AI SDK (`@ai-sdk/react`) with the `/chat` endpoint.
 *
 * IMPORTANT: `useChat` requires a real `Chat` instance — it crashes if passed undefined.
 * Always guard with a conditional render so `useChat` is only called after `chat` is created.
 *
 * @example
 * ```typescript
 * import { useChat } from '@ai-sdk/react';
 * import { createConversation, createAgentChat } from '@/lib/agent-chat/v2';
 * import { useState } from 'react';
 * import { ulid } from 'ulidx';
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
 *
 *   const handleSend = async (text: string) => {
 *     await chat.sendMessage({
 *       id: ulid(),
 *       role: 'user',
 *       parts: [{ type: 'text', text }],
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       {messages.map(msg => (
 *         <div key={msg.id}>
 *           {msg.role === 'user' ? 'You: ' : 'Agent: '}
 *           {msg.parts.filter(p => p.type === 'text').map(p => p.text).join('')}
 *         </div>
 *       ))}
 *       <button onClick={() => handleSend('Hello!')}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */

export type { ClientOptions, CreateConversationResponse } from './client';
export { createConversation } from './client';
export { createAgentChat } from './createAgentChat';
