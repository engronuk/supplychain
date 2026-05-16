import { useTheme } from "next-themes"

/**
 * Compatibility shim: LLMs often generate `import { useTheme } from '@/hooks/use-theme'`.
 * This re-exports next-themes which is the actual theme provider.
 *
 * Preferred usage: import { useTheme } from "next-themes" directly.
 */
export { useTheme }
