import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Clock, Users, Package, ShieldCheck, Truck, Plus } from 'lucide-react';
import { getNodes, updateNode, PROJECTS, field, type Node } from '@/lib/api';
import { useHierarchy } from '@/lib/hierarchy';
import { cn } from '@/lib/utils';
import { StockOrdersView } from './StockOrdersView';
import { ShipmentTracker } from './ShipmentTracker';
import { NewOrderModal } from './NewOrderModal';
import { RetailerList } from './RetailerList';
import { DistributorInventoryView } from './DistributorInventoryView';
import { RetailerInventoryView } from './RetailerInventoryView';
import { RequestsView } from './RequestsView';



type DistView = 'orders' | 'shipments' | 'retailers' | 'requests' | 'dist-inventory' | 'ret-inventory';

export const DistributorDashboard: React.FC = () => {
  const { identity } = useHierarchy();
  const distId   = identity?.role === 'distributor' ? identity.distId   : 'DIST-LAG-001';
  const distName = identity?.role === 'distributor' ? identity.displayName : 'Distributor Portal';

  const [view,      setView]      = useState<DistView>('orders');
  const [orders,         setOrders]        = useState<Node[]>([]);
  const [retailers,      setRetailers]     = useState<Node[]>([]);
  const [inventory,      setInventory]     = useState<Node[]>([]);
  const [distInventory,  setDistInventory] = useState<Node[]>([]);
  const [requests,      setRequests]     = useState<Node[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [showNewOrder,   setShowNewOrder]  = useState(false);
  const [confirming,     setConfirming]    = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getNodes(PROJECTS.distOrders),
      getNodes(PROJECTS.retailers),
      getNodes(PROJECTS.inventory),
      getNodes(PROJECTS.distInventory),
      getNodes(PROJECTS.requests),
    ]).then(([ord, ret, inv, distInv, reqs]) => {
      const myOrders    = ord.filter(n => n.parentId === null && field(n, '@dso_dist') === distId);
      const myRetailers = ret.filter(n => n.parentId === null &&
        (field(n, '@parentDist') === distId || field(n, '@rdist1') === distId));

      const myRetailerIds = new Set(myRetailers.map(n => field(n, '@rid01') as string).filter(Boolean));

      const myInv      = inv.filter(n => n.parentId === null && myRetailerIds.has(field(n, '@ri_ret') as string));
      const myDistInv  = distInv.filter(n => n.parentId === null && field(n, '@wi_dist') === distId);

      // Requests from retailers belonging to this distributor
      const myRequests = reqs.filter(n => n.parentId === null && (
        field(n, '@reqdst1') === distId ||
        myRetailerIds.has(field(n, '@reqret1') as string)
      ));

      setOrders(myOrders);
      setRetailers(myRetailers);
      setInventory(myInv);
      setDistInventory(myDistInv);
      setRequests(myRequests);
      setLoading(false);
    });
  }, [distId]);

  useEffect(() => { load(); }, [load]);

  const confirmReceipt = async (order: Node) => {
    setConfirming(order.id);
    const sku = field(order, '@dso_sku') as string;
    const qty = (field(order, '@dso_qty') as number) || 0;

    // Mark order as Received — fields sent flat (no fieldValues wrapper)
    await updateNode(PROJECTS.distOrders, order.id, {
      '/attributes/@dso_stat':  'dso-received',
      '/attributes/@dso_qconf': qty,
    });

    // 1. Add received qty to distributor warehouse stock
    const warehouseRow = distInventory.find(n => field(n, '@wi_sku') === sku);
    if (warehouseRow) {
      const wCurrent = (field(warehouseRow, '@wi_qty') as number) || 0;
      const wNew     = wCurrent + qty;
      const wThresh  = (field(warehouseRow, '@wi_thresh') as number) || 1;
      const wStat    = wNew >= wThresh ? 'wi-healthy' : wNew >= wThresh * 0.5 ? 'wi-low' : 'wi-critical';
      await updateNode(PROJECTS.distInventory, warehouseRow.id, {
        '/attributes/@wi_qty':     wNew,
        '/attributes/@wi_stat':    wStat,
        '/attributes/@wi_updated': new Date().toISOString().split('T')[0],
      });
    }

    // 2. Auto-update retailer inventory rows matching this SKU
    const matchingInv = inventory.filter(n => field(n, '@ri_sku') === sku);
    if (matchingInv.length > 0) {
      await Promise.all(matchingInv.map(async invRow => {
        const current = (field(invRow, '@ri_qty') as number) || 0;
        const newQty  = current + Math.round(qty / Math.max(matchingInv.length, 1));
        const thresh  = (field(invRow, '@ri_thresh') as number) || 1;
        const newStat = newQty >= thresh ? 'ri-healthy' : newQty >= thresh * 0.5 ? 'ri-low' : 'ri-critical';
        await updateNode(PROJECTS.inventory, invRow.id, {
          '/attributes/@ri_qty':     newQty,
          '/attributes/@ri_stat':    newStat,
          '/attributes/@ri_updated': new Date().toISOString().split('T')[0],
        });
      }));
    }

    setConfirming(null);
    load();
  };

  const inTransit = orders.filter(n => field(n, '@dso_stat') === 'dso-intransit');
  const pending   = orders.filter(n => field(n, '@dso_stat') === 'dso-pending');
  const received  = orders.filter(n => field(n, '@dso_stat') === 'dso-received');

  const distLowCount = distInventory.filter(n => {
    const s = field(n, '@wi_stat') as string;
    return s === 'wi-low' || s === 'wi-critical';
  }).length;

  const myPendingReq = requests.filter(n => field(n, '@reqstat1') === 'req-pending').length;

  const navItems: { id: DistView; label: string; badge?: number; badgeAlert?: boolean }[] = [
    { id: 'orders',         label: 'Stock Orders',         badge: pending.length                     },
    { id: 'shipments',      label: 'Shipment Tracker',      badge: inTransit.length                   },
    { id: 'requests',      label: 'Retailer Requests',  badge: myPendingReq || undefined, badgeAlert: true },
    { id: 'retailers',      label: 'My Retailers',          badge: retailers.length                   },
    { id: 'dist-inventory', label: 'Distributor Inventory', badge: distLowCount || undefined, badgeAlert: true },
    { id: 'ret-inventory',  label: 'Retailer Inventory',    badge: inventory.length                   },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div>
          <div className="text-base font-bold text-gray-900">Unilever Supply OS</div>
          <div className="text-xs text-gray-400 uppercase tracking-wide">Distributor Portal</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-3 py-1 rounded-full">
            <ShieldCheck size={12} />
            <span className="font-semibold truncate max-w-[160px]">{distName}</span>
            <span className="text-blue-400 font-mono ml-1">({distId})</span>
          </div>
          {pending.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200">
              {pending.length} pending
            </span>
          )}
          {inTransit.length > 0 && (
            <span className="bg-violet-100 text-violet-700 text-xs font-bold px-2.5 py-1 rounded-full border border-violet-200 flex items-center gap-1">
              <Truck size={10} />{inTransit.length} in transit
            </span>
          )}
        </div>
      </header>

      <div className="bg-blue-50 border-b border-blue-100 px-6 py-1.5 flex items-center gap-4 text-[11px] text-blue-600">
        <span><strong>{retailers.length}</strong> retailers · <strong>{orders.length}</strong> orders · <strong>{inventory.length}</strong> SKUs tracked</span>
        <span className="ml-auto text-blue-400 uppercase tracking-wider">Scoped to {distId}</span>
      </div>

      <div className="bg-white border-b border-gray-100 px-6 py-3 flex gap-6 flex-wrap">
        {[
          { label: 'Pending',   value: pending.length,   icon: <Clock      size={15} className="text-amber-500"  /> },
          { label: 'In Transit',value: inTransit.length, icon: <Truck      size={15} className="text-violet-500" /> },
          { label: 'Retailers', value: retailers.length, icon: <Users      size={15} className="text-blue-500"   /> },
          { label: 'Warehouse SKUs', value: distInventory.length, icon: <Package  size={15} className="text-teal-500"   /> },
          { label: 'Received',  value: received.length,  icon: <CheckCircle size={15} className="text-green-500"/> },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2">
            {s.icon}
            <span className="text-sm font-bold text-gray-900">{loading ? '—' : s.value}</span>
            <span className="text-xs text-gray-400">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setView(item.id)}
              className={cn('px-4 py-3 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5',
                view === item.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900')}>
              {item.label}
              {!!item.badge && item.badge > 0 && (
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                  item.id === 'orders'         ? 'bg-amber-100 text-amber-700' :
                  item.id === 'shipments'      ? 'bg-violet-100 text-violet-700' :
                  item.badgeAlert              ? 'bg-red-100 text-red-600' :
                                                 'bg-gray-100 text-gray-500')}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 p-6">
        {view === 'orders'         && <StockOrdersView loading={loading} orders={orders} onNew={() => setShowNewOrder(true)} onRefresh={load} />}
        {view === 'shipments'      && <ShipmentTracker loading={loading} orders={orders} confirming={confirming} onConfirmReceipt={confirmReceipt} />}
        {view === 'requests'      && <RequestsView loading={loading} requests={requests} distId={distId} onRefresh={load} retailers={retailers} distInventory={distInventory} />}
        {view === 'retailers'      && <RetailerList loading={loading} retailers={retailers} distId={distId} onRetailerCreated={load} />}
        {view === 'dist-inventory' && <DistributorInventoryView loading={loading} inventory={distInventory} distId={distId} onRefresh={load} />}
        {view === 'ret-inventory'  && <RetailerInventoryView loading={loading} inventory={inventory} retailers={retailers} />}
      </main>

      {showNewOrder && (
        <NewOrderModal distId={distId} distName={distName}
          onClose={() => setShowNewOrder(false)}
          onCreated={() => { setShowNewOrder(false); load(); }} />
      )}
    </div>
  );
};
