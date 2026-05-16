import React from 'react';
import { Plus } from 'lucide-react';
import { createNode, PROJECTS, field, text, type Node } from '@/lib/api';
import { cn } from '@/lib/utils';
import { healthDot, healthLabel } from './dsoHelpers';

export function RetailerList({ loading, retailers, distId, onRetailerCreated }: {
  loading: boolean; retailers: Node[]; distId: string; onRetailerCreated: () => void;
}) {
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', location: '', email: '' });
  const [saving, setSaving] = React.useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const retailerId = 'RET-' + Date.now().toString(36).toUpperCase();
    await createNode(PROJECTS.retailers, {
      '/text':                         form.name,
      '/attributes/@rid01':       retailerId,
      '/attributes/@parentDist':  distId,
      '/attributes/@rdist1':      distId,
      '/attributes/@rloc1':       form.location,
      '/attributes/@remail1':     form.email,
      '/attributes/@rhlth1':      'rhlth-healthy',
    });
    setSaving(false);
    setCreating(false);
    setForm({ name: '', location: '', email: '' });
    onRetailerCreated();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">
          My Retailers <span className="text-gray-400 font-normal text-base">({retailers.length})</span>
        </h1>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
          <Plus size={14} /> Add Retailer
        </button>
      </div>

      {creating && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-blue-900">
            New Retailer — linked to <code className="font-mono bg-blue-100 px-1 rounded">{distId}</code>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input placeholder="Store name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <input placeholder="Location (city)" value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <input placeholder="Contact email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !form.name.trim()}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create Retailer'}
            </button>
            <button onClick={() => setCreating(false)} className="text-gray-500 text-sm px-4 py-2 rounded-lg hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-3">Store</th>
              <th className="px-5 py-3">Location</th>
              <th className="px-5 py-3">Retailer ID</th>
              <th className="px-5 py-3">Health</th>
              <th className="px-5 py-3">Contact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? Array(5).fill(0).map((_,i) => (
              <tr key={i}>{Array(5).fill(0).map((_,j) => <td key={j} className="px-5 py-4"><div className="shimmer h-4 rounded w-24" /></td>)}</tr>
            )) : retailers.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-sm">No retailers linked to {distId} yet.</td></tr>
            ) : retailers.map(n => {
              const health = field(n, '@rhlth1') as string;
              const retId  = field(n, '@rid01')  as string;
              return (
                <tr key={n.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4 font-semibold text-gray-900">{text(n)}</td>
                  <td className="px-5 py-4 text-gray-600 text-xs">{(field(n, '@rloc1') as string) || '—'}</td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">{retId || '—'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', healthDot(health))} />
                      <span className="font-medium text-gray-700">{healthLabel(health)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-blue-600 text-xs">{(field(n, '@remail1') as string) || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
