/**
 * Purchase Orders Tab — active/open POs grouped by lifecycle stage with
 * top KPI strip, status filter pills, table view and right-side drawer.
 */
import { useEffect, useMemo, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, ChevronRight, FileText, Loader2, Filter, ListChecks,
} from "lucide-react";
import POStatusBadge from "./POStatusBadge";
import PODetailDrawer from "./PODetailDrawer";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_TABS = [
  { key: "all",         label: "All" },
  { key: "draft",       label: "Drafts" },
  { key: "submitted",   label: "Submitted" },
  { key: "approved",    label: "Approved" },
  { key: "processing",  label: "Processing" },
  { key: "shipped",     label: "Shipped" },
  { key: "delivered",   label: "Delivered" },
  { key: "cancelled",   label: "Cancelled" },
  { key: "rejected",    label: "Rejected" },
];

export default function PurchaseOrdersTab({ retailerId, onMutated }) {
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState({ open: false, id: null });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.purchaseOrders({ retailer_id: retailerId })
      .then((r) => { if (!cancelled) { setOrders(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId, reloadKey]);

  const counts = useMemo(() => {
    const c = { all: orders?.length || 0 };
    for (const t of STATUS_TABS) {
      if (t.key === "all") continue;
      c[t.key] = (orders || []).filter((o) => o.status === t.key).length;
    }
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) =>
        o.po_number?.toLowerCase().includes(q) ||
        o.distributor?.name?.toLowerCase().includes(q) ||
        (o.items || []).some((it) => it.product?.name?.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [orders, statusFilter, search]);

  // Stable 90-day cutoff captured once via lazy state initializer
  // (lazy initializers are pure to the lint rule).
  const [cutoff90] = useState(() => new Date(Date.now() - 90 * 86400000).toISOString());
  const stats = {
    open: (orders || []).filter((o) =>
      ["draft", "submitted", "approved", "processing", "shipped"].includes(o.status)).length,
    in_transit: (orders || []).filter((o) => o.status === "shipped").length,
    spend_90: (orders || [])
      .filter((o) => (o.created_at || "") > cutoff90)
      .reduce((a, b) => a + (b.total_amount || 0), 0),
    delivered: (orders || []).filter((o) => o.status === "delivered").length,
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4" data-testid="purchase-orders-tab">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Open POs" value={stats.open} accent="text-violet-700" testId="kpi-open-pos" />
        <Kpi label="In Transit" value={stats.in_transit} accent="text-indigo-700" testId="kpi-in-transit" />
        <Kpi label="90-day spend" value={fmtMoney(stats.spend_90)} accent="text-slate-900" testId="kpi-90d-spend" />
        <Kpi label="Delivered" value={stats.delivered} accent="text-emerald-700" testId="kpi-delivered" />
      </div>

      {/* Filter & search bar */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                data-testid={`po-filter-${t.key}`}
                className={`inline-flex items-center gap-2 h-8 rounded-full px-3 text-[12px] font-semibold transition-colors ${
                  statusFilter === t.key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {t.label}
                <span className={`tabular-nums text-[10px] rounded-full px-1.5 ${
                  statusFilter === t.key ? "bg-white/20" : "bg-white"
                }`}>{counts[t.key] || 0}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by PO #, supplier or product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="po-search"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <CardContent className="p-12 text-center text-slate-400">
            <ListChecks className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            No purchase orders match your filters.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="po-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold">PO #</th>
                  <th className="text-left px-5 py-3 font-semibold">Supplier</th>
                  <th className="text-left px-5 py-3 font-semibold">Date</th>
                  <th className="text-right px-5 py-3 font-semibold">Items</th>
                  <th className="text-right px-5 py-3 font-semibold">Amount</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => setDrawer({ open: true, id: po.id })}
                    className="hover:bg-violet-50/40 cursor-pointer"
                    data-testid={`po-row-${po.po_number}`}
                  >
                    <td className="px-5 py-3 font-mono text-slate-900 font-semibold">{po.po_number}</td>
                    <td className="px-5 py-3 text-slate-700">{po.distributor?.name || "—"}</td>
                    <td className="px-5 py-3 text-slate-500 tabular-nums">{fmtDate(po.created_at)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{po.items?.length || 0}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{fmtMoney(po.total_amount)}</td>
                    <td className="px-5 py-3"><POStatusBadge status={po.status} /></td>
                    <td className="px-2 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PODetailDrawer
        poId={drawer.id}
        open={drawer.open}
        onOpenChange={(o) => setDrawer({ ...drawer, open: o })}
        role="retailer"
        onMutated={() => { reload(); onMutated?.(); }}
      />
    </div>
  );
}

function Kpi({ label, value, accent, testId }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200" data-testid={testId}>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-10 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading purchase orders…
    </div>
  );
}
