import React, { useState, useEffect, useCallback } from 'react';
import { Truck, CheckCircle, Clock, Package, RefreshCw, AlertTriangle, XCircle, Inbox } from 'lucide-react';
import { getNodes, updateNode, PROJECTS, field, text, type Node } from '@/lib/api';
import { cn } from '@/lib/utils';

type ReqStat = 'req-pending' | 'req-approved' | 'req-intransit' | 'req-received' | 'req-rejected';

function getStatus(n: Node): ReqStat {
  return ((field(n, '@reqstat1') as string) || 'req-pending') as ReqStat;
}

function StatusBadge({ stat }: { stat: ReqStat }) {
  const map: Record<ReqStat, { label: string; cls: string; icon: React.ReactNode }> = {
    'req-pending':   { label: 'Pending',    cls: 'text-amber-700 bg-amber-50 border-amber-200',    icon: <Clock size={11}/> },
    'req-approved':  { label: 'Approved',   cls: 'text-green-700 bg-green-50 border-green-200',    icon: <CheckCircle size={11}/> },
    'req-intransit': { label: 'In Transit', cls: 'text-violet-700 bg-violet-50 border-violet-200', icon: <Truck size={11}/> },
    'req-received':  { label: 'Received',   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: <Package size={11}/> },
    'req-rejected':  { label: 'Rejected',   cls: 'text-red-700 bg-red-50 border-red-200',          icon: <XCircle size={11}/> },
  };
  const m = map[stat];
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border', m.cls)}>
      {m.icon} {m.label}
    </span>
  );
}

function borderColor(stat: ReqStat) {
  if (stat === 'req-intransit') return 'border-l-violet-400';
  if (stat === 'req-received')  return 'border-l-emerald-500';
  if (stat === 'req-rejected')  return 'border-l-red-300';
  if (stat === 'req-approved')  return 'border-l-green-400';
  return 'border-l-amber-400';
}

export function ShipmentsScreen({ retailerId }: { retailerId: string }) {
  const [requests, setRequests]   = useState<Node[]>([]);
  const [inventory, setInventory] = useState<Node[]>([]);
  const [loading, setLoading]     = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getNodes(PROJECTS.requests),
      getNodes(PROJECTS.inventory),
    ]).then(([reqs, inv]) => {
      setRequests(reqs.filter(n => n.parentId === null && field(n, '@reqret1') === retailerId));
      setInventory(inv.filter(n => n.parentId === null && field(n, '@ri_ret') === retailerId));
      setLoading(false);
    });
  }, [retailerId]);

  useEffect(() => { load(); }, [load]);

  const confirmReceipt = async (req: Node) => {
    const reqId = req.id;
    if (confirming === reqId) return;
    setConfirming(reqId);
    try {
      const qty = (field(req, '@reqqty1') as number) || 0;
      const sku = (field(req, '@reqpnm1') as string) || text(req);

      // 1. Mark request as received
      await updateNode(PROJECTS.requests, reqId, {
        '/attributes/@reqstat1': 'req-received',
        '/attributes/@reqreceivedAt': new Date().toISOString().split('T')[0],
      });

      // 2. Update retailer inventory — match by product name or SKU
      const invRow = inventory.find(n =>
        ((field(n, '@ri_pnm') as string) || text(n)).toLowerCase() === sku.toLowerCase() ||
        (field(n, '@ri_sku') as string) === sku
      );
      if (invRow) {
        const current  = (field(invRow, '@ri_qty') as number) || 0;
        const newQty   = current + qty;
        const thresh   = (field(invRow, '@ri_thresh') as number) || 1;
        const newStat  = newQty >= thresh ? 'ri-healthy' : newQty >= thresh * 0.5 ? 'ri-low' : 'ri-critical';
        await updateNode(PROJECTS.inventory, invRow.id, {
          '/attributes/@ri_qty':     newQty,
          '/attributes/@ri_stat':    newStat,
          '/attributes/@ri_updated': new Date().toISOString().split('T')[0],
        });
      }
    } finally {
      setConfirming(null);
      load();
    }
  };

  // Sort: in-transit first, then pending/approved, then received/rejected
  const sorted = [...requests].sort((a, b) => {
    const order: Record<ReqStat, number> = {
      'req-intransit': 0, 'req-pending': 1, 'req-approved': 2, 'req-received': 3, 'req-rejected': 4,
    };
    return order[getStatus(a)] - order[getStatus(b)];
  });

  const inTransitCount = requests.filter(r => getStatus(r) === 'req-intransit').length;

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#3d3530' }}>My Shipments</h1>
          <p className="text-sm mt-0.5" style={{ color: '#8b7d6b' }}>
            Track your stock requests and confirm deliveries.
          </p>
        </div>
        <button onClick={load}
          className="p-2 rounded-xl transition-all active:scale-95"
          style={{ background: '#f2ece4', border: '1px solid #d4c5b0', color: '#8b7d6b' }}>
          <RefreshCw size={16}/>
        </button>
      </div>

      {/* In-transit alert */}
      {inTransitCount > 0 && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#ede9f8', border: '1px solid #c4b5f4' }}>
          <Truck size={20} className="text-violet-600 flex-shrink-0 mt-0.5"/>
          <div>
            <div className="font-semibold text-sm text-violet-800">
              {inTransitCount} shipment{inTransitCount > 1 ? 's' : ''} on the way
            </div>
            <div className="text-xs text-violet-700 mt-0.5">
              Confirm receipt below once stock arrives at your store.
            </div>
          </div>
        </div>
      )}

      {/* Request cards */}
      {loading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#f2ece4' }}/>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16" style={{ color: '#8b7d6b' }}>
          <Inbox size={40} className="mx-auto mb-3 opacity-40"/>
          <p className="font-medium text-sm">No requests yet.</p>
          <p className="text-xs mt-1 opacity-70">Go to Restock to request stock from your distributor.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(req => {
            const stat      = getStatus(req);
            const qty       = (field(req, '@reqqty1') as number) || 0;
            const sku       = (field(req, '@reqpnm1') as string) || text(req);
            const reqId     = (field(req, '@reqid1')  as string) || req.id.slice(-6);
            const urgency   =  field(req, '@requrg1') as string | undefined;
            const note      =  field(req, '@reqnote1') as string | undefined;
            const isInTransit = stat === 'req-intransit';
            const isBusy    = confirming === req.id;

            return (
              <div key={req.id}
                className={cn('rounded-2xl p-4 border-l-4', borderColor(stat))}
                style={{ background: '#f2ece4', border: '1px solid #d4c5b0' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <StatusBadge stat={stat}/>
                      <span className="text-[11px] font-mono opacity-50">{reqId}</span>
                      {urgency === 'urg-high' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700">
                          <AlertTriangle size={10}/> Urgent
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-sm" style={{ color: '#3d3530' }}>{sku}</div>
                    <div className="text-xs mt-1 opacity-60" style={{ color: '#3d3530' }}>
                      {qty.toLocaleString()} units requested
                    </div>
                    {note && <p className="text-xs mt-1 italic opacity-50">{note}</p>}
                  </div>

                  {/* Confirm Receipt button — only for in-transit */}
                  {isInTransit && (
                    <button
                      onClick={() => confirmReceipt(req)}
                      disabled={isBusy}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 min-h-[44px]',
                        isBusy ? 'opacity-60 cursor-not-allowed' : ''
                      )}
                      style={{ background: '#4a7c5e', color: '#fff', border: 'none' }}
                    >
                      <CheckCircle size={15}/>
                      {isBusy ? 'Confirming…' : 'Confirm Receipt'}
                    </button>
                  )}
                </div>

                {/* Progress tracker */}
                <div className="mt-3 flex items-center gap-1">
                  {(['req-pending','req-intransit','req-received'] as ReqStat[]).map((step, i) => {
                    const isActive = step === stat;
                    const isDone   = ['req-pending','req-intransit'].indexOf(stat) > i ||
                                     stat === 'req-received';
                    const isCurrent = step === stat && stat !== 'req-received';
                    return (
                      <React.Fragment key={step}>
                        <div className={cn(
                          'w-2.5 h-2.5 rounded-full flex-shrink-0',
                          isDone || isActive ? (isActive && stat !== 'req-received' ? 'bg-violet-500' : 'bg-emerald-500') : 'bg-gray-200'
                        )}/>
                        {i < 2 && <div className={cn('flex-1 h-0.5', isDone ? 'bg-emerald-400' : 'bg-gray-200')}/>}
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] mt-1 opacity-50" style={{ color: '#3d3530' }}>
                  <span>Pending</span><span>In Transit</span><span>Received</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
