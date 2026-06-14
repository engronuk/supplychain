import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  ArrowUpRight, Download, ShoppingBag, Activity, TrendingUp, MapPin, Eye,
} from "lucide-react";
import ManufacturerNetworkIntelligence from "./ManufacturerNetworkIntelligence";
import WholesalerDistributors from "./WholesalerDistributors";

// --- helpers
const healthTone = (s) =>
  s === "healthy" ? { dot: "#10b981", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" } :
  s === "warning" ? { dot: "#f59e0b", chip: "bg-amber-50 text-amber-700 border-amber-200" } :
  s === "critical" ? { dot: "#ef4444", chip: "bg-rose-50 text-rose-700 border-rose-200" } :
  { dot: "#94a3b8", chip: "bg-slate-50 text-slate-600 border-slate-200" };
const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

export default function NetworkView() {
  const { session } = useSession();
  const role = session.role;
  if (role === "manufacturer") return <ManufacturerNetworkIntelligence />;
  if (role === "distributor") return <DistributorWholesalerNetwork session={session} />;
  if (role === "wholesaler") return <WholesalerDistributors />;
  return <div className="p-8 text-slate-500">Network view is only available for manufacturer, distributor & wholesaler roles.</div>;
}

// ============================================================================
// DISTRIBUTOR — Wholesaler Network (strict ownership tier)
//
// Distributor direct children = Wholesalers. Retailers are owned by wholesalers
// and therefore only accessible by drilling INTO a wholesaler row. Navigation
// must NEVER skip the wholesaler tier.
// ============================================================================
function DistributorWholesalerNetwork({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [sortBy, setSortBy] = useState({ key: "revenue_90d", dir: "desc" });

  useEffect(() => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.distributorWholesalerNetwork(session.entity.id)
      .then(setData)
      .finally(() => setLoading(false));
  }, [session?.entity?.id]);

  const wholesalers = data?.wholesalers || [];
  const kpis = data?.kpis || {};

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let out = wholesalers.filter((w) => {
      if (healthFilter !== "all" && w.status !== healthFilter) return false;
      if (!s) return true;
      return (w.name || "").toLowerCase().includes(s)
        || (w.city || "").toLowerCase().includes(s)
        || (w.code || "").toLowerCase().includes(s);
    });
    const { key, dir } = sortBy;
    out = [...out].sort((a, b) => {
      const va = a[key] ?? 0; const vb = b[key] ?? 0;
      if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb || "") : (vb || "").localeCompare(va);
      return dir === "asc" ? va - vb : vb - va;
    });
    return out;
  }, [wholesalers, search, healthFilter, sortBy]);

  const toggleSort = (key) => setSortBy((s) => ({
    key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc",
  }));

  const exportCsv = () => {
    const header = ["Wholesaler", "Code", "City", "Region", "Retailers", "Active Retailers (30d)", "Revenue (90d)", "Growth %", "Pending Orders", "Status"];
    const rows = filtered.map((w) => [
      w.name, w.code, w.city, w.region, w.retailer_count,
      w.active_retailers_30d, w.revenue_90d, w.growth_pct,
      w.pending_orders, w.status,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "wholesalers.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto" data-testid="distributor-wholesaler-network">
      <PageHeader
        title="Wholesaler Network"
        description="Your direct downstream tier. Click any wholesaler to drill into the retailers they own."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="wholesalers-export-csv">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
        }
      />

      {/* Summary KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiTile Icon={ShoppingBag} label="Wholesalers" value={fmtInt(kpis.total_wholesalers)}
          sub={`${kpis.active_wholesalers_30d ?? 0} active 30d`} tone="violet" />
        <KpiTile Icon={Activity} label="Retailers (visibility)" value={fmtInt(kpis.total_retailers_in_network)}
          sub={`${kpis.active_retailers_30d ?? 0} active 30d · owned by wholesalers`} tone="blue" />
        <KpiTile Icon={TrendingUp} label="Network revenue · 90d" value={fmtMoney(kpis.revenue_90d)}
          sub="across all wholesalers" tone="emerald" />
        <KpiTile Icon={MapPin} label="Tier" value="Distributor → Wholesaler"
          sub="Retailers via drill-down only" tone="slate" />
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wholesaler, code, city…"
            className="pl-9 w-80"
            data-testid="wholesalers-search"
          />
        </div>
        <Pill label="All health" active={healthFilter === "all"} onClick={() => setHealthFilter("all")} />
        <Pill label="Healthy" active={healthFilter === "healthy"} dot="#10b981" onClick={() => setHealthFilter("healthy")} />
        <Pill label="Warning" active={healthFilter === "warning"} dot="#f59e0b" onClick={() => setHealthFilter("warning")} />
        <Pill label="Critical" active={healthFilter === "critical"} dot="#ef4444" onClick={() => setHealthFilter("critical")} />
        <div className="ml-auto text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{filtered.length}</span> / {wholesalers.length} wholesalers
        </div>
      </div>

      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table data-testid="wholesalers-table">
            <TableHeader>
              <TableRow>
                <SortHead label="Wholesaler" k="name" sortBy={sortBy} onClick={toggleSort} />
                <SortHead label="Retailers" k="retailer_count" sortBy={sortBy} onClick={toggleSort} align="right" />
                <SortHead label="Active 30d" k="active_retailers_30d" sortBy={sortBy} onClick={toggleSort} align="right" />
                <SortHead label="Revenue (90d)" k="revenue_90d" sortBy={sortBy} onClick={toggleSort} align="right" />
                <SortHead label="Growth %" k="growth_pct" sortBy={sortBy} onClick={toggleSort} align="right" />
                <SortHead label="Pending" k="pending_orders" sortBy={sortBy} onClick={toggleSort} align="right" />
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-4">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-slate-500">Loading wholesalers…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-slate-500">No wholesalers match your filters.</TableCell></TableRow>
              )}
              {!loading && filtered.map((w) => {
                const ht = healthTone(w.status);
                const up = (w.growth_pct ?? 0) >= 0;
                const drillTo = `/distributor/${session.entity.id}/wholesaler/${w.id}`;
                return (
                  <TableRow key={w.id} data-testid={`wholesaler-row-${w.id}`} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell>
                      <Link to={drillTo} className="block group" data-testid={`wholesaler-link-${w.id}`}>
                        <div className="font-medium text-slate-900 group-hover:text-violet-600 transition-colors flex items-center gap-1">
                          {w.name}
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {w.code} · {w.city || "—"}, {w.region || "—"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold text-slate-900">{fmtInt(w.retailer_count)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-emerald-700 font-medium">{fmtInt(w.active_retailers_30d)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold text-slate-900">{fmtMoney(w.revenue_90d)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={`font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                        {fmtPct(w.growth_pct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(w.pending_orders)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${ht.chip}`}>
                        <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: ht.dot }} />
                        {w.status || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <Link to={drillTo} title="View retailers under this wholesaler" data-testid={`wholesaler-drill-${w.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900">
                        <Eye className="h-3.5 w-3.5" /> View retailers
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>

      {/* Ownership disclaimer footer */}
      <p className="mt-4 text-[11px] text-slate-400 text-center" data-testid="ownership-note">
        Strict ownership: <span className="font-semibold text-slate-500">Distributor → Wholesaler → Retailer</span>.
        Retailers are owned by wholesalers and only accessible after selecting one above.
      </p>
    </div>
  );
}

function KpiTile({ Icon, label, value, sub, tone }) {
  const tones = {
    violet:  "from-violet-50 to-white text-violet-700",
    blue:    "from-blue-50 to-white text-blue-700",
    emerald: "from-emerald-50 to-white text-emerald-700",
    slate:   "from-slate-50 to-white text-slate-700",
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

function Pill({ label, active, onClick, dot }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium transition-colors ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:text-slate-900"}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
      {label}
    </button>
  );
}

function SortHead({ label, k, sortBy, onClick, align = "left" }) {
  const active = sortBy.key === k;
  const Icon = active ? (sortBy.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <TableHead className={align === "right" ? "text-right pr-4" : ""}>
      <button onClick={() => onClick(k)} className={`inline-flex items-center gap-1 hover:text-slate-900 transition ${active ? "text-slate-900" : "text-slate-500"}`}>
        {label}<Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}
