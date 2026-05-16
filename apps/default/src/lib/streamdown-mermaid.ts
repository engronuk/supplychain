/**
 * Custom Streamdown diagram plugin that loads Mermaid from CDN.
 *
 * Drop-in replacement for `@streamdown/mermaid` that avoids bundling the
 * full mermaid library (~83 esbuild chunks for all diagram types).
 * Instead, mermaid is loaded on demand from esm.sh CDN.
 *
 * @see https://github.com/taskade/taskcade/issues/26056
 */

const MERMAID_VERSION = "11.14.0";
const MERMAID_CDN_URL = `https://esm.sh/mermaid@${MERMAID_VERSION}`;

interface MermaidConfig {
  startOnLoad?: boolean;
  theme?: string;
  securityLevel?: string;
  fontFamily?: string;
  suppressErrorRendering?: boolean;
  [key: string]: unknown;
}

interface MermaidInstance {
  initialize: (config: MermaidConfig) => void;
  render: (
    id: string,
    source: string
  ) => Promise<{
    svg: string;
  }>;
}

const DEFAULT_CONFIG: MermaidConfig = {
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  fontFamily: "monospace",
  suppressErrorRendering: true,
};

// Singleton: CDN module promise
let mermaidModulePromise: Promise<{ default: MermaidInstance }> | null = null;
let initialized = false;

function getMermaidModule(): Promise<{ default: MermaidInstance }> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import(
      /* @vite-ignore */ MERMAID_CDN_URL
    ) as Promise<{ default: MermaidInstance }>;
  }
  return mermaidModulePromise;
}

/**
 * CDN-based Mermaid diagram plugin for Streamdown.
 *
 * Implements the `DiagramPlugin` interface expected by Streamdown.
 */
export const mermaid = {
  name: "mermaid" as const,
  type: "diagram" as const,
  language: "mermaid",

  getMermaid(config?: MermaidConfig): MermaidInstance {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    return {
      initialize(overrides: MermaidConfig) {
        // Will be applied when the CDN module loads
        Object.assign(mergedConfig, overrides);
        initialized = false; // Force re-init with new config
      },

      async render(id: string, source: string): Promise<{ svg: string }> {
        const mod = await getMermaidModule();
        const m = mod.default;

        if (!initialized) {
          m.initialize(mergedConfig);
          initialized = true;
        }

        return m.render(id, source);
      },
    };
  },
};
