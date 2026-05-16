import React from 'react';
import { Truck, Plus, RefreshCw, Inbox } from 'lucide-react';
import { field, text, type Node } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';
import { dsoStyle, PRI_COLOR } from './dsoHelpers';

function OrderCard({ order }: { order: Node }) {
  const stat = (field(order, '@dso_stat') as string) || 'dso-pending';
  const pri  = (field(order, '@dso_pri')  as string) || 'dso-pri-low';
  const st   = dsoStyle(stat);
  const qty  = field(order, '@dso_qty') as number;
  const eta  = field(order, '@dso_eta') as { dateTime?: { date: string } } | null;
  const ship = field(order, '@dso_ship') as string;
  const note = field(order, '@dso_note') as string;
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 border-l-4 p-4 shadow-sm hover:shadow-md transition-shadow', PRI_COLOR[pri] || 'border-l-gray-300')}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1', st.color, st.bg, st.border)}>
              <span className={cn('inline-block w-1.5 h-1.5 rounded-full', st.dot)} />
              {st.label}
            </span>
            <span className="text-[11px] font-mono text-gray-400">{field(order, '@dso_id') as string}</span>
          </div>
          <div className="font-semibold text-gray-900">{field(order, '@dso_pnm') as string || text(order)}</div>
          <div className="text-sm text-gray-500 mt-1 flex gap-3 flex-wrap">
            <span><span className="font-medium text-gray-700">SKU:</span> {(field(order, '@dso_sku') as string) || '—'}</span>
            <span><span className="font-medium text-gray-700">Qty:</span> {qty?.toLocaleString() || '—'} units</span>
            {eta?.dateTime?.date && <span><span className="font-medium text-gray-700">ETA:</span> {eta.dateTime.date}</span>}
            {ship && <span className="font-mono text-[11px] text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">{ship}</span>}
          </div>
          {note && <p className="text-xs text-gray-400 mt-1.5 italic">{note}</p>}
        </div>
        {stat === 'dso-intransit' && (
          <span className="flex items-center gap-1.5 text-violet-600 text-xs font-semibold bg-violet-50 border border-violet-200 px-3 py-1.5 rounded-lg flex-shrink-0">
            <Truck size={12} className="animate-pulse" /> En route
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_ORDER = ['dso-pending','dso-approved','dso-intransit','dso-received','dso-rejected'];

export function StockOrdersView({ loading, orders, onNew, onRefresh }: {
  loading: boolean; orders: Node[]; onNew: () => void; onRefresh: () => void;
}) {
  const groups: Record<string, Node[]> = {};
  orders.forEach(n => {
    const s = (field(n, '@dso_stat') as string) || 'dso-pending';
    if (!groups[s]) groups[s] = [];
    groups[s].push(n);
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Stock Orders to Unilever</h1>
          <p className="text-sm text-gray-400 mt-0.5">Request products · track approval and shipment</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="flex items-center gap-1.5 border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
            <Plus size={15} /> New Stock Order
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array(4).fill(0).map((_,i) => <SkeletonCard key={i} height="h-24" />)}</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Inbox size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No stock orders yet.</p>
          <button onClick={onNew} className="mt-4 bg-blue-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors">
            Place Your First Order
          </button>
        </div>
      ) : (
        STATUS_ORDER.filter(s => groups[s]?.length).map(statusKey => {
          const st = dsoStyle(statusKey);
          return (
            <div key={statusKey}>
              <div className="flex items-center gap-2 mb-3">
                <div className={cn('w-2 h-2 rounded-full', st.dot)} />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{st.label}</span>
                <span className="text-xs text-gray-300">({groups[statusKey].length})</span>
              </div>
              <div className="space-y-3">
                {groups[statusKey].map(n => <OrderCard key={n.id} order={n} />)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
