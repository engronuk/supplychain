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
  Search, Warehouse, Store, ChevronUp, ChevronDown, ChevronsUpDown,
  Eye, Boxes, Receipt, Send, Phone, Mail, ArrowUpRight, Download,
} from "lucide-react";

// --- helpers
const toneFor = (s) =>
  s === "active" ? { dot: "#10b981", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" } :
  { dot: "#94a3b8", chip: "bg-slate-50 text-slate-600 border-slate-200" };
const healthTone = (s) =>
  s === "healthy" ? { dot: "#10b981", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" } :
  s === "warning" ? { dot: "#f59e0b", chip: "bg-amber-50 text-amber-700 border-amber-200" } :
  s === "critical" ? { dot: "#ef4444", chip: "bg-rose-50 text-rose-700 border-rose-200" } :
  { dot: "#94a3b8", chip: "bg-slate-50 text-slate-600 border-slate-200" };
const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString();
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function NetworkView() {
  const { session } = useSession();
  const role = session.role;
  if (role === "manufacturer") return <ManufacturerNetwork session={session} />;
  if (role === "distributor") return <DistributorNetwork session={session} />;
  return <div className="p-8 text-slate-500">Network view is only available for manufacturer & distributor roles.</div>;
}

// ============================================================================
// MANUFACTURER (distributors directory) — kept simple, prior behaviour
// ============================================================================
function ManufacturerNetwork({ session }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  useEffect(() => { Api.distributors(session.entity.id).then(setItems); }, [session.entity.id]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? items.filter((x) =>
      (x.name || "").toLowerCase().includes(s) ||
      (x.region || "").toLowerCase().includes(s) ||
      (x.city || "").toLowerCase().includes(s)
    ) : items;
  }, [items, search]);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="network-view">
      <PageHeader title="Distributors" description="All distributors carrying your products."
        actions={
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search distributors…" className="pl-9 w-72" data-testid="network-search" />
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
        <Warehouse className="h-4 w-4" />
        <span><span className="font-semibold text-slate-900">{filtered.length}</span> distributors</span>
      </div>
      <Card><CardContent className="p-0">
        <Table data-testid="network-table">
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Region</TableHead><TableHead>City</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((x) => (
              <TableRow key={x.id} data-testid={`network-row-${x.id}`}>
                <TableCell className="font-medium text-slate-900">{x.name}</TableCell>
                <TableCell><Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">{x.region || "—"}</Badge></TableCell>
                <TableCell className="text-slate-600">{x.city || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// DISTRIBUTOR — enriched retailer intelligence table
// ============================================================================
function DistributorNetwork({ session }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");      // active|inactive|all
  const [healthFilter, setHealthFilter] = useState("all");      // healthy|warning|critical|all
  const [sortBy, setSortBy] = useState({ key: "name", dir: "asc" });

  useEffect(() => {
    setLoading(true);
    Api.distributorRetailers(session.entity.id)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [session.entity.id]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let out = items.filter((x) => {
      if (statusFilter !== "all" && x.status !== statusFilter) return false;
      if (healthFilter !== "all" && x.health !== healthFilter) return false;
      if (!s) return true;
      return (x.name || "").toLowerCase().includes(s)
        || (x.city || "").toLowerCase().includes(s)
        || (x.store_code || "").toLowerCase().includes(s)
        || (x.contact_name || "").toLowerCase().includes(s);
    });
    const { key, dir } = sortBy;
    out = [...out].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === "last_order_date") { va = va || ""; vb = vb || ""; }
      if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb || "") : (vb || "").localeCompare(va);
      return dir === "asc" ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });
    return out;
  }, [items, search, statusFilter, healthFilter, sortBy]);

  const toggleSort = (key) => setSortBy((s) => ({
    key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc"
  }));

  const summary = useMemo(() => {
    const total = items.length;
    const active = items.filter((x) => x.status === "active").length;
    const totalRev = items.reduce((a, b) => a + (b.revenue || 0), 0);
    const critical = items.filter((x) => x.health === "critical").length;
    return { total, active, totalRev, critical };
  }, [items]);

  const exportCsv = () => {
    const header = ["Name","Store Code","Region","City","Status","Health %","Revenue","Inventory Units","Low Stock SKUs","Last Order","Phone"];
    const rows = filtered.map((x) => [
      x.name, x.store_code, x.region, x.city, x.status, x.stock_health_pct,
      x.revenue, x.inventory_units, x.low_stock_skus,
      x.last_order_date ? new Date(x.last_order_date).toISOString().slice(0,10) : "",
      x.phone,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "retailers.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto" data-testid="distributor-network">
      <PageHeader title="Retailer Intelligence"
        description="Status, revenue, stock health, and last order across your retailer network."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="retailers-export-csv">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
        }
      />

      {/* Summary KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <SummaryStat label="Total Retailers" value={summary.total} tone="slate" />
        <SummaryStat label="Active" value={summary.active} tone="emerald" />
        <SummaryStat label="Revenue (received)" value={fmtMoney(summary.totalRev)} tone="indigo" />
        <SummaryStat label="Critical Stock" value={summary.critical} tone="rose" />
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store, city, code, contact…"
            className="pl-9 w-80"
            data-testid="distributor-retailers-search"
          />
        </div>
        <Pill label="All" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <Pill label="Active" active={statusFilter === "active"} dot="#10b981" onClick={() => setStatusFilter("active")} />
        <Pill label="Inactive" active={statusFilter === "inactive"} dot="#94a3b8" onClick={() => setStatusFilter("inactive")} />
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <Pill label="Any health" active={healthFilter === "all"} onClick={() => setHealthFilter("all")} />
        <Pill label="Healthy" active={healthFilter === "healthy"} dot="#10b981" onClick={() => setHealthFilter("healthy")} />
        <Pill label="Warning" active={healthFilter === "warning"} dot="#f59e0b" onClick={() => setHealthFilter("warning")} />
        <Pill label="Critical" active={healthFilter === "critical"} dot="#ef4444" onClick={() => setHealthFilter("critical")} />
        <div className="ml-auto text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{filtered.length}</span> / {items.length} retailers
        </div>
      </div>

      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table data-testid="distributor-retailers-table">
            <TableHeader>
              <TableRow>
                <SortHead label="Retailer" k="name" sortBy={sortBy} onClick={toggleSort} />
                <SortHead label="Status" k="status" sortBy={sortBy} onClick={toggleSort} />
                <SortHead label="Stock Health" k="stock_health_pct" sortBy={sortBy} onClick={toggleSort} />
                <SortHead label="Revenue" k="revenue" sortBy={sortBy} onClick={toggleSort} align="right" />
                <SortHead label="Last Order" k="last_order_date" sortBy={sortBy} onClick={toggleSort} />
                <TableHead>Contact</TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-slate-500">Loading retailers…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-slate-500">No retailers match your filters.</TableCell></TableRow>
              )}
              {!loading && filtered.map((x) => {
                const st = toneFor(x.status);
                const ht = healthTone(x.health);
                return (
                  <TableRow key={x.id} data-testid={`retailer-row-${x.id}`} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell>
                      <Link to={`/network/retailer/${x.id}`} className="block group">
                        <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-1">
                          {x.name}
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {x.store_code} · {x.city || "—"}, {x.region || "—"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ${st.chip}`}>
                        <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: st.dot }} />
                        {x.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[140px]">
                        <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${x.stock_health_pct}%`, background: ht.dot }} />
                        </div>
                        <span className="text-[12px] font-semibold text-slate-700 tabular-nums">{x.stock_health_pct}%</span>
                      </div>
                      {x.low_stock_skus > 0 && (
                        <div className="text-[10.5px] text-amber-600 mt-1">{x.low_stock_skus} low · {x.out_of_stock_skus} out</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{fmtMoney(x.revenue)}</div>
                      <div className="text-[10.5px] text-slate-500">{x.inventory_units.toLocaleString()} units</div>
                    </TableCell>
                    <TableCell className="text-[12.5px] text-slate-700">{fmtDate(x.last_order_date)}</TableCell>
                    <TableCell className="text-[11.5px]">
                      <div className="text-slate-700 font-medium">{x.contact_name}</div>
                      {x.phone && (
                        <a href={`tel:${x.phone}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-indigo-600">
                          <Phone className="h-3 w-3" /> {x.phone}
                        </a>
                      )}
                      {x.email && (
                        <a href={`mailto:${x.email}`} className="block inline-flex items-center gap-1 text-slate-500 hover:text-indigo-600">
                          <Mail className="h-3 w-3" /> {x.email}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <div className="inline-flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                        <IconBtn title="View details" to={`/network/retailer/${x.id}`} icon={Eye} testId={`row-action-view-${x.id}`} />
                        <IconBtn title="Inventory" to={`/network/retailer/${x.id}?tab=overview`} icon={Boxes} />
                        <IconBtn title="Transactions" to={`/network/retailer/${x.id}?tab=transactions`} icon={Receipt} />
                        <IconBtn title="Create delivery" to={`/shipments?retailer=${x.id}`} icon={Send} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div>
  );
}

function SummaryStat({ label, value, tone }) {
  const tones = {
    slate: "from-slate-50 to-white", emerald: "from-emerald-50 to-white",
    indigo: "from-indigo-50 to-white", rose: "from-rose-50 to-white",
  };
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500 font-semibold">{label}</div>
      <div className="text-[20px] font-bold text-slate-900 mt-1">{value}</div>
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

function IconBtn({ title, to, icon: Icon, testId }) {
  return (
    <Link to={to} title={title} data-testid={testId}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors">
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}
