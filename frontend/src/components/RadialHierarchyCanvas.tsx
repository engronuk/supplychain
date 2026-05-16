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

const LEVEL_RADII = [0, 220, 430, 620, 800]; // mfg, region, state, dist, retailer
const NODE_SIZES: Record<HierarchyNode["type"], number> = {
  manufacturer: 30,
  region: 18,
  state: 13,
  distributor: 9,
  retailer: 5.5,
};

const SPRING = 0.16;          // position lerp factor (0..1)
const ALPHA_SPRING = 0.12;
const DIM_ALPHA = 0.18;
const PATH_ALPHA = 1.0;
const REST_ALPHA = 0.85;

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

  const zoomBehaviorRef = useRef<any>(null);

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
    zoomBehaviorRef.current = z;

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
    // Soft enterprise light gradient — Linear/Stripe-style
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, w, h);
    // gentle radial highlight at center for spatial depth
    const g = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    g.addColorStop(0.55, "rgba(248, 250, 252, 0.6)");
    g.addColorStop(1, "rgba(226, 232, 240, 0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawConcentricGuides(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    LEVEL_RADII.slice(1).forEach((r) => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawConnector(ctx: CanvasRenderingContext2D, a: CanvasNode, b: CanvasNode, alpha: number, active: boolean) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Bezier control points perpendicular to the segment for an arc-like curve
    const perp = 0.16;
    const cx1 = a.x + dx * 0.4 - dy * perp * 0.4;
    const cy1 = a.y + dy * 0.4 + dx * perp * 0.4;
    const cx2 = b.x - dx * 0.4 - dy * perp * 0.4;
    const cy2 = b.y - dy * 0.4 + dx * perp * 0.4;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    if (active) {
      grad.addColorStop(0, `rgba(99, 102, 241, ${0.45 * alpha})`);
      grad.addColorStop(1, `rgba(99, 102, 241, ${0.25 * alpha})`);
      ctx.lineWidth = 1.4;
    } else {
      grad.addColorStop(0, `rgba(148, 163, 184, ${0.28 * alpha})`);
      grad.addColorStop(1, `rgba(148, 163, 184, ${0.14 * alpha})`);
      ctx.lineWidth = 1;
    }
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, b.x, b.y);
    ctx.stroke();
  }

  function drawNode(ctx: CanvasRenderingContext2D, n: CanvasNode, isFocus: boolean, isHover: boolean) {
    const inActivePath = n.alpha > 0.5;
    const color = hierarchyService.statusColor(n.data.status as HealthStatus, !inActivePath);
    const halo = hierarchyService.statusHalo(n.data.status as HealthStatus);
    const alpha = Math.max(0, Math.min(1, n.alpha));

    ctx.save();
    ctx.globalAlpha = alpha;

    // Layered soft shadow halo (instead of dark glow)
    if (inActivePath) {
      const haloR = n.r + (isFocus ? 16 : isHover ? 11 : 7);
      const haloGrad = ctx.createRadialGradient(n.x, n.y, Math.max(0.1, n.r * 0.6), n.x, n.y, Math.max(haloR, 0.5));
      haloGrad.addColorStop(0, halo);
      haloGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(haloR, 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // White backing disk for crisp contrast against any halo
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = isFocus
      ? "rgba(15, 23, 42, 0.18)"
      : isHover
      ? "rgba(15, 23, 42, 0.14)"
      : "rgba(15, 23, 42, 0.08)";
    ctx.shadowBlur = isFocus ? 14 : isHover ? 10 : 6;
    ctx.shadowOffsetY = isFocus ? 4 : 2;
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(0.5, n.r + 1.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Status-colored inner core
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(0.1, n.r), 0, Math.PI * 2);
    ctx.fill();

    // Subtle inner ring for definition
    ctx.strokeStyle = inActivePath ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.6)";
    ctx.lineWidth = isFocus ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(0.1, n.r - 0.6), 0, Math.PI * 2);
    ctx.stroke();

    // Active focus outer ring
    if (isFocus) {
      ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Alerts badge (only visible for larger active nodes)
    if (n.data.alerts > 0 && n.r >= 8 && inActivePath) {
      const ax = n.x + n.r * 0.78;
      const ay = n.y - n.r * 0.78;
      const badgeR = Math.max(4, n.r * 0.34);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(ax, ay, badgeR + 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(ax, ay, badgeR, 0, Math.PI * 2);
      ctx.fill();
      if (n.r >= 12) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 9px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.data.alerts > 99 ? "99+" : n.data.alerts), ax, ay + 0.5);
      }
    }

    // Labels — improved readability with white halo on light bg
    const showLabel = n.r >= 11 || isFocus || isHover;
    if (showLabel && inActivePath) {
      const label = n.data.name;
      const fontSize = Math.max(11, Math.min(14, n.r * 0.7));
      ctx.font = `${isFocus ? 600 : 500} ${fontSize}px ui-sans-serif, system-ui, -apple-system`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ty = n.y + n.r + 9;
      const text = truncate(label, 24);
      // soft white outline for AA contrast
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineJoin = "round";
      ctx.strokeText(text, n.x, ty);
      ctx.fillStyle = isFocus ? "#0f172a" : "#334155";
      ctx.fillText(text, n.x, ty);
      // sub-label for focused node showing type
      if (isFocus && n.r >= 14) {
        ctx.font = `500 10px ui-sans-serif, system-ui`;
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(n.data.type.toUpperCase(), n.x, ty + fontSize + 3);
      }
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
    const activePathIds = new Set<string>();
    if (focusId) {
      // ancestors
      let id: string | null = focusId;
      while (id) {
        const n = nodesRef.current.get(id);
        if (!n) break;
        activePathIds.add(id);
        id = n.parentId;
      }
      // descendants of focus
      const stack = [focusId];
      while (stack.length) {
        const cur = stack.pop()!;
        activePathIds.add(cur);
        const node = nodesRef.current.get(cur);
        if (node) stack.push(...node.childrenIds);
      }
    }
    nodesRef.current.forEach((n) => {
      if (!n.parentId) return;
      const p = nodesRef.current.get(n.parentId);
      if (!p) return;
      const a = Math.min(n.alpha, p.alpha);
      const active = activePathIds.has(n.id) && activePathIds.has(p.id);
      drawConnector(ctx, p, n, a, active);
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
    const z = zoomBehaviorRef.current;
    const initial = zoomIdentity.translate(sizeRef.current.w / 2, sizeRef.current.h / 2).scale(1);
    if (z) {
      select(canvas).transition().duration(450).call(z.transform, initial);
    } else {
      transformRef.current = initial;
    }
    // collapse all but root
    const root = Array.from(nodesRef.current.values()).find((n) => n.depth === 0);
    if (root) {
      Array.from(nodesRef.current.keys()).forEach((id) => {
        if (id !== root.id) nodesRef.current.delete(id);
      });
      root.childrenIds = [];
      root.expanded = false;
      focusNode(root);
    }
    setDirty();
  }, [focusNode]);

  // controls bar (zoom in/out + reset) — smooth d3 transitions
  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    const z = zoomBehaviorRef.current;
    if (!canvas || !z) return;
    select(canvas).transition().duration(300).call(z.scaleBy, factor);
  };

  const controls = useMemo(() => (
    <div className="absolute top-4 right-4 flex flex-col gap-1.5 z-10" data-testid="hierarchy-controls">
      <button
        onClick={() => zoomBy(1.3)}
        className="h-9 w-9 rounded-lg bg-white/85 backdrop-blur-md text-slate-700 hover:bg-white hover:text-slate-900 border border-slate-200/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 text-lg font-medium"
        data-testid="hierarchy-zoom-in"
        title="Zoom in"
      >+</button>
      <button
        onClick={() => zoomBy(1 / 1.3)}
        className="h-9 w-9 rounded-lg bg-white/85 backdrop-blur-md text-slate-700 hover:bg-white hover:text-slate-900 border border-slate-200/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 text-lg font-medium"
        data-testid="hierarchy-zoom-out"
        title="Zoom out"
      >−</button>
      <button
        onClick={reset}
        className="h-9 w-9 rounded-lg bg-white/85 backdrop-blur-md text-slate-700 hover:bg-white hover:text-slate-900 border border-slate-200/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 text-xs font-semibold"
        title="Reset view"
        data-testid="hierarchy-reset"
      >⟲</button>
    </div>
  ), [reset]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" data-testid="radial-canvas-container">
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
