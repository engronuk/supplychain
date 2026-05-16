# Agent Chat SDK v2

SDK for building AI Agent Chat interfaces in Taskade Genesis apps.
Built on the AI SDK (`@ai-sdk/react`), using the `/chat` endpoint.

## Quick Start

```typescript
import { useChat } from '@ai-sdk/react';
import { createConversation, createAgentChat } from '@/lib/agent-chat/v2';
import { isToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { useState } from 'react';
import { ulid } from 'ulidx';

// IMPORTANT: useChat requires a real Chat instance — it crashes if passed undefined.
// Split into two components so useChat is only called after chat is created.

function ChatComponent() {
  const [chat, setChat] = useState<ReturnType<typeof createAgentChat> | null>(null);

  const handleStartChat = async () => {
    const { conversationId } = await createConversation(agentId);
    setChat(createAgentChat(agentId, conversationId));
  };

  if (!chat) return <button onClick={handleStartChat}>Start Chat</button>;
  return <ActiveChat chat={chat} />;
}

function ActiveChat({ chat }: { chat: ReturnType<typeof createAgentChat> }) {
  const { messages, status, addToolApprovalResponse } = useChat({ chat, id: chat.id });
  const isSending = status === 'submitted' || status === 'streaming';

  const handleSend = async (text: string) => {
    await chat.sendMessage({
      id: ulid(),
      role: 'user',
      parts: [{ type: 'text', text }],
    });
  };

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.role === 'user' ? 'You' : 'Agent'}:</strong>
          {msg.parts.map((part, i) => {
            // Always render all part types — the agent may use tools even if none
            // are configured yet. Omitting this causes tool calls to be silently dropped.
            if (part.type === 'text') {
              return <span key={i}>{part.text}</span>;
            }
            if (isToolUIPart(part)) {
              return (
                <div key={i}>
                  <em>Tool: {part.toolName} [{part.state}]</em>
                  {part.state === 'approval-requested' && part.approval != null && (
                    <>
                      <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>
                        Approve
                      </button>
                      <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}>
                        Deny
                      </button>
                    </>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      ))}
      <button onClick={() => handleSend('Hello!')} disabled={isSending}>Send</button>
    </div>
  );
}
```

## Pre-built AI Elements UI (`@/components/ai-elements/`)

Pre-built, styled React components for chat interfaces are available via AI Elements.
Use these instead of building chat UI from scratch:

| Component | Import | Purpose |
|-----------|--------|---------|
| `Conversation` | `@/components/ai-elements/conversation` | Scrollable chat container with auto-stick-to-bottom |
| `Message` | `@/components/ai-elements/message` | Message bubble with role-based styling + markdown |
| `PromptInput` | `@/components/ai-elements/prompt-input` | Chat input form with file attachments + submit |
| `Suggestion` | `@/components/ai-elements/suggestion` | Quick-reply suggestion pills |
| `Reasoning` | `@/components/ai-elements/reasoning` | Collapsible thinking/reasoning display |
| `CodeBlock` | `@/components/ai-elements/code-block` | Syntax-highlighted code with copy button |
| `Tool` | `@/components/ai-elements/tool` | Collapsible tool call display with status |
| `Confirmation` | `@/components/ai-elements/confirmation` | Tool call approval UI with approve/reject slots |
| `Shimmer` | `@/components/ai-elements/shimmer` | Animated shimmer text — usage: `<Shimmer>Loading...</Shimmer>` (children must be a string) |

See `@/components/ai-elements` for the full list of available components that you may use to build your chat UI.


### Full Example with AI Elements

```typescript
import { useChat } from '@ai-sdk/react';
import { createConversation, createAgentChat } from '@/lib/agent-chat/v2';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { isToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { useState } from 'react';
import { ulid } from 'ulidx';

function ChatPage() {
  const [chat, setChat] = useState<ReturnType<typeof createAgentChat> | null>(null);

  const handleStartChat = async () => {
    const { conversationId } = await createConversation(agentId);
    setChat(createAgentChat(agentId, conversationId));
  };

  if (!chat) return <button onClick={handleStartChat}>Start Chat</button>;
  return <ActiveChat chat={chat} />;
}

function ActiveChat({ chat }: { chat: ReturnType<typeof createAgentChat> }) {
  const { messages, status, addToolApprovalResponse } = useChat({ chat, id: chat.id });

  const handleSend = async (text: string) => {
    await chat.sendMessage({
      id: ulid(),
      role: 'user',
      parts: [{ type: 'text', text }],
    });
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <Conversation>
        <ConversationContent>
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                <MessageParts message={msg} onApprove={addToolApprovalResponse} />
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {!hasMessages && (
        <Suggestions>
          <Suggestion suggestion="What can you help me with?" onClick={handleSend} />
          <Suggestion suggestion="Tell me about this app" onClick={handleSend} />
        </Suggestions>
      )}

      <PromptInput onSubmit={({ text }) => handleSend(text)}>
        <PromptInputTextarea />
        <PromptInputFooter>
          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

// Always handle all part types — the agent may call tools even if none are configured
// yet. Omitting isToolUIPart handling causes tool calls to be silently dropped.
function MessageParts({
  message,
  onApprove,
}: {
  message: UIMessage;
  onApprove: ReturnType<typeof useChat>['addToolApprovalResponse'];
}) {
  return (
    <>
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;

        if (part.type === 'text') {
          return message.role === 'user' ? (
            <p key={key}>{part.text}</p>
          ) : (
            <MessageResponse key={key}>{part.text}</MessageResponse>
          );
        }

        if (isToolUIPart(part)) {
          return (
            <Tool key={key}>
              <ToolHeader type={part.type} state={part.state} />
              <ToolContent>
                <ToolInput input={part.input} />
                <Confirmation approval={part.approval} state={part.state}>
                  <ConfirmationRequest>
                    <ConfirmationTitle>Allow this tool to run?</ConfirmationTitle>
                  </ConfirmationRequest>
                  <ConfirmationAccepted>Approved</ConfirmationAccepted>
                  <ConfirmationRejected>Rejected</ConfirmationRejected>
                  <ConfirmationActions>
                    <ConfirmationAction
                      variant="outline"
                      onClick={() =>
                        part.approval != null && onApprove({ id: part.approval.id, approved: false })
                      }
                    >
                      Deny
                    </ConfirmationAction>
                    <ConfirmationAction
                      onClick={() =>
                        part.approval != null && onApprove({ id: part.approval.id, approved: true })
                      }
                    >
                      Approve
                    </ConfirmationAction>
                  </ConfirmationActions>
                </Confirmation>
                <ToolOutput output={part.output} errorText={part.errorText} />
              </ToolContent>
            </Tool>
          );
        }

        return null;
      })}
    </>
  );
}
```

## Tool Call Approval

Both examples above already include full approval handling — it is part of the standard
`MessageParts` pattern and should always be present, even if the agent has no tools
configured today. Tool call parts will simply never appear in that case; the code is inert.

The approval flow is managed by two pieces:

- **`Confirmation` + sub-components** (`@/components/ai-elements/confirmation`) — conditional
  rendering driven by `part.state` and `part.approval`. No handler logic lives inside them.
- **`addToolApprovalResponse`** (from `useChat`) — call with `{ id: part.approval.id, approved }`.
  The `id` must be the tool part’s **`approval.id`**, not `toolCallId`; wrong `id` updates nothing.
  `createAgentChat` then automatically sends the next request to the server.

### Approval state lifecycle

| State | What's visible |
|---|---|
| `approval-requested` | `<ConfirmationRequest>` + `<ConfirmationActions>` (approve/deny buttons) |
| `approval-responded` | `<ConfirmationAccepted>` or `<ConfirmationRejected>` based on decision |
| `output-available` | Tool completed — `<ToolOutput>` shows result |
| `output-denied` | Tool was denied — `<ConfirmationRejected>` stays visible |

Once `addToolApprovalResponse` is called, `createAgentChat` automatically sends the next
request to the server — no manual trigger required.

## API

**`createConversation(agentId, options?)`**
Creates a new public conversation. Returns `{ ok, conversationId }`.

**`createAgentChat(agentId, conversationId, options?)`**
Creates a `Chat` instance configured for the agent. Use with `useChat` from `@ai-sdk/react`.

**`useChat({ chat, id })`** (from `@ai-sdk/react`)
Standard AI SDK hook. Returns `{ messages, status, error, addToolApprovalResponse }`.

**`addToolApprovalResponse({ id, approved, reason? })`** (from `useChat`)
Submits an approve (`true`) or deny (`false`) decision. **`id` is `toolUIPart.approval.id`**, not `toolCallId`.
The conversation automatically resumes after the response is submitted.

## Sending Messages

```typescript
import { ulid } from 'ulidx';

await chat.sendMessage({
  id: ulid(),
  role: 'user',
  parts: [{ type: 'text', text: 'Hello!' }],
});
```

## Message Format

Messages use the AI SDK `UIMessage` type:

```typescript
import { isToolUIPart } from 'ai';

msg.parts.filter(p => p.type === 'text').map(p => p.text)   // Text
msg.parts.filter(isToolUIPart)                               // Tool calls
```

## Requirements

- Agent must have **public visibility** enabled before creating a conversation
- `useChat` must receive a real `Chat` instance, never `undefined`
