/**
 * Shiki highlighter — singleton with CDN-based language loading.
 *
 * Instead of importing from "shiki" (which bundles ALL ~200 language grammars
 * and ~50 themes as dynamic imports, producing 347 esbuild chunks), we use
 * `@shikijs/core` with:
 *   - 2 themes imported statically (github-light, github-dark)
 *   - Language grammars fetched from CDN on demand
 *
 * This reduces the chunk count from 347 → 0.
 *
 * @see https://github.com/taskade/taskcade/issues/26056
 */

import type { HighlighterCore } from "@shikijs/core";
import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";

export type { ThemedToken } from "@shikijs/core";

export type BundledLanguage = string;

// Keep in sync with the shiki version in package.json
const SHIKI_CDN_BASE = "https://esm.sh/@shikijs/langs@4.0.2/";

// Singleton highlighter — created once, languages loaded incrementally
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getOrCreateHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

// Track language loading state to deduplicate concurrent fetches
const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

async function ensureLanguage(
  highlighter: HighlighterCore,
  lang: string
): Promise<void> {
  if (loadedLangs.has(lang)) return;

  // Deduplicate concurrent loads for the same language
  const existing = loadingLangs.get(lang);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Dynamic CDN import — intentionally left as a runtime fetch, not bundled
      const mod = await import(`${SHIKI_CDN_BASE}${lang}.mjs`);
      await highlighter.loadLanguage(mod.default ?? mod);
    } catch {
      // Language not available on CDN — will fall back to plaintext
    } finally {
      loadedLangs.add(lang); // Prevent retries, even on failure
      loadingLangs.delete(lang);
    }
  })();

  loadingLangs.set(lang, promise);
  return promise;
}

/**
 * Returns a Shiki highlighter with the requested language loaded.
 * The highlighter is a singleton; languages are loaded incrementally from CDN.
 */
export async function getHighlighter(
  language: string
): Promise<HighlighterCore> {
  const highlighter = await getOrCreateHighlighter();
  await ensureLanguage(highlighter, language);
  return highlighter;
}
