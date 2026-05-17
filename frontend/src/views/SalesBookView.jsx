import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Receipt, Plus, Trash2, Search, Download, ShoppingCart, Banknote, Smartphone,
  CreditCard, Clock, TrendingUp, TrendingDown, Trophy, Sparkles, AlertOctagon,
  AlertTriangle, ShieldCheck, Info, Wallet, BadgePercent, Users, Package, Filter,
  CalendarDays, ChevronLeft, ChevronRight, Check, BookOpen, BarChart3, X,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, ResponsiveContainer, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Legend,
} from "recharts";

const PAYMENT_OPTIONS = [
  { value: "cash", label: "Cash", icon: Banknote, color: "emerald" },
  { value: "transfer", label: "Transfer", icon: Wallet, color: "blue" },
  { value: "pos", label: "POS", icon: CreditCard, color: "indigo" },
  { value: "credit", label: "Credit", icon: Clock, color: "amber" },
];
const PAYMENT_COLORS = { cash: "#10b981", transfer: "#3b82f6", pos: "#6366f1", credit: "#f59e0b" };
const naira = (n) => "₦" + Math.round(Number(n || 0)).toLocaleString();

export default function SalesBookView() {
  const { session } = useSession();
  if (session.role !== "retailer") {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <PageHeader title="Sales Book" description="The Sales Book is only available to retailer workspaces." />
      </div>
    );
  }
  return <SalesBook retailerId={session.entity.id} retailerName={session.entity.name} />;
}

function SalesBook({ retailerId, retailerName }) {
  const [tab, setTab] = useState("dashboard");
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [showEntry, setShowEntry] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    Api.salesSummary(retailerId).then(setSummary).catch(() => setSummary(null));
  }, [retailerId, refreshTick]);

  useEffect(() => {
    if (tab !== "analytics") return;
    Api.salesAnalytics(retailerId, 30).then(setAnalytics).catch(() => setAnalytics(null));
  }, [retailerId, tab, refreshTick]);

  const onSaleCreated = () => {
    setShowEntry(false);
    setRefreshTick((v) => v + 1);
    toast.success("Sale recorded and inventory updated");
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto pb-28" data-testid="sales-book-view">
      <PageHeader
        title="Sales Book"
        description={`Daily sales ledger for ${retailerName} — record, track, analyze.`}
        actions={
          <Button
            onClick={() => setShowEntry(true)}
            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500"
            data-testid="new-sale-btn"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Sale
          </Button>
        }
      />

      <Tabs value={tab} onChange={setTab} />

      {tab === "dashboard" && (
        <DashboardTab summary={summary} retailerId={retailerId} refreshTick={refreshTick} />
      )}
      {tab === "ledger" && (
        <LedgerTab retailerId={retailerId} refreshTick={refreshTick} />
      )}
      {tab === "analytics" && (
        <AnalyticsTab analytics={analytics} retailerId={retailerId} />
      )}

      {/* Mobile FAB */}
      <button
        onClick={() => setShowEntry(true)}
        className="md:hidden fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-xl shadow-indigo-500/30 flex items-center justify-center active:scale-95 transition"
        aria-label="New sale"
        data-testid="new-sale-fab"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showEntry && (
        <SaleEntryDialog
          retailerId={retailerId}
          onClose={() => setShowEntry(false)}
          onCreated={onSaleCreated}
        />
      )}
    </div>
  );
}

function Tabs({ value, onChange }) {
  const tabs = [
    { id: "dashboard", label: "Today", icon: TrendingUp },
    { id: "ledger", label: "Sales Book", icon: BookOpen },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-2xl mb-5 border border-slate-200/60">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            data-testid={`sales-tab-${t.id}`}
            className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-xl transition-all ${
              active ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Dashboard tab — KPI strip + recent + AI insights
// ============================================================================
function DashboardTab({ summary, retailerId, refreshTick }) {
  const [recent, setRecent] = useState({ rows: [] });
  useEffect(() => {
    Api.salesList(retailerId, { limit: 6 }).then(setRecent).catch(() => setRecent({ rows: [] }));
  }, [retailerId, refreshTick]);

  if (!summary) {
    return <div className="text-sm text-slate-500" data-testid="sales-dashboard-loading">Loading today's pulse…</div>;
  }
  const k = summary.kpis;

  return (
    <div data-testid="sales-dashboard">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <KPI tone="emerald" icon={ShoppingCart} label="Sales Today" value={k.units_today.toLocaleString()} sub="units sold" testId="kpi-units-today" />
        <KPI tone="indigo" icon={Banknote} label="Revenue Today" value={naira(k.revenue_today)} sub={`${k.transactions_today} tx`} testId="kpi-revenue-today" />
        <KPI tone="blue" icon={Receipt} label="Transactions" value={k.transactions_today.toLocaleString()} sub="today" testId="kpi-tx-today" />
        <KPI tone="violet" icon={BadgePercent} label="Avg. Basket" value={naira(k.avg_basket)} sub="per sale" testId="kpi-basket" />
        <KPI tone="rose" icon={Clock} label="Pending Credit" value={naira(k.pending_credit)} sub="awaiting payment" testId="kpi-credit" />
        <KPI tone="amber" icon={Trophy} label="Top Seller" value={k.best_seller ? k.best_seller.name.split(" ")[0] : "—"}
             sub={k.best_seller ? `${k.best_seller.units} units` : "no sales yet"} testId="kpi-top-seller" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2"><CardContent className="p-5">
          <Section title="Recent sales" icon={Receipt}
            right={k.wow_pct !== 0 && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${k.wow_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {k.wow_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(k.wow_pct)}% WoW
              </span>
            )} />
          {recent.rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No sales yet" hint='Tap "New Sale" to record your first transaction.' />
          ) : (
            <div className="space-y-2">
              {recent.rows.map((s) => <RecentSaleRow key={s.id} sale={s} />)}
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <Section title="Best seller today" icon={Trophy} />
          {!k.best_seller ? (
            <EmptyState icon={Package} title="No sales yet" hint="Your top product will show up here." />
          ) : (
            <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-white p-5">
              <div className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Champion</div>
              <div className="text-lg font-bold text-slate-900 mt-1 leading-tight">{k.best_seller.name}</div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Mini label="Units" value={k.best_seller.units} />
                <Mini label="Revenue" value={naira(k.best_seller.revenue)} />
              </div>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-[10.5px] uppercase tracking-widest text-slate-500 font-semibold mb-2">7-day revenue</div>
            <div className="text-2xl font-bold text-slate-900">{naira(k.revenue_7d)}</div>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

function RecentSaleRow({ sale }) {
  const opt = PAYMENT_OPTIONS.find((p) => p.value === sale.payment_method);
  const PayIcon = opt?.icon || Banknote;
  const t = new Date(sale.created_at);
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition" data-testid="recent-sale-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-700">{sale.transaction_code}</span>
          <Badge variant="outline" className="text-[10px] capitalize">{sale.payment_method}</Badge>
          {sale.payment_status === "pending" && (
            <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">unpaid</Badge>
          )}
        </div>
        <div className="text-sm text-slate-700 mt-0.5 truncate">
          {sale.items.map((it) => `${it.product_name} × ${it.quantity}`).join(" · ")}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {sale.customer_name ? ` · ${sale.customer_name}` : ""}
          {sale.attendant ? ` · by ${sale.attendant}` : ""}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-base font-bold text-slate-900">{naira(sale.grand_total)}</div>
        <div className="text-[10px] text-slate-500 inline-flex items-center gap-1">
          <PayIcon className="h-3 w-3" />
          {sale.units_total} units
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Ledger tab — table + filters + CSV export + pagination
// ============================================================================
function LedgerTab({ retailerId, refreshTick }) {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [filters, setFilters] = useState({
    search: "", date_from: "", date_to: "", payment_method: "", payment_status: "",
  });
  const [page, setPage] = useState(0);
  const limit = 25;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = { limit, offset: page * limit };
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    Api.salesList(retailerId, params)
      .then(setData)
      .finally(() => setLoading(false));
  }, [retailerId, filters, page, refreshTick]);

  const totalPages = Math.max(1, Math.ceil(data.total / limit));
  const csvUrl = Api.salesExportCsvUrl(retailerId, filters.date_from, filters.date_to);

  return (
    <div data-testid="sales-ledger">
      <Card className="mb-4"><CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
          <div className="md:col-span-4 relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={filters.search}
              onChange={(e) => { setFilters((f) => ({ ...f, search: e.target.value })); setPage(0); }}
              placeholder="Search tx code, product, customer…"
              className="pl-9"
              data-testid="ledger-search"
            />
          </div>
          <Input
            type="date" value={filters.date_from}
            onChange={(e) => { setFilters((f) => ({ ...f, date_from: e.target.value })); setPage(0); }}
            className="md:col-span-2" data-testid="ledger-date-from"
          />
          <Input
            type="date" value={filters.date_to}
            onChange={(e) => { setFilters((f) => ({ ...f, date_to: e.target.value })); setPage(0); }}
            className="md:col-span-2" data-testid="ledger-date-to"
          />
          <Select value={filters.payment_method || "all"} onValueChange={(v) => { setFilters((f) => ({ ...f, payment_method: v === "all" ? "" : v })); setPage(0); }}>
            <SelectTrigger className="md:col-span-2" data-testid="ledger-payment-filter"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payments</SelectItem>
              {PAYMENT_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <a
            href={csvUrl} target="_blank" rel="noreferrer"
            className="md:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
            data-testid="ledger-export-csv"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="ledger-table">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10.5px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Time</th>
                <th className="text-left px-4 py-3 font-semibold">Tx ID</th>
                <th className="text-left px-4 py-3 font-semibold">Products</th>
                <th className="text-right px-4 py-3 font-semibold">Qty</th>
                <th className="text-right px-4 py-3 font-semibold">Total</th>
                <th className="text-left px-4 py-3 font-semibold">Payment</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Attendant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={7} className="text-center py-10 text-sm text-slate-500">Loading…</td></tr>
              )}
              {!loading && data.rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12">
                  <EmptyState icon={BookOpen} title="No transactions match your filters" hint="Try clearing filters or recording a new sale." />
                </td></tr>
              )}
              {!loading && data.rows.map((s) => {
                const t = new Date(s.created_at);
                const opt = PAYMENT_OPTIONS.find((p) => p.value === s.payment_method);
                const PayIcon = opt?.icon || Banknote;
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition" data-testid="ledger-row">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      <div className="font-medium text-slate-900">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      <div className="text-[10px] text-slate-500">{t.toLocaleDateString()}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{s.transaction_code}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="text-slate-800 truncate">
                        {s.items.map((it) => `${it.product_name} × ${it.quantity}`).join(" · ")}
                      </div>
                      {s.customer_name && <div className="text-[10.5px] text-slate-500">{s.customer_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{s.units_total}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">{naira(s.grand_total)}</td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <PayIcon className="h-3 w-3 text-slate-500" />
                        <span className="capitalize">{s.payment_method}</span>
                        {s.payment_status === "pending" && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 ml-1">unpaid</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{s.attendant || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
          <div className="text-xs text-slate-500">
            {data.total === 0 ? "0 results" : (
              <>Showing <strong>{page * limit + 1}</strong>–<strong>{Math.min((page + 1) * limit, data.total)}</strong> of <strong>{data.total}</strong></>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:bg-slate-100"
              data-testid="ledger-prev"
            >
              <ChevronLeft className="h-4 w-4 mx-auto" />
            </button>
            <span className="text-xs text-slate-600">Page {page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:bg-slate-100"
              data-testid="ledger-next"
            >
              <ChevronRight className="h-4 w-4 mx-auto" />
            </button>
          </div>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// Analytics tab — trends, payments, products, AI insights
// ============================================================================
function AnalyticsTab({ analytics, retailerId }) {
  if (!analytics) return <div className="text-sm text-slate-500" data-testid="sales-analytics-loading">Crunching numbers…</div>;
  const { totals, trend_daily, trend_weekly, trend_monthly, best_products, slow_products, payment_mix, hourly, peak_hour, by_dow, peak_dow, ai_insights } = analytics;

  return (
    <div className="space-y-4" data-testid="sales-analytics">
      {/* AI insights ribbon */}
      {ai_insights && ai_insights.length > 0 && (
        <Card><CardContent className="p-5">
          <Section title="AI insights" icon={Sparkles}
            right={<span className="text-[10px] text-slate-500 uppercase tracking-wider">Powered by Claude Haiku</span>} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ai_insights.map((ins, i) => <InsightCard key={i} ins={ins} />)}
          </div>
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPI tone="indigo" icon={Banknote} label="Revenue · 30d" value={naira(totals.revenue)} sub={`avg ${naira(totals.avg_daily_revenue)}/day`} />
        <KPI tone="emerald" icon={Receipt} label="Transactions" value={totals.tx.toLocaleString()} sub={`over ${totals.days} days`} />
        <KPI tone="amber" icon={Clock} label="Peak hour" value={`${peak_hour.hour}:00`} sub={`${naira(peak_hour.revenue)} earned`} />
      </div>

      <Card><CardContent className="p-5">
        <Section title="Revenue trend · last 30 days" icon={TrendingUp} />
        {trend_daily.every((d) => d.revenue === 0) ? (
          <EmptyState icon={TrendingUp} title="No sales recorded yet" hint="Record your first sale to see your revenue trend." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={trend_daily}>
                <defs>
                  <linearGradient id="rev30" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={10} stroke="#94a3b8"
                  tickFormatter={(d) => d.slice(5)} />
                <YAxis fontSize={10} stroke="#94a3b8"
                  tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v) => [naira(v), "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#rev30)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent></Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <Section title="Weekly revenue" icon={CalendarDays} />
          {trend_weekly.length === 0 ? <EmptyState icon={CalendarDays} title="No data yet" /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={trend_weekly}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="week_start" fontSize={10} stroke="#94a3b8" tickFormatter={(d) => d.slice(5)} />
                  <YAxis fontSize={10} stroke="#94a3b8" tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => [naira(v), "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <Section title="Monthly revenue" icon={CalendarDays} />
          {trend_monthly.length === 0 ? <EmptyState icon={CalendarDays} title="No data yet" /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={trend_monthly}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={10} stroke="#94a3b8" />
                  <YAxis fontSize={10} stroke="#94a3b8" tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => [naira(v), "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <Section title="Best-selling products" icon={Trophy} />
          {best_products.length === 0 ? <EmptyState icon={Trophy} title="No product data yet" /> : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={best_products} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={10} stroke="#94a3b8" tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                  <YAxis type="category" dataKey="name" fontSize={10} stroke="#475569" width={130} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [naira(v), "Revenue"]} />
                  <Bar dataKey="revenue" radius={[0, 6, 6, 0]} fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <Section title="Payment mix" icon={CreditCard} />
          {payment_mix.every((p) => p.revenue === 0) ? <EmptyState icon={CreditCard} title="No payments yet" /> : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={payment_mix.filter((p) => p.revenue > 0)} dataKey="revenue" nameKey="label"
                       innerRadius={48} outerRadius={88} paddingAngle={3}>
                    {payment_mix.filter((p) => p.revenue > 0).map((p, i) => (
                      <Cell key={i} fill={PAYMENT_COLORS[p.method] || "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [naira(v), "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <Section title="Peak sales hours" icon={Clock}
            right={<span className="text-[11px] text-slate-500">Best: <strong className="text-slate-700">{peak_hour.hour}:00</strong></span>} />
          {hourly.every((h) => h.revenue === 0) ? <EmptyState icon={Clock} title="No hourly data yet" /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={hourly}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="hour" fontSize={10} stroke="#94a3b8" />
                  <YAxis fontSize={10} stroke="#94a3b8" tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => [naira(v), "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {hourly.map((h, i) => (
                      <Cell key={i} fill={h.hour === peak_hour.hour ? "#6366f1" : "#c7d2fe"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <Section title="Sales by day of week" icon={CalendarDays}
            right={<span className="text-[11px] text-slate-500">Best: <strong className="text-slate-700">{peak_dow.label}</strong></span>} />
          {by_dow.every((d) => d.revenue === 0) ? <EmptyState icon={CalendarDays} title="No data yet" /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={by_dow}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={10} stroke="#94a3b8" />
                  <YAxis fontSize={10} stroke="#94a3b8" tickFormatter={(v) => "₦" + (v / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => [naira(v), "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {by_dow.map((d, i) => (
                      <Cell key={i} fill={d.label === peak_dow.label ? "#10b981" : "#bbf7d0"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>
      </div>

      {slow_products.length > 0 && (
        <Card><CardContent className="p-5">
          <Section title="Slow-moving products" icon={AlertTriangle} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {slow_products.map((p) => (
              <div key={p.product_id} className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="text-[10.5px] uppercase tracking-widest text-amber-700 font-semibold">Slow seller</div>
                <div className="text-sm font-semibold text-slate-900 mt-1 leading-tight">{p.name}</div>
                <div className="text-xs text-slate-600 mt-1">{p.units} units · {naira(p.revenue)}</div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// Sale Entry Dialog (POS-style multi-product)
// ============================================================================
function SaleEntryDialog({ retailerId, onClose, onCreated }) {
  const [inventory, setInventory] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [cart, setCart] = useState([]); // [{ product_id, name, sku, category, unit_price, quantity, available }]
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [customer, setCustomer] = useState("");
  const [attendant, setAttendant] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Api.inventory("retailer", retailerId).then(setInventory).catch(() => setInventory([]));
  }, [retailerId]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return inventory
      .filter((i) => {
        const p = i.product || {};
        if (!p.name) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
      })
      .slice(0, 60);
  }, [inventory, productQuery]);

  const addProduct = (inv) => {
    const p = inv.product || {};
    setCart((prev) => {
      const existing = prev.find((c) => c.product_id === inv.product_id);
      if (existing) {
        if (existing.quantity >= inv.quantity) {
          toast.warning(`Only ${inv.quantity} of ${p.name} in stock`);
          return prev;
        }
        return prev.map((c) =>
          c.product_id === inv.product_id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, {
        product_id: inv.product_id,
        name: p.name, sku: p.sku, category: p.category,
        unit_price: Number(p.unit_price || 0),
        quantity: 1,
        available: Number(inv.quantity || 0),
      }];
    });
  };

  const updateQty = (pid, qty) => {
    qty = Math.max(0, Number(qty || 0));
    setCart((prev) => prev.map((c) => c.product_id === pid ? { ...c, quantity: qty } : c).filter((c) => c.quantity > 0));
  };

  const updatePrice = (pid, price) => {
    price = Math.max(0, Number(price || 0));
    setCart((prev) => prev.map((c) => c.product_id === pid ? { ...c, unit_price: price } : c));
  };

  const removeFromCart = (pid) => setCart((prev) => prev.filter((c) => c.product_id !== pid));

  const grandTotal = cart.reduce((s, c) => s + c.quantity * c.unit_price, 0);
  const totalUnits = cart.reduce((s, c) => s + c.quantity, 0);
  const stockError = cart.find((c) => c.quantity > c.available);

  const submit = async () => {
    if (cart.length === 0) {
      toast.error("Add at least one product to the cart");
      return;
    }
    if (stockError) {
      toast.error(`Insufficient stock: ${stockError.name} (${stockError.available} available)`);
      return;
    }
    setSubmitting(true);
    try {
      await Api.createSale(retailerId, {
        items: cart.map((c) => ({
          product_id: c.product_id, quantity: c.quantity, unit_price: c.unit_price,
        })),
        payment_method: paymentMethod,
        customer_name: customer, attendant, notes,
      });
      onCreated();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to record sale";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden gap-0 sm:rounded-2xl" data-testid="sale-entry-dialog">
        <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-indigo-600" />
            New Sale
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Auto-generated tx ID · {new Date().toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-5 max-h-[78vh] overflow-hidden">
          {/* Product picker */}
          <div className="lg:col-span-2 border-r border-slate-200 flex flex-col bg-slate-50/50">
            <div className="p-4 border-b border-slate-200 bg-white">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Search products by name or SKU…"
                  className="pl-9"
                  data-testid="sale-product-search"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {filteredProducts.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">No products match.</div>
              )}
              {filteredProducts.map((inv) => {
                const p = inv.product || {};
                const lowStock = inv.quantity <= (inv.reorder_level || 10);
                return (
                  <button
                    key={inv.product_id}
                    onClick={() => addProduct(inv)}
                    disabled={inv.quantity <= 0}
                    className="w-full text-left bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition p-3 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid={`product-pick-${inv.product_id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">{p.name}</div>
                        <div className="text-[10.5px] text-slate-500 mt-0.5">{p.sku} · {p.category}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold text-indigo-700">{naira(p.unit_price)}</div>
                        <div className={`text-[10px] ${inv.quantity <= 0 ? "text-rose-600" : lowStock ? "text-amber-600" : "text-slate-500"}`}>
                          {inv.quantity <= 0 ? "out of stock" : `${inv.quantity} in stock`}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cart + payment */}
          <div className="lg:col-span-3 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5" /> Cart ({cart.length})
                </div>
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-[11px] text-rose-600 hover:underline" data-testid="cart-clear">
                    Clear all
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
                  <ShoppingCart className="h-8 w-8 text-slate-300 mx-auto" />
                  <div className="text-sm font-medium text-slate-600 mt-2">Cart is empty</div>
                  <div className="text-xs text-slate-500 mt-0.5">Tap products on the left to add them.</div>
                </div>
              ) : (
                <div className="space-y-2" data-testid="cart-items">
                  {cart.map((c) => {
                    const overStock = c.quantity > c.available;
                    return (
                      <div key={c.product_id} className={`p-3 rounded-xl border ${overStock ? "border-rose-300 bg-rose-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                            <div className="text-[10.5px] text-slate-500">{c.sku} · {c.available} in stock</div>
                          </div>
                          <button onClick={() => removeFromCart(c.product_id)} className="text-slate-400 hover:text-rose-600" data-testid={`cart-remove-${c.product_id}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Qty</label>
                            <div className="flex items-center mt-1 rounded-lg border border-slate-200 overflow-hidden">
                              <button onClick={() => updateQty(c.product_id, c.quantity - 1)}
                                className="px-2 py-1.5 text-slate-600 hover:bg-slate-100"
                                data-testid={`qty-dec-${c.product_id}`}>−</button>
                              <input type="number" min="0" value={c.quantity}
                                onChange={(e) => updateQty(c.product_id, e.target.value)}
                                className="w-full text-center text-sm font-semibold border-0 focus:outline-none focus:ring-0 py-1.5 tabular-nums"
                                data-testid={`qty-input-${c.product_id}`} />
                              <button onClick={() => updateQty(c.product_id, c.quantity + 1)}
                                className="px-2 py-1.5 text-slate-600 hover:bg-slate-100"
                                data-testid={`qty-inc-${c.product_id}`}>+</button>
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Unit ₦</label>
                            <Input type="number" value={c.unit_price}
                              onChange={(e) => updatePrice(c.product_id, e.target.value)}
                              className="mt-1 h-9 text-sm tabular-nums" />
                          </div>
                          <div className="text-right">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Line total</label>
                            <div className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                              {naira(c.quantity * c.unit_price)}
                            </div>
                          </div>
                        </div>
                        {overStock && (
                          <div className="text-[11px] text-rose-700 inline-flex items-center gap-1 mt-2">
                            <AlertTriangle className="h-3 w-3" /> Quantity exceeds available stock ({c.available})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-5 space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Payment method</label>
                  <div className="grid grid-cols-4 gap-2 mt-1.5">
                    {PAYMENT_OPTIONS.map((p) => {
                      const active = paymentMethod === p.value;
                      const tones = {
                        emerald: "border-emerald-400 bg-emerald-50 text-emerald-700",
                        blue: "border-blue-400 bg-blue-50 text-blue-700",
                        indigo: "border-indigo-400 bg-indigo-50 text-indigo-700",
                        amber: "border-amber-400 bg-amber-50 text-amber-700",
                      };
                      return (
                        <button
                          key={p.value}
                          onClick={() => setPaymentMethod(p.value)}
                          className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all ${
                            active ? tones[p.color] : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                          data-testid={`payment-${p.value}`}
                        >
                          <p.icon className="h-4 w-4" />
                          <span className="text-[11px] font-semibold">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Customer (optional)</label>
                    <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Walk-in" className="mt-1 h-9" data-testid="sale-customer" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Attendant</label>
                    <Input value={attendant} onChange={(e) => setAttendant(e.target.value)} placeholder="Cashier name" className="mt-1 h-9" data-testid="sale-attendant" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Notes (optional)</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember…" className="mt-1 h-9" data-testid="sale-notes" />
                </div>
              </div>
            </div>

            {/* Sticky total + submit */}
            <div className="border-t border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-slate-500">
                  {totalUnits} unit{totalUnits !== 1 ? "s" : ""} · {cart.length} line item{cart.length !== 1 ? "s" : ""}
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Grand total</div>
                  <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{naira(grandTotal)}</div>
                </div>
              </div>
              <Button
                onClick={submit}
                disabled={submitting || cart.length === 0 || !!stockError}
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
                data-testid="sale-submit"
              >
                {submitting ? "Recording…" : (
                  <>
                    <Check className="h-5 w-5 mr-1.5" />
                    Complete Sale · {naira(grandTotal)}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Small UI helpers
// ============================================================================
function KPI({ tone = "slate", icon: Icon, label, value, sub, testId }) {
  const tones = {
    indigo: "from-indigo-50 to-white border-indigo-100/80 text-indigo-700",
    blue: "from-blue-50 to-white border-blue-100/80 text-blue-700",
    emerald: "from-emerald-50 to-white border-emerald-100/80 text-emerald-700",
    amber: "from-amber-50 to-white border-amber-100/80 text-amber-700",
    rose: "from-rose-50 to-white border-rose-100/80 text-rose-700",
    violet: "from-violet-50 to-white border-violet-100/80 text-violet-700",
    slate: "from-slate-50 to-white border-slate-200 text-slate-600",
  };
  return (
    <Card data-testid={testId} className={`bg-gradient-to-br ${tones[tone] || tones.slate}`}>
      <CardContent className="p-4">
        <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider">
          {Icon && <Icon className="h-3.5 w-3.5" />} {label}
        </div>
        <div className="text-[22px] font-bold text-slate-900 mt-1 tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-base font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, icon: Icon, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        {Icon && <Icon className="h-4 w-4 text-slate-500" />}
        {title}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="text-center py-8">
      {Icon && <Icon className="h-8 w-8 text-slate-300 mx-auto" />}
      <div className="text-sm font-medium text-slate-600 mt-2">{title}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function InsightCard({ ins }) {
  const tones = {
    positive: { bg: "from-emerald-50 to-white", text: "text-emerald-700", icon: ShieldCheck },
    warning: { bg: "from-amber-50 to-white", text: "text-amber-700", icon: AlertTriangle },
    critical: { bg: "from-rose-50 to-white", text: "text-rose-700", icon: AlertOctagon },
    info: { bg: "from-blue-50 to-white", text: "text-blue-700", icon: Info },
  };
  const t = tones[ins.tone] || tones.info;
  const ICON_MAP = {
    "trending-up": TrendingUp, "trending-down": TrendingDown, "sparkles": Sparkles,
    "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle, "clock": Clock,
    "shield-check": ShieldCheck, "trophy": Trophy, "info": Info,
  };
  const Icon = ICON_MAP[ins.icon] || t.icon;
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${t.bg} p-4`}>
      <div className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider ${t.text}`}>
        <Icon className="h-3.5 w-3.5" /> {ins.tone}
      </div>
      <div className="text-sm font-semibold text-slate-900 mt-1.5 leading-snug">{ins.title}</div>
      {ins.detail && <div className="text-xs text-slate-600 mt-1 leading-relaxed">{ins.detail}</div>}
    </div>
  );
}
