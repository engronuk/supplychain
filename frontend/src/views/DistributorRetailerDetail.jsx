import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, MapPin, Phone, Mail, User, Hash, Send, FileText, Truck,
  Package, BarChart3, Receipt, TrendingUp, TrendingDown, Sparkles,
  AlertOctagon, AlertTriangle, Clock, ShieldCheck, Trophy, Info, Search,
} from "lucide-react";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtDateTime = (v) => v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const INSIGHT_ICONS = {
  "trending-up": TrendingUp, "trending-down": TrendingDown, "sparkles": Sparkles,
  "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle, "clock": Clock,
  "shield-check": ShieldCheck, "trophy": Trophy, "info": Info,
};

export default function DistributorRetailerDetail() {
  const { retailerId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab = params.get("tab") || "overview";
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.distributorRetailerDetail(session.entity.id, retailerId)
      .then(setData)
      .catch(() => setError("Could not load retailer detail."))
      .finally(() => setLoading(false));
  }, [session?.entity?.id, retailerId]);

  if (loading) return <div className="p-8 text-slate-500">Loading retailer workspace…</div>;
  if (error || !data) return <div className="p-8 text-rose-600">{error || "Not found."}</div>;

  const { retailer, overview, deliveries, delivery_summary, stock_requests,
          analytics, transactions, ai_insights, distributor } = data;
  const health =
    overview.stock_health_pct >= 75 ? { tone: "emerald", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "#10b981" } :
    overview.stock_health_pct >= 40 ? { tone: "amber", chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "#f59e0b" } :
    { tone: "rose", chip: "bg-rose-50 text-rose-700 border-rose-200", dot: "#ef4444" };

  return (
    <div className="p-6 lg:p-8 max-w-[1500px] mx-auto" data-testid="retailer-detail">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <button onClick={() => navigate("/network")} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 mb-2 transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to retailers
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900">{retailer.name}</h1>
            <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${health.chip}`}>
              <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: health.dot }} />
              Stock {overview.stock_health_pct}%
            </Badge>
          </div>
          <div className="text-[12px] text-slate-500 mt-1 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{retailer.city || "—"}, {retailer.region || "—"}</span>
            <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{retailer.store_code || "—"}</span>
            {retailer.phone && <a href={`tel:${retailer.phone}`} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="h-3 w-3" />{retailer.phone}</a>}
            {distributor?.name && <span className="text-slate-400">Distributor: <span className="text-indigo-600 font-medium">{distributor.name}</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button asChild variant="outline" size="sm" data-testid="action-send-restock">
            <Link to={`/shipments?retailer=${retailer.id}`}><Send className="h-3.5 w-3.5 mr-1.5" />Send Restock</Link>
          </Button>
          <Button asChild size="sm" data-testid="action-create-delivery">
            <Link to={`/shipments?retailer=${retailer.id}&action=create`}><Truck className="h-3.5 w-3.5 mr-1.5" />Create Delivery</Link>
          </Button>
        </div>
      </div>

      {/* AI insights ribbon */}
      {ai_insights.length > 0 && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="ai-insights">
          {ai_insights.slice(0, 3).map((ins, i) => <InsightCard key={i} insight={ins} />)}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue={initialTab} className="space-y-4">
        <TabsList className="bg-white border border-slate-200/80 p-1 rounded-2xl shadow-sm">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="deliveries" data-testid="tab-deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="requests" data-testid="tab-requests">Stock Requests</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">Analytics</TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab retailer={retailer} overview={overview} distributor={distributor} analytics={analytics} insights={ai_insights} /></TabsContent>
        <TabsContent value="deliveries"><DeliveriesTab deliveries={deliveries} summary={delivery_summary} /></TabsContent>
        <TabsContent value="requests"><StockRequestsTab requests={stock_requests} /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab analytics={analytics} overview={overview} /></TabsContent>
        <TabsContent value="transactions"><TransactionsTab transactions={transactions} /></TabsContent>
      </Tabs>
    </div>
  );
}

// =====================================================================
// Overview Tab
// =====================================================================
function OverviewTab({ retailer, overview, distributor, analytics, insights }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Left — profile */}
      <Card className="lg:col-span-1">
        <CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Retailer Profile</div>
          <ProfileRow label="Name" value={retailer.name} />
          <ProfileRow label="Region" value={retailer.region || "—"} />
          <ProfileRow label="State / City" value={retailer.city || "—"} />
          <ProfileRow label="Address" value={retailer.address || "—"} />
          <ProfileRow label="Store Code" value={retailer.store_code || "—"} />
          <ProfileRow label="GPS" value={retailer.latitude ? `${retailer.latitude.toFixed(3)}, ${retailer.longitude.toFixed(3)}` : "—"} />
          <div className="h-px bg-slate-200/70 my-3" />
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Contact</div>
          <ProfileRow label="Contact" value={retailer.contact_name || "—"} icon={User} />
          <ProfileRow label="Phone" value={retailer.phone || "—"} icon={Phone} />
          <ProfileRow label="Email" value={retailer.email || "—"} icon={Mail} />
          <div className="h-px bg-slate-200/70 my-3" />
          <ProfileRow label="Assigned to" value={distributor?.name || "—"} />
        </CardContent>
      </Card>

      {/* Right — KPI grid */}
      <div className="lg:col-span-2 grid grid-cols-2 gap-3">
        <KPI label="Total Revenue" value={fmtMoney(overview.total_revenue)} tone="indigo" testId="kpi-total-revenue" />
        <KPI label="Stock Health" value={`${overview.stock_health_pct}%`} tone={overview.stock_health_pct >= 75 ? "emerald" : overview.stock_health_pct >= 40 ? "amber" : "rose"} />
        <KPI label="Active Orders" value={overview.active_orders} tone="blue" />
        <KPI label="Pending Requests" value={overview.pending_requests} tone={overview.pending_requests > 0 ? "amber" : "slate"} />
        <KPI label="Last Delivery" value={fmtDate(overview.last_delivery_date)} tone="slate" sub />
        <KPI label="Last Order" value={fmtDate(overview.last_order_date)} tone="slate" sub />

        <Card className="col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Revenue Trend · 30 days</div>
              <div className={`inline-flex items-center gap-1 text-[12px] font-semibold ${analytics.wow_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {analytics.wow_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(analytics.wow_pct)}% W/W
              </div>
            </div>
            <Sparkline data={analytics.trend} height={70} />
            <div className="text-[12px] text-slate-500 mt-2">
              <span className="font-semibold text-slate-900">{fmtMoney(analytics.revenue_30d)}</span> in 30 days · {fmtMoney(analytics.revenue_7d)} in last 7 days
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardContent className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-2">Inventory Snapshot</div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat color="#10b981" label="In Stock" value={overview.in_stock} />
              <MiniStat color="#f59e0b" label="Low Stock" value={overview.low_stock} />
              <MiniStat color="#ef4444" label="Out of Stock" value={overview.out_of_stock} />
            </div>
          </CardContent>
        </Card>

        {insights.length > 3 && (
          <Card className="col-span-2">
            <CardContent className="p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">More Insights</div>
              <div className="space-y-2">
                {insights.slice(3).map((ins, i) => <InsightRow key={i} insight={ins} />)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ProfileRow({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-[12.5px]">
      {Icon && <Icon className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />}
      <div className="text-slate-500 w-24 flex-shrink-0">{label}</div>
      <div className="text-slate-900 font-medium min-w-0 break-words">{value}</div>
    </div>
  );
}

// =====================================================================
// Deliveries Tab
// =====================================================================
function DeliveriesTab({ deliveries, summary }) {
  const [statusF, setStatusF] = useState("all");
  const filtered = useMemo(() => {
    if (statusF === "all") return deliveries;
    return deliveries.filter((d) => d.status === statusF);
  }, [deliveries, statusF]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Delivery Value" value={fmtMoney(summary.total_value)} tone="indigo" />
        <KPI label="Total Delivery Cost" value={fmtMoney(summary.total_cost)} tone="slate" />
        <KPI label="Net Margin" value={fmtMoney(summary.margin)} tone="emerald" />
        <KPI label="Delivered / Total" value={`${summary.delivered}/${deliveries.length}`} tone="blue" />
      </div>

      <div className="flex items-center gap-2">
        {["all", "received", "in_transit", "pending"].map((s) => (
          <Pill key={s} label={s.replace("_", " ")} active={statusF === s} onClick={() => setStatusF(s)} />
        ))}
        <div className="ml-auto text-xs text-slate-500">{filtered.length} deliveries</div>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tracking</TableHead><TableHead>Status</TableHead>
            <TableHead>Created</TableHead><TableHead>Received</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right pr-4">Margin</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-slate-500">No deliveries.</TableCell></TableRow>
            )}
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-slate-900">{d.tracking_code}</TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
                <TableCell className="text-slate-600 text-[12.5px]">{fmtDateTime(d.created_at)}</TableCell>
                <TableCell className="text-slate-600 text-[12.5px]">{fmtDate(d.received_at)}</TableCell>
                <TableCell className="text-right tabular-nums">{d.units}</TableCell>
                <TableCell className="text-right tabular-nums font-medium text-slate-900">{fmtMoney(d.value)}</TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">{fmtMoney(d.cost)}</TableCell>
                <TableCell className="text-right tabular-nums pr-4 text-emerald-700 font-medium">{fmtMoney(d.value - d.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// =====================================================================
// Stock Requests Tab
// =====================================================================
function StockRequestsTab({ requests }) {
  const [statusF, setStatusF] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusF !== "all" && r.status !== statusF) return false;
      if (!s) return true;
      return r.items.some((it) => (it.product_name || "").toLowerCase().includes(s)
        || (it.category || "").toLowerCase().includes(s));
    });
  }, [requests, statusF, search]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Requests" value={requests.length} tone="slate" />
        <KPI label="Pending" value={requests.filter((r) => r.status === "pending").length} tone="amber" />
        <KPI label="Approved / Fulfilled" value={requests.filter((r) => r.status === "approved" || r.status === "fulfilled").length} tone="emerald" />
        <KPI label="Rejected" value={requests.filter((r) => r.status === "rejected").length} tone="rose" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or category…" className="pl-9 w-72" />
        </div>
        {["all", "pending", "approved", "fulfilled", "rejected"].map((s) => (
          <Pill key={s} label={s} active={statusF === s} onClick={() => setStatusF(s)} />
        ))}
        <div className="ml-auto text-xs text-slate-500">{filtered.length} requests</div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-slate-500">No stock requests match your filters.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id}><CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <span className="font-medium text-slate-900">Request #{r.id.slice(0, 8)}</span>
                    <RequestStatusBadge status={r.status} />
                    {r.priority === "high" && <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px]">PRIORITY</Badge>}
                  </div>
                  <div className="text-[11.5px] text-slate-500 mt-0.5">{fmtDateTime(r.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Order Value</div>
                  <div className="text-[16px] font-bold text-slate-900">{fmtMoney(r.order_value)}</div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableHead className="h-8">Product</TableHead>
                    <TableHead className="h-8">Category</TableHead>
                    <TableHead className="h-8 text-right">Qty</TableHead>
                    <TableHead className="h-8 text-right">Unit Price</TableHead>
                    <TableHead className="h-8 text-right pr-2">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((it, i) => (
                    <TableRow key={i} className="border-slate-100 hover:bg-slate-50/40">
                      <TableCell className="py-1.5 text-[12.5px] font-medium text-slate-800">{it.product_name}</TableCell>
                      <TableCell className="py-1.5 text-[12px] text-slate-500">{it.category || "—"}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{it.quantity}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-slate-600">{fmtMoney(it.unit_price)}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums pr-2 font-medium">{fmtMoney(it.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Analytics Tab
// =====================================================================
function AnalyticsTab({ analytics, overview }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Revenue (30d)" value={fmtMoney(analytics.revenue_30d)} tone="indigo" />
        <KPI label="Revenue (7d)" value={fmtMoney(analytics.revenue_7d)} tone="indigo" />
        <KPI label="W/W Growth" value={`${analytics.wow_pct >= 0 ? "+" : ""}${analytics.wow_pct}%`} tone={analytics.wow_pct >= 0 ? "emerald" : "rose"} />
        <KPI label="M/M Growth" value={`${analytics.mom_pct >= 0 ? "+" : ""}${analytics.mom_pct}%`} tone={analytics.mom_pct >= 0 ? "emerald" : "rose"} />
      </div>

      <Card><CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Daily Revenue · 30 days</div>
        <Sparkline data={analytics.trend} height={120} showAxis />
      </CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Top Selling Products</div>
          {analytics.top_products.length === 0 ? (
            <div className="text-[12.5px] text-slate-500 py-8 text-center">No sales data yet.</div>
          ) : (
            <div className="space-y-2">
              {analytics.top_products.map((p, i) => {
                const max = analytics.top_products[0].revenue || 1;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-slate-800 truncate flex-1 mr-2">{p.product}</span>
                      <span className="text-[12.5px] font-semibold tabular-nums">{fmtMoney(p.revenue)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(p.revenue / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Sales by Category</div>
          {analytics.category_breakdown.length === 0 ? (
            <div className="text-[12.5px] text-slate-500 py-8 text-center">No category data yet.</div>
          ) : (
            <Donut data={analytics.category_breakdown} />
          )}
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-3">Margin Trend</div>
        <Sparkline data={analytics.margin_trend} field="margin" color="#10b981" height={100} />
        <div className="text-[11.5px] text-slate-500 mt-2">Estimated 20% gross margin on delivered revenue.</div>
      </CardContent></Card>
    </div>
  );
}

// =====================================================================
// Transactions Tab
// =====================================================================
function TransactionsTab({ transactions }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Transactions" value={transactions.length} tone="slate" />
        <KPI label="Total Order Value" value={fmtMoney(transactions.reduce((a, b) => a + b.order_value, 0))} tone="indigo" />
        <KPI label="Paid" value={transactions.filter((t) => t.payment_status === "paid").length} tone="emerald" />
        <KPI label="Pending" value={transactions.filter((t) => t.payment_status === "pending").length} tone="amber" />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Order Value</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right pr-4">Order Date</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {transactions.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-slate-500">No transactions.</TableCell></TableRow>
            )}
            {transactions.map((t, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium text-slate-900 flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-slate-400" />{t.invoice_number}</TableCell>
                <TableCell className="tabular-nums font-medium">{fmtMoney(t.order_value)}</TableCell>
                <TableCell className="text-slate-600">{t.items_count}</TableCell>
                <TableCell><PaymentBadge status={t.payment_status} /></TableCell>
                <TableCell className="text-slate-600 capitalize text-[12.5px]">{t.payment_method.replace("_", " ")}</TableCell>
                <TableCell className="text-right text-[12.5px] text-slate-600 pr-4">{fmtDateTime(t.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// =====================================================================
// Shared building blocks
// =====================================================================
function KPI({ label, value, tone = "slate", sub = false, testId }) {
  const tones = {
    slate: "from-slate-50 to-white text-slate-900",
    emerald: "from-emerald-50 to-white text-emerald-900",
    indigo: "from-indigo-50 to-white text-indigo-900",
    amber: "from-amber-50 to-white text-amber-900",
    rose: "from-rose-50 to-white text-rose-900",
    blue: "from-blue-50 to-white text-blue-900",
  };
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${tones[tone]} p-3.5`} data-testid={testId}>
      <div className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500 font-semibold">{label}</div>
      <div className={`${sub ? "text-[14px]" : "text-[19px]"} font-bold mt-1`}>{value}</div>
    </div>
  );
}

function MiniStat({ color, label, value }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/70 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> {label}
      </div>
      <div className="text-[18px] font-bold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    received: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Received" },
    in_transit: { color: "bg-blue-50 text-blue-700 border-blue-200", label: "In Transit" },
    pending: { color: "bg-amber-50 text-amber-700 border-amber-200", label: "Pending" },
    cancelled: { color: "bg-slate-50 text-slate-600 border-slate-200", label: "Cancelled" },
  };
  const m = map[status] || map.pending;
  return <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${m.color}`}>{m.label}</Badge>;
}

function RequestStatusBadge({ status }) {
  const map = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-blue-50 text-blue-700 border-blue-200",
    fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${map[status] || map.pending}`}>{status}</Badge>;
}

function PaymentBadge({ status }) {
  const map = {
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${map[status] || map.pending}`}>{status}</Badge>;
}

function Pill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center h-8 px-3 rounded-full border text-[12px] font-medium capitalize transition-colors
        ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:text-slate-900"}`}>
      {label}
    </button>
  );
}

function InsightCard({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const tones = {
    positive: { bg: "from-emerald-50 to-emerald-50/30", border: "border-emerald-100/80", text: "text-emerald-700" },
    warning:  { bg: "from-amber-50 to-amber-50/30",   border: "border-amber-100/80",   text: "text-amber-700" },
    critical: { bg: "from-rose-50 to-rose-50/30",     border: "border-rose-100/80",     text: "text-rose-700" },
    info:     { bg: "from-indigo-50 to-indigo-50/30", border: "border-indigo-100/80", text: "text-indigo-700" },
  };
  const t = tones[insight.tone] || tones.info;
  return (
    <div className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-3.5`}>
      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${t.text}`}>
        <Icon className="h-3.5 w-3.5" /> {insight.tone === "info" ? "Insight" : insight.tone}
      </div>
      <div className="text-[13px] font-semibold text-slate-900 mt-1">{insight.title}</div>
      <div className="text-[11.5px] text-slate-600 mt-0.5 leading-relaxed">{insight.detail}</div>
    </div>
  );
}

function InsightRow({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const colors = { positive: "text-emerald-600", warning: "text-amber-600", critical: "text-rose-600", info: "text-indigo-600" };
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-4 w-4 mt-0.5 ${colors[insight.tone] || colors.info}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-slate-800">{insight.title}</div>
        <div className="text-[11.5px] text-slate-500">{insight.detail}</div>
      </div>
    </div>
  );
}

// Simple SVG sparkline / line chart
function Sparkline({ data, field = "revenue", color = "#6366f1", height = 60, showAxis = false }) {
  if (!data || data.length === 0) return null;
  const W = 800;
  const H = height;
  const values = data.map((d) => d[field]);
  const max = Math.max(...values, 1);
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (d[field] / max) * (H - 6) - 3;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={`gr-${field}-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#gr-${field}-${color.slice(1)})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {showAxis && (
        <>
          <text x="0" y="10" fontSize="10" fill="#94a3b8">{fmtMoney(max)}</text>
          <text x="0" y={H - 2} fontSize="10" fill="#94a3b8">{data[0].date}</text>
          <text x={W - 60} y={H - 2} fontSize="10" fill="#94a3b8">{data[data.length - 1].date}</text>
        </>
      )}
    </svg>
  );
}

function Donut({ data }) {
  const total = data.reduce((a, b) => a + b.revenue, 0) || 1;
  let angle = -Math.PI / 2;
  const R = 60, S = 16;
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];
  const segs = data.slice(0, colors.length).map((d, i) => {
    const slice = (d.revenue / total) * Math.PI * 2;
    const x1 = R + R * Math.cos(angle);
    const y1 = R + R * Math.sin(angle);
    angle += slice;
    const x2 = R + R * Math.cos(angle);
    const y2 = R + R * Math.sin(angle);
    const large = slice > Math.PI ? 1 : 0;
    const path = `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
    return { path, color: colors[i % colors.length], data: d, pct: ((d.revenue / total) * 100).toFixed(1) };
  });
  return (
    <div className="flex items-center gap-5">
      <svg width={R * 2} height={R * 2} viewBox={`0 0 ${R * 2} ${R * 2}`}>
        {segs.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
        <circle cx={R} cy={R} r={R - S} fill="white" />
      </svg>
      <div className="flex-1 space-y-1.5">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center text-[12px]">
            <span className="h-2 w-2 rounded-full mr-2" style={{ background: s.color }} />
            <span className="flex-1 text-slate-700 truncate">{s.data.category}</span>
            <span className="text-slate-900 font-semibold mr-2">{fmtMoney(s.data.revenue)}</span>
            <span className="text-slate-500 tabular-nums w-12 text-right">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
