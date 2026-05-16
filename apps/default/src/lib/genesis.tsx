import type {
  LogFunction,
  LoggerEntryInput,
  SpaceAppLogLifecycleData,
} from '@taskade/parade-shared';
import * as React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

// ---------------------------------------------------------------------------
// Lifecycle logger (injected by Director Preview via window global)
// ---------------------------------------------------------------------------

interface GenesisLogger {
  log: LogFunction;
}
declare global {
  interface Window {
    __TASKADE_APP_LIFECYCLE_LOGGER__?: GenesisLogger;
  }
}

/**
 * Returns the Taskade lifecycle logger if running inside Director Preview.
 * The logger is injected into `window.__TASKADE_APP_LIFECYCLE_LOGGER__` by
 * the preview inject script. Returns `null` in published mode.
 */
export function getGenesisAppLifecycleLogger(): GenesisLogger | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__TASKADE_APP_LIFECYCLE_LOGGER__ ?? null;
}

/**
 * Report a runtime error to the parent frame via postMessage.
 * In preview mode this triggers the "Fix with AI" popup.
 * In published mode this is a no-op (logger not available).
 */
export function reportGenesisError(
  code: 'error.boundary',
  error: unknown,
  componentStack?: string | null,
) {
  getGenesisAppLifecycleLogger()?.log({
    level: 'error',
    message: 'Runtime Error',
    data: {
      code,
      message: error instanceof Error ? error.message : String(error),
      stack: [error instanceof Error ? error.stack : undefined, componentStack]
        .filter(Boolean)
        .join('\n'),
    } satisfies SpaceAppLogLifecycleData,
  } satisfies LoggerEntryInput);
}

// ---------------------------------------------------------------------------
// Error boundary fallback UI (inline styles for resilience)
// ---------------------------------------------------------------------------

/** Fallback UI shown when the ErrorBoundary catches a render error. */
function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Something went wrong</h2>
      <p style={{ color: '#999', margin: '0 0 1rem', fontSize: '0.95rem' }}>
        The app encountered an error. You can try again, or refresh the page.
      </p>
      <pre
        style={{
          background: '#f5f5f5',
          padding: '1rem',
          borderRadius: '8px',
          overflow: 'auto',
          fontSize: '0.8rem',
          color: '#dc2626',
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {String(error)}
      </pre>
      <button
        type="button"
        onClick={resetErrorBoundary}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 1rem',
          background: '#1f2937',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '0.9rem',
        }}
      >
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GenesisRoot
// ---------------------------------------------------------------------------

/**
 * Genesis root wrapper — must be provided by the base template, not LLM-generated.
 *
 * Wraps children in an ErrorBoundary that:
 * 1. Catches render-phase errors and shows {@link ErrorFallback} instead of a blank page.
 * 2. Reports the error to the parent frame via {@link reportGenesisError} so
 *    Director Preview can show the "Fix with AI" popup.
 */
export function GenesisRoot({ children }: { children: React.ReactNode }) {
  return (
    <ReactErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        console.error('[Genesis] Uncaught render error:', error, info);
        reportGenesisError('error.boundary', error, info.componentStack);
      }}
      onReset={() => {
        console.info('[Genesis] User reset error boundary');
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}
