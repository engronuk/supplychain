/**
 * API Response types
 */
export interface CreateConversationResponse {
  ok: boolean;
  conversationId: string;
}

/**
 * Configuration for API client
 */
export interface ClientOptions {
  /** Base URL for API requests (defaults to relative paths) */
  baseUrl?: string;
}

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

  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text().catch(() => '');

  if (!response.ok) {
    throw new Error(
      `Failed to create conversation: ${response.status} ${responseText || 'Unknown error'}`,
    );
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Invalid response format: expected JSON, got ${contentType}. Response: ${responseText.substring(0, 100)}`,
    );
  }

  try {
    const data = JSON.parse(responseText);
    return data as CreateConversationResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON response: ${err instanceof Error ? err.message : 'Unknown error'}. Response: ${responseText.substring(0, 200)}`,
    );
  }
}
