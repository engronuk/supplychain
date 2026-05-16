// RadialHierarchyCanvas.tsx
// D3-driven radial hierarchy rendered to <canvas> for high-performance
// pan/zoom + spring-animated expansion. Lazy-loads children on click.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zoom as d3zoom, zoomIdentity, ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import {
  hierarchyService,
  HierarchyNode,
  HealthStatus,
} from "@/services/hierarchyService";

export interface CanvasNode {
  id: string;
  parentId: string | null;
  data: HierarchyNode;
  depth: number;
  /** Angular slot [a0, a1] in radians around the root. */
  a0: number;
  a1: number;
  angle: number; // mid-angle
  // current animated values
  x: number;
  y: number;
  r: number;
  alpha: number;
  // target values (springs lerp toward these)
  tx: number;
  ty: number;
  tr: number;
  talpha: number;
  // ui state
  expanded: boolean;
  loading: boolean;
  childrenIds: string[]; // populated when loaded
  born: number; // performance.now() when added (for staggered intro)
}

interface Props {
  manufacturerId: string;
  /** Called whenever the hovered node changes (with screen coords for the tooltip). */
  onHover?: (info: { node: CanvasNode; clientX: number; clientY: number } | null) => void;
  /** Called when the active focus path changes (root-first list of nodes). */
  onFocusPathChange?: (path: CanvasNode[]) => void;
}

const LEVEL_RADII = [0, 200, 360, 520, 680]; // mfg, region, state, dist, retailer
const NODE_SIZES: Record<HierarchyNode["type"], number> = {
  manufacturer: 32,
  region: 20,
  state: 14,
  distributor: 10,
  retailer: 6,
};

const SPRING = 0.18;          // position lerp factor (0..1)
const ALPHA_SPRING = 0.12;
const DIM_ALPHA = 0.22;
const PATH_ALPHA = 1.0;
const REST_ALPHA = 0.78;

export default function RadialHierarchyCanvas({
  manufacturerId,
  onHover,
  onFocusPathChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const nodesRef = useRef<Map<string, CanvasNode>>(new Map());
  const focusIdRef = useRef<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 800, h: 600 });
  const dirtyRef = useRef(true);

  const [, forceRender] = useState(0); // for occasional React-side re-renders (legend, etc.)

  // ----------- helpers -----------
  const setDirty = () => { dirtyRef.current = true; };

  const setTargetsForNode = useCallback((n: CanvasNode) => {
    const radius = LEVEL_RADII[Math.min(n.depth, LEVEL_RADII.length - 1)];
    n.tx = Math.cos(n.angle) * radius;
    n.ty = Math.sin(n.angle) * radius;
    n.tr = NODE_SIZES[n.data.type] || 8;
  }, []);

  const placeChildren = useCallback((parent: CanvasNode, children: HierarchyNode[]) => {
    const span = parent.a1 - parent.a0;
    const isRoot = parent.depth === 0;
    // For the root we want full circle; for others pad slightly so siblings breathe
    const pad = isRoot ? 0 : Math.min(span * 0.05, 0.08);
    const usable = Math.max(span - pad * 2, 0.001);
    const step = usable / Math.max(children.length, 1);

    const now = performance.now();
    children.forEach((c, i) => {
      const a0 = parent.a0 + pad + step * i;
      const a1 = a0 + step;
      const mid = (a0 + a1) / 2;
      // Existing? skip
      if (nodesRef.current.has(c.id)) return;
      const node: CanvasNode = {
        id: c.id,
        parentId: parent.id,
        data: c,
        depth: parent.depth + 1,
        a0, a1, angle: mid,
        // appear at parent's current position then animate out
        x: parent.x, y: parent.y, r: 0, alpha: 0,
        tx: 0, ty: 0, tr: 0, talpha: REST_ALPHA,
        expanded: false, loading: false,
        childrenIds: [],
        born: now + i * 12, // small per-child stagger
      };
      setTargetsForNode(node);
      nodesRef.current.set(c.id, node);
      parent.childrenIds.push(c.id);
    });
    setDirty();
  }, [setTargetsForNode]);

  const computeFocusPath = useCallback((focusId: string | null): CanvasNode[] => {
    if (!focusId) return [];
    const path: CanvasNode[] = [];
    let id: string | null = focusId;
    while (id) {
      const n = nodesRef.current.get(id);
      if (!n) break;
      path.unshift(n);
      id = n.parentId;
    }
    return path;
  }, []);

  const updateAlphas = useCallback(() => {
    const focusId = focusIdRef.current;
    if (!focusId) {
      nodesRef.current.forEach((n) => { n.talpha = REST_ALPHA; });
      return;
    }
    const path = computeFocusPath(focusId);
    const pathIds = new Set(path.map((p) => p.id));
    // Also include focus's descendants
    const includeDescendants = (id: string) => {
      const n = nodesRef.current.get(id);
      if (!n) return;
      pathIds.add(n.id);
      n.childrenIds.forEach(includeDescendants);
    };
    includeDescendants(focusId);
    nodesRef.current.forEach((n) => {
      n.talpha = pathIds.has(n.id) ? PATH_ALPHA : DIM_ALPHA;
    });
  }, [computeFocusPath]);

  // ----------- expand / collapse -----------
  const expandNode = useCallback(async (n: CanvasNode) => {
    if (n.expanded || n.loading || !n.data.has_children) return;
    n.loading = true;
    setDirty();
    try {
      const kids = await hierarchyService.getChildren(manufacturerId, n.data);
      placeChildren(n, kids);
      n.expanded = true;
    } finally {
      n.loading = false;
      setDirty();
    }
  }, [manufacturerId, placeChildren]);

  const collapseNode = useCallback((n: CanvasNode) => {
    // remove descendants
    const stack = [...n.childrenIds];
    while (stack.length) {
      const id = stack.pop()!;
      const child = nodesRef.current.get(id);
      if (!child) continue;
      stack.push(...child.childrenIds);
      // animate back to parent then delete; for simplicity delete immediately
      nodesRef.current.delete(id);
    }
    n.childrenIds = [];
    n.expanded = false;
    setDirty();
  }, []);

  const focusNode = useCallback((n: CanvasNode | null) => {
    focusIdRef.current = n?.id || null;
    updateAlphas();
    setDirty();
    if (onFocusPathChange) onFocusPathChange(computeFocusPath(focusIdRef.current));
  }, [updateAlphas, computeFocusPath, onFocusPathChange]);

  // ----------- initial load -----------
  useEffect(() => {
    let cancelled = false;
    nodesRef.current.clear();
    focusIdRef.current = null;
    hoverIdRef.current = null;

    (async () => {
      const root = await hierarchyService.getRoot(manufacturerId);
      if (cancelled) return;
      const rootNode: CanvasNode = {
        id: root.id,
        parentId: null,
        data: root,
        depth: 0,
        a0: -Math.PI, a1: Math.PI, angle: 0,
        x: 0, y: 0, r: 0, alpha: 0,
        tx: 0, ty: 0, tr: NODE_SIZES.manufacturer, talpha: PATH_ALPHA,
        expanded: false, loading: false, childrenIds: [],
        born: performance.now(),
      };
      nodesRef.current.set(root.id, rootNode);
      focusNode(rootNode);
      forceRender((v) => v + 1);
    })();

    return () => { cancelled = true; };
  }, [manufacturerId, focusNode]);

  // ----------- resize + DPR -----------
  useEffect(() => {
    const onResize = () => {
      const el = containerRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas) return;
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rect.width, h: rect.height };
      setDirty();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ----------- d3-zoom (pan + zoom) -----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = select(canvas);
    const z = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 4])
      .filter((event) => {
        // Allow wheel for zoom, drag for pan (but not when clicking a node)
        if (event.type === "mousedown") {
          return !isPointerOnNode(event);
        }
        return !event.ctrlKey && !event.button;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        setDirty();
      });
    sel.call(z as any);

    // Set initial transform centered
    const initial = zoomIdentity.translate(sizeRef.current.w / 2, sizeRef.current.h / 2).scale(1);
    transformRef.current = initial;
    sel.call((z as any).transform, initial);

    return () => { sel.on(".zoom", null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------- pointer interaction -----------
  function clientToWorld(clientX: number, clientY: number): [number, number] {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const x = (clientX - rect.left - t.x) / t.k;
    const y = (clientY - rect.top - t.y) / t.k;
    return [x, y];
  }

  function pickNodeAt(x: number, y: number): CanvasNode | null {
    let best: CanvasNode | null = null;
    let bestD = Infinity;
    nodesRef.current.forEach((n) => {
      const dx = n.x - x, dy = n.y - y;
      const d2 = dx * dx + dy * dy;
      const hit = (n.r + 6) * (n.r + 6);
      if (d2 <= hit && d2 < bestD) { bestD = d2; best = n; }
    });
    return best;
  }

  function isPointerOnNode(event: MouseEvent): boolean {
    const [x, y] = clientToWorld(event.clientX, event.clientY);
    return !!pickNodeAt(x, y);
  }

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const [x, y] = clientToWorld(e.clientX, e.clientY);
    const hit = pickNodeAt(x, y);
    if (!hit) {
      focusNode(null);
      return;
    }
    focusNode(hit);
    if (!hit.expanded) {
      void expandNode(hit);
    } else {
      collapseNode(hit);
    }
  }, [collapseNode, expandNode, focusNode]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const [x, y] = clientToWorld(e.clientX, e.clientY);
    const hit = pickNodeAt(x, y);
    const id = hit?.id || null;
    if (id !== hoverIdRef.current) {
      hoverIdRef.current = id;
      setDirty();
      if (onHover) {
        if (hit) onHover({ node: hit, clientX: e.clientX, clientY: e.clientY });
        else onHover(null);
      }
    } else if (hit && onHover) {
      onHover({ node: hit, clientX: e.clientX, clientY: e.clientY });
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hit ? "pointer" : "grab";
  }, [onHover]);

  const handleLeave = useCallback(() => {
    if (hoverIdRef.current) {
      hoverIdRef.current = null;
      setDirty();
      onHover && onHover(null);
    }
  }, [onHover]);

  // ----------- render loop -----------
  useEffect(() => {
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      let anim = false;
      nodesRef.current.forEach((n) => {
        // Born stagger — wait until born time before springing
        if (now < n.born) { anim = true; return; }
        const dx = n.tx - n.x;
        const dy = n.ty - n.y;
        const dr = n.tr - n.r;
        const da = n.talpha - n.alpha;
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05 || Math.abs(dr) > 0.05 || Math.abs(da) > 0.005) {
          anim = true;
          n.x += dx * SPRING;
          n.y += dy * SPRING;
          n.r += dr * SPRING;
          n.alpha += da * ALPHA_SPRING;
        } else {
          n.x = n.tx; n.y = n.ty; n.r = n.tr; n.alpha = n.talpha;
        }
      });
      if (anim) setDirty();

      if (dirtyRef.current) {
        draw();
        dirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
    // base
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, w, h);
    // radial vignette
    const g = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(36, 64, 110, 0.35)");
    g.addColorStop(0.55, "rgba(15, 23, 42, 0.6)");
    g.addColorStop(1, "rgba(7, 11, 20, 1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawConcentricGuides(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.05)";
    ctx.lineWidth = 1;
    LEVEL_RADII.slice(1).forEach((r) => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawConnector(ctx: CanvasRenderingContext2D, a: CanvasNode, b: CanvasNode, alpha: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Bezier control points perpendicular to the segment for an arc-like curve
    const perp = 0.18;
    const cx1 = a.x + dx * 0.35 - dy * perp * 0.4;
    const cy1 = a.y + dy * 0.35 + dx * perp * 0.4;
    const cx2 = b.x - dx * 0.35 - dy * perp * 0.4;
    const cy2 = b.y - dy * 0.35 + dx * perp * 0.4;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, `rgba(148, 163, 184, ${0.15 * alpha})`);
    grad.addColorStop(1, `rgba(96, 165, 250, ${0.45 * alpha})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, b.x, b.y);
    ctx.stroke();
  }

  function drawNode(ctx: CanvasRenderingContext2D, n: CanvasNode, isFocus: boolean, isHover: boolean) {
    const color = hierarchyService.statusColor(n.data.status as HealthStatus, n.alpha < 0.4);
    const glow = hierarchyService.statusGlow(n.data.status as HealthStatus);
    const alpha = Math.max(0, Math.min(1, n.alpha));
    // outer glow
    ctx.save();
    ctx.globalAlpha = alpha;
    const glowSize = n.r + (isFocus ? 18 : isHover ? 10 : 6);
    const radGlow = ctx.createRadialGradient(n.x, n.y, n.r * 0.5, n.x, n.y, glowSize);
    radGlow.addColorStop(0, glow);
    radGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = radGlow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowSize, 0, Math.PI * 2);
    ctx.fill();

    // shadow ring
    ctx.shadowColor = glow;
    ctx.shadowBlur = isFocus ? 20 : isHover ? 12 : 0;

    // core
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ring stroke
    ctx.lineWidth = isFocus ? 2.2 : 1.2;
    ctx.strokeStyle = isFocus ? "#ffffff" : "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r + 1.4, 0, Math.PI * 2);
    ctx.stroke();

    // alerts dot
    if (n.data.alerts > 0 && n.r >= 8) {
      const ax = n.x + n.r * 0.78;
      const ay = n.y - n.r * 0.78;
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(3, n.r * 0.32), 0, Math.PI * 2);
      ctx.fill();
      if (n.r >= 12) {
        ctx.fillStyle = "#0b1220";
        ctx.font = "600 9px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.data.alerts > 99 ? "99+" : n.data.alerts), ax, ay + 0.5);
      }
    }

    // label (only for larger nodes or focused/hover)
    const showLabel = n.r >= 12 || isFocus || isHover;
    if (showLabel) {
      const label = n.data.name;
      ctx.font = `${isFocus ? 600 : 500} ${Math.max(11, Math.min(14, n.r * 0.7))}px ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ty = n.y + n.r + 8;
      // text outline for contrast
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(7, 11, 20, 0.9)";
      ctx.strokeText(truncate(label, 22), n.x, ty);
      ctx.fillStyle = isFocus ? "#ffffff" : "rgba(226, 232, 240, 0.85)";
      ctx.fillText(truncate(label, 22), n.x, ty);
    }

    ctx.restore();
  }

  function truncate(s: string, n: number) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;

    // CSS-coord clear (handles HiDPI via setTransform earlier)
    drawBackground(ctx, w, h);

    const t = transformRef.current;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    drawConcentricGuides(ctx);

    // connectors first
    const focusId = focusIdRef.current;
    nodesRef.current.forEach((n) => {
      if (!n.parentId) return;
      const p = nodesRef.current.get(n.parentId);
      if (!p) return;
      const a = Math.min(n.alpha, p.alpha);
      drawConnector(ctx, p, n, a);
    });

    // nodes (draw smaller ones first so larger sit on top)
    const arr = Array.from(nodesRef.current.values()).sort((a, b) => a.r - b.r);
    const hoverId = hoverIdRef.current;
    arr.forEach((n) => {
      drawNode(ctx, n, n.id === focusId, n.id === hoverId);
    });

    ctx.restore();
  }

  // expose programmatic reset to caller via window (light-touch)
  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = select(canvas);
    const z = (sel.property("__zoom") ? sel : null);
    const initial = zoomIdentity.translate(sizeRef.current.w / 2, sizeRef.current.h / 2).scale(1);
    transformRef.current = initial;
    if (z) sel.call((d3zoom().transform as any), initial);
    // collapse all but root
    const root = Array.from(nodesRef.current.values()).find((n) => n.depth === 0);
    if (root) {
      // delete all non-root
      Array.from(nodesRef.current.keys()).forEach((id) => {
        if (id !== root.id) nodesRef.current.delete(id);
      });
      root.childrenIds = [];
      root.expanded = false;
      focusNode(root);
    }
    setDirty();
  }, [focusNode]);

  // controls bar (zoom in/out + reset)
  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = transformRef.current;
    const k = Math.max(0.25, Math.min(4, t.k * factor));
    const next = zoomIdentity.translate(t.x, t.y).scale(k);
    transformRef.current = next;
    const sel = select(canvas);
    sel.call((d3zoom().transform as any), next);
    setDirty();
  };

  const controls = useMemo(() => (
    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
      <button
        onClick={() => zoomBy(1.25)}
        className="h-9 w-9 rounded-lg bg-slate-900/80 backdrop-blur text-slate-200 hover:bg-slate-800 border border-slate-700/60 text-lg font-semibold"
        data-testid="hierarchy-zoom-in"
      >+</button>
      <button
        onClick={() => zoomBy(0.8)}
        className="h-9 w-9 rounded-lg bg-slate-900/80 backdrop-blur text-slate-200 hover:bg-slate-800 border border-slate-700/60 text-lg font-semibold"
        data-testid="hierarchy-zoom-out"
      >−</button>
      <button
        onClick={reset}
        className="h-9 w-9 rounded-lg bg-slate-900/80 backdrop-blur text-slate-200 hover:bg-slate-800 border border-slate-700/60 text-xs font-semibold"
        title="Reset"
        data-testid="hierarchy-reset"
      >⟲</button>
    </div>
  ), [reset]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#070b14]" data-testid="radial-canvas-container">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className="block w-full h-full cursor-grab"
        data-testid="radial-canvas"
      />
      {controls}
    </div>
  );
}
