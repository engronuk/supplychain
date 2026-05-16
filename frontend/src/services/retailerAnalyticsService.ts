// retailerAnalyticsService.ts
// Lightweight client for the new retailer OS endpoints, with localStorage
// caching for offline-first behavior and a queue for pending reorders.
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export type Urgency = "healthy" | "warning" | "critical";

export interface DashboardKpis {
  inventory_units: number;
  low_stock_count: number;
  critical_count: number;
  pending_deliveries: number;
  sales_today_units: number;
  sales_today_revenue: number;
  skus_tracked: number;
}

export interface InventoryRow {
  id: string;
  product_id: string;
  product?: { name?: string; sku?: string; category?: string; unit_price?: number };
  quantity: number;
  reorder_level: number;
  velocity: number;
  urgency: Urgency;
  days_remaining: number;
}

export interface ReorderSuggestion {
  product_id: string;
  product?: { name?: string; sku?: string; unit_price?: number };
  current_quantity: number;
  velocity: number;
  days_remaining: number;
  urgency: Urgency;
  recommended_quantity: number;
}

export interface AIInsight {
  id: string;
  type: string;
  tone: "critical" | "warning" | "info";
  title: string;
  message: string;
  action: string;
  product_id?: string;
}

export interface ActivityItem {
  kind: string;
  title: string;
  message: string;
  ts: string;
  read?: boolean;
  tracking_code?: string;
  status?: string;
}

export interface SalesTrend {
  series: { date: string; units: number; revenue: number }[];
  totals: { units: number; revenue: number };
  inventory_turnover: number;
  reorder_count: number;
  stock_efficiency_score: number;
}

const cacheKey = (k: string, retailerId: string) => `retailer:${k}:${retailerId}`;
const queueKey = (retailerId: string) => `retailer:reorder-queue:${retailerId}`;

function readCache<T>(k: string, retailerId: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(k, retailerId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeCache(k: string, retailerId: string, v: unknown) {
  try {
    localStorage.setItem(cacheKey(k, retailerId), JSON.stringify(v));
  } catch {
    /* ignore quota */
  }
}

async function getOrCache<T>(k: string, retailerId: string, url: string): Promise<{ data: T; fromCache: boolean }> {
  try {
    const { data } = await axios.get<T>(url);
    writeCache(k, retailerId, data);
    return { data, fromCache: false };
  } catch (e) {
    const cached = readCache<T>(k, retailerId);
    if (cached) return { data: cached, fromCache: true };
    throw e;
  }
}

export const retailerAnalyticsService = {
  dashboard: (retailerId: string) =>
    getOrCache<any>("dashboard", retailerId, `${API}/retailer/${retailerId}/dashboard`),

  insights: (retailerId: string) =>
    getOrCache<AIInsight[]>("insights", retailerId, `${API}/retailer/${retailerId}/insights`),

  reorderSuggestions: (retailerId: string) =>
    getOrCache<ReorderSuggestion[]>("suggestions", retailerId, `${API}/retailer/${retailerId}/reorder-suggestions`),

  salesTrend: (retailerId: string, days = 7) =>
    getOrCache<SalesTrend>(`trend-${days}`, retailerId, `${API}/retailer/${retailerId}/sales-trend?days=${days}`),

  activity: (retailerId: string) =>
    getOrCache<ActivityItem[]>("activity", retailerId, `${API}/retailer/${retailerId}/activity`),

  inventory: (retailerId: string) =>
    getOrCache<InventoryRow[]>("inventory", retailerId, `${API}/inventory?owner_type=retailer&owner_id=${retailerId}`),

  /** Submit a quick reorder. If offline, queue locally and resolve true. */
  async submitReorder(
    retailerId: string,
    payload: { shipment_id?: string; items?: { product_id: string; quantity: number }[]; note?: string }
  ): Promise<{ ok: boolean; queued?: boolean; request_id?: string }> {
    const url = `${API}/retailer/${retailerId}/quick-reorder`;
    if (!navigator.onLine) {
      this.enqueue(retailerId, payload);
      return { ok: true, queued: true };
    }
    try {
      const { data } = await axios.post(url, payload);
      return { ok: true, request_id: data.request_id };
    } catch (e) {
      this.enqueue(retailerId, payload);
      return { ok: true, queued: true };
    }
  },

  enqueue(retailerId: string, payload: any) {
    const q = readCache<any[]>("reorder-queue", retailerId) || [];
    q.push({ ...payload, _queued_at: new Date().toISOString() });
    writeCache("reorder-queue", retailerId, q);
  },

  /** Flush queued reorders to server. Returns count flushed. */
  async flushQueue(retailerId: string): Promise<number> {
    const q = readCache<any[]>("reorder-queue", retailerId) || [];
    if (!q.length || !navigator.onLine) return 0;
    let flushed = 0;
    const remaining: any[] = [];
    for (const item of q) {
      try {
        await axios.post(`${API}/retailer/${retailerId}/quick-reorder`, item);
        flushed += 1;
      } catch {
        remaining.push(item);
      }
    }
    writeCache("reorder-queue", retailerId, remaining);
    return flushed;
  },

  queuedCount(retailerId: string): number {
    return (readCache<any[]>("reorder-queue", retailerId) || []).length;
  },

  /** Hook that monitors online state and flushes the queue automatically. */
  attachAutoFlush(retailerId: string, onFlushed?: (n: number) => void) {
    const handler = async () => {
      const n = await this.flushQueue(retailerId);
      if (n > 0 && onFlushed) onFlushed(n);
    };
    window.addEventListener("online", handler);
    handler();
    return () => window.removeEventListener("online", handler);
  },
};

export default retailerAnalyticsService;
