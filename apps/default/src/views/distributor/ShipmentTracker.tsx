import React from 'react';
import { CheckCircle, Truck, RefreshCw } from 'lucide-react';
import { field, text, type Node } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';

const STEPS = ['Pending', 'Approved', 'In Transit', 'Received'];
const stepOf = (stat: string) =>
  stat === 'dso-received' ? 3 : stat === 'dso-intransit' ? 2 : stat === 'dso-approved' ? 1 : 0;

export function ShipmentTracker({ loading, orders, confirming, onConfirmReceipt }: {
  loading: boolean; orders: Node[]; confirming: string | null;
  onConfirmReceipt: (order: Node) => void;
}) {
  const active = orders.filter(n => {
    const s = field(n, '@dso_stat') as string;
    return s === 'dso-intransit' || s === 'dso-approved';
  });
  const received = orders.filter(n => field(n, '@dso_stat') === 'dso-received');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Shipment Tracker</h1>
        <p className="text-sm text-gray-400 mt-0.5">Track approved orders · confirm receipt to auto-update inventory</p>
      </div>

      {loading ? (
        <div className="space-y-4">{Array(3).fill(0).map((_,i) => <SkeletonCard key={i} height="h-36" />)}</div>
      ) : active.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
          <Truck size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No active shipments.</p>
          <p className="text-sm mt-1">Approved orders appear here once dispatched.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {active.map(order => {
            const stat   = (field(order, '@dso_stat') as string) || 'dso-pending';
            const step   = stepOf(stat);
            const ship   = field(order, '@dso_ship') as string;
            const eta    = field(order, '@dso_eta') as { dateTime?: { date: string } } | null;
            const qty    = field(order, '@dso_qty') as number;
            const isIT   = stat === 'dso-intransit';
            const isConf = confirming === order.id;

            return (
              <div key={order.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className={cn('h-1.5', isIT ? 'bg-gradient-to-r from-violet-500 to-blue-400' : 'bg-blue-400')} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-900">{field(order, '@dso_pnm') as string || text(order)}</span>
                        <span className="font-mono text-xs text-gray-400">{field(order, '@dso_id') as string}</span>
                      </div>
                      <div className="text-sm text-gray-500 flex flex-wrap gap-3">
                        <span><strong className="text-gray-700">SKU:</strong> {field(order, '@dso_sku') as string}</span>
                        <span><strong className="text-gray-700">Qty:</strong> {qty?.toLocaleString()} units</span>
                        {eta?.dateTime?.date && <span><strong className="text-gray-700">ETA:</strong> {eta.dateTime.date}</span>}
                        {ship && <span className="font-mono text-xs text-violet-600">{ship}</span>}
                      </div>
                    </div>
                    {isIT ? (
                      <button onClick={() => onConfirmReceipt(order)} disabled={isConf}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm min-h-[44px] flex-shrink-0">
                        {isConf
                          ? <><RefreshCw size={14} className="animate-spin" /> Updating inventory…</>
                          : <><CheckCircle size={14} /> Confirm Receipt &amp; Update Inventory</>
                        }
                      </button>
                    ) : (
                      <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg font-medium flex-shrink-0">
                        Awaiting dispatch
                      </span>
                    )}
                  </div>

                  <div className="flex items-center">
                    {STEPS.map((s, i) => {
                      const done    = i < step;
                      const current = i === step;
                      return (
                        <React.Fragment key={s}>
                          <div className="flex flex-col items-center gap-1 flex-shrink-0">
                            <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-all',
                              done    ? 'bg-green-500 border-green-500 text-white' :
                              current ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100' :
                                        'bg-white border-gray-200 text-gray-300')}>
                              {done ? <CheckCircle size={13} /> : i + 1}
                            </div>
                            <span className={cn('text-[10px] font-medium whitespace-nowrap',
                              current ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-300')}>{s}</span>
                          </div>
                          {i < STEPS.length - 1 && (
                            <div className={cn('flex-1 h-0.5 mx-1 mb-4', i < step ? 'bg-green-400' : 'bg-gray-200')} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {isIT && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                      <Truck size={12} className="animate-pulse flex-shrink-0" />
                      <span>Shipment en route — click <strong>Confirm Receipt</strong> when goods arrive to auto-update inventory.</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {received.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <CheckCircle size={14} className="text-green-500" /> Received History
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-400 bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3">Order ID</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Qty Received</th>
                  <th className="px-4 py-3">Shipment Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {received.map(n => (
                  <tr key={n.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{field(n, '@dso_id') as string}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{field(n, '@dso_pnm') as string || text(n)}</td>
                    <td className="px-4 py-3">
                      <span className="text-green-700 font-bold">
                        {((field(n, '@dso_qconf') as number) || (field(n, '@dso_qty') as number))?.toLocaleString()} units
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-600">{(field(n, '@dso_ship') as string) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
