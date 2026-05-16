# Agent Chat SDK (Legacy)

> **DEPRECATED**: Do not use this SDK for new code. Use `@/lib/agent-chat/v2` instead — see `src/lib/agent-chat/v2/README.md` for docs.

---

Simple SDK for building AI Agent Chat interfaces in Taskade Genesis apps.

**Key Features:**
- Manual conversation creation (consumer must create conversation before use)
- Stream opens when conversationId is provided
- Stream stays open throughout (handles reconnection automatically)
- Supports creating/switching conversations

## Quick Start

```typescript
import { useAgentChat, createConversation } from '@/lib/agent-chat';
import { useState } from 'react';

function ChatComponent() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const { sendMessage, messages, isConnected } = useAgentChat(agentId, conversationId);

  // Create conversation manually
  const handleStartChat = async () => {
    const { conversationId: newId } = await createConversation(agentId);
    setConversationId(newId);
  };
  
  return (
    <div>
      {!conversationId && <button onClick={handleStartChat}>Start Chat</button>}
      {messages.map(msg => (
        <div key={msg.id}>
          {msg.role === 'user' ? 'You: ' : 'Agent: '}
          {msg.content}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div>Tool calls: {msg.toolCalls.length}</div>
          )}
        </div>
      ))}
      <button onClick={() => sendMessage('Hello!')}>Send</button>
    </div>
  );
}
```

## Multiple Conversations

```typescript
const [conversationId, setConversationId] = useState<string | null>(null);
const {
  sendMessage,
  messages,
  createConversation: createNewConversation,    // Create new conversation
  switchConversation,    // Switch to existing conversation
} = useAgentChat(agentId, conversationId);

// Create new chat
const handleNewChat = async () => {
  const newConvoId = await createNewConversation();
  setConversationId(newConvoId);
};

// Switch to different conversation
const handleSwitchChat = (existingConvoId: string) => {
  switchConversation(existingConvoId);
  setConversationId(existingConvoId);
};
```

## API Reference

**`useAgentChat(agentId, conversationId)`**
- `agentId` - The agent ID (required)
- `conversationId` - The conversation ID (required, pass `null` if not yet created)
- `sendMessage(text)` - Send message to current conversation (requires conversationId)
- `messages` - Array of messages (MessageState[])
- `isConnected` - Stream connection status
- `conversationId` - Current conversation ID (from hook return)
- `createConversation()` - Create new conversation (returns ID)
- `switchConversation(id)` - Switch to different conversation
- `error` - Current error, if any

**Note:** The hook will only connect the stream when `conversationId` is provided (not `null`). You must create a conversation manually before the stream can connect.

**Advanced (low-level):**
- `createConversation(agentId)` - Direct API call
- `sendMessage(agentId, conversationId, text)` - Direct API call
- `AgentChatStream` - Stream manager class

See `index.ts` for full type exports.

## Requirements

- Agent must have **public visibility** enabled before creating conversation
- Stream stays open permanently (never close after first response)
- Text deltas are automatically accumulated (append, never replace)
