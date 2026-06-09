import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Boxes, PackageCheck, Truck, ArrowLeftRight, Undo2,
  ClipboardList, FileBarChart2, Bell, Building2, MapPin, Users, Package,
  Settings, Search, Mail, HelpCircle, Plus, ChevronDown, ChevronRight,
  Calendar, Box, CheckCircle2, Clock, AlertTriangle, ShieldAlert,
  ArrowDownToLine, ArrowUpFromLine, Repeat, Pencil, BarChart3,
  TrendingUp, ChevronLeft, Warehouse as WarehouseIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";

const naira = (v) =>
  "₦" + new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(v || 0);
const num = (v) => new Intl.NumberFormat("en-NG").format(v || 0);

const NAV_MAIN = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/wms" },
  { icon: Boxes,            label: "Inventory",  caret: true },
  { icon: ArrowDownToLine,  label: "Receiving",  caret: true },
  { icon: Truck,            label: "Dispatch",   caret: true },
  { icon: ArrowLeftRight,   label: "Transfers",  caret: true },
  { icon: Undo2,            label: "Returns",    caret: true },
  { icon: ClipboardList,    label: "Cycle Counts" },
  { icon: FileBarChart2,    label: "Reports" },
  { icon: Bell,             label: "Alerts" },
];
const NAV_SETUP = [
  { icon: Building2, label: "Warehouses" },
  { icon: MapPin,    label: "Locations" },
  { icon: Users,     label: "Users & Roles" },
  { icon: Package,   label: "Products" },
  { icon: Settings,  label: "Settings" },
];

// Mock data that the design calls for. Inventory rows are merged with REAL
// Flour Mills Apapa Warehouse inventory once it loads.
const MOCK_TREND = [
  { d: "May 12", v: 0.55 }, { d: "May 13", v: 0.78 }, { d: "May 14", v: 0.81 },
  { d: "May 15", v: 1.05 }, { d: "May 16", v: 0.98 }, { d: "May 17", v: 1.18 },
  { d: "May 18", v: 1.15 },
];
const MOCK_PRODUCT_EMOJI = {
  "Soya Oil": "🛢", "Vegetable Oil": "🛢", "Semovita": "🌾", "Wheat Flour": "🌾",
  "Margarine": "🧈", "Spread": "🍯", "Choc": "🍯", "Industrial Fat": "🏭",
};
const PRODUCT_BG = {
  "Soya Oil": "bg-amber-100", "Vegetable Oil": "bg-amber-100",
  "Semovita": "bg-yellow-100", "Wheat Flour": "bg-yellow-100",
  "Margarine": "bg-orange-100", "Spread": "bg-rose-100",
  "Choc": "bg-rose-100", "Industrial Fat": "bg-slate-100",
};

const productThumb = (name = "") => {
  const key = Object.keys(MOCK_PRODUCT_EMOJI).find((k) => name.includes(k));
  return {
    emoji: key ? MOCK_PRODUCT_EMOJI[key] : "📦",
    bg: key ? PRODUCT_BG[key] : "bg-slate-100",
  };
};

const ALERTS = [
  { icon: AlertTriangle, tint: "rose",   title: "Low Stock Alert",
    sub: "5 products are below minimum stock level", ago: "10m ago" },
  { icon: Clock,         tint: "amber",  title: "Expiring Soon",
    sub: "12 products will expire in next 30 days", ago: "25m ago" },
  { icon: ShieldAlert,   tint: "ochre",  title: "Shipment Delay",
    sub: "2 inbound shipments are delayed", ago: "1h ago" },
  { icon: Box,           tint: "indigo", title: "Inventory Variance",
    sub: "3 items have variance above threshold", ago: "2h ago" },
  { icon: Truck,         tint: "violet", title: "Transfer Received",
    sub: "Stock transfer from Abuja Warehouse", ago: "3h ago" },
];

const TINT = {
  rose:   { tile: "bg-rose-50",    text: "text-rose-600",   ago: "text-rose-600"   },
  amber:  { tile: "bg-amber-50",   text: "text-amber-600",  ago: "text-amber-600"  },
  ochre:  { tile: "bg-orange-50",  text: "text-orange-600", ago: "text-orange-600" },
  indigo: { tile: "bg-indigo-50",  text: "text-indigo-600", ago: "text-indigo-600" },
  violet: { tile: "bg-violet-50",  text: "text-violet-600", ago: "text-violet-600" },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function WMSDashboard() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouseOrg, setWarehouseOrg] = useState(null);
  const [tenantName, setTenantName] = useState("Flour Mills Nigeria");
  const [loading, setLoading] = useState(true);

  const warehouseId = session?.entity?.id || session?.user?.entity_id;
  const isWarehouseRole = session?.role === "warehouse";

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        // Resolve the user's warehouse (only meaningful for warehouse role).
        let ownerType = "warehouse";
        let ownerId = warehouseId;
        if (!isWarehouseRole) {
          // Super-admin / others looking at the WMS view — pick the first
          // warehouse org and use it.
          const orgs = await Api.organizations({ organization_type: "warehouse" });
          if (orgs?.length) {
            ownerId = orgs[0].id;
            setWarehouseOrg(orgs[0]);
          }
        } else {
          const me = await Api.organization(warehouseId);
          setWarehouseOrg(me);
        }
        const [inv, prods] = await Promise.all([
          Api.inventory(ownerType, ownerId),
          Api.products(),
        ]);
        setInventory(inv || []);
        setProducts(prods || []);
      } catch (e) {
        // empty state is fine
      } finally {
        setLoading(false);
      }
    })();
  }, [session, warehouseId, isWarehouseRole]);

  // ---- Compose derived KPIs from inventory ----
  const enriched = useMemo(() => {
    const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
    return (inventory || []).map((r) => {
      const p = byPid[r.product_id] || {};
      const available = r.quantity;
      // Synthetic figures that mirror real WMS dashboards.
      const reserved = Math.round(available * 0.15);
      const damaged  = Math.max(0, Math.round(available * 0.005));
      const expired  = Math.max(0, Math.round(available * 0.001));
      const value    = (p.unit_price || 0) * available;
      return {
        ...r, product: p, available, reserved, damaged, expired, value,
        sku: p.sku || "—", name: p.name || "—",
      };
    });
  }, [inventory, products]);

  const totals = useMemo(() => {
    const totalCartons = enriched.reduce((s, r) => s + r.available + r.reserved, 0);
    const totalValue   = enriched.reduce((s, r) => s + r.value, 0);
    const availCartons = enriched.reduce((s, r) => s + r.available, 0);
    return {
      totalCartons: totalCartons || 125430,
      totalValue:   totalValue   || 1245320000,
      availCartons: availCartons || 98230,
      availPct: totalCartons ? Math.round((availCartons / totalCartons) * 1000) / 10 : 78.3,
    };
  }, [enriched]);

  return (
    <div className="flex min-h-screen bg-slate-50/60 text-slate-800">
      {/* SIDEBAR */}
      <Sidebar
        warehouseName={warehouseOrg?.organization_name || "Apapa Warehouse"}
        warehouseCity={warehouseOrg?.city || "Lagos"}
        userName={session?.user?.name || session?.user?.email?.split("@")[0] || "John Adeyemi"}
        userRole={isWarehouseRole ? "Warehouse Manager" : (session?.role || "Operator")}
        onSignOut={() => { signOut(); navigate("/login"); }}
      />

      {/* MAIN COLUMN */}
      <div className="flex-1 min-w-0">
        <TopBar tenantName={tenantName}
                warehouseName={warehouseOrg?.organization_name || "Apapa Warehouse"}
                warehouseCity={warehouseOrg?.city || "Lagos, Nigeria"} />

        <main className="px-8 py-6 space-y-6">
          {/* Page heading */}
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                Warehouse Dashboard
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Real-time overview of warehouse operations and performance
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Calendar className="h-4 w-4 text-slate-500" />
                May 12 – May 18, 2026
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* KPI Row */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard
              icon={Box} tint="blue"
              label="Total Inventory"
              big={num(totals.totalCartons)} unit="Cartons"
              sub={<span className="text-slate-500">{naira(totals.totalValue)} <span className="text-slate-400">Value</span></span>}
            />
            <KpiCard
              icon={CheckCircle2} tint="emerald"
              label="Available Inventory"
              big={num(totals.availCartons)} unit="Cartons"
              sub={<span className="text-emerald-600 font-semibold">{totals.availPct}% <span className="text-slate-500 font-normal">of total</span></span>}
            />
            <KpiCard
              icon={Clock} tint="amber"
              label="Inbound Today" big="12" unit="Shipments"
              sub={<span className="text-slate-500"><strong className="text-slate-900">5,430</strong> Cartons</span>}
            />
            <KpiCard
              icon={Truck} tint="violet"
              label="Outbound Today" big="18" unit="Shipments"
              sub={<span className="text-slate-500"><strong className="text-slate-900">7,890</strong> Cartons</span>}
            />
            <KpiCard
              icon={AlertTriangle} tint="rose"
              label="Pending Tasks" big="24" unit="Tasks"
              sub={<a className="text-blue-600 hover:underline text-sm font-medium inline-flex items-center gap-0.5">View all tasks <ChevronRight className="h-3.5 w-3.5" /></a>}
            />
          </section>

          {/* MIDDLE: Inventory Table + Operations + Alerts */}
          <section className="grid grid-cols-12 gap-6">
            <InventoryOverview rows={enriched} loading={loading} />
            <OperationsSummary />
            <AlertsPanel />
          </section>

          {/* BOTTOM: Trend + Utilization + Quick Actions */}
          <section className="grid grid-cols-12 gap-6 pb-8">
            <TrendChart />
            <UtilizationChart />
            <QuickActions />
          </section>
        </main>
      </div>
    </div>
  );
}

// ===========================================================================
// Sidebar
// ===========================================================================
function Sidebar({ warehouseName, warehouseCity, userName, userRole, onSignOut }) {
  return (
    <aside className="w-[260px] shrink-0 bg-[#0B1838] text-slate-300 flex flex-col"
           data-testid="wms-sidebar">
      {/* Logo */}
      <div className="px-5 pt-5 pb-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-500/90 grid place-items-center text-white shadow-lg shadow-blue-900/40">
          <WarehouseIcon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-white font-semibold tracking-tight">TradeKonekt</div>
          <div className="text-[11px] tracking-[0.18em] text-slate-400 uppercase">WMS</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 mt-2">
        <NavSection title="Main" items={NAV_MAIN} activeLabel="Dashboard" />
        <NavSection title="Setup" items={NAV_SETUP} />
      </div>

      {/* Current warehouse card */}
      <div className="px-3 pt-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 px-2 mb-2">
          Current Warehouse
        </div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center text-blue-200">
            <WarehouseIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-sm font-semibold truncate">{warehouseName}</div>
            <div className="text-xs text-slate-400 truncate">{warehouseCity}, Nigeria</div>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
        </div>
      </div>

      {/* User card */}
      <div className="px-3 pt-3 pb-3">
        <button onClick={onSignOut}
          className="w-full rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3 hover:bg-white/10 transition"
          data-testid="wms-user-card">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white text-sm font-bold ring-2 ring-emerald-500/30">
            {(userName || "?").split(" ").map((w) => w[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-white text-sm font-semibold truncate">{userName}</div>
            <div className="text-xs text-slate-400 truncate">{userRole}</div>
          </div>
        </button>
      </div>

      <button className="px-5 py-3 border-t border-white/10 flex items-center gap-2 text-slate-400 text-sm hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Collapse
      </button>
    </aside>
  );
}

function NavSection({ title, items, activeLabel }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 px-3 mb-2">{title}</div>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const active = it.label === activeLabel;
          return (
            <li key={it.label}>
              <button
                className={[
                  "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition",
                  active
                    ? "bg-white text-[#0B1838] font-semibold shadow"
                    : "text-slate-300 hover:bg-white/5 hover:text-white",
                ].join(" ")}
                data-testid={`nav-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <it.icon className={`h-4.5 w-4.5 ${active ? "text-[#0B1838]" : "text-slate-400"}`} />
                <span className="flex-1 text-left">{it.label}</span>
                {it.caret && <ChevronDown className={`h-4 w-4 ${active ? "text-[#0B1838]" : "text-slate-500"}`} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ===========================================================================
// TopBar
// ===========================================================================
function TopBar({ tenantName, warehouseName, warehouseCity }) {
  return (
    <header className="bg-white border-b border-slate-200/80 px-8 py-4 flex items-center gap-4">
      <Selector
        logo={<div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-[10px] font-black grid place-items-center">FMN</div>}
        title={tenantName} subtitle="Manufacturer"
      />
      <Selector
        logo={<div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 grid place-items-center"><WarehouseIcon className="h-4 w-4" /></div>}
        title={warehouseName} subtitle={warehouseCity}
      />
      <div className="flex-1 max-w-2xl relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search anything..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-16 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 border border-slate-200 px-1.5 rounded">
          Ctrl + K
        </span>
      </div>
      <div className="flex items-center gap-2">
        <IconBtn icon={Bell} count={12} />
        <IconBtn icon={Mail} count={5} dot="bg-rose-500" />
        <IconBtn icon={HelpCircle} />
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white text-sm font-bold ring-2 ring-emerald-500/30">JA</div>
        <button className="ml-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white px-4 py-2.5 text-sm font-semibold shadow-lg shadow-blue-500/20 hover:from-blue-600 hover:to-blue-800">
          <Plus className="h-4 w-4" /> Create New <ChevronDown className="h-3.5 w-3.5 opacity-80" />
        </button>
      </div>
    </header>
  );
}

function Selector({ logo, title, subtitle }) {
  return (
    <button className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 min-w-[210px]">
      {logo}
      <div className="text-left min-w-0">
        <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
        <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
      </div>
      <ChevronDown className="h-4 w-4 text-slate-400 ml-auto" />
    </button>
  );
}

function IconBtn({ icon: Icon, count, dot }) {
  return (
    <button className="relative h-10 w-10 rounded-xl border border-slate-200 bg-white grid place-items-center text-slate-600 hover:bg-slate-50">
      <Icon className="h-4.5 w-4.5" />
      {count != null && (
        <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white grid place-items-center px-1 ${dot || "bg-rose-500"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// KPI Card
// ===========================================================================
const KPI_TINT = {
  blue:    { tile: "bg-blue-50",    icon: "text-blue-600",    ring: "ring-blue-100/40"  },
  emerald: { tile: "bg-emerald-50", icon: "text-emerald-600", ring: "ring-emerald-100/40" },
  amber:   { tile: "bg-amber-50",   icon: "text-amber-600",   ring: "ring-amber-100/40" },
  violet:  { tile: "bg-violet-50",  icon: "text-violet-600",  ring: "ring-violet-100/40" },
  rose:    { tile: "bg-rose-50",    icon: "text-rose-600",    ring: "ring-rose-100/40"  },
};

function KpiCard({ icon: Icon, tint, label, big, unit, sub }) {
  const c = KPI_TINT[tint];
  return (
    <div className={`rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm`} data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-start gap-4">
        <div className={`h-12 w-12 rounded-2xl ${c.tile} grid place-items-center ${c.icon} ring-1 ${c.ring}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-500">{label}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <div className="text-2xl font-bold text-slate-900 leading-none">{big}</div>
            <div className="text-xs text-slate-500">{unit}</div>
          </div>
          <div className="mt-3 text-xs">{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Inventory Overview Table
// ===========================================================================
function InventoryOverview({ rows, loading }) {
  return (
    <div className="col-span-12 xl:col-span-7 rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="px-6 py-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Inventory Overview</h2>
        <a className="text-sm font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5">
          View all inventory <ChevronRight className="h-3.5 w-3.5" />
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 border-y border-slate-200 bg-slate-50/60">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Product</th>
              <th className="text-left py-3 font-medium">SKU</th>
              <th className="text-left py-3 font-medium">Available</th>
              <th className="text-left py-3 font-medium">Reserved</th>
              <th className="text-left py-3 font-medium">Damaged</th>
              <th className="text-left py-3 font-medium">Expired</th>
              <th className="text-right py-3 px-6 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-12">Loading inventory…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-12">No inventory rows for this warehouse yet.</td></tr>
            )}
            {rows.slice(0, 5).map((r) => {
              const t = productThumb(r.name);
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-xl ${t.bg} grid place-items-center text-xl`}>
                        {t.emoji}
                      </div>
                      <div className="font-medium text-slate-800 leading-tight">{r.name}</div>
                    </div>
                  </td>
                  <td className="py-4 text-slate-600">{r.sku}</td>
                  <td className="py-4 text-emerald-600 font-semibold">{num(r.available)}</td>
                  <td className="py-4 text-blue-600 font-semibold">{num(r.reserved)}</td>
                  <td className="py-4 text-amber-600 font-semibold">{num(r.damaged)}</td>
                  <td className={`py-4 font-semibold ${r.expired > 0 ? "text-rose-600" : "text-slate-400"}`}>{num(r.expired)}</td>
                  <td className="py-4 px-6 text-right font-semibold text-slate-800">{naira(r.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 text-xs text-slate-500 flex items-center justify-center gap-2 border-t border-slate-100">
        Showing top 5 of {rows.length || 120} products
        <a className="text-blue-600 font-medium hover:underline">View all</a>
      </div>
    </div>
  );
}

// ===========================================================================
// Operations Summary
// ===========================================================================
function OperationsSummary() {
  const items = [
    { icon: ArrowDownToLine, tint: "blue",    title: "Pending Receipts",   value: 8,  label: "Shipments" },
    { icon: ArrowUpFromLine, tint: "emerald", title: "Pending Dispatches", value: 14, label: "Shipments" },
    { icon: Truck,           tint: "violet",  title: "In Transit",         value: 11, label: "Shipments" },
    { icon: CheckCircle2,    tint: "emerald", title: "Completed Today",    value: 22, label: "Shipments" },
  ];
  return (
    <div className="col-span-12 md:col-span-6 xl:col-span-2.5 lg:col-span-6 xl:col-start-8 xl:col-span-2 rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900">Operations Summary</h3>
        <a className="text-xs font-semibold text-blue-600 hover:underline">View all</a>
      </div>
      <ul className="space-y-4">
        {items.map((it) => (
          <li key={it.title} className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl bg-${it.tint === 'blue' ? 'blue' : it.tint === 'emerald' ? 'emerald' : 'violet'}-50 grid place-items-center text-${it.tint === 'blue' ? 'blue' : it.tint === 'emerald' ? 'emerald' : 'violet'}-600 shrink-0`}>
              <it.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">{it.title}</div>
              <div className="text-lg font-bold text-slate-900 leading-none mt-1">{it.value}</div>
              <div className="text-[11px] text-slate-400">{it.label}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Alerts panel
// ===========================================================================
function AlertsPanel() {
  return (
    <div className="col-span-12 md:col-span-6 xl:col-span-3 rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900">Alerts &amp; Notifications</h3>
        <a className="text-xs font-semibold text-blue-600 hover:underline">View all</a>
      </div>
      <ul className="space-y-4">
        {ALERTS.map((a) => {
          const t = TINT[a.tint];
          return (
            <li key={a.title} className="flex items-start gap-3">
              <div className={`h-9 w-9 rounded-xl ${t.tile} grid place-items-center ${t.text} shrink-0`}>
                <a.icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 truncate">{a.title}</div>
                  <div className={`text-[11px] font-medium ${t.ago} shrink-0`}>{a.ago}</div>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 leading-snug">{a.sub}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ===========================================================================
// Trend chart
// ===========================================================================
function TrendChart() {
  return (
    <div className="col-span-12 xl:col-span-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-900">Inventory Value Trend</h3>
        <button className="text-xs text-slate-600 inline-flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1">
          This Week <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={MOCK_TREND} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="d" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `₦${v}B`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `₦${v}B`} />
            <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: "#2563eb" }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ===========================================================================
// Utilization Donut
// ===========================================================================
function UtilizationChart() {
  const data = [{ name: "Used", value: 68 }, { name: "Available", value: 32 }];
  return (
    <div className="col-span-12 md:col-span-6 xl:col-span-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
      <h3 className="font-bold text-slate-900 mb-3">Warehouse Utilization</h3>
      <div className="flex items-center gap-6">
        <div className="relative h-44 w-44 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={56} outerRadius={84} startAngle={90} endAngle={-270} stroke="none">
                <Cell fill="#2563eb" />
                <Cell fill="#10b981" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center">
              <div className="text-3xl font-extrabold text-slate-900 leading-none">68%</div>
              <div className="text-xs text-slate-500 mt-1">Utilized</div>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <Legend dotColor="bg-blue-600" label="Used Space" value="6,800 m² (68%)" />
          <Legend dotColor="bg-emerald-500" label="Available Space" value="3,200 m² (32%)" />
          <div className="pt-3 mt-3 border-t border-slate-100 text-xs text-slate-500">
            Total Capacity <span className="text-slate-900 font-semibold ml-1">10,000 m²</span>
          </div>
        </div>
      </div>
    </div>
  );
}
function Legend({ dotColor, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor} mt-1.5 shrink-0`} />
      <div>
        <div className="text-slate-700 font-medium">{label}</div>
        <div className="text-slate-500 text-xs">{value}</div>
      </div>
    </div>
  );
}

// ===========================================================================
// Quick Actions
// ===========================================================================
function QuickActions() {
  const items = [
    { icon: ArrowDownToLine, label: "Receive Shipment", tint: "blue" },
    { icon: ArrowUpFromLine, label: "Create Dispatch",  tint: "emerald" },
    { icon: Repeat,          label: "Stock Transfer",   tint: "violet" },
    { icon: Pencil,          label: "Adjust Inventory", tint: "amber" },
    { icon: BarChart3,       label: "Cycle Count",      tint: "indigo" },
    { icon: FileBarChart2,   label: "View Reports",     tint: "emerald" },
  ];
  const TILE = {
    blue:    { tile: "bg-blue-50",    icon: "text-blue-600"    },
    emerald: { tile: "bg-emerald-50", icon: "text-emerald-600" },
    violet:  { tile: "bg-violet-50",  icon: "text-violet-600"  },
    amber:   { tile: "bg-amber-50",   icon: "text-amber-600"   },
    indigo:  { tile: "bg-indigo-50",  icon: "text-indigo-600"  },
  };
  return (
    <div className="col-span-12 xl:col-span-3 rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
      <h3 className="font-bold text-slate-900 mb-4">Quick Actions</h3>
      <div className="grid grid-cols-3 gap-3">
        {items.map((it) => {
          const c = TILE[it.tint];
          return (
            <button key={it.label}
              className="rounded-2xl border border-slate-200 hover:border-slate-300 bg-white py-4 flex flex-col items-center justify-center gap-2 hover:shadow-sm transition"
              data-testid={`qa-${it.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className={`h-10 w-10 rounded-xl ${c.tile} grid place-items-center ${c.icon}`}>
                <it.icon className="h-5 w-5" />
              </div>
              <div className="text-xs text-slate-600 text-center leading-tight">{it.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
