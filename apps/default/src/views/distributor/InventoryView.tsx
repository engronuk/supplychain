import React from 'react';
import { Package } from 'lucide-react';
import { field, text, type Node } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';

const statStyle = (s: string) =>
  s === 'ri-healthy' ? 'text-green-600 bg-green-50 border-green-200' :
  s === 'ri-low'     ? 'text-amber-600 bg-amber-50 border-amber-200' :
                       'text-red-600 bg-red-50 border-red-200';
const barColor = (s: string) =>
  s === 'ri-healthy' ? 'bg-green-500' : s === 'ri-low' ? 'bg-amber-500' : 'bg-red-500';

export function InventoryView({ loading, inventory, retailers }: {
  loading: boolean; inventory: Node[]; retailers: Node[];
}) {
  const retailerName = (retId: string) => {
    const r = retailers.find(n => field(n, '@rid01') === retId);
    return r ? text(r) : retId;
  };

  const grouped: Record<string, Node[]> = {};
  inventory.forEach(n => {
    const rid = (field(n, '@ri_ret') as string) || 'unknown';
    if (!grouped[rid]) grouped[rid] = [];
    grouped[rid].push(n);
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">
        Retailer Inventory <span className="text-gray-400 font-normal text-base">— stock levels by store</span>
      </h1>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_,i) => <SkeletonCard key={i} height="h-28" />)}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Package size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No inventory data linked to your retailers yet.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([retId, rows]) => {
          const crit = rows.filter(n => field(n, '@ri_stat') === 'ri-critical').length;
          const low  = rows.filter(n => field(n, '@ri_stat') === 'ri-low').length;
          return (
            <div key={retId}>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="font-semibold text-gray-800 text-sm">{retailerName(retId)}</div>
                <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{retId}</span>
                {crit > 0 && <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-bold">{crit} critical</span>}
                {low  > 0 && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-bold">{low} low</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {rows.map(n => {
                  const qty    = (field(n, '@ri_qty')    as number) || 0;
                  const thresh = (field(n, '@ri_thresh') as number) || 1;
                  const stat   = (field(n, '@ri_stat')   as string) || 'ri-healthy';
                  const pct    = Math.min(100, Math.round((qty / thresh) * 100));
                  return (
                    <div key={n.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 text-sm truncate">{(field(n, '@ri_pnm') as string) || text(n)}</div>
                          <div className="text-xs text-gray-400 font-mono">{field(n, '@ri_sku') as string}</div>
                        </div>
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border ml-2 flex-shrink-0', statStyle(stat))}>
                          {stat.replace('ri-', '').toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span className="font-bold text-gray-700">{qty} units</span>
                          <span>threshold: {thresh}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all', barColor(stat))} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
