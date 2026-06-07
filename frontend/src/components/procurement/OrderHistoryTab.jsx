/**
 * Order History — searchable historical orders with multi-filter controls
 * (supplier, status, date range, product) and CSV export.
 */
import { useEffect, useMemo, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar, Search, Filter, Download, History as HistoryIcon, Loader2, ChevronRight } from "lucide-react";
import POStatusBadge from "./POStatusBadge";
import PODetailDrawer from "./PODetailDrawer";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_OPTIONS = ["all", "draft", "submitted", "approved", "processing", "shipped", "delivered", "cancelled", "rejected"];

export default function OrderHistoryTab({ retailerId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState("all");
  const [productId, setProductId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState({ open: false, id: null });

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.purchaseOrders({ retailer_id: retailerId })
      .then((rs) => {
        if (cancelled) return;
        const list = rs || [];
        setOrders(list);
        const seen = new Set();
        setSuppliers(list.filter((r) => {
          if (seen.has(r.distributor?.id)) return false;
          seen.add(r.distributor?.id);
          return !!r.distributor?.id;
        }).map((r) => r.distributor));
        const seenP = new Set();
        const ps = [];
        list.forEach((r) => (r.items || []).forEach((it) => {
          if (it.product?.id && !seenP.has(it.product.id)) {
            seenP.add(it.product.id);
            ps.push(it.product);
          }
        }));
        setProducts(ps);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId]);

  const filtered = useMemo(() => {
    let rows = orders;
    if (supplier !== "all") rows = rows.filter((r) => r.distributor?.id === supplier);
    if (status !== "all") rows = rows.filter((r) => r.status === status);
    if (productId !== "all") rows = rows.filter((r) => (r.items || []).some((it) => it.product?.id === productId));
    if (dateFrom) rows = rows.filter((r) => r.created_at >= dateFrom);
    if (dateTo) rows = rows.filter((r) => r.created_at <= (dateTo + "T23:59:59"));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.po_number?.toLowerCase().includes(q) ||
        r.distributor?.name?.toLowerCase().includes(q) ||
        (r.items || []).some((it) => it.product?.name?.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [orders, supplier, status, productId, dateFrom, dateTo, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    spend: filtered.reduce((a, b) => a + (b.total_amount || 0), 0),
    units: filtered.reduce((a, b) => a + (b.items || []).reduce((x, y) => x + (y.quantity || 0), 0), 0),
  }), [filtered]);

  const exportCsv = () => {
    const header = ["PO #", "Supplier", "Date", "Status", "Items", "Units", "Amount"];
    const rows = filtered.map((r) => [
      r.po_number, r.distributor?.name || "", r.created_at, r.status,
      (r.items || []).length,
      (r.items || []).reduce((a, b) => a + (b.quantity || 0), 0),
      r.total_amount,
    ]);
    const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `procurement-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4" data-testid="order-history-tab">
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="h-4 w-4 text-slate-400" />
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger data-testid="filter-supplier"><SelectValue placeholder="Supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger data-testid="filter-product"><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="pl-9" data-testid="filter-date-from" />
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="pl-9" data-testid="filter-date-to" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Free-text search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="filter-search"
              />
            </div>
            <Button variant="outline" onClick={exportCsv} data-testid="export-csv">
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between text-sm">
        <div className="text-slate-600">
          <span className="font-semibold text-slate-900">{totals.count}</span> orders ·
          <span className="font-semibold text-slate-900 ml-2">{totals.units}</span> units
        </div>
        <div className="text-slate-600">
          Total spend: <span className="font-semibold text-violet-700">{fmtMoney(totals.spend)}</span>
        </div>
      </div>

      <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <CardContent className="p-12 text-center text-slate-400">
            <HistoryIcon className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            No orders match your filters.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="history-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold">PO #</th>
                  <th className="text-left px-5 py-3 font-semibold">Supplier</th>
                  <th className="text-left px-5 py-3 font-semibold">Date</th>
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
                    data-testid={`history-row-${po.po_number}`}
                  >
                    <td className="px-5 py-3 font-mono text-slate-900 font-semibold">{po.po_number}</td>
                    <td className="px-5 py-3 text-slate-700">{po.distributor?.name || "—"}</td>
                    <td className="px-5 py-3 text-slate-500 tabular-nums">{fmtDate(po.created_at)}</td>
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
      />
    </div>
  );
}

function Loading() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-10 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading history…
    </div>
  );
}
