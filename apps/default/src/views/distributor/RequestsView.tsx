import React, { useMemo, useState } from 'react';
import {
  Inbox, RefreshCw, AlertTriangle, Clock,
  CheckCircle, XCircle, Truck, ChevronDown, ChevronRight,
} from 'lucide-react';
import { field, type Node, text, updateNode, PROJECTS } from '@/lib/api';
import { SkeletonCard } from '@/components/SkeletonRow';
import { cn } from '@/lib/utils';

type ReqStat = 'req-pending' | 'req-approved' | 'req-intransit' | 'req-received' | 'req-rejected';
const STATUS_ORDER: ReqStat[] = ['req-pending','req-intransit','req-approved','req-received','req-rejected'];

function reqBadge(stat: ReqStat) {
  if (stat === 'req-approved')   return { label:'Approved',  cls:'text-green-700 bg-green-50 border-green-200',   dot:'bg-green-500',  border:'border-l-green-400'  };
  if (stat === 'req-intransit')  return { label:'In Transit',cls:'text-violet-700 bg-violet-50 border-violet-200',dot:'bg-violet-500', border:'border-l-violet-400' };
  if (stat === 'req-received')   return { label:'Received',  cls:'text-emerald-700 bg-emerald-50 border-emerald-200',dot:'bg-emerald-600',border:'border-l-emerald-500'};
  if (stat === 'req-rejected')   return { label:'Rejected',  cls:'text-red-700 bg-red-50 border-red-200',         dot:'bg-red-400',   border:'border-l-red-300'    };
  return                                { label:'Pending',   cls:'text-amber-700 bg-amber-50 border-amber-200',   dot:'bg-amber-400', border:'border-l-amber-400'  };
}

function getStatus(req: Node): ReqStat {
  return ((field(req, '@reqstat1') as string) || 'req-pending') as ReqStat;
}

function UrgencyPill({ urgency }: { urgency?: string }) {
  if (!urgency) return null;
  if (urgency === 'urg-high')
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700"><AlertTriangle size={10}/> High</span>;
  if (urgency === 'urg-medium')
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700"><Clock size={10}/> Medium</span>;
  return null;
}

function RequestCard({ req, distInventory, onAction }: { req:Node; distInventory:Node[]; onAction:()=>void }) {
  const [busy, setBusy] = useState(false);
  const stat = getStatus(req);
  const b = reqBadge(stat);
  const qty      = (field(req,'@reqqty1') as number) || 0;
  const sku      = (field(req,'@reqpnm1') as string) || text(req);
  const id       = (field(req,'@reqid1')  as string) || req.id.slice(-6);
  const urgency  =  field(req,'@requrg1') as string|undefined;
  const note     =  field(req,'@reqnote1') as string|undefined;

  const warehouseRow = distInventory.find(n =>
    ((field(n,'@wi_pnm') as string)||'').toLowerCase() === sku.toLowerCase() ||
    (field(n,'@wi_sku') as string) === sku
  );
  const warehouseQty = (field(warehouseRow,'@wi_qty') as number) || 0;
  const canFulfil = warehouseQty >= qty;
  const isPending = stat === 'req-pending';

  const approve = async () => {
    if (!canFulfil || busy) return;
    setBusy(true);
    try {
      await updateNode(PROJECTS.requests, req.id, { '/attributes/@reqstat1': 'req-intransit' });
      if (warehouseRow) {
        const newQty  = Math.max(0, warehouseQty - qty);
        const thresh  = (field(warehouseRow,'@wi_thresh') as number) || 1;
        const newStat = newQty >= thresh ? 'wi-healthy' : newQty >= thresh*0.5 ? 'wi-low' : 'wi-critical';
        await updateNode(PROJECTS.distInventory, warehouseRow.id, {
          '/attributes/@wi_qty':     newQty,
          '/attributes/@wi_stat':    newStat,
          '/attributes/@wi_updated': new Date().toISOString().split('T')[0],
        });
      }
    } finally { setBusy(false); onAction(); }
  };

  const reject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateNode(PROJECTS.requests, req.id, { '/attributes/@reqstat1': 'req-rejected' });
    } finally { setBusy(false); onAction(); }
  };

  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 border-l-4 p-4 shadow-sm transition-opacity', b.border, busy && 'opacity-60')}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', b.cls)}>{b.label}</span>
            <span className="text-[11px] font-mono text-gray-400">{id}</span>
            <UrgencyPill urgency={urgency}/>
          </div>
          <div className="font-semibold text-gray-900 truncate">{sku}</div>
          <div className="text-sm text-gray-500 mt-1 flex gap-4 flex-wrap">
            <span><span className="font-medium text-gray-700">Qty:</span> {qty.toLocaleString()} units</span>
            {warehouseRow && (
              <span className={canFulfil ? 'text-green-600' : 'text-red-500'}>
                <span className="font-medium">Warehouse:</span> {warehouseQty.toLocaleString()} avail
              </span>
            )}
          </div>
          {note && <p className="text-xs text-gray-400 mt-1.5 italic">{note}</p>}
        </div>
        {isPending && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button onClick={approve} disabled={busy || !canFulfil}
              title={!canFulfil ? 'Insufficient stock' : 'Approve and dispatch'}
              className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all',
                canFulfil ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed')}>
              <Truck size={13}/> {busy ? 'Processing…' : 'Approve & Ship'}
            </button>
            <button onClick={reject} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50 transition-all">
              <XCircle size={13}/> Reject
            </button>
          </div>
        )}
        {stat === 'req-intransit' && <div className="flex items-center gap-1.5 text-violet-600 text-xs font-bold flex-shrink-0"><Truck size={14}/> Dispatched</div>}
        {stat === 'req-received'  && <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold flex-shrink-0"><CheckCircle size={14}/> Received</div>}
        {stat === 'req-rejected'  && <div className="flex items-center gap-1.5 text-red-500 text-xs font-bold flex-shrink-0"><XCircle size={14}/> Rejected</div>}
      </div>
    </div>
  );
}

function RetailerSection({ retailerName, reqs, distInventory, onAction }: {
  retailerName:string; reqs:Node[]; distInventory:Node[]; onAction:()=>void;
}) {
  const [open, setOpen] = useState(true);
  const pendingCount = reqs.filter(r => getStatus(r)==='req-pending').length;
  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <button onClick={() => setOpen(o=>!o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <span className="flex-1 text-sm font-bold text-gray-800">{retailerName}</span>
        {pendingCount > 0 && <span className="text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">{pendingCount} pending</span>}
        <span className="text-xs text-gray-400">{reqs.length} total</span>
        {open ? <ChevronDown size={15} className="text-gray-400"/> : <ChevronRight size={15} className="text-gray-400"/>}
      </button>
      {open && (
        <div className="p-4 space-y-5 bg-white">
          {STATUS_ORDER.filter(s => reqs.some(r=>getStatus(r)===s)).map(s => {
            const b = reqBadge(s);
            const sReqs = reqs.filter(r=>getStatus(r)===s);
            return (
              <div key={s}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('w-2 h-2 rounded-full', b.dot)}/>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{b.label}</span>
                  <span className="text-xs text-gray-300">({sReqs.length})</span>
                </div>
                <div className="space-y-3">
                  {sReqs.map(req => <RequestCard key={req.id} req={req} distInventory={distInventory} onAction={onAction}/>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RequestsView({ loading, requests, distId, onRefresh, retailers, distInventory }: {
  loading:boolean; requests:Node[]; distId:string; onRefresh:()=>void; retailers:Node[]; distInventory:Node[];
}) {
  const retailerNameById = useMemo(() => {
    const map = new Map<string,string>();
    retailers.forEach(r => {
      const id   = (field(r,'@rid01') as string) || '';
      const name = (field(r,'@ri_pnm') as string) || text(r);
      if (id) map.set(id, name);
    });
    return map;
  }, [retailers]);

  const groupedByRetailer = useMemo(() => {
    const g: Record<string,Node[]> = {};
    requests.forEach(req => {
      const retailerId   = (field(req,'@reqret1') as string) || '';
      const retailerName = retailerNameById.get(retailerId) || retailerId || 'Unknown Retailer';
      if (!g[retailerName]) g[retailerName] = [];
      g[retailerName].push(req);
    });
    return g;
  }, [requests, retailerNameById]);

  const totalPending = requests.filter(r=>getStatus(r)==='req-pending').length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Stock Requests from Retailers</h1>
          <p className="text-sm text-gray-400 mt-0.5">Grouped by retailer · <span className="font-mono text-blue-600">{distId}</span></p>
        </div>
        <div className="flex items-center gap-2">
          {totalPending > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
              {totalPending} need action
            </span>
          )}
          <button onClick={onRefresh}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <RefreshCw size={14}/> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array(3).fill(0).map((_,i)=><SkeletonCard key={i} height="h-32"/>)}</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-200">
          <Inbox size={48} className="mx-auto mb-3 text-gray-300"/>
          <p className="font-medium">No retailer stock requests yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByRetailer)
            .sort((a,b) => {
              const ap = a[1].filter(r=>getStatus(r)==='req-pending').length;
              const bp = b[1].filter(r=>getStatus(r)==='req-pending').length;
              if (bp !== ap) return bp - ap;
              return a[0].localeCompare(b[0]);
            })
            .map(([name, reqs]) => (
              <RetailerSection key={name} retailerName={name} reqs={reqs} distInventory={distInventory} onAction={onRefresh}/>
            ))}
        </div>
      )}
    </div>
  );
}
