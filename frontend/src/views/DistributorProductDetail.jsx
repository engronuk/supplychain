import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, Package, Hash, Tag, Sparkles, TrendingUp, TrendingDown,
  AlertOctagon, AlertTriangle, Clock, ShieldCheck, Trophy, Info, Search,
  Zap, Activity, Box, MapPin,
} from "lucide-react";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const INSIGHT_ICONS = {
  "trending-up": TrendingUp, "trending-down": TrendingDown, "sparkles": Sparkles,
  "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle, "clock": Clock,
  "shield-check": ShieldCheck, "trophy": Trophy, "info": Info,
};

const TIER_TONE = {
  overstocked: { chip: "bg-blue-50 text-blue-700 border-blue-200", dot: "#3b82f6", label: "Overstocked" },
  healthy: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "#10b981", label: "Healthy" },
  understocked: { chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "#f59e0b", label: "Understocked" },
  critical: { chip: "bg-rose-50 text-rose-700 border-rose-200", dot: "#ef4444", label: "Critical" },
};

export default function DistributorProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.entity?.id || !productId) return;
    setLoading(true);
    Api.distributorProductDetail(session.entity.id, productId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [session?.entity?.id, productId]);

  if (loading) return <div className="p-8 text-slate-500">Loading product intelligence…</div>;
  if (!data) return <div className="p-8 text-rose-600">Product not found.</div>;

  const { product, overview, revenue_analytics, shop_distribution,
          stock_intelligence, performance, ai_insights } = data;
  const tone = TIER_TONE[overview.stock_status] || TIER_TONE.healthy;

  return (
    <div className="p-6 lg:p-8 max-w-[1500px] mx-auto" data-testid="product-detail">
      {/* Header */}
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 mb-2 transition-colors">
        <ChevronLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-sm">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight text-slate-900">{product.name}</h1>
              <div className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{product.sku}</span>
                <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{product.category}</span>
                <span className="text-slate-400">Unit Price: <span className="text-slate-700 font-medium">{fmtMoney(product.unit_price)}</span></span>
              </div>
            </div>
          </div>
        </div>
        <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${tone.chip}`}>
          <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: tone.dot }} />
          {tone.label}
        </Badge>
      </div>

      {ai_insights.length > 0 && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="product-ai-insights">
          {ai_insights.slice(0, 3).map((ins, i) => <InsightCard key={i} insight={ins} />)}
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-white border border-slate-200/80 p-1 rounded-2xl shadow-sm">
          <TabsTrigger value="overview" data-testid="ptab-overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue" data-testid="ptab-revenue">Revenue Analytics</TabsTrigger>
          <TabsTrigger value="distribution" data-testid="ptab-distribution">Shop Distribution</TabsTrigger>
          <TabsTrigger value="stock" data-testid="ptab-stock">Stock Intelligence</TabsTrigger>
          <TabsTrigger value="performance" data-testid="ptab-performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab product={product} overview={overview} performance={performance} /></TabsContent>
        <TabsContent value="revenue"><RevenueTab analytics={revenue_analytics} /></TabsContent>
        <TabsContent value="distribution"><DistributionTab shops={shop_distribution} /></TabsContent>
        <TabsContent value="stock"><StockIntelTab intel={stock_intelligence} overview={overview} /></TabsContent>
        <TabsContent value="performance"><PerformanceTab performance={performance} overview={overview} analytics={revenue_analytics} /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ product, overview, performance }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <Card className="lg:col-span-1">
        <CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Product Identity</div>
          <Row label="Name" value={product.name} />
          <Row label="SKU" value={product.sku} mono />
          <Row label="Barcode" value={product.barcode || "—"} mono />
          <Row label="Category" value={product.category} />
          <Row label="Unit Price" value={fmtMoney(product.unit_price)} />
        </CardContent>
      </Card>
      <div className="lg:col-span-2 grid grid-cols-2 gap-3">
        <KPI label="Current Inventory" value={overview.current_inventory.toLocaleString()} sub={`reorder @ ${overview.reorder_level}`} tone="indigo" />
        <KPI label="Total Revenue" value={fmtMoney(overview.total_revenue)} sub="last 90 days" tone="emerald" />
        <KPI label="Avg Daily Sales" value={overview.avg_daily_sales} sub="units / day" tone="blue" />
        <KPI label="Shops Stocking" value={overview.shops_stocking} sub={`${overview.shops_healthy} healthy`} tone="slate" />
        <Card className="col-span-2"><CardContent className="p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Stock Health Across Shops</div>
          <div className="grid grid-cols-4 gap-3">
            <Mini color="#3b82f6" label="Overstocked" value={overview.shops_overstocked} />
            <Mini color="#10b981" label="Healthy" value={overview.shops_healthy} />
            <Mini color="#f59e0b" label="Understocked" value={overview.shops_understocked} />
            <Mini color="#ef4444" label="Critical" value={overview.shops_critical} />
          </div>
        </CardContent></Card>
        <Card className="col-span-2"><CardContent className="p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Velocity</div>
          <div className="flex items-center gap-3">
            {performance.fast_moving && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><Zap className="h-3 w-3 mr-1" />Fast-moving</Badge>}
            {performance.slow_moving && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><Clock className="h-3 w-3 mr-1" />Slow-moving</Badge>}
            <span className="text-[12px] text-slate-500">{performance.last_30_units} units sold in last 30 days</span>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

function RevenueTab({ analytics }) {
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Monthly Revenue Trend</div>
        {analytics.monthly_trend.length === 0 ? <Empty msg="No sales recorded yet." /> :
          <BarRow data={analytics.monthly_trend} field="revenue" label="month" color="#6366f1" formatter={fmtMoney} />}
      </CardContent></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Revenue by Region</div>
          {analytics.region_breakdown.length === 0 ? <Empty msg="No regional data yet." /> :
            <BarList data={analytics.region_breakdown} valueKey="revenue" nameKey="region" color="#3b82f6" formatter={fmtMoney} />}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Top Retail Shops</div>
          {analytics.top_retailers.length === 0 ? <Empty msg="No retailer revenue yet." /> :
            <BarList data={analytics.top_retailers.slice(0, 8)} valueKey="revenue" nameKey="name" color="#10b981" formatter={fmtMoney} />}
        </CardContent></Card>
      </div>
    </div>
  );
}

function DistributionTab({ shops }) {
  const [tierFilter, setTierFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return shops.filter((x) => (tierFilter === "all" || x.tier === tierFilter)
      && (!s || (x.retailer_name || "").toLowerCase().includes(s) || (x.city || "").toLowerCase().includes(s)));
  }, [shops, tierFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shop or city…" className="pl-9 w-72" />
        </div>
        {["all", "critical", "understocked", "healthy", "overstocked"].map((k) =>
          <Pill key={k} label={k} active={tierFilter === k} onClick={() => setTierFilter(k)} />)}
        <div className="ml-auto text-xs text-slate-500">{filtered.length} shops</div>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Retailer</TableHead><TableHead>Region</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Reorder</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4">Last Restock</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">No shops match.</TableCell></TableRow>}
            {filtered.map((s) => {
              const t = TIER_TONE[s.tier];
              return (
                <TableRow key={s.retailer_id} className="hover:bg-slate-50/50">
                  <TableCell><div className="font-medium text-slate-900">{s.retailer_name}</div>
                    <div className="text-[11px] text-slate-500">{s.city || "—"}</div></TableCell>
                  <TableCell className="text-slate-600 text-[12.5px]"><MapPin className="h-3 w-3 inline mr-1" />{s.region || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{s.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">{s.reorder_level}</TableCell>
                  <TableCell><Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${t.chip}`}>
                    <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: t.dot }} />{t.label}</Badge></TableCell>
                  <TableCell className="text-[12px] text-slate-600 pr-4">{fmtDate(s.last_restock)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

function StockIntelTab({ intel, overview }) {
  const total = overview.shops_stocking || 1;
  const data = [
    { tier: "overstocked", count: intel.buckets.overstocked, color: "#3b82f6" },
    { tier: "healthy", count: intel.buckets.healthy, color: "#10b981" },
    { tier: "understocked", count: intel.buckets.understocked, color: "#f59e0b" },
    { tier: "critical", count: intel.buckets.critical, color: "#ef4444" },
  ];
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Stock Distribution Heatmap</div>
        <div className="flex rounded-xl overflow-hidden h-9">
          {data.map((d) => d.count > 0 && (
            <div key={d.tier} className="flex items-center justify-center text-[11px] font-semibold text-white"
                 style={{ width: `${(d.count / total) * 100}%`, background: d.color }} title={`${d.tier}: ${d.count}`}>
              {d.count > 1 ? `${d.count}` : ""}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {data.map((d) => <Mini key={d.tier} color={d.color} label={d.tier} value={d.count} />)}
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Smart Recommendations</div>
        {intel.recommendations.length === 0 ? <div className="text-[12px] text-slate-500 py-6 text-center">No urgent action — stock distribution looks balanced.</div> :
          <div className="space-y-2">{intel.recommendations.map((rec, i) => <InsightRow key={i} insight={{ tone: rec.tone, title: rec.title, detail: rec.detail, icon: rec.tone === "critical" ? "alert-octagon" : rec.tone === "warning" ? "alert-triangle" : "info" }} />)}</div>}
      </CardContent></Card>
    </div>
  );
}

function PerformanceTab({ performance, overview, analytics }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="30-Day Units" value={performance.last_30_units} tone="indigo" />
        <KPI label="Avg Daily Sales" value={overview.avg_daily_sales} sub="units / day" tone="blue" />
        <KPI label="Most Requested" value={`${performance.most_requested_units} units`} tone="amber" sub="from retailer requests" />
        <KPI label="Shops Stocking" value={overview.shops_stocking} sub="total presence" tone="slate" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Tag2 active={performance.fast_moving} Icon={Zap} label="Fast Moving" color="emerald" desc="Avg daily sales ≥ 5 units" />
        <Tag2 active={performance.slow_moving} Icon={Clock} label="Slow Moving" color="amber" desc="Avg daily sales < 1 unit" />
        <Tag2 active={performance.most_requested_units > 0} Icon={Activity} label="Most Requested" color="indigo" desc={`${performance.most_requested_units} pending units across retailer requests`} />
        <Tag2 active={analytics.top_retailers.length > 0} Icon={Trophy} label="Highest Revenue" color="blue" desc={analytics.top_retailers[0] ? `${analytics.top_retailers[0].name} — ${fmtMoney(analytics.top_retailers[0].revenue)}` : "—"} />
      </div>
    </div>
  );
}

// ============ shared blocks ============
function Row({ label, value, mono }) {
  return <div className="flex items-start gap-2 py-1.5 text-[12.5px]">
    <div className="text-slate-500 w-24 flex-shrink-0">{label}</div>
    <div className={`text-slate-900 font-medium ${mono ? "font-mono text-[11.5px]" : ""}`}>{value}</div>
  </div>;
}

function KPI({ label, value, sub, tone = "slate" }) {
  const tones = {
    slate: "from-slate-50 to-white", emerald: "from-emerald-50 to-white",
    indigo: "from-indigo-50 to-white", amber: "from-amber-50 to-white",
    rose: "from-rose-50 to-white", blue: "from-blue-50 to-white",
  };
  return <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${tones[tone]} p-3.5`}>
    <div className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500 font-semibold">{label}</div>
    <div className="text-[19px] font-bold text-slate-900 mt-1">{value}</div>
    {sub && <div className="text-[10.5px] text-slate-500 mt-0.5">{sub}</div>}
  </div>;
}

function Mini({ color, label, value }) {
  return <div className="rounded-xl bg-white border border-slate-200/70 p-3">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{label}
    </div>
    <div className="text-[18px] font-bold text-slate-900 mt-0.5">{value}</div>
  </div>;
}

function Pill({ label, active, onClick }) {
  return <button onClick={onClick}
    className={`inline-flex items-center h-8 px-3 rounded-full border text-[12px] font-medium capitalize transition-colors
      ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:text-slate-900"}`}>{label}</button>;
}

function Empty({ msg }) {
  return <div className="text-[12.5px] text-slate-500 py-8 text-center">{msg}</div>;
}

function BarRow({ data, field, label, color, formatter }) {
  const max = Math.max(...data.map((d) => d[field]), 1);
  return <div className="space-y-2">
    {data.map((d, i) => (
      <div key={i}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] text-slate-600">{d[label]}</span>
          <span className="text-[12px] font-semibold tabular-nums">{formatter(d[field])}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${(d[field] / max) * 100}%`, background: color }} />
        </div>
      </div>
    ))}
  </div>;
}

function BarList({ data, valueKey, nameKey, color, formatter }) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  return <div className="space-y-2">
    {data.map((d, i) => (
      <div key={i}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12.5px] text-slate-700 truncate flex-1 mr-2">{d[nameKey]}</span>
          <span className="text-[12px] font-semibold tabular-nums">{formatter(d[valueKey])}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${(d[valueKey] / max) * 100}%`, background: color }} />
        </div>
      </div>
    ))}
  </div>;
}

function Tag2({ active, Icon, label, color, desc }) {
  const tones = {
    emerald: "from-emerald-50 to-white border-emerald-200 text-emerald-700",
    amber: "from-amber-50 to-white border-amber-200 text-amber-700",
    indigo: "from-indigo-50 to-white border-indigo-200 text-indigo-700",
    blue: "from-blue-50 to-white border-blue-200 text-blue-700",
  };
  return <Card className={`bg-gradient-to-br ${active ? tones[color] : "from-slate-50 to-white border-slate-200 text-slate-400"} border`}>
    <CardContent className="p-4">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className="text-[12.5px] text-slate-700 mt-1.5">{active ? desc : "—"}</div>
    </CardContent>
  </Card>;
}

function InsightCard({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const tones = {
    positive: { bg: "from-emerald-50 to-emerald-50/30", border: "border-emerald-100/80", text: "text-emerald-700" },
    warning: { bg: "from-amber-50 to-amber-50/30", border: "border-amber-100/80", text: "text-amber-700" },
    critical: { bg: "from-rose-50 to-rose-50/30", border: "border-rose-100/80", text: "text-rose-700" },
    info: { bg: "from-indigo-50 to-indigo-50/30", border: "border-indigo-100/80", text: "text-indigo-700" },
  };
  const t = tones[insight.tone] || tones.info;
  return <div className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-3.5`}>
    <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${t.text}`}>
      <Icon className="h-3.5 w-3.5" /> {insight.tone === "info" ? "Insight" : insight.tone}
    </div>
    <div className="text-[13px] font-semibold text-slate-900 mt-1">{insight.title}</div>
    <div className="text-[11.5px] text-slate-600 mt-0.5 leading-relaxed">{insight.detail}</div>
  </div>;
}

function InsightRow({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const colors = { positive: "text-emerald-600", warning: "text-amber-600", critical: "text-rose-600", info: "text-indigo-600" };
  return <div className="flex items-start gap-2">
    <Icon className={`h-4 w-4 mt-0.5 ${colors[insight.tone] || colors.info}`} />
    <div className="flex-1 min-w-0">
      <div className="text-[12.5px] font-medium text-slate-800">{insight.title}</div>
      <div className="text-[11.5px] text-slate-500">{insight.detail}</div>
    </div>
  </div>;
}
