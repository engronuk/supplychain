// geoService.ts — Nigeria map / geographic network data
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export type GeoStatus = "healthy" | "warning" | "critical";

export interface GeoRegion {
  name: string;
  lat: number;
  lon: number;
  distributors: number;
  retailers: number;
  status: GeoStatus;
}

export interface GeoDistributor {
  id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  status: GeoStatus;
  retailer_count: number;
  low_stock_retailers: number;
  shipment_activity: number;
}

export interface GeoRetailer {
  id: string;
  name: string;
  city: string;
  region: string;
  address: string;
  store_code: string;
  phone: string;
  lat: number;
  lon: number;
  distributor_id: string;
  status: GeoStatus;
  low_stock_skus: number;
  active_shipments: number;
}

export interface GeoNetwork {
  manufacturer: { id: string; name: string; lat: number; lon: number };
  regions: GeoRegion[];
  distributors: GeoDistributor[];
  retailers: GeoRetailer[];
}

export interface RetailerDetail {
  retailer: GeoRetailer;
  distributor: { id: string; name: string };
  inventory: { in_stock: number; low_stock: number; out_of_stock: number; health_pct: number };
  sales: { revenue_7d: number; delta_pct: number; trend: { date: string; revenue: number }[] };
  pending_requests: number;
  last_shipment: { tracking_code: string; status: string; eta: string | null } | null;
  ai_insight: string;
}

let cached: GeoNetwork | null = null;
let cachedMfgId: string | null = null;

export const geoService = {
  async getNetwork(mfgId: string, force = false): Promise<GeoNetwork> {
    if (!force && cached && cachedMfgId === mfgId) return cached;
    const { data } = await axios.get(`${API}/geo/network/${mfgId}`);
    cached = data;
    cachedMfgId = mfgId;
    return data;
  },

  async getRetailer(retailerId: string): Promise<RetailerDetail> {
    const { data } = await axios.get(`${API}/geo/retailer/${retailerId}`);
    return data;
  },

  resetCache() {
    cached = null;
    cachedMfgId = null;
  },

  statusColor(s: GeoStatus): string {
    return s === "healthy" ? "#10b981" : s === "warning" ? "#f59e0b" : "#ef4444";
  },
};

export default geoService;
