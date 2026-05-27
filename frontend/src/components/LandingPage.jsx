import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Activity,
  Network,
  Radar,
  Boxes,
  CloudRain,
  TrendingUp,
  ShieldCheck,
  Truck,
  AlertTriangle,
  BrainCircuit,
  Receipt,
  MessageSquare,
  Eye,
  Zap,
  Compass,
} from "lucide-react";

// ---------------------------------------------------------------------------
// LIVE SIGNAL TICKER — rotates through curated FMCG intel events
// ---------------------------------------------------------------------------
const SIGNALS = [
  { tone: "amber", icon: AlertTriangle, label: "Stockout risk", body: "Lipton Yellow Label · Lagos · 3.1d remaining" },
  { tone: "moss",  icon: TrendingUp,    label: "Velocity spike", body: "OMO Detergent · +47% WoW · Maryland cluster" },
  { tone: "indigo",icon: CloudRain,     label: "Weather pressure", body: "Rain expected · Port Harcourt · +18% bouillon" },
  { tone: "amber", icon: Truck,         label: "Lane delay",       body: "Lagos → Ikeja · ETA +90 min · re-routing" },
  { tone: "moss",  icon: Activity,      label: "Anomaly cleared",  body: "Sunlight Powder · Abuja · velocity normalized" },
  { tone: "indigo",icon: Radar,         label: "Salary window",    body: "End of month · +22% expected lift" },
  { tone: "amber", icon: AlertTriangle, label: "Churn signal",     body: "Royal Hub · 12d no-order · health score 41" },
];

function useTicker(items, intervalMs = 2800) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), intervalMs);
    return () => clearInterval(t);
  }, [items.length, intervalMs]);
  return items[idx];
}

// ---------------------------------------------------------------------------
// TOPNAV
// ---------------------------------------------------------------------------
function Topnav() {
  return (
    <header className="sticky top-0 z-40 bg-paper/85 backdrop-blur-md border-b border-stone-200/60" data-testid="landing-topnav">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group" data-testid="brand-link">
          <div className="h-8 w-8 rounded-md bg-ink text-paper flex items-center justify-center font-display text-lg font-semibold">T</div>
          <span className="font-display text-xl tracking-tight">TradeKonekt</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-graphite">
          <a href="#platform" className="hover:text-ink transition-colors">Platform</a>
          <a href="#intelligence" className="hover:text-ink transition-colors">Intelligence</a>
          <a href="#network" className="hover:text-ink transition-colors">Network</a>
          <a href="#how-it-works" className="hover:text-ink transition-colors">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login" data-testid="signin-link">
            <Button variant="ghost" className="h-9 text-ink hover:bg-stone-100">Sign in</Button>
          </Link>
          <Link to="/login" data-testid="request-demo-cta">
            <Button className="h-9 bg-ink hover:bg-ink/90 text-paper">
              Request demo <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// HERO — left-aligned serif headline + right-side live signal card
// ---------------------------------------------------------------------------
function Hero() {
  const current = useTicker(SIGNALS, 2600);
  const Icon = current.icon;

  return (
    <section className="relative overflow-hidden" data-testid="landing-hero">
      {/* faint grid backdrop */}
      <div className="absolute inset-0 -z-10 bg-grid-fine opacity-60" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-paper via-paper to-paper/0 pointer-events-none" />

      <div className="max-w-[1280px] mx-auto px-6 md:px-10 pt-16 md:pt-24 pb-20 md:pb-28">
        {/* eyebrow */}
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-graphite mb-7 animate-fade-rise">
          <span className="relative flex h-2 w-2">
            <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-moss opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-moss"></span>
          </span>
          AI-native distribution intelligence · Now in POC with 500 retailers
        </div>

        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-16 items-start">
          {/* Left — headline */}
          <div className="animate-fade-rise" style={{ animationDelay: "60ms" }}>
            <h1 className="font-display text-[44px] leading-[1.04] sm:text-[58px] lg:text-[78px] tracking-[-0.02em]">
              Orchestrate national<br />
              distribution<span className="italic text-amber"> with intelligence</span><br />
              built in.
            </h1>
            <p className="mt-7 text-lg text-graphite max-w-xl leading-relaxed">
              TradeKonekt is the operating system for FMCG commerce networks —
              connecting one manufacturer, every distributor and every shelf into
              a single predictive, role-aware workspace.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/login" data-testid="hero-primary-cta">
                <Button className="h-12 px-6 bg-ink hover:bg-ink/90 text-paper text-base">
                  Enter your workspace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#platform" className="inline-flex items-center gap-2 text-ink font-medium px-3 h-12 group">
                See the platform
                <span className="h-7 w-7 rounded-full border border-stone-300 flex items-center justify-center group-hover:border-ink transition-colors">
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </a>
            </div>

            {/* mini metric strip */}
            <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 max-w-2xl">
              <MetricChip label="Connected retailers" value="3,080" />
              <MetricChip label="Distributor depots" value="91" />
              <MetricChip label="Daily signals" value="1.2k" />
              <MetricChip label="Anomaly latency" value="5 min" />
            </div>
          </div>

          {/* Right — Live signal card */}
          <div className="relative animate-fade-rise" style={{ animationDelay: "150ms" }}>
            <div className="absolute -inset-4 bg-gradient-to-br from-amber/8 via-transparent to-moss/8 rounded-3xl blur-xl -z-10" />
            <div className="rounded-2xl border border-stone-200 bg-white shadow-[0_28px_80px_-30px_rgba(10,10,10,0.18)] overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-200/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radar className="h-4 w-4 text-amber" />
                  <span className="font-display text-base">Live Intelligence Feed</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-graphite font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-moss animate-pulse"></span>
                  REAL-TIME
                </div>
              </div>
              <div className="p-5">
                <div key={current.body} className="animate-fade-rise">
                  <SignalCard signal={current} />
                </div>

                {/* stacked dim siblings */}
                <div className="mt-3 space-y-2.5 opacity-70">
                  {SIGNALS.slice(0, 3).filter(s => s.body !== current.body).slice(0, 2).map((s) => (
                    <SignalCard key={s.body} signal={s} dim />
                  ))}
                </div>

                {/* tiny chart */}
                <div className="mt-6 pt-5 border-t border-stone-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs uppercase tracking-widest text-graphite">Sales velocity · 14d</div>
                    <div className="text-xs text-moss font-mono font-medium">▲ 12.4%</div>
                  </div>
                  <Sparkline />
                </div>
              </div>
            </div>

            {/* floating chip */}
            <div className="hidden lg:flex absolute -left-6 -bottom-4 bg-ink text-paper rounded-xl px-4 py-3 shadow-2xl items-center gap-2.5 animate-fade-rise" style={{ animationDelay: "300ms" }}>
              <BrainCircuit className="h-4 w-4 text-amber" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-paper/60">Sabi · AI Copilot</div>
                <div className="text-sm font-medium">3 recommendations awaiting review</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricChip({ label, value }) {
  return (
    <div>
      <div className="font-display text-3xl text-ink leading-none">{value}</div>
      <div className="mt-1.5 text-xs uppercase tracking-wider text-graphite">{label}</div>
    </div>
  );
}

function SignalCard({ signal, dim = false }) {
  const Icon = signal.icon;
  const toneClass =
    signal.tone === "amber" ? "text-amber border-amber/30 bg-amber/5" :
    signal.tone === "moss" ? "text-moss border-moss/30 bg-moss/5" :
    "text-indigo border-indigo/20 bg-indigo/5";
  return (
    <div className={`rounded-lg border ${toneClass} px-3.5 py-3 ${dim ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="h-7 w-7 rounded-md bg-white border border-stone-200 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-medium">{signal.label}</div>
          <div className="text-sm text-ink mt-0.5 truncate">{signal.body}</div>
        </div>
      </div>
    </div>
  );
}

function Sparkline() {
  // tiny svg sparkline with subtle area fill
  const pts = [40, 38, 42, 47, 44, 50, 53, 49, 58, 62, 60, 68, 71, 76];
  const max = 80;
  const w = 320, h = 56;
  const step = w / (pts.length - 1);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - (p / max) * h}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F766E" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0F766E" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-grad)" />
      <path d={path} fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - (pts[pts.length - 1] / max) * h} r="3" fill="#0F766E" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LOGO STRIP — credibility row
// ---------------------------------------------------------------------------
function TrustStrip() {
  const items = [
    "Unilever Nigeria", "Lagos Distribution", "Abuja Hub",
    "Port Harcourt Lane", "500-retailer POC", "AI-Native",
  ];
  return (
    <section className="border-y border-stone-200 bg-paper/60" data-testid="trust-strip">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10 py-6 overflow-hidden">
        <div className="flex items-center gap-4 mb-3">
          <span className="text-[11px] uppercase tracking-[0.18em] text-graphite">Built for the rollout</span>
          <span className="flex-1 h-px bg-stone-200" />
        </div>
        <div className="overflow-hidden">
          <div className="flex items-center gap-12 animate-marquee whitespace-nowrap" style={{ width: "max-content" }}>
            {[...items, ...items].map((it, i) => (
              <div key={i} className="font-display text-2xl text-graphite/60 tracking-tight">{it}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PLATFORM PILLARS
// ---------------------------------------------------------------------------
function Pillars() {
  const pillars = [
    {
      icon: BrainCircuit,
      tag: "Intelligence",
      title: "Predictive intelligence, not just dashboards.",
      body: "Stockout forecasts, anomaly detection, weather + holiday correlations, retailer health scoring — all stream into a role-aware feed updated every five minutes.",
      points: ["Forecasts with confidence bands", "Salary-window + weather signals", "5-min anomaly latency"],
      tone: "amber",
    },
    {
      icon: Network,
      tag: "Orchestration",
      title: "One workspace, every node in the chain.",
      body: "Manufacturer, distributor and retailer act in the same data plane. Shipments, stock requests and inventory move through a single state machine — Pending → In Transit → Received.",
      points: ["91 distributors + 3,080 retailers", "Atomic inventory & shipment lifecycle", "Role-scoped multi-tenancy"],
      tone: "moss",
    },
    {
      icon: Receipt,
      tag: "Retail workflows",
      title: "POS-grade tools for the shop floor.",
      body: "Sales Book captures every transaction with inventory deduction, payment mix and a Sabi copilot that listens, transcribes and acts — bringing the retailer into the conversation.",
      points: ["POS-style multi-item sale", "Voice-first AI assistant", "Auto-restock recommendations"],
      tone: "indigo",
    },
  ];

  return (
    <section id="platform" className="py-24 md:py-28" data-testid="pillars-section">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10">
        <SectionEyebrow>The platform</SectionEyebrow>
        <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tight max-w-3xl mt-3">
          Three systems<span className="italic text-amber"> braided</span> into one.
        </h2>
        <p className="mt-5 text-graphite text-lg max-w-2xl">
          TradeKonekt is a unified plane for intelligence, orchestration and shop-floor execution — not a stack of tools you have to glue together.
        </p>

        <div className="mt-14 grid md:grid-cols-3 gap-5">
          {pillars.map((p, i) => (
            <PillarCard key={p.title} pillar={p} delay={i * 80} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PillarCard({ pillar, delay = 0 }) {
  const Icon = pillar.icon;
  const accent =
    pillar.tone === "amber" ? "text-amber" :
    pillar.tone === "moss" ? "text-moss" : "text-indigo";
  return (
    <article
      className="relative group rounded-2xl border border-stone-200 bg-white p-7 hover:border-ink/40 hover:shadow-[0_20px_60px_-30px_rgba(10,10,10,0.18)] transition-all duration-300 animate-fade-rise"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-medium ${accent}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current`}></span>
          {pillar.tag}
        </span>
        <Icon className={`h-5 w-5 ${accent} opacity-90`} />
      </div>
      <h3 className="font-display text-2xl tracking-tight mt-5 leading-snug">{pillar.title}</h3>
      <p className="text-graphite text-sm leading-relaxed mt-3">{pillar.body}</p>
      <ul className="mt-6 space-y-2.5 border-t border-stone-200 pt-5">
        {pillar.points.map((pt) => (
          <li key={pt} className="text-sm flex items-start gap-2 text-ink/80">
            <span className={`mt-1.5 h-1 w-3 rounded-full bg-current ${accent} flex-shrink-0`} />
            {pt}
          </li>
        ))}
      </ul>
    </article>
  );
}

function SectionEyebrow({ children }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.22em] text-graphite font-medium flex items-center gap-2">
      <span className="h-px w-8 bg-graphite/50" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DASHBOARD PREVIEW — animated mocked workspace
// ---------------------------------------------------------------------------
function DashboardPreview() {
  return (
    <section id="intelligence" className="relative py-24 md:py-32 bg-ink text-paper overflow-hidden" data-testid="dashboard-preview">
      <div className="absolute inset-0 opacity-[0.06] bg-grid-fine" />
      <div className="absolute -top-40 -right-40 h-[480px] w-[480px] rounded-full bg-amber/12 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 h-[480px] w-[480px] rounded-full bg-moss/10 blur-3xl" />

      <div className="max-w-[1280px] mx-auto px-6 md:px-10 relative">
        <div className="grid lg:grid-cols-[1fr_1.3fr] gap-14 items-center">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-paper/55 font-medium flex items-center gap-2">
              <span className="h-px w-8 bg-paper/30" /> Intelligence center
            </div>
            <h2 className="font-display text-4xl md:text-5xl tracking-tight mt-3 leading-[1.05]">
              The signal your network<br />
              <span className="italic text-amber">already had</span>, surfaced.
            </h2>
            <p className="mt-5 text-paper/70 text-lg leading-relaxed max-w-md">
              An always-on intelligence layer narrates what's happening across
              the network — and recommends the next move with confidence bands
              and impact estimates.
            </p>

            <div className="mt-10 space-y-3">
              {[
                { icon: Eye, t: "12 signal streams", s: "Forecasts · Anomalies · Health · Logistics · Weather" },
                { icon: Zap, t: "Scope-aware filtering", s: "Distributors see only their lane. Retailers see only themselves." },
                { icon: Compass, t: "Recommendations with intent", s: "Each insight ships with urgency · confidence · projected impact." },
              ].map((b, i) => {
                const Icon = b.icon;
                return (
                  <div key={b.t} className="flex items-start gap-3 animate-fade-rise" style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="h-9 w-9 rounded-md bg-white/8 border border-white/12 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-amber" />
                    </div>
                    <div>
                      <div className="font-medium">{b.t}</div>
                      <div className="text-sm text-paper/60">{b.s}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mocked dashboard panel */}
          <div className="relative">
            <div className="absolute -inset-6 bg-amber/8 blur-3xl rounded-3xl -z-0" />
            <div className="relative rounded-2xl bg-paper text-ink shadow-2xl overflow-hidden border border-stone-200/40">
              {/* fake window header */}
              <div className="px-4 py-2.5 border-b border-stone-200 flex items-center gap-1.5 bg-stone-50">
                <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
                <span className="ml-3 text-xs font-mono text-graphite">workspace.tradekonekt.com/intel</span>
              </div>

              <div className="p-5 grid grid-cols-12 gap-4">
                {/* KPI ROW */}
                {[
                  { l: "Active distributors", v: "91", d: "↑ +3 vs last wk", tone: "moss" },
                  { l: "Retailers at risk",   v: "27", d: "↓ 8 cleared",     tone: "amber" },
                  { l: "ETA confidence",      v: "94%", d: "lane health",    tone: "indigo" },
                ].map((k) => (
                  <div key={k.l} className="col-span-4 rounded-lg border border-stone-200 px-3.5 py-3 bg-white">
                    <div className="text-[10px] uppercase tracking-wider text-graphite">{k.l}</div>
                    <div className="font-display text-2xl mt-1">{k.v}</div>
                    <div className={`text-[11px] mt-1 font-mono ${k.tone === "moss" ? "text-moss" : k.tone === "amber" ? "text-amber" : "text-indigo"}`}>{k.d}</div>
                  </div>
                ))}

                {/* chart card */}
                <div className="col-span-7 rounded-lg border border-stone-200 p-4 bg-white">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Network sales velocity</div>
                    <div className="text-xs text-graphite font-mono">14d</div>
                  </div>
                  <NetworkVelocityChart />
                </div>

                {/* alerts list */}
                <div className="col-span-5 rounded-lg border border-stone-200 p-4 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium">Alerts</div>
                    <div className="text-[11px] text-graphite font-mono">SCOPE · MFG</div>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { t: "Lipton · Lagos · stockout in 3.1d", tone: "amber" },
                      { t: "Sunlight · Abuja · velocity spike", tone: "moss" },
                      { t: "Royco · Kano · churn risk", tone: "indigo" },
                    ].map((a) => (
                      <div key={a.t} className="flex items-center gap-2 text-xs">
                        <span className={`h-2 w-2 rounded-full ${a.tone === "amber" ? "bg-amber" : a.tone === "moss" ? "bg-moss" : "bg-indigo"}`} />
                        <span className="truncate text-ink">{a.t}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sabi narration */}
                <div className="col-span-12 rounded-lg border border-stone-200 p-4 bg-gradient-to-br from-amber/5 to-paper">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-md bg-ink text-paper flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-amber" />
                    </div>
                    <div className="flex-1">
                      <div className="text-[11px] uppercase tracking-wider text-graphite">Sabi · Executive Brief</div>
                      <div className="text-sm text-ink mt-1">
                        Lagos region is running hot — OMO and Lipton velocity is up <span className="font-mono">+47%</span> WoW.
                        Three retailers will deplete Lipton by Friday. Pre-positioning 1,200 units from Abuja depot
                        increases service level to <span className="font-mono">98.4%</span>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function NetworkVelocityChart() {
  // multi-series area chart, hand-rolled SVG so it stays light & on-brand
  const w = 380, h = 130;
  const series = {
    Lagos:   [22, 28, 30, 27, 35, 41, 39, 46, 52, 49, 58, 64, 70, 78],
    Abuja:   [18, 20, 22, 24, 23, 27, 30, 28, 32, 34, 37, 38, 42, 44],
    Kano:    [12, 13, 14, 13, 16, 15, 18, 19, 17, 22, 24, 23, 26, 28],
  };
  const max = 90;
  const colors = { Lagos: "#D97706", Abuja: "#0F766E", Kano: "#1E1B4B" };
  const lines = Object.entries(series).map(([k, pts]) => {
    const step = w / (pts.length - 1);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - (p / max) * h}`).join(" ");
    return { key: k, d, color: colors[k] };
  });
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32 mt-2">
        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1="0" x2={w} y1={h * p} y2={h * p} stroke="#E5E5E0" strokeWidth="1" />
        ))}
        {lines.map((l) => (
          <path key={l.key} d={l.d} fill="none" stroke={l.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {lines.map((l) => {
          const pts = series[l.key];
          const step = w / (pts.length - 1);
          return (
            <circle key={l.key + "-d"} cx={(pts.length - 1) * step} cy={h - (pts[pts.length - 1] / max) * h} r="3" fill={l.color} />
          );
        })}
      </svg>
      <div className="flex items-center gap-3 text-xs mt-2">
        {Object.entries(colors).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5 text-graphite">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            {k}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOW IT WORKS — 4-step pipeline
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    { n: "01", t: "Sense",     d: "Ingest every shipment, stock movement, sale and external signal — weather, holidays, salary windows.", icon: Radar },
    { n: "02", t: "Predict",   d: "Forecast stockouts with EWMA + day-of-week seasonality. Detect anomalies with rolling z-scores.", icon: BrainCircuit },
    { n: "03", t: "Recommend", d: "Generate role-aware recommendations with urgency, confidence and projected impact.", icon: Compass },
    { n: "04", t: "Act",       d: "One-tap dispatch, restock, or escalate to Sabi for a narrated next-step plan.", icon: Zap },
  ];
  return (
    <section id="how-it-works" className="py-24 md:py-28" data-testid="how-it-works">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10">
        <SectionEyebrow>The loop</SectionEyebrow>
        <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tight max-w-3xl mt-3">
          Sense. Predict. Recommend.<span className="italic text-amber"> Act.</span>
        </h2>

        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.n}
                className="group relative rounded-xl border border-stone-200 bg-white p-6 hover:border-ink/30 transition-colors animate-fade-rise"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-graphite tracking-widest">{s.n}</span>
                  <Icon className="h-4 w-4 text-amber" />
                </div>
                <div className="font-display text-2xl mt-4 tracking-tight">{s.t}</div>
                <p className="mt-2 text-sm text-graphite leading-relaxed">{s.d}</p>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 -translate-y-1/2 text-stone-300">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CAPABILITY MATRIX
// ---------------------------------------------------------------------------
function CapabilityMatrix() {
  const items = [
    { i: Boxes,         t: "Inventory ledger" },
    { i: Truck,         t: "Shipment lifecycle" },
    { i: MessageSquare, t: "Stock requests" },
    { i: Receipt,       t: "POS Sales Book" },
    { i: BrainCircuit,  t: "AI Copilot · Sabi" },
    { i: Radar,         t: "Anomaly detection" },
    { i: TrendingUp,    t: "Stockout forecasts" },
    { i: CloudRain,     t: "Weather signals" },
    { i: ShieldCheck,   t: "Role-scoped tenancy" },
    { i: Network,       t: "Network graph" },
    { i: Activity,      t: "Retailer health" },
    { i: Sparkles,      t: "Voice ordering" },
  ];
  return (
    <section id="network" className="py-24 md:py-28 bg-stone-50/60 border-y border-stone-200" data-testid="capabilities">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <SectionEyebrow>Capabilities</SectionEyebrow>
            <h2 className="font-display text-4xl md:text-5xl tracking-tight mt-3 max-w-2xl">
              Twelve native modules.<br /><span className="italic text-amber">Zero glue code.</span>
            </h2>
          </div>
          <p className="text-graphite text-base max-w-sm">
            All built on FastAPI · MongoDB · React — designed to scale from a 500-retailer POC to a national rollout without rewrites.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it) => {
            const Icon = it.i;
            return (
              <div key={it.t} className="rounded-lg border border-stone-200 bg-white p-4 hover:border-ink/30 hover:bg-paper transition-colors group cursor-default">
                <Icon className="h-4 w-4 text-graphite group-hover:text-amber transition-colors" />
                <div className="mt-3 text-sm font-medium text-ink">{it.t}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA + FOOTER
// ---------------------------------------------------------------------------
function FinalCTA() {
  return (
    <section className="py-24 md:py-32" data-testid="final-cta">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10">
        <div className="relative rounded-3xl bg-ink text-paper overflow-hidden p-10 md:p-16">
          <div className="absolute inset-0 opacity-[0.08] bg-grid-fine" />
          <div className="absolute -top-32 -right-32 h-[400px] w-[400px] rounded-full bg-amber/15 blur-3xl" />
          <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
            <div>
              <SectionEyebrowDark>Ready when you are</SectionEyebrowDark>
              <h2 className="font-display text-4xl md:text-6xl tracking-tight mt-4 leading-[1.04]">
                Run the next 500-retailer<br />
                rollout on <span className="italic text-amber">TradeKonekt</span>.
              </h2>
              <p className="mt-5 text-paper/75 text-base max-w-md">
                Sign in to the demo workspace to see live signals from a connected Nigerian distribution network.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <Link to="/login" data-testid="footer-cta-enter">
                <Button className="h-12 px-6 bg-amber hover:bg-amber/90 text-ink text-base font-semibold">
                  Enter the workspace <ArrowUpRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link to="/login" data-testid="footer-cta-signin" className="text-sm text-paper/70 hover:text-paper">
                or sign in with your email
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionEyebrowDark({ children }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.22em] text-paper/55 font-medium flex items-center gap-2">
      <span className="h-px w-8 bg-paper/30" />
      {children}
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-paper py-10" data-testid="landing-footer">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-ink text-paper flex items-center justify-center font-display text-base font-semibold">T</div>
          <span className="font-display text-lg tracking-tight">TradeKonekt</span>
        </div>
        <div className="text-xs text-graphite">
          © {new Date().getFullYear()} TradeKonekt · Distribution intelligence for commerce networks
        </div>
        <div className="flex items-center gap-5 text-xs text-graphite">
          <a href="#platform" className="hover:text-ink">Platform</a>
          <a href="#intelligence" className="hover:text-ink">Intelligence</a>
          <Link to="/login" className="hover:text-ink">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans" data-testid="landing-page">
      <Topnav />
      <Hero />
      <TrustStrip />
      <Pillars />
      <DashboardPreview />
      <HowItWorks />
      <CapabilityMatrix />
      <FinalCTA />
      <Footer />
    </div>
  );
}
