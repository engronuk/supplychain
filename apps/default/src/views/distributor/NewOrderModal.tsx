import React, { useState } from 'react';
import { X, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { createNode, PROJECTS } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PRODUCTS } from './dsoHelpers';

export function NewOrderModal({ distId, distName, onClose, onCreated }: {
  distId: string; distName: string; onClose: () => void; onCreated: () => void;
}) {
  const [sku,      setSku]      = useState('KBC-CUBES');
  const [qty,      setQty]      = useState(500);
  const [priority, setPriority] = useState('dso-pri-medium');
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);

  const selectedProduct = PRODUCTS.find(p => p.sku === sku);

  const handleSubmit = async () => {
    if (!sku || qty <= 0) return;
    setSaving(true);
    const orderId = 'DSO-' + Date.now().toString(36).toUpperCase();
    await createNode(PROJECTS.distOrders, {
      '/text':                             `${orderId}: ${selectedProduct?.name} x${qty} — ${distName}`,
      '/attributes/@dso_id':      orderId,
      '/attributes/@dso_dist':    distId,
      '/attributes/@dso_dname':   distName,
      '/attributes/@dso_sku':     sku,
      '/attributes/@dso_pnm':     selectedProduct?.name || sku,
      '/attributes/@dso_qty':     qty,
      '/attributes/@dso_qconf':   0,
      '/attributes/@dso_stat':    'dso-pending',
      '/attributes/@dso_pri':     priority,
      '/attributes/@dso_note':    note || `Stock order from ${distName}`,
      '/attributes/@dso_ship':    '',
      '/attributes/@dso_created': new Date().toISOString().split('T')[0],
    });
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-base font-bold text-gray-900">New Stock Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Request from Unilever — status starts as <span className="text-amber-600 font-semibold">Pending</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <ShieldCheck size={14} className="text-blue-500" />
            <span className="text-sm text-blue-700 font-medium">{distName}</span>
            <span className="text-xs text-blue-400 font-mono ml-auto">{distId}</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Product</label>
            <select value={sku} onChange={e => setSku(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white">
              {PRODUCTS.map(p => (
                <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quantity (units)</label>
            <input type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Priority</label>
            <div className="flex gap-2">
              {[
                { id: 'dso-pri-high',   label: 'High',   style: 'border-red-300 text-red-700 bg-red-50'       },
                { id: 'dso-pri-medium', label: 'Medium', style: 'border-amber-300 text-amber-700 bg-amber-50' },
                { id: 'dso-pri-low',    label: 'Low',    style: 'border-green-300 text-green-700 bg-green-50' },
              ].map(p => (
                <button key={p.id} onClick={() => setPriority(p.id)}
                  className={cn('flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-all',
                    priority === p.id ? p.style : 'border-gray-200 text-gray-400 hover:border-gray-300')}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Notes <span className="text-gray-300 font-normal">(optional)</span>
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. Urgent — multiple retailers running low…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button onClick={handleSubmit} disabled={saving || qty <= 0}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm">
            {saving
              ? <><RefreshCw size={14} className="animate-spin" /> Submitting…</>
              : <><ArrowRight size={14} /> Submit Order to Unilever</>
            }
          </button>
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
