import React, { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Package, Users, AlertCircle, TrendingUp, Plus, MessageCircle, FileText, ChevronDown, X, Edit2, Check, Download, Calendar, ArrowRight, ShoppingCart, Eye, Bell, Search, Truck, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { getNodes, updateNode, PROJECTS, field, text, type Node } from '@/lib/api';
import { SkeletonCard, SkeletonRow } from '@/components/SkeletonRow';
import { useHierarchy } from '@/lib/hierarchy';

type MfgView = 'overview' | 'distributors' | 'products' | 'heatmap' | 'distorders';
const DEEP_BLUE = '#1e3a8a';
const TEAL = '#0d9488';
const AMBER = '#d97706';
const CHART_COLORS = [DEEP_BLUE, TEAL, AMBER, '#7c3aed', '#dc2626', '#059669'];

function ngn(v: number, compact = false): string {
  if (compact) {
    if (v >= 1_000_000) return '\u20a6' + (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000) return '\u20a6' + (v / 1_000).toFixed(0) + 'K';
  }
  return '\u20a6' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const revenueData = [
  { month: 'Nov', revenue: 2_140_000_000 }, { month: 'Dec', revenue: 3_080_000_000 },
  { month: 'Jan', revenue: 2_620_000_000 }, { month: 'Feb', revenue: 2_890_000_000 },
  { month: 'Mar', revenue: 2_710_000_000 }, { month: 'Apr', revenue: 3_450_000_000 },
  { month: 'May', revenue: 3_870_000_000 },
];
const SPARK_REVENUE = [2140,3080,2620,2890,2710,3450,3870].map((v,i) => ({ i, v }));
const SPARK_DIST    = [58,60,62,63,65,66,68].map((v,i) => ({ i, v }));
const SPARK_PENDING = [8,12,9,14,11,8,10].map((v,i) => ({ i, v }));
const SPARK_PRODS   = [13,13,13,14,15,15,15].map((v,i) => ({ i, v }));

const REGIONS = ['Lagos','North West','South East','West','Middle Belt'];
const SKUS = ['Knorr','Blue Band','OMO','Vaseline','Lifebuoy','Royco','Close-Up','LUX','Axe','Rexona'];
const HEAT: Record<string,Record<string,number>> = {
  'Lagos':        {'Knorr':1421,'Blue Band':1474,'OMO':1043,'Vaseline':1440,'Lifebuoy':820,'Royco':980,'Close-Up':910,'LUX':870,'Axe':760,'Rexona':890},
  'North West':   {'Knorr':580,'Blue Band':620, 'OMO':890, 'Vaseline':540, 'Lifebuoy':640,'Royco':510,'Close-Up':480,'LUX':620,'Axe':1041,'Rexona':1065},
  'South East':   {'Knorr':890,'Blue Band':740, 'OMO':760, 'Vaseline':880, 'Lifebuoy':896,'Royco':1013,'Close-Up':1069,'LUX':780,'Axe':520,'Rexona':610},
  'West':         {'Knorr':640,'Blue Band':590, 'OMO':720, 'Vaseline':780, 'Lifebuoy':530,'Royco':620,'Close-Up':540,'LUX':1027,'Axe':680,'Rexona':720},
  'Middle Belt':  {'Knorr':510,'Blue Band':480, 'OMO':620, 'Vaseline':560, 'Lifebuoy':490,'Royco':440,'Close-Up':780,'LUX':560,'Axe':430,'Rexona':580},
};
const HMAX = 1474;

const PRODUCT_SALES = Array.from({ length: 30 }, (_, i) => ({
  day: 'D' + (i + 1),
  sales: Math.round(Math.sin(i / 4) * 3000000 + 6500000 + i * 80000),
}));

const DIST_RETAILERS = [
  { name: 'Funtime Retail Shop, Ikeja',       inventory: 82, requests: 3 },
  { name: 'Kano Mega Store, Zoo Rd',          inventory: 54, requests: 7 },
  { name: 'Onitsha Main Market Shop',         inventory: 91, requests: 1 },
  { name: 'Benin Mega Mart, Sapele Rd',       inventory: 38, requests: 11 },
];

function heatColor(val: number, max: number): string {
  const p = val / max;
  const r = Math.round(255 * p + 248 * (1 - p));
  const g = Math.round(243 * (1 - p * 0.85));
  const b = Math.round(28 * (1 - p));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function SidePanel({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-base font-bold text-[#1a1a1a]">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors mt-0.5"><X size={18} /></button>
        </div>
        <div className="flex-1 p-5 space-y-5">{children}</div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sparkData, sparkColor, icon, trend, trendUp }: {
  label: string; value: string | null; sparkData: { i: number; v: number }[];
  sparkColor: string; icon: React.ReactNode; trend: string; trendUp: boolean;
}) {
  return (
    <div className="bg-[#f8f9fa] border border-gray-200 rounded-[8px] p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</span>
        <span className="text-gray-300">{icon}</span>
      </div>
      <div className="text-xl font-bold text-[#1a1a1a] font-mono">
        {value ?? <span className="shimmer inline-block w-16 h-6 rounded" />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-semibold ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>
          {trendUp ? '↑' : '↓'} {trend}
        </span>
        <div className="flex-1 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={'sg' + sparkColor.replace('#', '')} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={sparkColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2} fill={'url(#sg' + sparkColor.replace('#', '') + ')'} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export const ManufacturerDashboard: React.FC = () => {
  const { identity, ownedDistributorIds } = useHierarchy();
  const mfgId = identity?.role === 'manufacturer' ? identity.mfgId : 'MFG-UNILEVER';

  const [view, setView]             = useState<MfgView>('overview');
  const [distributors, setDist]     = useState<Node[]>([]);
  const [allRetailers, setAllRetailers] = useState<Node[]>([]);
  const [products, setProducts]     = useState<Node[]>([]);
  const [requests, setRequests]     = useState<Node[]>([]);
  const [analytics, setAnalytics]   = useState<Node[]>([]);
  const [distOrders, setDistOrders] = useState<Node[]>([]);
  const [processingOrder, setProcessingOrder] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [searchDist, setSearchDist] = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [dateRange, setDateRange]   = useState('last-30');
  const [reportOpen, setReportOpen] = useState(false);
  const [distPanel, setDistPanel]   = useState<{ open: boolean; node: Node | null }>({ open: false, node: null });
  const [prodPanel, setProdPanel]   = useState<{ open: boolean; node: Node | null }>({ open: false, node: null });
  const [poModal, setPOModal]       = useState<{ open: boolean; node: Node | null }>({ open: false, node: null });
  const [reqDetail, setReqDetail]   = useState<{ open: boolean; node: Node | null }>({ open: false, node: null });
  const [heatCell, setHeatCell]     = useState<{ open: boolean; region: string; sku: string }>({ open: false, region: '', sku: '' });

  useEffect(() => {
    Promise.all([
      getNodes(PROJECTS.distributors),
      getNodes(PROJECTS.retailers),
      getNodes(PROJECTS.products),
      getNodes(PROJECTS.requests),
      getNodes(PROJECTS.analytics),
      getNodes(PROJECTS.distOrders),
    ]).then(([d, ret, p, r, a, dord]) => {
      // MANUFACTURER VIEW: only distributors where @parentMfg === mfgId
      const myDists = d.filter(n => n.parentId === null && field(n, '@parentMfg') === mfgId);
      const myDistIds = new Set(myDists.map(n => field(n, '@did01') as string).filter(Boolean));

      // ALL retailers belonging to any of our distributors
      const myRetailers = ret.filter(n =>
        n.parentId === null && myDistIds.has(field(n, '@parentDist') as string)
      );
      const myRetailerIds = new Set(myRetailers.map(n => field(n, '@rid01') as string).filter(Boolean));

      // Requests from those retailers
      const myRequests = r.filter(n =>
        n.parentId === null &&
        (myDistIds.has(field(n, '@reqdst1') as string) || myRetailerIds.has(field(n, '@reqret1') as string))
      );

      setDist(myDists);
      setAllRetailers(myRetailers);
      setProducts(p.filter(n => n.parentId === null));
      setRequests(myRequests);
      setAnalytics(a.filter(n => n.parentId === null));
      setDistOrders(dord.filter(n => n.parentId === null));
      setLoading(false);
    });
  }, [mfgId]);

  const totalRevenue    = analytics.reduce((s, n) => s + ((field(n, '@da_rev') as number) || 0), 0) || 3870000000;
  const pendingCount    = requests.filter(n => field(n, '@reqstat1') === 'req-pending').length;
  const activeDistCount = distributors.filter(n => field(n, '@dstat1') === 'dstat-active').length || distributors.length || 68;
  const totalRetailerCount = allRetailers.length || distributors.length; // fallback to dist count

  const topProducts = analytics.reduce<{ name: string; vol: number }[]>((acc, n) => {
    const name = (field(n, '@da_name') as string) || text(n);
    const vol  = (field(n, '@da_vol') as number) || 0;
    const ex = acc.find(p => p.name === name);
    if (ex) ex.vol += vol; else acc.push({ name: name.split(' ').slice(0, 2).join(' '), vol });
    return acc;
  }, []).sort((a, b) => b.vol - a.vol).slice(0, 6);

  const filteredDist  = distributors.filter(n => text(n).toLowerCase().includes(searchDist.toLowerCase()));
  const filteredProds = products.filter(n => !filterCat || (field(n, '@cat01') as string) === filterCat);

  const exportCSV = () => {
    const rows = [['Product', 'SKU', 'Price (NGN)', 'Stock', 'Category']];
    products.forEach(n => rows.push([
      text(n), (field(n, '@sku01') as string) || '',
      String((field(n, '@price1') as number) || 0),
      String((field(n, '@stock1') as number) || 0),
      (field(n, '@cat01') as string) || ''
    ]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'manufacturer-report-ngn.csv';
    a.click();
  };

  const pendingDistOrders = distOrders.filter(n => field(n, '@dso_stat') === 'dso-pending');

  const handleDistOrderAction = async (order: Node, action: 'approve' | 'reject') => {
    setProcessingOrder(order.id);
    const shipRef = action === 'approve' ? 'SHP-UL-' + Date.now().toString(36).toUpperCase() : '';
    const newStatus = action === 'approve' ? 'dso-approved' : 'dso-rejected';
    await updateNode(PROJECTS.distOrders, order.id, {
      '/attributes/@dso_stat': newStatus,
      ...(action === 'approve' ? { '/attributes/@dso_ship': shipRef } : {}),
    });
    setDistOrders(prev => prev.map(n => n.id === order.id
      ? { ...n, fieldValues: { ...n.fieldValues, '/attributes/@dso_stat': newStatus, '/attributes/@dso_ship': shipRef } }
      : n));
    setProcessingOrder(null);
  };

  const markInTransit = async (order: Node) => {
    setProcessingOrder(order.id);
    const etaDate = new Date(); etaDate.setDate(etaDate.getDate() + 5);
    await updateNode(PROJECTS.distOrders, order.id, {
      '/attributes/@dso_stat': 'dso-intransit',
      '/attributes/@dso_eta':  etaDate.toISOString().split('T')[0],
    });
    setDistOrders(prev => prev.map(n => n.id === order.id
      ? { ...n, fieldValues: { ...n.fieldValues, '/attributes/@dso_stat': 'dso-intransit' } }
      : n));
    setProcessingOrder(null);
  };

  const navItems: { id: MfgView; label: string; badge?: number }[] = [
    { id: 'overview',     label: 'Overview' },
    { id: 'distorders',   label: 'Dist. Orders', badge: pendingDistOrders.length },
    { id: 'distributors', label: 'Distributors' },
    { id: 'products',     label: 'Products' },
    { id: 'heatmap',      label: 'Demand Heatmap' },
  ];

  return (
    <div className="flex h-full min-h-screen bg-[#f8f9fa] text-[#1a1a1a]">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="p-5 border-b border-gray-100">
          <div className="text-xs font-bold tracking-[0.2em] text-[#1e3a8a] uppercase">Unilever</div>
          <div className="text-[10px] text-gray-400 mt-0.5 tracking-widest uppercase">Manufacturer Portal</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setView(item.id)}
              className={'w-full text-left px-3 py-2.5 rounded-[8px] text-sm font-medium transition-all duration-150 flex items-center justify-between ' +
                (view === item.id ? 'bg-[#1e3a8a] text-white shadow-sm' : 'text-gray-500 hover:text-[#1a1a1a] hover:bg-gray-100')}>
              <span>{item.label}</span>
              {!!item.badge && item.badge > 0 && (
                <span className="text-[10px] font-bold bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Signed in as</div>
          <div className="text-xs text-gray-600 mt-1 font-medium truncate max-w-[160px]">
            {identity?.role === 'manufacturer' ? identity.displayName : 'Manufacturer Portal'}
          </div>
          <div className="text-[9px] text-[#1e3a8a] font-mono mt-0.5 opacity-70">{mfgId}</div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-[#1a1a1a]">{getGreeting()}, Admin 👋</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[8px] px-3 py-2">
              <Calendar size={14} className="text-gray-400" />
              <select value={dateRange} onChange={e => setDateRange(e.target.value)}
                className="text-sm text-gray-600 bg-transparent border-none outline-none">
                <option value="last-7">Last 7 days</option>
                <option value="last-30">Last 30 days</option>
                <option value="last-90">Last 90 days</option>
                <option value="ytd">Year to date</option>
              </select>
            </div>
            <div className="relative">
              <button onClick={e => { e.stopPropagation(); setReportOpen(o => !o); }}
                className="flex items-center gap-2 bg-[#1e3a8a] text-white px-4 py-2 rounded-[8px] text-sm font-medium hover:bg-[#1e3a8a]/90 transition-colors shadow-sm">
                <FileText size={14} />Generate Report<ChevronDown size={14} />
              </button>
              {reportOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 w-48">
                  <button onClick={() => { exportCSV(); setReportOpen(false); }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                    <Download size={14} />Export CSV (₦)
                  </button>
                  <button onClick={() => { window.print(); setReportOpen(false); }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                    <FileText size={14} />Print / PDF (₦)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Revenue" value={loading ? null : ngn(totalRevenue, true)} sparkData={SPARK_REVENUE} sparkColor={DEEP_BLUE} icon={<TrendingUp size={16} />} trend="+11.7%" trendUp />
          <KpiCard label="Active Distributors" value={loading ? null : String(activeDistCount)} sparkData={SPARK_DIST} sparkColor={TEAL} icon={<Users size={16} />} trend="+5.9%" trendUp />
          <KpiCard label="Pending Requests" value={loading ? null : String(pendingCount)} sparkData={SPARK_PENDING} sparkColor={AMBER} icon={<AlertCircle size={16} />} trend="+22%" trendUp={false} />
          <KpiCard label="Products in Catalog" value={loading ? null : String(products.length || 53)} sparkData={SPARK_PRODS} sparkColor="#7c3aed" icon={<Package size={16} />} trend="+2" trendUp />
        </div>

        {/* Hierarchy Scope Banner */}
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 flex items-center gap-4 text-xs text-blue-700 flex-wrap">
          <span className="font-semibold text-blue-900">{mfgId}</span>
          <span className="text-blue-400">→</span>
          <span>{loading ? '…' : activeDistCount} Distributors</span>
          <span className="text-blue-400">→</span>
          <span>{loading ? '…' : totalRetailerCount} Retailers</span>
          <span className="ml-auto text-[10px] text-blue-400 uppercase tracking-wider">Full hierarchy visibility</span>
        </div>

        {/* Quick Actions */}
        <div className="bg-[#f8f9fa] border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mr-1">Quick Actions</span>
          <button onClick={() => setView('products')}
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-[8px] text-sm hover:border-[#1e3a8a] hover:text-[#1e3a8a] transition-colors shadow-sm">
            <Plus size={13} />Add Product
          </button>
          <button onClick={() => setView('distributors')}
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-[8px] text-sm hover:border-[#0d9488] hover:text-[#0d9488] transition-colors shadow-sm">
            <MessageCircle size={13} />Message Distributor
          </button>
          <button className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-[8px] text-sm hover:border-amber-500 hover:text-amber-600 transition-colors shadow-sm">
            <Bell size={13} />View Alerts
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{pendingCount}</span>
            )}
          </button>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6" onClick={() => setReportOpen(false)}>
          {view === 'overview'     && <MfgOverview loading={loading} requests={requests} topProducts={topProducts} onReqDetail={n => setReqDetail({ open: true, node: n })} />}
          {view === 'distorders'   && <MfgDistOrders loading={loading} orders={distOrders} processing={processingOrder} onApprove={n => handleDistOrderAction(n, 'approve')} onReject={n => handleDistOrderAction(n, 'reject')} onMarkInTransit={markInTransit} />}
          {view === 'distributors' && <MfgDistributors loading={loading} filteredDist={filteredDist} searchDist={searchDist} setSearchDist={setSearchDist} onRowClick={n => setDistPanel({ open: true, node: n })} />}
          {view === 'products'     && <MfgProducts loading={loading} products={filteredProds} filterCat={filterCat} setFilterCat={setFilterCat} onCardClick={n => setProdPanel({ open: true, node: n })} onCreatePO={n => setPOModal({ open: true, node: n })} />}
          {view === 'heatmap'      && <MfgHeatmap onCellClick={(r, s) => setHeatCell({ open: true, region: r, sku: s })} />}
        </main>
      </div>

      {distPanel.open && distPanel.node && <DistributorPanel node={distPanel.node} onClose={() => setDistPanel({ open: false, node: null })} />}
      {prodPanel.open && prodPanel.node && <ProductDetailPanel node={prodPanel.node} requests={requests} onClose={() => setProdPanel({ open: false, node: null })} onCreatePO={n => { setProdPanel({ open: false, node: null }); setPOModal({ open: true, node: n }); }} />}
      {poModal.open   && poModal.node   && <PurchaseOrderModal node={poModal.node} onClose={() => setPOModal({ open: false, node: null })} />}
      {reqDetail.open && reqDetail.node && <RequestDetailPanel node={reqDetail.node} onClose={() => setReqDetail({ open: false, node: null })} />}
      {heatCell.open                    && <HeatCellPanel region={heatCell.region} sku={heatCell.sku} onClose={() => setHeatCell({ open: false, region: '', sku: '' })} />}
    </div>
  );
};

function MfgOverview({ loading, requests, topProducts, onReqDetail }: {
  loading: boolean; requests: Node[]; topProducts: { name: string; vol: number }[]; onReqDetail: (n: Node) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-[8px] p-5 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wider">Revenue Over Time (₦)</h2>
          {loading ? <SkeletonCard height="h-48" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={DEEP_BLUE} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={DEEP_BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => ngn(v, true)} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} formatter={(v: unknown) => [ngn(v as number, true), 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke={DEEP_BLUE} strokeWidth={3} fill="url(#revGrad)" dot={{ fill: DEEP_BLUE, r: 4, strokeWidth: 2, stroke: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-[8px] p-5 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wider">Top Products by Volume</h2>
          {loading ? <SkeletonCard height="h-48" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={topProducts} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }} />
                <Bar dataKey="vol" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {topProducts.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-[8px] p-5 shadow-sm">
        <h2 className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wider">Restock Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="pb-3 pr-4">Request ID</th><th className="pb-3 pr-4">Product</th>
                <th className="pb-3 pr-4">Qty</th><th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Urgency</th><th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? Array(4).fill(0).map((_, i) => <SkeletonRow key={i} cols={6} />) :
                requests.slice(0, 6).map(n => {
                  const stat = field(n, '@reqstat1') as string;
                  const urg  = field(n, '@requrg1') as string;
                  const sc = stat === 'req-fulfilled' ? 'text-emerald-700 bg-emerald-50' : stat === 'req-rejected' ? 'text-red-700 bg-red-50' : stat === 'req-inprogress' ? 'text-blue-700 bg-blue-50' : 'text-amber-700 bg-amber-50';
                  const uc = urg === 'urg-high' ? 'text-red-700 bg-red-50' : urg === 'urg-medium' ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
                  return (
                    <tr key={n.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-400">{(field(n, '@reqid1') as string) || '—'}</td>
                      <td className="py-3 pr-4 font-medium text-[#1a1a1a]">{(field(n, '@reqpnm1') as string) || text(n)}</td>
                      <td className="py-3 pr-4 font-mono text-gray-500">{(field(n, '@reqqty1') as number) || 0}</td>
                      <td className="py-3 pr-4"><span className={'px-2 py-0.5 rounded-full text-[10px] font-semibold ' + sc}>{stat?.replace('req-', '') || '—'}</span></td>
                      <td className="py-3 pr-4"><span className={'px-2 py-0.5 rounded-full text-[10px] font-semibold ' + uc}>{urg?.replace('urg-', '') || '—'}</span></td>
                      <td className="py-3">
                        <button onClick={() => onReqDetail(n)} className="flex items-center gap-1 text-[#1e3a8a] text-xs font-medium hover:underline">
                          <Eye size={12} />View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MfgDistributors({ loading, filteredDist, searchDist, setSearchDist, onRowClick }: {
  loading: boolean; filteredDist: Node[]; searchDist: string; setSearchDist: (v: string) => void; onRowClick: (n: Node) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-[#1a1a1a]">Distributor Network</h1>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-[8px] px-3 py-2 w-64">
          <Search size={14} className="text-gray-400" />
          <input type="text" placeholder="Search distributors…" value={searchDist} onChange={e => setSearchDist(e.target.value)}
            className="flex-1 text-sm outline-none placeholder-gray-400 text-[#1a1a1a] bg-transparent" />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-[8px] overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-4">Distributor</th><th className="px-5 py-4">Region</th>
              <th className="px-5 py-4"># Retailers</th><th className="px-5 py-4">Fulfillment Rate</th>
              <th className="px-5 py-4">Status</th><th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? Array(5).fill(0).map((_, i) => <SkeletonRow key={i} cols={6} />) :
              filteredDist.map(n => {
                const stat = field(n, '@dstat1') as string;
                const rate = (field(n, '@dfrt1') as number) || 0;
                const rc = rate >= 90 ? '#059669' : rate >= 80 ? '#d97706' : '#dc2626';
                const sb = stat === 'dstat-active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : stat === 'dstat-review' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200';
                return (
                  <tr key={n.id} className="hover:bg-blue-50/40 transition-colors cursor-pointer group" onClick={() => onRowClick(n)}>
                    <td className="px-5 py-4 font-semibold text-[#1a1a1a] group-hover:text-[#1e3a8a] transition-colors">
                      <div className="flex items-center gap-1.5">
                        {text(n)}<ArrowRight size={12} className="text-gray-300 group-hover:text-[#1e3a8a] opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-500 capitalize">{(field(n, '@dreg1') as string)?.replace('dreg-', '') || '—'}</td>
                    <td className="px-5 py-4 font-mono text-gray-600">{(field(n, '@dret1') as number) || 0}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[80px]">
                          <div className="h-1.5 rounded-full" style={{ width: rate + '%', background: rc }} />
                        </div>
                        <span className="font-mono text-xs font-semibold" style={{ color: rc }}>{rate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4"><span className={'px-2 py-0.5 rounded-full text-[10px] font-semibold border ' + sb}>{stat?.replace('dstat-', '') || '—'}</span></td>
                    <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                      <button className="flex items-center gap-1.5 text-[#0d9488] text-xs font-medium border border-[#0d9488]/30 rounded-[8px] px-2.5 py-1.5 hover:bg-teal-50 transition-colors">
                        <MessageCircle size={12} />Message
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MfgProducts({ loading, products, filterCat, setFilterCat, onCardClick, onCreatePO }: {
  loading: boolean; products: Node[]; filterCat: string; setFilterCat: (v: string) => void;
  onCardClick: (n: Node) => void; onCreatePO: (n: Node) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [saving, setSaving]       = useState(false);

  const startEdit = (n: Node, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(n.id);
    setEditPrice(String((field(n, '@price1') as number) || 0));
    setEditStock(String((field(n, '@stock1') as number) || 0));
  };

  const saveEdit = async (n: Node, e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try { await updateNode(PROJECTS.products, n.id, { '/attributes/@price1': parseFloat(editPrice), '/attributes/@stock1': parseInt(editStock) }); } catch (_) {}
    setSaving(false);
    setEditingId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-[#1a1a1a] flex-1">Product Catalog</h1>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="bg-white border border-gray-200 text-gray-600 rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-[#1e3a8a] shadow-sm">
          <option value="">All Categories</option>
          <option value="cat-personal-care">Personal Care</option>
          <option value="cat-home-care">Home Care</option>
          <option value="cat-food-bev">Food & Beverage</option>
          <option value="cat-baby">Baby Products</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? Array(8).fill(0).map((_, i) => <SkeletonCard key={i} height="h-44" />) :
          products.map(n => {
            const price   = (field(n, '@price1') as number) || 0;
            const stock   = (field(n, '@stock1') as number) || 0;
            const reorder = (field(n, '@reord1') as number) || 50;
            const isLow   = stock < reorder * 1.5;
            const isEditing = editingId === n.id;
            const suggested = Math.max(reorder * 2 - stock, reorder);
            return (
              <div key={n.id}
                className="bg-white border border-gray-200 rounded-[8px] p-4 hover:border-[#1e3a8a]/40 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => { if (!isEditing) onCardClick(n); }}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] text-gray-400 uppercase font-medium">{(field(n, '@cat01') as string)?.replace('cat-', '') || 'General'}</span>
                  {isLow && <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">Low Stock</span>}
                </div>
                <div className="font-semibold text-[#1a1a1a] text-sm mb-0.5 group-hover:text-[#1e3a8a] transition-colors line-clamp-1">{text(n)}</div>
                <div className="text-[10px] text-gray-400 font-mono mb-3">{field(n, '@sku01') as string}</div>
                {isEditing ? (
                  <div className="space-y-2" onClick={e => e.stopPropagation()}>
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase tracking-wider">Price (₦)</label>
                      <input value={editPrice} onChange={e => setEditPrice(e.target.value)}
                        className="w-full border border-gray-200 rounded-[6px] px-2 py-1 text-sm font-mono mt-0.5 focus:outline-none focus:border-[#1e3a8a]" />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase tracking-wider">Stock</label>
                      <input value={editStock} onChange={e => setEditStock(e.target.value)}
                        className="w-full border border-gray-200 rounded-[6px] px-2 py-1 text-sm font-mono mt-0.5 focus:outline-none focus:border-[#1e3a8a]" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={e => saveEdit(n, e)} disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1 bg-[#1e3a8a] text-white rounded-[6px] py-1.5 text-xs font-medium hover:bg-[#1e3a8a]/90 disabled:opacity-60">
                        <Check size={11} />{saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={e => { e.stopPropagation(); setEditingId(null); }}
                        className="flex-1 border border-gray-200 text-gray-500 rounded-[6px] py-1.5 text-xs font-medium hover:bg-gray-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between mb-3">
                      <div><div className="text-[10px] text-gray-400">Price</div><div className="text-[#1e3a8a] font-mono font-bold text-sm">{ngn(price)}</div></div>
                      <div className="text-right"><div className="text-[10px] text-gray-400">Stock</div><div className={'font-mono font-bold text-sm ' + (isLow ? 'text-amber-600' : 'text-[#1a1a1a]')}>{stock.toLocaleString()}</div></div>
                    </div>
                    <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                      <button onClick={e => startEdit(n, e)}
                        className="flex items-center gap-1 border border-gray-200 text-gray-500 rounded-[6px] px-2 py-1.5 text-[10px] font-medium hover:border-[#1e3a8a] hover:text-[#1e3a8a] transition-colors">
                        <Edit2 size={10} />Edit
                      </button>
                      {isLow && (
                        <button onClick={() => onCreatePO(n)}
                          className="flex-1 flex items-center justify-center gap-1 bg-[#1e3a8a] text-white rounded-[6px] px-2 py-1.5 text-[10px] font-semibold hover:bg-[#1e3a8a]/90 transition-colors">
                          <ShoppingCart size={10} />Create PO ({suggested})
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function MfgHeatmap({ onCellClick }: { onCellClick: (region: string, sku: string) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#1a1a1a]">Demand Heatmap</h1>
        <p className="text-sm text-gray-400 mt-1">Restock frequency by product × region. Click any cell to view top requesting retailers.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-[8px] p-5 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-gray-400 pb-3 pr-4 font-medium w-24">Region ↓</th>
              {SKUS.map(s => <th key={s} className="text-center pb-3 px-2 text-gray-400 font-mono font-normal whitespace-nowrap">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {REGIONS.map(region => (
              <tr key={region}>
                <td className="text-gray-700 font-semibold py-2 pr-4 whitespace-nowrap">{region}</td>
                {SKUS.map(sku => {
                  const val = HEAT[region]?.[sku] || 0;
                  const isDark = val > 600;
                  return (
                    <td key={sku} className="px-1 py-1.5">
                      <div className="w-16 h-10 rounded-[6px] flex items-center justify-center font-mono font-bold transition-all hover:scale-110 hover:shadow-md cursor-pointer"
                        style={{ background: heatColor(val, HMAX), color: isDark ? '#fff' : '#1a1a1a' }}
                        title={region + ' x ' + sku + ': ' + val.toLocaleString() + ' units'}
                        onClick={() => onCellClick(region, sku)}>
                        {val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Scale</span>
          <div className="flex h-3 w-40 rounded overflow-hidden">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-1 h-full" style={{ background: heatColor((i / 19) * HMAX, HMAX) }} />
            ))}
          </div>
          <span className="text-[10px] text-gray-400">Low → High demand</span>
        </div>
      </div>
    </div>
  );
}

function DistributorPanel({ node, onClose }: { node: Node; onClose: () => void }) {
  return (
    <SidePanel title={text(node)} subtitle="Distributor Detail" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Region',      value: (field(node, '@dreg1') as string)?.replace('dreg-', '') || '—' },
          { label: 'Status',      value: (field(node, '@dstat1') as string)?.replace('dstat-', '') || '—' },
          { label: 'Retailers',   value: String((field(node, '@dret1') as number) || 0) },
          { label: 'Fulfillment', value: ((field(node, '@dfrt1') as number) || 0) + '%' },
        ].map(d => (
          <div key={d.label} className="bg-gray-50 rounded-[8px] p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">{d.label}</div>
            <div className="font-semibold text-[#1a1a1a] text-sm mt-0.5 capitalize">{d.value}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Retailer Network</h3>
        <div className="space-y-2">
          {DIST_RETAILERS.map(r => {
            const hc = r.inventory >= 80 ? 'text-emerald-700 bg-emerald-50' : r.inventory >= 50 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';
            return (
              <div key={r.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-[8px] border border-gray-100">
                <div>
                  <div className="text-sm font-medium text-[#1a1a1a]">{r.name}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{r.requests} pending restock requests</div>
                </div>
                <span className={'text-[10px] font-bold px-2 py-1 rounded-full ' + hc}>{r.inventory}% health</span>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Recent Restock History</h3>
        <div className="space-y-1.5">
          {[
            'SKU-001 · 500 units · ' + ngn(2500000) + ' · Fulfilled',
            'SKU-006 · 200 units · ' + ngn(4800000) + ' · In Progress',
            'SKU-004 · 350 units · ' + ngn(3150000) + ' · Pending',
          ].map(r => (
            <div key={r} className="text-xs text-gray-500 bg-gray-50 rounded-[6px] px-3 py-2 font-mono">{r}</div>
          ))}
        </div>
      </div>
      <button className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white rounded-[8px] py-2.5 text-sm font-semibold hover:bg-[#0d9488]/90 transition-colors">
        <MessageCircle size={14} />Message Distributor
      </button>
    </SidePanel>
  );
}

function ProductDetailPanel({ node, requests, onClose, onCreatePO }: {
  node: Node; requests: Node[]; onClose: () => void; onCreatePO: (n: Node) => void;
}) {
  const price   = (field(node, '@price1') as number) || 0;
  const stock   = (field(node, '@stock1') as number) || 0;
  const reorder = (field(node, '@reord1') as number) || 50;
  const isLow   = stock < reorder * 1.5;
  const prodName = text(node).toLowerCase().slice(0, 5);
  const prodRequests = requests.filter(r => ((field(r, '@reqpnm1') as string) || '').toLowerCase().includes(prodName));

  return (
    <SidePanel title={text(node)} subtitle={(field(node, '@sku01') as string) || 'Product Detail'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Unit Price',    value: ngn(price),        accent: true,  warn: false },
          { label: 'Current Stock', value: stock.toLocaleString(), accent: false, warn: isLow },
          { label: 'Reorder Point', value: String(reorder),   accent: false, warn: false },
          { label: 'Category',      value: (field(node, '@cat01') as string)?.replace('cat-', '') || 'General', accent: false, warn: false },
        ].map(d => (
          <div key={d.label} className="bg-gray-50 rounded-[8px] p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">{d.label}</div>
            <div className={'font-bold text-sm font-mono mt-0.5 ' + (d.accent ? 'text-[#1e3a8a]' : d.warn ? 'text-amber-600' : 'text-[#1a1a1a]')}>{d.value}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Stock by Distributor</h3>
        {[{ name: 'NorthBridge Dist.', share: 0.35 }, { name: 'Lagos Central', share: 0.28 }, { name: 'Eastern Hub', share: 0.22 }, { name: 'Abuja Logistics', share: 0.15 }].map(d => (
          <div key={d.name} className="flex items-center gap-3 mb-2">
            <span className="text-xs text-gray-500 w-32 truncate">{d.name}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-[#1e3a8a]" style={{ width: (d.share * 100) + '%' }} />
            </div>
            <span className="text-xs font-mono text-gray-600 w-12 text-right">{Math.round(stock * d.share).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Sales — Last 30 Days (₦)</h3>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={PRODUCT_SALES}>
            <defs>
              <linearGradient id="prodGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={TEAL} stopOpacity={0.2} />
                <stop offset="95%" stopColor={TEAL} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 9 }} interval={4} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => ngn(v, true)} tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: unknown) => [ngn(v as number, true), 'Sales']} contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            <Area type="monotone" dataKey="sales" stroke={TEAL} strokeWidth={2.5} fill="url(#prodGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Pending Restock Requests</h3>
        {prodRequests.length === 0 ? (
          <p className="text-sm text-gray-400">No pending requests found.</p>
        ) : (
          <div className="space-y-2">
            {prodRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-[6px] text-xs">
                <span className="text-gray-500 font-mono">{(field(r, '@reqid1') as string) || r.id.slice(0, 8)}</span>
                <span className="font-mono">{(field(r, '@reqqty1') as number) || 0} units</span>
                <span className="text-amber-600 font-medium">{((field(r, '@reqstat1') as string) || '').replace('req-', '') || 'pending'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {isLow && (
        <button onClick={() => onCreatePO(node)}
          className="w-full flex items-center justify-center gap-2 bg-[#1e3a8a] text-white rounded-[8px] py-2.5 text-sm font-semibold hover:bg-[#1e3a8a]/90 transition-colors">
          <ShoppingCart size={14} />Create Purchase Order
        </button>
      )}
    </SidePanel>
  );
}

function PurchaseOrderModal({ node, onClose }: { node: Node; onClose: () => void }) {
  const price     = (field(node, '@price1') as number) || 0;
  const stock     = (field(node, '@stock1') as number) || 0;
  const reorder   = (field(node, '@reord1') as number) || 50;
  const suggested = Math.max(reorder * 2 - stock, reorder);
  const [qty, setQty]   = useState(String(suggested));
  const [saved, setSaved] = useState(false);
  const qtyNum = parseFloat(qty) || 0;
  const total  = qtyNum * price;
  const submit = () => { setSaved(true); setTimeout(onClose, 1400); };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[#1a1a1a]">Create Purchase Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">{text(node)} · {(field(node, '@sku01') as string) || 'SKU'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>
        {saved ? (
          <div className="text-center py-10">
            <div className="text-5xl mb-3">✅</div>
            <div className="font-bold text-[#1a1a1a] text-lg">Purchase Order Created</div>
            <div className="text-sm text-gray-400 mt-1">PO sent to procurement queue</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-[8px] p-3">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Unit Price</div>
                <div className="font-bold text-[#1e3a8a] font-mono text-sm mt-0.5">{ngn(price)}</div>
              </div>
              <div className="bg-gray-50 rounded-[8px] p-3">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Current Stock</div>
                <div className="font-bold text-amber-600 font-mono text-sm mt-0.5">{stock.toLocaleString()}</div>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">
                Order Quantity <span className="text-gray-400">(suggested: {suggested})</span>
              </label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} min={1}
                className="w-full border border-gray-200 rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-[#1e3a8a] font-mono" />
            </div>
            <div className="bg-[#1e3a8a]/5 border border-[#1e3a8a]/20 rounded-[8px] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Order Total</span>
                <span className="text-xl font-bold text-[#1e3a8a] font-mono">{ngn(total)}</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{qtyNum.toLocaleString()} units × {ngn(price)}</div>
            </div>
            <div className="bg-gray-50 rounded-[8px] p-3 space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Supplier</span><span className="font-medium text-[#1a1a1a]">Primary Supplier Ltd.</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Est. Delivery</span><span className="font-medium text-[#1a1a1a]">5–7 business days</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Payment Terms</span><span className="font-medium text-[#1a1a1a]">Net 30</span>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-[8px] py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={submit}
                className="flex-1 bg-[#1e3a8a] text-white rounded-[8px] py-2.5 text-sm font-semibold hover:bg-[#1e3a8a]/90 transition-colors shadow-sm">
                Confirm Order · {ngn(total, true)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RequestDetailPanel({ node, onClose }: { node: Node; onClose: () => void }) {
  const stat = (field(node, '@reqstat1') as string) || '';
  const urg  = (field(node, '@requrg1') as string) || '';
  const qty  = (field(node, '@reqqty1') as number) || 0;
  const price = 15000;
  return (
    <SidePanel title={(field(node, '@reqpnm1') as string) || text(node)} subtitle={'Request ' + ((field(node, '@reqid1') as string) || '')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Status',   value: stat.replace('req-', '') || '—' },
          { label: 'Urgency',  value: urg.replace('urg-', '') || '—' },
          { label: 'Quantity', value: qty.toLocaleString() + ' units' },
          { label: 'Est. Value', value: ngn(qty * price) },
        ].map(d => (
          <div key={d.label} className="bg-gray-50 rounded-[8px] p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">{d.label}</div>
            <div className="font-semibold text-[#1a1a1a] text-sm mt-0.5 capitalize">{d.value}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Full Request History</h3>
        <div className="space-y-2">
          {[
            { date: '2025-05-01', event: 'Request submitted by retailer', actor: 'QuickMart Abuja' },
            { date: '2025-05-03', event: 'Forwarded to distributor',       actor: 'Lagos Central Dist.' },
            { date: '2025-05-05', event: 'Stock check completed',          actor: 'System' },
            { date: '2025-05-08', event: 'Awaiting manufacturer approval', actor: 'Pending' },
          ].map((e, i) => (
            <div key={i} className="flex gap-3 p-2.5 bg-gray-50 rounded-[6px]">
              <div className="w-20 text-[10px] text-gray-400 font-mono shrink-0">{e.date}</div>
              <div>
                <div className="text-xs font-medium text-[#1a1a1a]">{e.event}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{e.actor}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button className="flex-1 border border-emerald-200 text-emerald-700 rounded-[8px] py-2.5 text-sm font-semibold hover:bg-emerald-50 transition-colors">
          Approve
        </button>
        <button className="flex-1 border border-red-200 text-red-600 rounded-[8px] py-2.5 text-sm font-semibold hover:bg-red-50 transition-colors">
          Reject
        </button>
      </div>
    </SidePanel>
  );
}

function HeatCellPanel({ region, sku, onClose }: { region: string; sku: string; onClose: () => void }) {
  const val = HEAT[region]?.[sku] || 0;
  const topRetailers = [
    { name: 'QuickMart Abuja',      orders: Math.round(val * 0.38) },
    { name: 'Sunrise Retail Lagos', orders: Math.round(val * 0.29) },
    { name: 'Metro Stores PH',      orders: Math.round(val * 0.21) },
    { name: 'ValuePlus Kano',       orders: Math.round(val * 0.12) },
  ];
  return (
    <SidePanel title={region + ' × ' + sku} subtitle={val.toLocaleString() + ' total restock requests'} onClose={onClose}>
      <div className="flex items-center gap-3 p-4 rounded-[8px]" style={{ background: heatColor(val, HMAX) }}>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: val > 600 ? '#fff' : '#374151' }}>Demand Level</div>
          <div className="text-2xl font-bold font-mono mt-0.5" style={{ color: val > 600 ? '#fff' : '#1a1a1a' }}>
            {val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val} units
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Top Requesting Retailers</h3>
        <div className="space-y-3">
          {topRetailers.map((r, i) => (
            <div key={r.name} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#1e3a8a] text-white text-[9px] flex items-center justify-center font-bold shrink-0">{i + 1}</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#1a1a1a]">{r.name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-100 rounded-full h-1">
                    <div className="h-1 rounded-full bg-[#1e3a8a]" style={{ width: (r.orders / val * 100) + '%' }} />
                  </div>
                  <span className="text-[10px] font-mono text-gray-500 w-16 text-right">{r.orders.toLocaleString()} req</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-[8px] p-3">
        <div className="text-xs font-semibold text-amber-700 mb-1">Recommendation</div>
        <div className="text-xs text-amber-600">
          {val > 1000
            ? 'High demand detected. Consider increasing allocation to ' + region + ' region for ' + sku + '.'
            : 'Moderate demand. Monitor trends before adjusting regional allocation.'}
        </div>
      </div>
    </SidePanel>
  );
}

/* ═══ Manufacturer: Distributor Stock Orders Inbox ════════════════════════ */
const DSO_STYLE: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  'dso-pending':   { label: 'Pending',    color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200',  dot: 'bg-amber-500'  },
  'dso-approved':  { label: 'Approved',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   dot: 'bg-blue-500'   },
  'dso-intransit': { label: 'In Transit', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500' },
  'dso-received':  { label: 'Received',   color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  dot: 'bg-green-500'  },
  'dso-rejected':  { label: 'Rejected',   color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    dot: 'bg-red-500'    },
};
const mfgDsoStyle = (s: string) => DSO_STYLE[s] ?? DSO_STYLE['dso-pending'];

function MfgDistOrders({ loading, orders, processing, onApprove, onReject, onMarkInTransit }: {
  loading: boolean; orders: Node[]; processing: string | null;
  onApprove: (n: Node) => void; onReject: (n: Node) => void; onMarkInTransit: (n: Node) => void;
}) {
  const pending   = orders.filter(n => field(n, '@dso_stat') === 'dso-pending');
  const approved  = orders.filter(n => field(n, '@dso_stat') === 'dso-approved');
  const inTransit = orders.filter(n => field(n, '@dso_stat') === 'dso-intransit');
  const done      = orders.filter(n => ['dso-received','dso-rejected'].includes(field(n, '@dso_stat') as string));

  const Section = ({ title, items, dot }: { title: string; items: Node[]; dot: string }) => (
    items.length === 0 ? null : (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className={'w-2 h-2 rounded-full ' + dot} />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</span>
          <span className="text-xs text-gray-300">({items.length})</span>
        </div>
        <div className="space-y-3">
          {items.map(order => {
            const stat = (field(order, '@dso_stat') as string) || 'dso-pending';
            const st   = mfgDsoStyle(stat);
            const qty  = field(order, '@dso_qty') as number;
            const ship = field(order, '@dso_ship') as string;
            const isPending  = stat === 'dso-pending';
            const isApproved = stat === 'dso-approved';
            const isProc = processing === order.id;
            return (
              <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={'text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ' + st.color + ' ' + st.bg + ' ' + st.border}>
                        <span className={'inline-block w-1.5 h-1.5 rounded-full ' + st.dot} />
                        {st.label}
                      </span>
                      <span className="text-[11px] font-mono text-gray-400">{field(order, '@dso_id') as string}</span>
                    </div>
                    <div className="font-semibold text-gray-900">{field(order, '@dso_pnm') as string || text(order)}</div>
                    <div className="text-sm text-gray-500 mt-1 flex gap-3 flex-wrap">
                      <span><span className="font-medium text-gray-700">From:</span> {(field(order, '@dso_dname') as string) || (field(order, '@dso_dist') as string)}</span>
                      <span><span className="font-medium text-gray-700">SKU:</span> {field(order, '@dso_sku') as string}</span>
                      <span><span className="font-medium text-gray-700">Qty:</span> {qty?.toLocaleString()} units</span>
                      {ship && <span className="font-mono text-[11px] text-violet-600">{ship}</span>}
                    </div>
                    {field(order, '@dso_note') && (
                      <p className="text-xs text-gray-400 mt-1.5 italic">{field(order, '@dso_note') as string}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                    {isPending && (
                      <>
                        <button onClick={() => onApprove(order)} disabled={!!isProc}
                          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 min-h-[40px]">
                          {isProc ? <RefreshCw size={13} className="animate-spin" /> : <><CheckCircle size={14} /> Approve</>}
                        </button>
                        <button onClick={() => onReject(order)} disabled={!!isProc}
                          className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 min-h-[40px]">
                          <XCircle size={14} /> Reject
                        </button>
                      </>
                    )}
                    {isApproved && (
                      <button onClick={() => onMarkInTransit(order)} disabled={!!isProc}
                        className="flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 min-h-[40px]">
                        {isProc ? <RefreshCw size={13} className="animate-spin" /> : <><Truck size={14} /> Mark In Transit</>}
                      </button>
                    )}
                    {stat === 'dso-intransit' && (
                      <span className="flex items-center gap-1.5 text-violet-600 text-xs font-semibold bg-violet-50 border border-violet-200 px-3 py-2 rounded-lg">
                        <Truck size={12} className="animate-pulse" /> Dispatched
                      </span>
                    )}
                    {stat === 'dso-received' && (
                      <span className="flex items-center gap-1.5 text-green-600 text-xs font-semibold bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
                        <CheckCircle size={12} /> Received
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Distributor Stock Orders</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Review and approve stock requests from distributors · approve → mark in transit → distributor confirms receipt
        </p>
      </div>
      {loading ? (
        <div className="space-y-3">{Array(4).fill(0).map((_,i) => <SkeletonCard key={i} height="h-24" />)}</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Truck size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No stock orders from distributors yet.</p>
        </div>
      ) : (
        <>
          <Section title="Pending Approval" items={pending}   dot="bg-amber-500"  />
          <Section title="Approved"          items={approved}  dot="bg-blue-500"   />
          <Section title="In Transit"        items={inTransit} dot="bg-violet-500" />
          <Section title="Completed / Rejected" items={done}  dot="bg-gray-300"   />
        </>
      )}
    </div>
  );
}
