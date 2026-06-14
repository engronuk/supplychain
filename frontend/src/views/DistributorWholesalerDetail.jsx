/**
 * Distributor → Wholesaler → Retailer drill-down page.
 *
 * The middle tier of the strict ownership chain. Navigation MUST land here
 * before any retailer detail page is reachable from a distributor context.
 *
 * Route: /distributor/:distributorId/wholesaler/:wholesalerId
 *
 * Backend: GET /api/distributor/{distributor_id}/wholesaler/{wholesaler_id}/detail
 */
import { useEffect, useState, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, Store, ShoppingBag, TrendingUp, Activity, ClipboardList,
  Loader2, ArrowUpRight, Search, MapPin, Mail,
} from "lucide-react";

const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtDate = (v) => v
  ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

const STATUS_TONE = {
  healthy:   { dot: "#10b981", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  attention: { dot: "#f59e0b", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  critical:  { dot: "#ef4444", chip: "bg-rose-50 text-rose-700 border-rose-200" },
};

const PO_TONE = {
  submitted:  "bg-blue-50 text-blue-700 border-blue-200",
  approved:   "bg-violet-50 text-violet-700 border-violet-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
  shipped:    "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled:  "bg-slate-50 text-slate-600 border-slate-200",
};

export default function DistributorWholesalerDetail() {
  const { distributorId, wholesalerId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!distributorId || !wholesalerId) return;
    let live = true;
    setLoading(true);
    Api.distributorWholesalerDetail(distributorId, wholesalerId)
      .then((d) => { if (live) { setData(d); setErr(null); } })
      .catch((e) => { if (live) setErr(e?.response?.data?.detail || "Failed to load wholesaler"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [distributorId, wholesalerId]);

  const wholesaler = data?.wholesaler;
  const kpis = data?.kpis || {};
  const retailers = data?.retailers || [];
  const recentOrders = data?.recent_orders_from_retailers || data?.recent_orders || [];
  const incomingPOs = data?.incoming_purchase_orders || [];

  const filteredRetailers = useMemo(() => {
    if (!search.trim()) return retailers;
    const s = search.trim().toLowerCase();
    return retailers.filter((r) =>
      (r.name || "").toLowerCase().includes(s)
      || (r.code || "").toLowerCase().includes(s)
      || (r.city || "").toLowerCase().includes(s)
    );
  }, [retailers, search]);

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center text-slate-500" data-testid="ws-detail-loading">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading wholesaler…
      </div>
    );
  }
  if (err) {
    return (
      <div className="p-8 max-w-3xl mx-auto" data-testid="ws-detail-error">
        <Card><CardContent className="p-8 text-center">
          <p className="text-rose-600 font-semibold mb-2">{err}</p>
          <p className="text-sm text-slate-500 mb-4">
            Wholesalers can only be opened through a distributor that owns them.
          </p>
          <Button variant="outline" onClick={() => navigate(-1)}>Go back</Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto" data-testid="ws-detail-page">
      {/* Breadcrumb — enforces strict tier path */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-3" data-testid="ws-breadcrumb">
        <Link to="/dashboard" className="hover:text-slate-900">Distributor</Link>
        <span>›</span>
        <Link to="/network" className="hover:text-slate-900">Wholesalers</Link>
        <span>›</span>
        <span className="text-slate-900 font-medium">{wholesaler?.name || "Wholesaler"}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/network")} className="-ml-2 mb-1 text-slate-500">
            <ChevronLeft className="h-4 w-4 mr-1" /> All wholesalers
          </Button>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Wholesaler · downstream tier</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5" data-testid="ws-detail-title">{wholesaler?.name}</h1>
          <div className="text-[13px] text-slate-500 mt-1 flex items-center flex-wrap gap-x-3">
            <span><span className="font-mono text-slate-700">{wholesaler?.code}</span></span>
            {wholesaler?.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {wholesaler.city}, {wholesaler.region}
              </span>
            )}
            {wholesaler?.contact_email && (
              <a href={`mailto:${wholesaler.contact_email}`} className="inline-flex items-center gap-1 hover:text-violet-700">
                <Mail className="h-3 w-3" /> {wholesaler.contact_email}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="ws-detail-kpis">
        <KpiTile Icon={Store} label="Retailers owned" value={fmtInt(kpis.total_retailers)}
          sub={`${kpis.active_retailers_30d ?? 0} active 30d`} tone="violet" />
        <KpiTile Icon={Activity} label="Revenue · 90d" value={fmtMoney(kpis.revenue_90d)}
          sub="aggregated across retailers" tone="emerald" />
        <KpiTile Icon={ClipboardList} label="Pending orders from retailers" value={fmtInt(kpis.pending_orders_from_retailers)}
          sub="awaiting wholesaler fulfilment" tone="amber" />
        <KpiTile Icon={ShoppingBag} label="Pending PO to distributor" value={fmtInt(kpis.pending_procurement_to_distributor)}
          sub="upstream replenishment" tone="blue" />
      </div>

      {/* Retailers table — the *only* path into a retailer from a distributor context */}
      <Card className="mb-6"><CardContent className="p-0">
        <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4 flex-wrap border-b border-slate-100">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Retailers owned by this wholesaler</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5">Retailer Directory · ownership: wholesaler</h3>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search retailer…"
              className="pl-9 w-72 h-9"
              data-testid="retailers-under-wholesaler-search"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table data-testid="retailers-under-wholesaler-table">
            <TableHeader>
              <TableRow>
                <TableHead>Retailer</TableHead>
                <TableHead className="text-right">Revenue (90d)</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Last sale</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRetailers.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-slate-500">
                  {retailers.length === 0
                    ? "No retailers owned by this wholesaler yet."
                    : "No retailers match your search."}
                </TableCell></TableRow>
              )}
              {filteredRetailers.map((r) => {
                const tone = STATUS_TONE[r.status] || STATUS_TONE.attention;
                // Detail route — distributor's drill into a retailer goes
                // through the wholesaler-owned context so the tier path is
                // visible in the URL.
                const detailTo = `/distributors/${distributorId}/retailers/${r.id}?via=${wholesalerId}`;
                return (
                  <TableRow key={r.id} data-testid={`retailer-row-${r.id}`} className="hover:bg-slate-50/50">
                    <TableCell>
                      <Link to={detailTo} className="group">
                        <div className="font-medium text-slate-900 group-hover:text-violet-600 flex items-center gap-1 transition-colors">
                          {r.name}
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {r.code} · {r.city || "—"}, {r.region || "—"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-slate-900">{fmtMoney(r.revenue_90d)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">{fmtInt(r.units_90d)}</TableCell>
                    <TableCell className="text-[12.5px] text-slate-600">{fmtDate(r.last_sale_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${tone.chip}`}>
                        <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: tone.dot }} />
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Link to={detailTo}
                        className="text-xs font-semibold text-violet-700 hover:text-violet-900"
                        data-testid={`retailer-drill-${r.id}`}>
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>

      {/* Recent retailer orders & upstream procurement (two-up) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="recent-retailer-orders-card"><CardContent className="p-0">
          <div className="px-6 pt-5 pb-3 border-b border-slate-100">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Recent retailer → wholesaler</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5">Recent orders from retailers</h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Retailer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">No retailer orders yet.</TableCell></TableRow>
                )}
                {recentOrders.slice(0, 10).map((o) => (
                  <TableRow key={o.id} data-testid={`recent-retailer-order-${o.id}`}>
                    <TableCell className="font-mono text-[11.5px] text-slate-600">{o.po_number}</TableCell>
                    <TableCell className="text-[12.5px] text-slate-700">{o.retailer_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(o.total_amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${PO_TONE[o.status] || PO_TONE.cancelled}`}>{o.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent></Card>

        <Card data-testid="incoming-procurement-card"><CardContent className="p-0">
          <div className="px-6 pt-5 pb-3 border-b border-slate-100">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Upstream procurement</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5">Wholesaler → distributor POs (you)</h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomingPOs.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">No upstream procurement yet.</TableCell></TableRow>
                )}
                {incomingPOs.slice(0, 10).map((p) => (
                  <TableRow key={p.id} data-testid={`incoming-po-${p.id}`}>
                    <TableCell className="font-mono text-[11.5px] text-slate-600">{p.po_number}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">{p.line_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(p.total_amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${PO_TONE[p.status] || PO_TONE.cancelled}`}>{p.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

function KpiTile({ Icon, label, value, sub, tone }) {
  const tones = {
    violet:  "from-violet-50 to-white text-violet-700",
    blue:    "from-blue-50 to-white text-blue-700",
    emerald: "from-emerald-50 to-white text-emerald-700",
    amber:   "from-amber-50 to-white text-amber-700",
  };
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <div className="text-[10.5px] uppercase tracking-[0.16em] font-semibold opacity-80">{label}</div>
      </div>
      <div className="text-[20px] font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
