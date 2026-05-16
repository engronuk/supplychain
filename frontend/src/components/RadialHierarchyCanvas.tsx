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

// Root-level children (regions) get distributed evenly on an absolute circle.
// Deeper levels switch to *orbital* clustering around their parent for cohesion.
const ROOT_RING = 240;

// Adaptive orbital parameters per child level (depth of the children, not parent).
// baseOrbit: minimum distance from parent at that child level
// growth: orbit grows with child-count beyond this many siblings
const ORBIT_BY_DEPTH: Record<number, { baseOrbit: number; growth: number; maxOrbit: number; minFan: number; maxFan: number }> = {
  2: { baseOrbit: 140, growth: 6,  maxOrbit: 220, minFan: Math.PI * 0.55, maxFan: Math.PI * 1.05 }, // state
  3: { baseOrbit: 110, growth: 5,  maxOrbit: 180, minFan: Math.PI * 0.55, maxFan: Math.PI * 1.00 }, // distributor
  4: { baseOrbit: 70,  growth: 4,  maxOrbit: 130, minFan: Math.PI * 0.50, maxFan: Math.PI * 0.95 }, // retailer
};

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

  /** Compute orbit + fan for a sibling group of given size. */
  function computeOrbit(depth: number, count: number, nodeR: number): { orbit: number; fan: number } {
    const cfg = ORBIT_BY_DEPTH[depth] || ORBIT_BY_DEPTH[4];
    // Fan width grows with sibling count (compact for few, wider for many)
    let fan = cfg.minFan;
    if (count > 3) fan = cfg.minFan + (count - 3) * 0.045;
    fan = Math.max(cfg.minFan, Math.min(cfg.maxFan, fan));

    // Orbit radius grows with count to keep arc-length per sibling sane
    let orbit = cfg.baseOrbit + Math.max(0, count - 4) * cfg.growth;

    // Collision-aware: ensure tangential spacing >= 2 * (nodeR + padding)
    if (count > 1) {
      const step = fan / count;
      const required = 2 * (nodeR + 10);
      const tangential = step * orbit;
      if (tangential < required) {
        orbit = Math.min(cfg.maxOrbit, required / step);
      }
    }
    return { orbit, fan };
  }

  const setTargetsForNode = useCallback((n: CanvasNode) => {
    n.tr = NODE_SIZES[n.data.type] || 8;
    // Root node sits at origin
    if (n.depth === 0) {
      n.tx = 0;
      n.ty = 0;
    }
    // For non-root, targets are set by placeChildren (orbital). This function
    // only ensures defaults exist for newly-created nodes prior to placement.
  }, []);

  const placeChildren = useCallback((parent: CanvasNode, children: HierarchyNode[]) => {
    const N = children.length;
    if (N === 0) return;
    const now = performance.now();
    const isRoot = parent.depth === 0;
    const childDepth = parent.depth + 1;
    const childType = children[0].type;
    const childR = NODE_SIZES[childType] || 8;

    // --- Compute angular layout per parent ---
    let baseAngle: number;     // mid direction for the fan
    let fanWidth: number;      // total angular span
    let orbitRadius: number;   // distance from parent to children
    let absoluteRing = false;  // if true, position relative to origin (root case)

    if (isRoot) {
      // Distribute regions evenly on an absolute ring around manufacturer
      baseAngle = 0;
      fanWidth = Math.PI * 2;
      orbitRadius = ROOT_RING;
      absoluteRing = true;
    } else {
      // Outward direction from origin through parent — children fan out this way
      const pAngle = Math.atan2(parent.ty || parent.y, parent.tx || parent.x);
      baseAngle = isFinite(pAngle) ? pAngle : parent.angle;
      const { orbit, fan } = computeOrbit(childDepth, N, childR);
      orbitRadius = orbit;
      fanWidth = fan;
    }

    // --- Place each child ---
    const step = N > 1 ? fanWidth / N : 0;
    const startAngle = baseAngle - fanWidth / 2 + step / 2;

    children.forEach((c, i) => {
      if (nodesRef.current.has(c.id)) return;
      // For root, an even ring requires step = 2π/N (no half-step centering needed)
      const childAngle = absoluteRing
        ? -Math.PI + ((i + 0.5) * (Math.PI * 2)) / N
        : (N === 1 ? baseAngle : startAngle + i * step);

      // Position: orbital around parent (or on absolute ring for root)
      let tx: number, ty: number;
      if (absoluteRing) {
        tx = Math.cos(childAngle) * orbitRadius;
        ty = Math.sin(childAngle) * orbitRadius;
      } else {
        tx = parent.tx + Math.cos(childAngle) * orbitRadius;
        ty = parent.ty + Math.sin(childAngle) * orbitRadius;
      }

      // Track angular slot for further nested expansion (descendants fan from this direction)
      const slotHalf = absoluteRing
        ? Math.PI / Math.max(N, 1)
        : (step / 2 || fanWidth / 2);

      const node: CanvasNode = {
        id: c.id,
        parentId: parent.id,
        data: c,
        depth: childDepth,
        a0: childAngle - slotHalf,
        a1: childAngle + slotHalf,
        angle: childAngle,
        // appear at parent's current position then animate out
        x: parent.x, y: parent.y, r: 0, alpha: 0,
        tx, ty,
        tr: NODE_SIZES[c.type] || 8,
        talpha: REST_ALPHA,
        expanded: false, loading: false,
        childrenIds: [],
        born: now + i * 14,
      };
      nodesRef.current.set(c.id, node);
      parent.childrenIds.push(c.id);
    });

    // --- Sibling-pair collision relaxation (a couple of light passes) ---
    if (!absoluteRing && parent.childrenIds.length > 1) {
      const sibs = parent.childrenIds
        .map((id) => nodesRef.current.get(id))
        .filter(Boolean) as CanvasNode[];
      relaxSiblings(sibs, parent, childR);
    }

    setDirty();
  }, []);

  /**
   * Light relaxation: if two siblings are closer than (2r + pad) we nudge them
   * tangentially along the orbit. Only operates on a single sibling group.
   */
  function relaxSiblings(sibs: CanvasNode[], parent: CanvasNode, childR: number) {
    const pad = 14;
    const minDist = 2 * childR + pad;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (let i = 0; i < sibs.length; i++) {
        for (let j = i + 1; j < sibs.length; j++) {
          const a = sibs[i], b = sibs[j];
          const dx = b.tx - a.tx, dy = b.ty - a.ty;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < minDist) {
            // Move each along its own tangent (perpendicular to its radial from parent)
            const push = (minDist - d) / 2;
            const tangent = (n: CanvasNode, sign: number) => {
              const rx = n.tx - parent.tx, ry = n.ty - parent.ty;
              const rl = Math.hypot(rx, ry) || 1;
              // tangent = perpendicular to radial; choose direction toward "away" side
              const tx = -ry / rl, ty = rx / rl;
              n.tx += tx * push * sign;
              n.ty += ty * push * sign;
              // keep them roughly on the orbit (re-normalize distance to parent)
              const nx = n.tx - parent.tx, ny = n.ty - parent.ty;
              const nl = Math.hypot(nx, ny) || 1;
              const target = rl; // preserve original orbit distance
              n.tx = parent.tx + (nx / nl) * target;
              n.ty = parent.ty + (ny / nl) * target;
              n.angle = Math.atan2(ny, nx);
            };
            tangent(a, -1);
            tangent(b, +1);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

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
    ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    // Single subtle ring marking the root's children orbit
    ctx.beginPath();
    ctx.arc(0, 0, ROOT_RING, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawConnector(ctx: CanvasRenderingContext2D, a: CanvasNode, b: CanvasNode, alpha: number, active: boolean) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Adaptive curvature: short orbital edges get cleaner near-straight lines;
    // longer edges curve gently for a grouped micro-network feel.
    const perp = Math.max(0.04, Math.min(0.16, dist / 1800));
    const cx1 = a.x + dx * 0.4 - dy * perp * 0.45;
    const cy1 = a.y + dy * 0.4 + dx * perp * 0.45;
    const cx2 = b.x - dx * 0.4 - dy * perp * 0.45;
    const cy2 = b.y - dy * 0.4 + dx * perp * 0.45;
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
