// hierarchyService.ts — fetches lazy hierarchy layers from the backend
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export type HierarchyType = "manufacturer" | "region" | "state" | "distributor" | "retailer";
export type HealthStatus = "healthy" | "warning" | "critical";

export interface HierarchyNode {
  id: string;
  ref_id?: string;
  parent_id: string | null;
  name: string;
  type: HierarchyType;
  status: HealthStatus;
  alerts: number;
  has_children: boolean;
  summary: Record<string, any>;
}

const cache = new Map<string, HierarchyNode[]>();

async function fetchOnce(key: string, url: string): Promise<HierarchyNode[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const { data } = await axios.get(url);
  const arr = Array.isArray(data) ? data : [data];
  cache.set(key, arr);
  return arr;
}

export const hierarchyService = {
  async getRoot(manufacturerId: string): Promise<HierarchyNode> {
    const { data } = await axios.get(`${API}/hierarchy/manufacturer/${manufacturerId}`);
    return data as HierarchyNode;
  },

  /**
   * Lazily fetch children for a node. The returned array is cached.
   */
  async getChildren(manufacturerId: string, node: HierarchyNode): Promise<HierarchyNode[]> {
    if (!node.has_children) return [];

    switch (node.type) {
      case "manufacturer":
        return fetchOnce(
          `regions:${manufacturerId}`,
          `${API}/hierarchy/regions/${manufacturerId}`
        );
      case "region": {
        const region = node.name;
        return fetchOnce(
          `states:${manufacturerId}:${region}`,
          `${API}/hierarchy/states/${manufacturerId}/${encodeURIComponent(region)}`
        );
      }
      case "state": {
        // id format: state:<mfgId>:<region>:<state>
        const parts = node.id.split(":");
        const mfg = parts[1];
        const region = parts[2];
        const state = parts.slice(3).join(":");
        return fetchOnce(
          `dists:${mfg}:${region}:${state}`,
          `${API}/hierarchy/distributors/${mfg}/${encodeURIComponent(region)}/${encodeURIComponent(state)}`
        );
      }
      case "distributor": {
        const distId = node.ref_id || node.id.replace(/^dist:/, "");
        return fetchOnce(
          `rets:${distId}`,
          `${API}/hierarchy/retailers/${distId}`
        );
      }
      default:
        return [];
    }
  },

  /** Bust all caches (e.g. after a re-seed). */
  resetCache() {
    cache.clear();
  },

  /** Color helpers shared with the canvas component. */
  statusColor(status: HealthStatus, dimmed = false): string {
    if (dimmed) return "#cbd5e1"; // soft neutral slate-300 for inactive
    const map: Record<HealthStatus, string> = {
      healthy: "#10b981",
      warning: "#f59e0b",
      critical: "#ef4444",
    };
    return map[status];
  },

  /** Softer ring color for the layered shadow halo on light bg. */
  statusHalo(status: HealthStatus): string {
    const map: Record<HealthStatus, string> = {
      healthy: "rgba(16, 185, 129, 0.16)",
      warning: "rgba(245, 158, 11, 0.18)",
      critical: "rgba(239, 68, 68, 0.16)",
    };
    return map[status];
  },

  statusGlow(status: HealthStatus): string {
    const map: Record<HealthStatus, string> = {
      healthy: "rgba(16, 185, 129, 0.30)",
      warning: "rgba(245, 158, 11, 0.30)",
      critical: "rgba(239, 68, 68, 0.30)",
    };
    return map[status];
  },
};

export default hierarchyService;
