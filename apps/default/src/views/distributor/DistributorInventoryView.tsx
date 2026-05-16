import React, { useState, useMemo } from 'react';
import { Package, Search, AlertTriangle, CheckCircle, XCircle, RefreshCw, TrendingDown, BarChart2 } from 'lucide-react';
import { field, text, type Node } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';

/* ── status helpers ── */
type WiStat = 'wi-healthy' | 'wi-low' | 'wi-critical';

const STAT_CFG: Record<string, { label: string; textCls: string; bgCls: string; borderCls: string; barCls: string; icon: React.ReactNode }> = {
  'wi-healthy':  { label: 'Healthy',      textCls: 'text-green-700',  bgCls: 'bg-green-50',  borderCls: 'border-green-200',  barCls: 'bg-green-500',  icon: <CheckCircle  size={12} /> },
  'wi-low':      { label: 'Low',          textCls: 'text-amber-700',  bgCls: 'bg-amber-50',  borderCls: 'border-amber-200',  barCls: 'bg-amber-500',  icon: <AlertTriangle size={12} /> },
  'wi-critical': { label: 'Out of Stock', textCls: 'text-red-700',    bgCls: 'bg-red-50',    borderCls: 'border-red-200',    barCls: 'bg-red-500',    icon: <XCircle      size={12} /> },
};
const statCfg = (s: string) => STAT_CFG[s] ?? STAT_CFG['wi-healthy'];

const FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'wi-healthy',  label: 'Healthy' },
  { id: 'wi-low',      label: 'Low' },
  { id: 'wi-critical', label: 'Out of Stock' },
];

export function DistributorInventoryView({ loading, inventory, distId, onRefresh }: {
  loading: boolean; inventory: Node[]; distId: string; onRefresh: () => void;
}) {
  const [search,    setSearch]    = useState('');
  const [statusFlt, setStatusFlt] = useState('all');

  const filtered = useMemo(() => inventory.filter(n => {
    const matchStatus = statusFlt === 'all' || field(n, '@wi_stat') === statusFlt;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      ((field(n, '@wi_pnm') as string) || text(n)).toLowerCase().includes(q) ||
      ((field(n, '@wi_sku') as string) || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  }), [inventory, search, statusFlt]);

  /* summary counts */
  const healthy  = inventory.filter(n => field(n, '@wi_stat') === 'wi-healthy').length;
  const low      = inventory.filter(n => field(n, '@wi_stat') === 'wi-low').length;
  const critical = inventory.filter(n => field(n, '@wi_stat') === 'wi-critical').length;
  const totalQty = inventory.reduce((s, n) => s + ((field(n, '@wi_qty') as number) || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Distributor Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Your warehouse stock levels · scoped to <span className="font-mono text-blue-600">{distId}</span>
          </p>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total SKUs',    value: inventory.length, icon: <BarChart2   size={18} className="text-blue-500"  />, cls: 'border-blue-100'  },
            { label: 'Healthy',       value: healthy,           icon: <CheckCircle  size={18} className="text-green-500" />, cls: 'border-green-100' },
            { label: 'Low Stock',     value: low,               icon: <AlertTriangle size={18} className="text-amber-500"/>, cls: 'border-amber-100' },
            { label: 'Out of Stock',  value: critical,          icon: <XCircle      size={18} className="text-red-500"  />, cls: 'border-red-100'   },
          ].map(c => (
            <div key={c.label} className={cn('bg-white rounded-xl border p-4 shadow-sm flex items-center gap-3', c.cls)}>
              <div className="flex-shrink-0">{c.icon}</div>
              <div>
                <div className="text-xl font-bold text-gray-900">{c.value}</div>
                <div className="text-xs text-gray-400">{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alert banner for critical items */}
      {!loading && critical > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <XCircle size={16} className="flex-shrink-0 text-red-500" />
          <span><strong>{critical} SKU{critical !== 1 ? 's' : ''}</strong> are out of stock — consider placing a stock order to Unilever.</span>
        </div>
      )}
      {!loading && low > 0 && critical === 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          <TrendingDown size={16} className="flex-shrink-0 text-amber-500" />
          <span><strong>{low} SKU{low !== 1 ? 's' : ''}</strong> are running low — consider restocking soon.</span>
        </div>
      )}

      {/* Search + filter bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search product or SKU…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setStatusFlt(f.id)}
              className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border transition-all',
                statusFlt === f.id
                  ? f.id === 'wi-critical' ? 'bg-red-600 text-white border-red-600'
                  : f.id === 'wi-low'      ? 'bg-amber-500 text-white border-amber-500'
                  : f.id === 'wi-healthy'  ? 'bg-green-600 text-white border-green-600'
                  :                          'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400')}>
              {f.label}
              {f.id !== 'all' && !loading && (() => {
                const cnt = f.id === 'wi-healthy' ? healthy : f.id === 'wi-low' ? low : critical;
                return cnt > 0 ? <span className="ml-1 opacity-70">({cnt})</span> : null;
              })()}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(9).fill(0).map((_,i) => <SkeletonCard key={i} height="h-28" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
          <Package size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No products match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(n => {
            const qty    = (field(n, '@wi_qty')    as number) || 0;
            const thresh = (field(n, '@wi_thresh') as number) || 1;
            const stat   = (field(n, '@wi_stat')   as string) || 'wi-healthy';
            const pct    = thresh > 0 ? Math.min(100, Math.round((qty / thresh) * 100)) : 0;
            const cfg    = statCfg(stat);
            const updated = field(n, '@wi_updated') as { dateTime?: { date: string } } | string | null;
            const updatedStr = typeof updated === 'string' ? updated
              : updated?.dateTime?.date ?? null;

            return (
              <div key={n.id} className={cn('bg-white rounded-xl border shadow-sm hover:shadow-md transition-all p-4',
                stat === 'wi-critical' ? 'border-red-200 ring-1 ring-red-100' :
                stat === 'wi-low'      ? 'border-amber-200' : 'border-gray-200')}>
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm truncate">
                      {(field(n, '@wi_pnm') as string) || text(n)}
                    </div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">
                      {(field(n, '@wi_sku') as string) || '—'}
                    </div>
                  </div>
                  <span className={cn('flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0', cfg.textCls, cfg.bgCls, cfg.borderCls)}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-gray-800">{qty.toLocaleString()} units</span>
                    <span className="text-gray-400">Threshold: {thresh.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all duration-500', cfg.barCls)} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] mt-1 text-gray-300">
                    <span>{pct}% of threshold</span>
                    {updatedStr && <span>Updated {updatedStr}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer summary */}
      {!loading && filtered.length > 0 && (
        <div className="text-xs text-gray-400 text-center pb-2">
          Showing {filtered.length} of {inventory.length} SKUs · Total warehouse stock: <strong className="text-gray-600">{totalQty.toLocaleString()} units</strong>
        </div>
      )}
    </div>
  );
}
