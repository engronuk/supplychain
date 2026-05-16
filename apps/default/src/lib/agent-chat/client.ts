import type { CreateConversationResponse, SendMessageResponse } from './types';

/**
 * Configuration for API client
 */
export interface ClientOptions {
  /** Base URL for API requests (defaults to relative paths) */
  baseUrl?: string;
}

/**
 * Checks if a string is null, undefined, or empty after trimming
 */
function isEmptyString(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/**
 * Creates a new public agent conversation
 *
 * @param agentId - The agent ID
 * @param options - Optional client configuration
 * @returns Promise resolving to conversation ID
 * @throws Error if conversation creation fails
 *
 * @example
 * ```typescript
 * const { conversationId } = await createConversation('agent-456');
 * ```
 */
export async function createConversation(
  agentId: string,
  options?: ClientOptions,
): Promise<CreateConversationResponse> {
  if (isEmptyString(agentId)) {
    throw new Error('Agent ID cannot be empty');
  }

  const baseUrl = options?.baseUrl ?? '';
  const url = `${baseUrl}/api/taskade/agents/${encodeURIComponent(agentId)}/public-conversations`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Read response body once
  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text().catch(() => '');

  if (!response.ok) {
    throw new Error(
      `Failed to create conversation: ${response.status} ${responseText || 'Unknown error'}`,
    );
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Invalid response format: expected JSON, got ${contentType}. Response: ${responseText.substring(
        0,
        100,
      )}`,
    );
  }

  try {
    const data = JSON.parse(responseText);
    return data as CreateConversationResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON response: ${
        err instanceof Error ? err.message : 'Unknown error'
      }. Response: ${responseText.substring(0, 200)}`,
    );
  }
}

/**
 * Sends a message to an existing conversation
 *
 * @param agentId - The agent ID
 * @param conversationId - The conversation ID
 * @param text - The message text to send
 * @param options - Optional client configuration
 * @returns Promise resolving when message is sent
 * @throws Error if message sending fails (e.g., conversation not idle, conversation ended)
 *
 * @example
 * ```typescript
 * await sendMessage('agent-456', 'convo-789', 'Hello!');
 * ```
 */
export async function sendMessage(
  agentId: string,
  conversationId: string,
  text: string,
  options?: ClientOptions,
): Promise<SendMessageResponse> {
  if (isEmptyString(agentId)) {
    throw new Error('Agent ID cannot be empty');
  }

  if (isEmptyString(conversationId)) {
    throw new Error('Conversation ID cannot be empty');
  }

  const trimmedText = text.trim();
  if (isEmptyString(trimmedText)) {
    throw new Error('Message text cannot be empty');
  }

  const baseUrl = options?.baseUrl ?? '';
  const url = `${baseUrl}/api/taskade/agents/${encodeURIComponent(
    agentId,
  )}/public-conversations/${encodeURIComponent(conversationId)}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: trimmedText }),
  });

  // Read response body once
  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text().catch(() => '');

  if (!response.ok) {
    // Parse error message if available
    let errorMessage = `Failed to send message: ${response.status}`;
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // Use default error message with response text
      if (responseText) {
        errorMessage = `${errorMessage}: ${responseText.substring(0, 100)}`;
      }
    }
    throw new Error(errorMessage);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Invalid response format: expected JSON, got ${contentType}. Response: ${responseText.substring(
        0,
        100,
      )}`,
    );
  }

  try {
    const data = JSON.parse(responseText);
    return data as SendMessageResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON response: ${
        err instanceof Error ? err.message : 'Unknown error'
      }. Response: ${responseText.substring(0, 200)}`,
    );
  }
}
