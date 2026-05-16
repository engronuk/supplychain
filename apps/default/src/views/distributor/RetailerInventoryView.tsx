import React, { useState, useMemo } from 'react';
import {
  Package, Search, ChevronDown, ChevronRight,
  CheckCircle, AlertTriangle, XCircle, Users,
} from 'lucide-react';
import { field, text, type Node } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';

/* ── helpers ── */
const STAT_CFG = {
  'ri-healthy':  { label: 'HEALTHY',  textCls: 'text-green-700',  bgCls: 'bg-green-50',  borderCls: 'border-green-200',  barCls: 'bg-green-500'  },
  'ri-low':      { label: 'LOW',      textCls: 'text-amber-700',  bgCls: 'bg-amber-50',  borderCls: 'border-amber-200',  barCls: 'bg-amber-500'  },
  'ri-critical': { label: 'CRITICAL', textCls: 'text-red-700',    bgCls: 'bg-red-50',    borderCls: 'border-red-200',    barCls: 'bg-red-500'    },
} as const;
type StatKey = keyof typeof STAT_CFG;
const statCfg = (s: string) => STAT_CFG[s as StatKey] ?? STAT_CFG['ri-healthy'];

/* ── individual product card (matching the existing style from screenshot) ── */
function ProductCard({ node }: { node: Node }) {
  const qty    = (field(node, '@ri_qty')    as number) || 0;
  const thresh = (field(node, '@ri_thresh') as number) || 1;
  const stat   = (field(node, '@ri_stat')   as string) || 'ri-healthy';
  const pct    = thresh > 0 ? Math.min(100, Math.round((qty / thresh) * 100)) : 0;
  const cfg    = statCfg(stat);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-1 gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm truncate">
            {(field(node, '@ri_pnm') as string) || text(node)}
          </div>
          <div className="text-xs text-gray-400 font-mono">{field(node, '@ri_sku') as string}</div>
        </div>
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ml-2', cfg.textCls, cfg.bgCls, cfg.borderCls)}>
          {cfg.label}
        </span>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="font-bold text-gray-800">{qty} units</span>
          <span className="text-gray-400">threshold: {thresh}</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', cfg.barCls)} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ── accordion retailer row ── */
function RetailerAccordion({
  retId, retName, rows, defaultOpen,
}: {
  retId: string; retName: string; rows: Node[]; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const low      = rows.filter(n => field(n, '@ri_stat') === 'ri-low').length;
  const critical = rows.filter(n => field(n, '@ri_stat') === 'ri-critical').length;
  const alert    = low + critical;

  return (
    <div className={cn('rounded-xl border shadow-sm overflow-hidden transition-all',
      alert > 0 ? 'border-amber-200' : 'border-gray-200')}>

      {/* Collapsed header */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors',
          open ? 'bg-gray-50 border-b border-gray-200' : 'bg-white hover:bg-gray-50',
        )}>
        <div className={cn('transition-transform duration-200', open ? 'rotate-90' : '')}>
          <ChevronRight size={16} className="text-gray-400" />
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          <span className="font-semibold text-gray-900 text-sm">{retName}</span>
          <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{retId}</span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {critical > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <XCircle size={10} /> {critical} critical
            </span>
          )}
          {low > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={10} /> {low} low
            </span>
          )}
          {alert === 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
              <CheckCircle size={10} /> All healthy
            </span>
          )}
          <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
            {rows.length} SKU{rows.length !== 1 ? 's' : ''}
          </span>
        </div>
      </button>

      {/* Expanded grid */}
      {open && (
        <div className="bg-gray-50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map(n => <ProductCard key={n.id} node={n} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── main component ── */
export function RetailerInventoryView({ loading, inventory, retailers }: {
  loading: boolean; inventory: Node[]; retailers: Node[];
}) {
  const [search,      setSearch]      = useState('');
  const [filterLow,   setFilterLow]   = useState(false);
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null); // null = per-row default

  const retailerName = (retId: string) => {
    const r = retailers.find(n => field(n, '@rid01') === retId);
    return r ? text(r) : retId;
  };

  /* group by retailer */
  const grouped = useMemo(() => {
    const map: Record<string, Node[]> = {};
    inventory.forEach(n => {
      const rid = (field(n, '@ri_ret') as string) || 'unknown';
      if (!map[rid]) map[rid] = [];
      map[rid].push(n);
    });
    return map;
  }, [inventory]);

  /* filter retailers by search + low-stock toggle */
  const visibleRetailers = useMemo(() => {
    return Object.entries(grouped).filter(([retId, rows]) => {
      const name = retailerName(retId).toLowerCase();
      const matchSearch = !search || name.includes(search.toLowerCase()) || retId.toLowerCase().includes(search.toLowerCase());
      const hasAlert = rows.some(n => {
        const s = field(n, '@ri_stat') as string;
        return s === 'ri-low' || s === 'ri-critical';
      });
      const matchFilter = !filterLow || hasAlert;
      return matchSearch && matchFilter;
    });
  }, [grouped, search, filterLow, retailers]);

  /* global summary */
  const totalLow      = inventory.filter(n => field(n, '@ri_stat') === 'ri-low').length;
  const totalCritical = inventory.filter(n => field(n, '@ri_stat') === 'ri-critical').length;
  const retailerCount = Object.keys(grouped).length;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Retailer Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">Stock levels by store — {retailerCount} retailers tracked</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAllExpanded(true)}
            className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
            Expand All
          </button>
          <button
            onClick={() => setAllExpanded(false)}
            className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
            Collapse All
          </button>
        </div>
      </div>

      {/* Summary pills */}
      {!loading && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs shadow-sm">
            <Users size={12} className="text-blue-500" />
            <span className="font-bold text-gray-800">{retailerCount}</span>
            <span className="text-gray-400">retailers</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs shadow-sm">
            <Package size={12} className="text-teal-500" />
            <span className="font-bold text-gray-800">{inventory.length}</span>
            <span className="text-gray-400">total SKUs</span>
          </div>
          {totalLow > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 text-xs shadow-sm">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="font-bold text-amber-700">{totalLow}</span>
              <span className="text-amber-600">low stock</span>
            </div>
          )}
          {totalCritical > 0 && (
            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-full px-3 py-1.5 text-xs shadow-sm">
              <XCircle size={12} className="text-red-500" />
              <span className="font-bold text-red-700">{totalCritical}</span>
              <span className="text-red-600">critical</span>
            </div>
          )}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search retailers…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white"
          />
        </div>
        <button
          onClick={() => setFilterLow(f => !f)}
          className={cn('flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border font-medium transition-all',
            filterLow
              ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
              : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300')}>
          <AlertTriangle size={14} />
          Low stock only
        </button>
      </div>

      {/* Accordion list */}
      {loading ? (
        <div className="space-y-3">{Array(5).fill(0).map((_,i) => <SkeletonCard key={i} height="h-14" />)}</div>
      ) : visibleRetailers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
          <Package size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No retailers match your filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRetailers.map(([retId, rows], idx) => {
            const hasAlert = rows.some(n => {
              const s = field(n, '@ri_stat') as string;
              return s === 'ri-low' || s === 'ri-critical';
            });
            // default open: first retailer or any with alerts
            const defaultOpen = allExpanded !== null ? allExpanded : (idx === 0 || hasAlert);
            return (
              <RetailerAccordion
                key={retId + String(allExpanded)}
                retId={retId}
                retName={retailerName(retId)}
                rows={rows}
                defaultOpen={defaultOpen}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
