#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * scripts/check-tailwind-purge.js
 *
 * Fails the build if any Tailwind color utility used in source code is
 * MISSING from the production CSS bundle. Catches the exact class of bug
 * we hit when `tailwind.config.js` accidentally overrode a default color
 * scale (`amber: '#D97706'`) and silently nuked `text-amber-50`, `bg-amber-100`,
 * `from-indigo-500`, etc. across the entire app.
 *
 * What it scans:
 *   • Color-related utilities: text-*, bg-*, border-*, from-*, to-*, via-*,
 *     fill-*, stroke-*, ring-*, placeholder-*, divide-*, decoration-*,
 *     caret-*, accent-*, shadow-* (the suffixed colored variant).
 *
 * What it skips:
 *   • Arbitrary values:        text-[#FF0000], bg-[url(...)]
 *   • CSS-variable utilities:  text-[hsl(var(--x))]
 *   • Pseudo-utilities:        sr-only, etc.
 *   • State / responsive prefixes are stripped before lookup
 *     (md:hover:text-amber-500 → text-amber-500).
 *   • Opacity modifiers are stripped (text-amber-500/40 → text-amber-500).
 *
 * Usage:
 *   node scripts/check-tailwind-purge.js
 *   (run after `yarn build` — expects /app/frontend/build/static/css/*.css)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const BUILD_CSS_DIR = path.join(ROOT, "build/static/css");

const COLOR_PREFIXES = [
  "text", "bg", "border", "from", "to", "via",
  "fill", "stroke", "ring", "placeholder", "divide",
  "decoration", "caret", "accent",
];

// Matches: optional state prefixes + (prefix)-(color)(-shade)? + optional /opacity
// e.g. md:hover:text-amber-500/40
const TOKEN_RE = new RegExp(
  String.raw`\b(?:[a-z0-9-]+:)*(?:${COLOR_PREFIXES.join("|")})-[a-z]+(?:-\d+)?(?:\/\d+)?\b`,
  "g",
);

const COLOR_SHADE_RE = new RegExp(
  String.raw`^((?:${COLOR_PREFIXES.join("|")}))-([a-z]+)(?:-(\d+))?$`,
);

// ----- helpers -----------------------------------------------------------------

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

function isArbitraryValue(token) {
  return token.includes("[") || token.includes("]");
}

function isUtilityWeIgnore(token) {
  // strip prefixes / opacity for shape check
  const bare = token.split(":").pop().split("/")[0];
  // Tailwind has non-color utilities sharing these prefixes; we only flag the
  // ones that look like "prefix-color-shade".
  const m = bare.match(COLOR_SHADE_RE);
  if (!m) return true;
  const color = m[2];
  // Skip a few non-color tokens that match the pattern grammatically.
  const NOT_COLORS = new Set([
    // text-{align,size,base,sm,...}
    "left", "right", "center", "justify", "start", "end",
    "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl",
    "5xl", "6xl", "7xl", "8xl", "9xl",
    // bg-{none,fixed,local,scroll,contain,...}
    "none", "fixed", "local", "scroll", "contain", "cover", "auto",
    "no", "repeat", "round", "space",
    // border-{0,2,4,8,solid,dashed,dotted,...}
    "solid", "dashed", "dotted", "double", "hidden", "current",
    "transparent",
    // ring offset, etc.
    "inset", "offset",
    // generic
    "inherit", "current",
    // SVG attribute names that have a hyphen and match the pattern (border-radius,
    // stroke-width, stroke-linecap, stroke-linejoin, stroke-miterlimit, etc.)
    "radius", "width", "linecap", "linejoin", "miterlimit", "rule",
    // Animation keyword directions on Radix slide-in / slide-out utilities:
    // `slide-out-to-bottom`, `slide-in-from-left`, etc. cause our regex to
    // grab `to-bottom`, `from-left`, etc.
    "top", "bottom",  // left/right/start/end already covered above
    // React Router <Link to="..."> path values: to-login, to-distribution, etc.
    // These start with `/` once you re-add the value, but we capture them as
    // `to-{firstpath}`. Filter by checking against a known set; users can
    // extend this list if needed.
    "login", "demo", "dashboard", "inventory", "shipments", "requests",
    "network", "analytics", "reports", "sales", "intel", "distribution",
    "distributor", "distributors", "retailer", "retailers", "product",
    "products", "manufacturer", "manufacturers", "invite", "home",
    // Custom CSS keyframe / animation tokens that share a prefix
    "blink", "spin", "ping", "bounce",
  ]);
  if (NOT_COLORS.has(color)) return true;
  return false;
}

function normaliseToBase(token) {
  // strip state/responsive prefixes
  const noPrefix = token.split(":").pop();
  // strip opacity modifier
  const noOpacity = noPrefix.split("/")[0];
  return noOpacity;
}

// ----- 1. collect literal color tokens from source ----------------------------

const sourceFiles = walk(SRC, [".js", ".jsx", ".ts", ".tsx"]);
const used = new Map(); // base class → set of source files that reference it

for (const f of sourceFiles) {
  const text = fs.readFileSync(f, "utf8");
  // light-weight comment stripper so we don't flag classes in /* ... */ blocks
  const cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Strip JSX attribute values that aren't class strings — common false-
    // positive sources are React Router `to="/x"` props, `from="..."` form
    // props, navigation `from="..."`, etc. We only care about `className=`
    // contents, so blank out other `to=` / `from=` / `viewBox=` attrs.
    .replace(/\b(?:to|from|viewBox|action|href|src|name|type|role|id|key|placeholder|aria-[a-z]+|data-[a-z-]+|fill|stroke)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "");
  const matches = cleaned.match(TOKEN_RE) || [];
  for (const raw of matches) {
    if (isArbitraryValue(raw)) continue;
    if (isUtilityWeIgnore(raw)) continue;
    const base = normaliseToBase(raw);
    if (!used.has(base)) used.set(base, new Set());
    used.get(base).add(path.relative(ROOT, f));
  }
}

// ----- 2. load built CSS -------------------------------------------------------

if (!fs.existsSync(BUILD_CSS_DIR)) {
  console.error(`✗ Built CSS not found at ${BUILD_CSS_DIR}. Run \`yarn build\` first.`);
  process.exit(2);
}
const cssChunks = fs.readdirSync(BUILD_CSS_DIR)
  .filter((f) => f.endsWith(".css"))
  .map((f) => fs.readFileSync(path.join(BUILD_CSS_DIR, f), "utf8"));
const css = cssChunks.join("\n");

// Tailwind compiles `.text-amber-500{...}` (and `.hover\:text-amber-500:hover`
// when only used with a prefix). We track each token *with* its prefix so we
// detect the right CSS rule. Slashes & colons in the class name get escaped
// in CSS with a backslash, so we search for the bare token as a substring —
// it appears inside both `.bg-amber-600 {...}` AND `.hover\:bg-amber-600 {...}`.
function cssContainsToken(originalToken) {
  // Strip opacity modifier only — keep state/responsive prefix because that's
  // what determines which class Tailwind actually generated.
  const noOpacity = originalToken.split("/")[0];
  // The base class without any prefixes (e.g., text-amber-500)
  const bare = noOpacity.split(":").pop();
  // The full token with prefixes (e.g., hover:bg-amber-600)
  // CSS rule will look like `.hover\:bg-amber-600` — search just `bg-amber-600`
  // which appears in both prefixed and unprefixed rules.
  return css.indexOf(bare) !== -1;
}

// ----- 3. report ---------------------------------------------------------------

const missing = [];
for (const [cls, refs] of used) {
  if (!cssContainsToken(cls)) {
    missing.push({ cls, refs: Array.from(refs) });
  }
}

const total = used.size;
const present = total - missing.length;

console.log(`Tailwind purge check — scanned ${sourceFiles.length} files, ${total} color utilities used`);
console.log(`  ✓ ${present} present in built CSS`);

if (missing.length === 0) {
  console.log("  ✓ 0 missing — palette is consistent.");
  process.exit(0);
}

console.error(`  ✗ ${missing.length} missing utilities (referenced in source but NOT in CSS):\n`);
for (const m of missing.slice(0, 60)) {
  console.error(`    • ${m.cls}`);
  for (const ref of m.refs.slice(0, 3)) console.error(`        ↳ ${ref}`);
  if (m.refs.length > 3) console.error(`        ↳ … +${m.refs.length - 3} more`);
}
if (missing.length > 60) {
  console.error(`    … +${missing.length - 60} more`);
}
console.error(`\n  Common causes: a custom color in tailwind.config.js overrode a default scale,`);
console.error(`  or a class name is built at runtime (e.g. \`text-\${tone}-500\`) and Tailwind's`);
console.error(`  JIT scanner can't see it. Either rename your brand token (e.g. \`brand-amber\`),`);
console.error(`  give it a DEFAULT key (\`amber: { DEFAULT: '#...' }\`), or move dynamic class`);
console.error(`  composition into a static lookup table.`);

process.exit(1);
