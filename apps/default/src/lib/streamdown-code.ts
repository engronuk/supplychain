/**
 * Custom Streamdown code-highlighter plugin using @shikijs/core with CDN.
 *
 * Drop-in replacement for `@streamdown/code` that avoids bundling all ~200
 * shiki language grammars (which creates 347 esbuild chunks and crashes the
 * preview server). Instead, languages are loaded on demand from CDN.
 *
 * Uses the same singleton highlighter as `@/lib/shiki`.
 *
 * @see https://github.com/taskade/taskcade/issues/26056
 */

import type { HighlighterCore } from "@shikijs/core";
import { getHighlighter } from "./shiki";

// Re-use the theme names from the shared shiki singleton
const THEMES = ["github-light", "github-dark"] as const;

// Cache: key → tokens result
const cache = new Map<
  string,
  { bg?: string; fg?: string; tokens: unknown[][] }
>();

// In-flight subscribers for async results
const subscribers = new Map<
  string,
  Set<(result: { bg?: string; fg?: string; tokens: unknown[][] }) => void>
>();

function cacheKey(
  code: string,
  language: string,
  themes: [string, string]
): string {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${themes[0]}:${themes[1]}:${code.length}:${start}:${end}`;
}

function themeNames(
  themes: [unknown, unknown]
): [string, string] {
  const name = (t: unknown) =>
    typeof t === "string" ? t : (t as { name?: string })?.name ?? "custom";
  return [name(themes[0]), name(themes[1])];
}

/**
 * CDN-based code highlighter plugin for Streamdown.
 *
 * Implements the `CodeHighlighterPlugin` interface expected by Streamdown.
 */
export const code = {
  name: "shiki" as const,
  type: "code-highlighter" as const,

  supportsLanguage(_language: string): boolean {
    // Accept all languages — unknown ones will fall back to plaintext
    // after the CDN fetch fails.
    return true;
  },

  getSupportedLanguages(): string[] {
    // Return empty — languages are loaded dynamically from CDN
    return [];
  },

  getThemes(): [string, string] {
    return [THEMES[0], THEMES[1]];
  },

  highlight(
    options: {
      code: string;
      language: string;
      themes: [unknown, unknown];
    },
    callback?: (result: {
      bg?: string;
      fg?: string;
      tokens: unknown[][];
    }) => void
  ): { bg?: string; fg?: string; tokens: unknown[][] } | null {
    const { code: src, language } = options;
    const names = themeNames(options.themes);
    const key = cacheKey(src, language, names);

    // Return cached result if available
    const cached = cache.get(key);
    if (cached) return cached;

    // Register callback for async notification
    if (callback) {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set());
      }
      subscribers.get(key)!.add(callback);
    }

    // Fire-and-forget async highlight
    getHighlighter(language)
      .then((highlighter: HighlighterCore) => {
        const langToUse = highlighter.getLoadedLanguages().includes(language)
          ? language
          : "text";

        const result = highlighter.codeToTokens(src, {
          lang: langToUse,
          themes: {
            light: names[0],
            dark: names[1],
          },
        });

        const tokenized = {
          bg: result.bg ?? undefined,
          fg: result.fg ?? undefined,
          tokens: result.tokens,
        };

        cache.set(key, tokenized);

        // Notify subscribers
        const subs = subscribers.get(key);
        if (subs) {
          for (const sub of subs) {
            sub(tokenized);
          }
          subscribers.delete(key);
        }
      })
      .catch((error: unknown) => {
        console.error("[streamdown-code] Failed to highlight:", error);
        subscribers.delete(key);
      });

    // Not ready yet — Streamdown will show unhighlighted code
    return null;
  },
};
