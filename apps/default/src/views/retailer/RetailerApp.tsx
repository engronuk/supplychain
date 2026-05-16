import React, { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, MessageCircle, Camera, Home, AlertTriangle, CheckCircle, Truck } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { createConversation, createAgentChat } from '@/lib/agent-chat/v2';
import { getNodes, createNode, PROJECTS, field, text, type Node } from '@/lib/api';
import { useHierarchy } from '@/lib/hierarchy';
import { isToolUIPart, type UIMessage } from 'ai';
import { ulid } from 'ulidx';
import {
  Conversation, ConversationContent, ConversationScrollButton
} from '@/components/ai-elements/conversation';
import {
  Message, MessageContent, MessageResponse
} from '@/components/ai-elements/message';
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { ShipmentsScreen } from './ShipmentsScreen';

type RetailerScreen = 'home' | 'inventory' | 'restock' | 'shipments' | 'chat' | 'scan';

const statColor = (s: string) => s === 'ri-healthy' ? 'text-green-700 bg-green-100 border-green-300' : s === 'ri-low' ? 'text-amber-700 bg-amber-100 border-amber-300' : 'text-red-700 bg-red-100 border-red-300';
const statLabel = (s: string) => s === 'ri-healthy' ? '✓ Healthy' : s === 'ri-low' ? '⚠ Low' : '✕ Critical';

const AGENT_ID = '01KRQWJ4C4G86NAF13RJ2MH629';

export const RetailerApp: React.FC = () => {
  const { identity } = useHierarchy();
  // RETAILER SCOPE: only see own inventory rows
  const RETAILER_ID = identity?.role === 'retailer' ? identity.retailerId : 'RET-001';
  const PARENT_DIST_ID = identity?.role === 'retailer' ? identity.parentDistId : 'DIST-LAG-001';
  const displayName = identity?.role === 'retailer' ? identity.displayName : 'My Store';

  const [screen, setScreen] = useState<RetailerScreen>('home');
  const [inventory, setInventory] = useState<Node[]>([]);
  const [inTransitCount, setInTransitCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNodes(PROJECTS.inventory)
      .then(nodes => {
        const mine = nodes.filter(n => n.parentId === null && field(n, '@ri_ret') === RETAILER_ID);
        setInventory(mine);
        setLoading(false);
      });
  }, [RETAILER_ID]);

  // Poll in-transit requests count for badge
  useEffect(() => {
    const check = () => getNodes(PROJECTS.requests).then(reqs => {
      const count = reqs.filter(n =>
        n.parentId === null &&
        field(n, '@reqret1') === RETAILER_ID &&
        field(n, '@reqstat1') === 'req-intransit'
      ).length;
      setInTransitCount(count);
    });
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [RETAILER_ID]);

  const tabs = [
    { id: 'home' as RetailerScreen,      icon: <Home size={22} />,         label: 'Home',      badge: false },
    { id: 'inventory' as RetailerScreen,  icon: <Package size={22} />,      label: 'Stock',     badge: false },
    { id: 'restock' as RetailerScreen,    icon: <RefreshCw size={22} />,    label: 'Restock',   badge: false },
    { id: 'shipments' as RetailerScreen,  icon: <Truck size={22} />,        label: 'Shipments', badge: inTransitCount > 0 },
    { id: 'chat' as RetailerScreen,       icon: <MessageCircle size={22} />,label: 'AI',        badge: true  },
    { id: 'scan' as RetailerScreen,       icon: <Camera size={22} />,       label: 'Scan',      badge: false },
  ];

  const criticalCount = inventory.filter(n => field(n, '@ri_stat') === 'ri-critical').length;
  const lowCount = inventory.filter(n => field(n, '@ri_stat') === 'ri-low').length;

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto" style={{ background: '#faf7f2', color: '#3d3530' }}>
      {/* Screen Content */}
      <div className="flex-1 overflow-y-auto">
        {screen === 'home'      && <HomeScreen inventory={inventory} loading={loading} critical={criticalCount} low={lowCount} onNavigate={setScreen} displayName={displayName} retailerId={RETAILER_ID} parentDistId={PARENT_DIST_ID} inTransitCount={inTransitCount} />}
        {screen === 'inventory' && <InventoryScreen inventory={inventory} loading={loading} />}
        {screen === 'restock'   && <RestockScreen inventory={inventory} retailerId={RETAILER_ID} parentDistId={PARENT_DIST_ID} />}
        {screen === 'shipments' && <ShipmentsScreen retailerId={RETAILER_ID} />}
        {screen === 'chat'      && <ChatScreen />}
        {screen === 'scan'      && <ScanScreen onClose={() => setScreen('home')} />}
      </div>

      {/* Bottom Nav */}
      <nav className="flex-shrink-0 border-t flex" style={{ background: '#faf7f2', borderColor: '#d4c5b0' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setScreen(tab.id)}
            className="flex-1 flex flex-col items-center py-3 gap-1 transition-all duration-150 relative min-h-[56px]"
            style={{ color: screen === tab.id ? '#8b7d6b' : '#b5a899' }}>
            {tab.badge && (
              <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full"
                style={{ background: tab.id === 'shipments' ? '#7c3aed' : '#f59e0b' }} />
            )}
            {tab.icon}
            <span className="text-[10px] font-medium tracking-wide">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

function HomeScreen({ inventory, loading, critical, low, onNavigate, displayName, retailerId, parentDistId, inTransitCount }: {
  inventory: Node[]; loading: boolean; critical: number; low: number;
  onNavigate: (s: RetailerScreen) => void;
  displayName: string; retailerId: string; parentDistId: string; inTransitCount: number;
}) {
  return (
    <div className="p-5 space-y-5">
      <div className="pt-2">
        <div className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: '#8b7d6b' }}>Unilever Supply Chain</div>
        <h1 className="text-2xl font-bold mt-1" style={{ color: '#3d3530' }}>{displayName}</h1>
        <p className="text-sm mt-0.5" style={{ color: '#8b7d6b' }}>Good morning — here's your store at a glance.</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] font-mono bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">{retailerId}</span>
          <span className="text-[10px] text-gray-400">→</span>
          <span className="text-[10px] font-mono bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full">{parentDistId}</span>
        </div>
      </div>

      {/* In-transit shipment banner */}
      {inTransitCount > 0 && (
        <button onClick={() => onNavigate('shipments')}
          className="w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-all active:scale-98"
          style={{ background: '#ede9f8', border: '1px solid #c4b5f4' }}>
          <Truck size={20} className="text-violet-600 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-sm text-violet-800">
              {inTransitCount} shipment{inTransitCount > 1 ? 's' : ''} on the way
            </div>
            <div className="text-xs text-violet-600 mt-0.5">Tap to view and confirm receipt →</div>
          </div>
        </button>
      )}

      {/* Alert Banner */}
      {(critical || low) ? (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#fff4e6', border: '1px solid #f5c69e' }}>
          <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sm text-amber-800">Attention needed</div>
            <div className="text-xs text-amber-700 mt-0.5">
              {critical ? `${critical} critical · ` : ''}{low ? `${low} low stock` : ''}
            </div>
          </div>
        </div>
      ) : null}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total SKUs', value: loading ? '—' : inventory.length, color: '#3d3530' },
          { label: 'Healthy', value: loading ? '—' : inventory.filter(n => field(n, '@ri_stat') === 'ri-healthy').length, color: '#4a7c5e' },
          { label: 'Critical', value: loading ? '—' : critical, color: '#c0392b' },
        ].map(c => (
          <div key={c.label} className="rounded-2xl p-3 text-center" style={{ background: '#f2ece4', border: '1px solid #d4c5b0' }}>
            <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: '#8b7d6b' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Scan CTA */}
      <button onClick={() => onNavigate('scan')}
        className="w-full rounded-2xl py-5 text-center font-bold text-base transition-all active:scale-98"
        style={{ background: '#8b7d6b', color: '#faf7f2' }}>
        <Camera size={20} className="inline mr-2 -mt-0.5" />
        Scan to Update Inventory
      </button>

      {/* Recent Items */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: '#3d3530' }}>Your Inventory</h2>
        <div className="space-y-2">
          {loading ? Array(3).fill(0).map((_, i) => (
            <div key={i} className="shimmer h-14 rounded-2xl" />
          )) : inventory.slice(0, 4).map(n => {
            const stat = field(n, '@ri_stat') as string;
            return (
              <div key={n.id} className="flex items-center justify-between rounded-2xl p-3.5" style={{ background: '#f2ece4', border: '1px solid #d4c5b0' }}>
                <div>
                  <div className="font-medium text-sm" style={{ color: '#3d3530' }}>{field(n, '@ri_pnm') as string || text(n)}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#8b7d6b' }}>{field(n, '@ri_qty') as number} units</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statColor(stat)}`}>{statLabel(stat)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InventoryScreen({ inventory, loading }: { inventory: Node[]; loading: boolean }) {
  return (
    <div className="p-5 space-y-4">
      <h1 className="text-xl font-bold pt-2" style={{ color: '#3d3530' }}>Inventory</h1>
      <div className="space-y-3">
        {loading ? Array(5).fill(0).map((_, i) => <div key={i} className="shimmer h-20 rounded-2xl" />) :
          inventory.map(n => {
            const stat = field(n, '@ri_stat') as string;
            const qty = field(n, '@ri_qty') as number;
            const thresh = field(n, '@ri_thresh') as number;
            const sold = field(n, '@ri_sold') as number;
            const pct = Math.min(100, Math.round((qty / Math.max(thresh, 1)) * 100));
            const barBg = stat === 'ri-healthy' ? '#4a7c5e' : stat === 'ri-low' ? '#d4860d' : '#c0392b';
            return (
              <div key={n.id} className="rounded-2xl p-4" style={{ background: '#f2ece4', border: '1px solid #d4c5b0' }}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold text-base" style={{ color: '#3d3530' }}>{field(n, '@ri_pnm') as string || text(n)}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#8b7d6b' }}>{field(n, '@ri_sku') as string} · {sold} sold/30d</div>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statColor(stat)}`}>{statLabel(stat)}</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1" style={{ color: '#8b7d6b' }}>
                    <span>{qty} in stock</span><span>Threshold: {thresh}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#d4c5b0' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barBg }} />
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}


function RestockScreen({ inventory, retailerId, parentDistId }: {
  inventory: Node[]; retailerId: string; parentDistId: string;
}) {
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('');
  const [urgency, setUrgency] = useState('urg-medium');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const criticalItems = inventory.filter(n => field(n, '@ri_stat') === 'ri-critical' || field(n, '@ri_stat') === 'ri-low');
  const hasCritical = criticalItems.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !qty) return;
    setSubmitting(true);
    try {
      const reqId = `REQ-${Date.now().toString().slice(-4)}`;
      // AUTO-STAMP: @reqret1 = retailer's own ID; @reqdst1 = their parent distributor
      await createNode(PROJECTS.requests, {
        '/text': `${reqId}: ${product} × ${qty}`,
        '/attributes/@reqid1': reqId,
        '/attributes/@reqret1': retailerId,     // ← own identity stamped
        '/attributes/@reqdst1': parentDistId,   // ← parent distributor auto-set
        '/attributes/@reqpnm1': product,
        '/attributes/@reqqty1': parseInt(qty),
        '/attributes/@reqstat1': 'req-pending',
        '/attributes/@requrg1': urgency,
        '/attributes/@reqnote1': note,
      });
      setSubmitted(true);
    } catch {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full min-h-[60vh] text-center space-y-4">
        <CheckCircle size={56} className="text-green-600" />
        <h2 className="text-xl font-bold" style={{ color: '#3d3530' }}>Request Submitted!</h2>
        <p className="text-sm" style={{ color: '#8b7d6b' }}>Your distributor will review and respond shortly.</p>
        <button onClick={() => { setSubmitted(false); setProduct(''); setQty(''); setNote(''); }}
          className="px-6 py-3 rounded-2xl font-semibold text-sm mt-2 min-h-[48px]" style={{ background: '#8b7d6b', color: '#faf7f2' }}>
          Submit Another
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <h1 className="text-xl font-bold pt-2" style={{ color: '#3d3530' }}>Restock Request</h1>

      {hasCritical && (
        <div className="rounded-2xl p-4" style={{ background: '#fff4e6', border: '1px solid #f5c69e' }}>
          <div className="text-xs font-bold text-amber-800 mb-2 uppercase tracking-wide">AI Suggestions</div>
          <div className="space-y-1.5">
            {criticalItems.slice(0, 3).map(n => (
              <button key={n.id} onClick={() => { setProduct(field(n, '@ri_pnm') as string || text(n)); setQty('50'); setUrgency(field(n, '@ri_stat') === 'ri-critical' ? 'urg-high' : 'urg-medium'); }}
                className="w-full text-left text-xs rounded-xl p-2.5 flex items-center justify-between transition-all min-h-[48px]"
                style={{ background: '#ffecd4', border: '1px solid #f5c69e', color: '#7a4f1e' }}>
                <span className="font-medium">{field(n, '@ri_pnm') as string || text(n)}</span>
                <span className="text-amber-700">Tap to pre-fill →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: '#3d3530' }}>Product Name</label>
          <input value={product} onChange={e => setProduct(e.target.value)} required
            className="w-full rounded-2xl px-4 py-3.5 text-base outline-none transition-all min-h-[48px]"
            style={{ background: '#f2ece4', border: '1px solid #d4c5b0', color: '#3d3530' }}
            placeholder="e.g. ProMax Wireless Headphones" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: '#3d3530' }}>Quantity</label>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} required min="1"
            className="w-full rounded-2xl px-4 py-3.5 text-base outline-none min-h-[48px]"
            style={{ background: '#f2ece4', border: '1px solid #d4c5b0', color: '#3d3530' }}
            placeholder="50" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: '#3d3530' }}>Urgency</label>
          <select value={urgency} onChange={e => setUrgency(e.target.value)}
            className="w-full rounded-2xl px-4 py-3.5 text-base outline-none min-h-[48px]"
            style={{ background: '#f2ece4', border: '1px solid #d4c5b0', color: '#3d3530' }}>
            <option value="urg-low">Low — routine restock</option>
            <option value="urg-medium">Medium — running low</option>
            <option value="urg-high">High — critically low</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: '#3d3530' }}>Notes (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            className="w-full rounded-2xl px-4 py-3.5 text-base outline-none resize-none"
            style={{ background: '#f2ece4', border: '1px solid #d4c5b0', color: '#3d3530' }}
            placeholder="Any additional context for your distributor…" />
        </div>
        <button type="submit" disabled={submitting || !product || !qty}
          className="w-full rounded-2xl py-4 font-bold text-base transition-all active:scale-98 min-h-[56px] disabled:opacity-50"
          style={{ background: '#8b7d6b', color: '#faf7f2' }}>
          {submitting ? 'Submitting…' : 'Submit Restock Request'}
        </button>
      </form>
    </div>
  );
}

function ChatScreen() {
  const [chat, setChat] = useState<ReturnType<typeof createAgentChat> | null>(null);
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setStarting(true);
    const { conversationId } = await createConversation(AGENT_ID);
    setChat(createAgentChat(AGENT_ID, conversationId));
    setStarting(false);
  }, []);

  useEffect(() => { handleStart(); }, [handleStart]);

  if (!chat || starting) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]" style={{ color: '#8b7d6b' }}>
        <div className="text-center space-y-3">
          <MessageCircle size={40} className="mx-auto" />
          <p className="text-sm">Connecting to your AI assistant…</p>
        </div>
      </div>
    );
  }

  return <ActiveChat chat={chat} />;
}

function ActiveChat({ chat }: { chat: ReturnType<typeof createAgentChat> }) {
  const { messages, status, addToolApprovalResponse } = useChat({ chat, id: chat.id });
  const isSending = status === 'submitted' || status === 'streaming';

  const handleSend = async (text: string) => {
    await chat.sendMessage({ id: ulid(), role: 'user', parts: [{ type: 'text', text }] });
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full" style={{ background: '#faf7f2' }}>
      <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#d4c5b0' }}>
        <div className="font-semibold text-base" style={{ color: '#3d3530' }}>Inventory Assistant</div>
        <div className="text-xs mt-0.5" style={{ color: '#8b7d6b' }}>Ask what to restock, how much, and when</div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <Conversation>
          <ConversationContent>
            {messages.map(msg => (
              <Message key={msg.id} from={msg.role}>
                <MessageContent>
                  <ChatMessageParts message={msg} onApprove={addToolApprovalResponse} />
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {!hasMessages && (
          <Suggestions>
            <Suggestion suggestion="What should I restock?" onClick={handleSend} />
            <Suggestion suggestion="Show me critical stock items" onClick={handleSend} />
            <Suggestion suggestion="Help me create a restock request" onClick={handleSend} />
          </Suggestions>
        )}

        <PromptInput onSubmit={({ text }) => handleSend(text)}>
          <PromptInputTextarea placeholder="Ask your inventory assistant…" />
          <PromptInputFooter>
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function ChatMessageParts({ message, onApprove }: { message: UIMessage; onApprove: ReturnType<typeof useChat>['addToolApprovalResponse'] }) {
  return (
    <>
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        if (part.type === 'text') {
          return message.role === 'user'
            ? <p key={key} className="text-sm">{part.text}</p>
            : <MessageResponse key={key}>{part.text}</MessageResponse>;
        }
        if (isToolUIPart(part)) {
          return (
            <div key={key} className="text-xs rounded-lg p-2 mt-1" style={{ background: '#f2ece4' }}>
              <em style={{ color: '#8b7d6b' }}>Tool: {part.toolName} [{part.state}]</em>
              {part.state === 'approval-requested' && part.approval != null && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApprove({ id: part.approval!.id, approved: true })}
                    className="px-3 py-1 rounded-lg text-xs font-semibold min-h-[36px]" style={{ background: '#8b7d6b', color: '#faf7f2' }}>Approve</button>
                  <button onClick={() => onApprove({ id: part.approval!.id, approved: false })}
                    className="px-3 py-1 rounded-lg text-xs font-semibold border min-h-[36px]" style={{ borderColor: '#d4c5b0', color: '#8b7d6b' }}>Deny</button>
                </div>
              )}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function ScanScreen({ onClose }: { onClose: () => void }) {
  const [scanned, setScanned] = useState(false);

  return (
    <div className="flex flex-col h-screen" style={{ background: '#1a1510' }}>
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-white text-sm font-medium">Scan Product</span>
        <button onClick={onClose} className="text-white text-sm opacity-60 hover:opacity-100 min-h-[48px] px-4">Cancel</button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <div className="relative w-72 h-72">
          <div className="absolute inset-0 rounded-3xl border-2 border-white/20" />
          <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-white rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-white rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-white rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-white rounded-br-2xl" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-0.5 bg-amber-400 opacity-80" style={{ animation: 'shimmer 1.5s infinite' }} />
          </div>
          {!scanned && (
            <button onClick={() => setScanned(true)}
              className="absolute inset-0 flex items-center justify-center text-white/50 text-xs text-center px-6 min-h-[48px]">
              Tap to simulate scan
            </button>
          )}
          {scanned && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-3xl">
              <div className="text-center text-white space-y-2">
                <CheckCircle size={40} className="mx-auto text-green-400" />
                <div className="text-sm font-bold">SKU-001 Scanned</div>
                <div className="text-xs text-white/60">ProMax Headphones</div>
              </div>
            </div>
          )}
        </div>

        <p className="text-white/40 text-sm text-center mt-8">
          {scanned ? 'Item identified. Updating inventory…' : 'Position barcode within the frame'}
        </p>

        {scanned && (
          <button onClick={onClose}
            className="mt-6 px-8 py-3.5 rounded-2xl font-semibold text-sm min-h-[56px]"
            style={{ background: '#8b7d6b', color: '#faf7f2' }}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
