// WMS Dashboard — now an Outlet child of WMSLayout. Re-uses real backend KPIs.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Box, CheckCircle2, Clock, Truck, AlertTriangle, ArrowDownToLine,
  ArrowUpFromLine, Repeat, Pencil, BarChart3, FileBarChart2, ChevronDown,
  ChevronRight, Calendar,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { Api } from "@/lib/api";
import { Card, num, naira } from "./ui";

const MOCK_TREND = [
  { d: "May 12", v: 0.55 }, { d: "May 13", v: 0.78 }, { d: "May 14", v: 0.81 },
  { d: "May 15", v: 1.05 }, { d: "May 16", v: 0.98 }, { d: "May 17", v: 1.18 },
  { d: "May 18", v: 1.15 },
];
const PROD_THUMB = {
  "Soya Oil": ["🛢", "bg-amber-100"], "Vegetable Oil": ["🛢", "bg-amber-100"],
  "Semovita": ["🌾", "bg-yellow-100"], "Wheat Flour": ["🌾", "bg-yellow-100"],
  "Margarine": ["🧈", "bg-orange-100"], "Spread": ["🍯", "bg-rose-100"],
  "Choc": ["🍯", "bg-rose-100"], "Industrial Fat": ["🏭", "bg-slate-100"],
};
const productThumb = (name = "") => {
  const k = Object.keys(PROD_THUMB).find((kk) => name.includes(kk));
  return k ? PROD_THUMB[k] : ["📦", "bg-slate-100"];
};

export default function WMSDashboardPage() {
  const navigate = useNavigate();
  const { warehouseId } = useOutletContext();
  const [summary, setSummary] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (!warehouseId) return;
    Api.wmsSummary(warehouseId).then(setSummary).catch(() => {});
    Api.inventory("warehouse", warehouseId).then(setInventory).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
    Api.wmsListAlerts(warehouseId).then((d) => setAlerts(d.alerts || [])).catch(() => {});
  }, [warehouseId]);

  const enriched = useMemo(() => {
    const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
    return (inventory || []).map((r) => {
      const p = byPid[r.product_id] || {};
      const avail = r.quantity;
      return {
        ...r, product: p, available: avail,
        reserved: Math.round(avail * 0.15),
        damaged: Math.max(0, Math.round(avail * 0.005)),
        expired: Math.max(0, Math.round(avail * 0.001)),
        value: (p.unit_price || 0) * avail,
        sku: p.sku || "—", name: p.name || "—",
      };
    });
  }, [inventory, products]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Warehouse Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time overview of warehouse operations and performance</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Calendar className="h-4 w-4 text-slate-500" /> May 12 – May 18, 2026 <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      {/* KPI row */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard onClick={() => navigate("/wms/inventory")} icon={Box} tint="blue"
          label="Total Inventory" big={num(summary?.total_units || 0)} unit="Cartons"
          sub={<span className="text-slate-500">{naira(summary?.total_value || 0)} <span className="text-slate-400">Value</span></span>} />
        <KpiCard onClick={() => navigate("/wms/inventory")} icon={CheckCircle2} tint="emerald"
          label="Available Inventory" big={num(summary?.available_units || 0)} unit="Cartons"
          sub={<span className="text-emerald-600 font-semibold">{summary?.available_pct || 0}% <span className="text-slate-500 font-normal">of total</span></span>} />
        <KpiCard onClick={() => navigate("/wms/receiving")} icon={Clock} tint="amber"
          label="Inbound Today" big={String(summary?.inbound_today ?? 0)} unit="Shipments"
          sub={<span className="text-slate-500">Tap to view receiving queue</span>} />
        <KpiCard onClick={() => navigate("/wms/dispatch")} icon={Truck} tint="violet"
          label="Outbound Today" big={String(summary?.outbound_today ?? 0)} unit="Shipments"
          sub={<span className="text-slate-500">Tap to view dispatches</span>} />
        <KpiCard onClick={() => navigate("/wms/alerts")} icon={AlertTriangle} tint="rose"
          label="Pending Tasks" big={String(summary?.pending_tasks ?? 0)} unit="Tasks"
          sub={<a className="text-blue-600 hover:underline text-sm font-medium inline-flex items-center gap-0.5">View all tasks <ChevronRight className="h-3.5 w-3.5" /></a>} />
      </section>

      {/* Inventory table + Ops + Alerts */}
      <section className="grid grid-cols-12 gap-6">
        <Card className="col-span-12 xl:col-span-7 p-0 overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Inventory Overview</h2>
            <a onClick={() => navigate("/wms/inventory")} className="cursor-pointer text-sm font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5">View all inventory <ChevronRight className="h-3.5 w-3.5" /></a>
          </div>
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
              {enriched.slice(0, 5).map((r) => {
                const [emoji, bg] = productThumb(r.name);
                return (
                  <tr key={r.id}
                      onClick={() => navigate(`/wms/inventory/${r.product_id}`)}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 cursor-pointer"
                      data-testid={`row-${r.sku}`}>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className={`h-11 w-11 rounded-xl ${bg} grid place-items-center text-xl`}>{emoji}</div>
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
        </Card>

        <Card className="col-span-12 md:col-span-6 xl:col-span-2 p-5">
          <h3 className="font-bold text-slate-900 mb-4">Operations Summary</h3>
          <ul className="space-y-4">
            <OpRow icon={ArrowDownToLine} title="Pending Receipts" value={summary?.inbound_today ?? 0} tint="blue" />
            <OpRow icon={ArrowUpFromLine} title="Pending Dispatches" value={summary?.outbound_today ?? 0} tint="emerald" />
            <OpRow icon={Truck} title="In Transit" value={0} tint="violet" />
            <OpRow icon={CheckCircle2} title="Completed Today" value={0} tint="emerald" />
          </ul>
        </Card>

        <Card className="col-span-12 md:col-span-6 xl:col-span-3 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900">Alerts &amp; Notifications</h3>
            <a onClick={() => navigate("/wms/alerts")} className="cursor-pointer text-xs font-semibold text-blue-600 hover:underline">View all</a>
          </div>
          <ul className="space-y-4">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-start gap-3 cursor-pointer hover:bg-slate-50/60 rounded-lg -mx-2 px-2 py-1.5"
                  onClick={() => navigate(`/wms/alerts?id=${a.id}`)}>
                <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 grid place-items-center shrink-0">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{a.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-snug">{a.message}</div>
                </div>
              </li>
            ))}
            {alerts.length === 0 && (
              <li className="text-sm text-slate-500">No active alerts.</li>
            )}
          </ul>
        </Card>
      </section>

      {/* Trend + Utilization + Quick Actions */}
      <section className="grid grid-cols-12 gap-6 pb-8">
        <Card className="col-span-12 xl:col-span-5 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900">Inventory Value Trend</h3>
            <button className="text-xs text-slate-600 inline-flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1">This Week <ChevronDown className="h-3 w-3" /></button>
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
        </Card>

        <Card className="col-span-12 md:col-span-6 xl:col-span-4 p-5">
          <h3 className="font-bold text-slate-900 mb-3">Warehouse Utilization</h3>
          <div className="flex items-center gap-6">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[{name:"Used",value:68},{name:"Free",value:32}]} dataKey="value" innerRadius={56} outerRadius={84} startAngle={90} endAngle={-270} stroke="none">
                    <Cell fill="#2563eb" /><Cell fill="#10b981" />
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
              <Legend dot="bg-blue-600" label="Used Space" value="6,800 m² (68%)" />
              <Legend dot="bg-emerald-500" label="Available Space" value="3,200 m² (32%)" />
              <div className="pt-3 mt-3 border-t border-slate-100 text-xs text-slate-500">Total Capacity <span className="text-slate-900 font-semibold ml-1">10,000 m²</span></div>
            </div>
          </div>
        </Card>

        <Card className="col-span-12 xl:col-span-3 p-5">
          <h3 className="font-bold text-slate-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-3">
            <QA icon={ArrowDownToLine} label="Receive Shipment" tint="blue"   onClick={() => navigate("/wms/receiving?new=1")} />
            <QA icon={ArrowUpFromLine} label="Create Dispatch"  tint="emerald" onClick={() => navigate("/wms/dispatch?new=1")} />
            <QA icon={Repeat}          label="Stock Transfer"   tint="violet" onClick={() => navigate("/wms/transfers")} />
            <QA icon={Pencil}          label="Adjust Inventory" tint="amber"  onClick={() => navigate("/wms/inventory")} />
            <QA icon={BarChart3}       label="Cycle Count"      tint="indigo" onClick={() => navigate("/wms/cycle-counts")} />
            <QA icon={FileBarChart2}   label="View Reports"     tint="emerald" onClick={() => navigate("/wms/reports")} />
          </div>
        </Card>
      </section>
    </div>
  );
}

const KPI_TINT = {
  blue: "bg-blue-50 text-blue-600 ring-blue-100/40",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100/40",
  amber: "bg-amber-50 text-amber-600 ring-amber-100/40",
  violet: "bg-violet-50 text-violet-600 ring-violet-100/40",
  rose: "bg-rose-50 text-rose-600 ring-rose-100/40",
};

function KpiCard({ icon: Icon, tint, label, big, unit, sub, onClick }) {
  return (
    <div onClick={onClick} className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm cursor-pointer hover:shadow-md hover:border-slate-300 transition" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g,"-")}`}>
      <div className="flex items-start gap-4">
        <div className={`h-12 w-12 rounded-2xl grid place-items-center ring-1 ${KPI_TINT[tint]}`}>
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

const OP_TINT = {
  blue: ["bg-blue-50","text-blue-600"], emerald:["bg-emerald-50","text-emerald-600"],
  violet:["bg-violet-50","text-violet-600"],
};
function OpRow({ icon: Icon, title, value, tint }) {
  const [tile, t] = OP_TINT[tint];
  return (
    <li className="flex items-center gap-3">
      <div className={`h-11 w-11 rounded-xl ${tile} grid place-items-center ${t} shrink-0`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-lg font-bold text-slate-900 leading-none mt-1">{value}</div>
        <div className="text-[11px] text-slate-400">Shipments</div>
      </div>
    </li>
  );
}
function Legend({ dot, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`h-2.5 w-2.5 rounded-full ${dot} mt-1.5 shrink-0`} />
      <div><div className="text-slate-700 font-medium">{label}</div><div className="text-slate-500 text-xs">{value}</div></div>
    </div>
  );
}

const QA_TINT = {
  blue: ["bg-blue-50","text-blue-600"], emerald:["bg-emerald-50","text-emerald-600"],
  violet:["bg-violet-50","text-violet-600"], amber:["bg-amber-50","text-amber-600"],
  indigo:["bg-indigo-50","text-indigo-600"],
};
function QA({ icon: Icon, label, tint, onClick }) {
  const [tile, t] = QA_TINT[tint];
  return (
    <button onClick={onClick} className="rounded-2xl border border-slate-200 hover:border-slate-300 bg-white py-4 flex flex-col items-center justify-center gap-2 hover:shadow-sm transition" data-testid={`qa-${label.toLowerCase().replace(/\s+/g,"-")}`}>
      <div className={`h-10 w-10 rounded-xl ${tile} grid place-items-center ${t}`}><Icon className="h-5 w-5" /></div>
      <div className="text-xs text-slate-600 text-center leading-tight">{label}</div>
    </button>
  );
}
