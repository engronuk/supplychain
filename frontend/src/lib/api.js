import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

// We use Bearer tokens (Authorization header) — cookies are only a fallback
// the frontend never reads. Setting `withCredentials: false` means the
// browser won't trip CORS preflight on credentialed requests, which was
// breaking production /demo until the backend was patched to echo origins.
const api = axios.create({ baseURL: API_BASE, withCredentials: false });

// ---- token store (in-memory copy maintained by SessionContext) ----
let _accessToken = null;
export function setAccessToken(token) { _accessToken = token || null; }
export function getAccessToken() { return _accessToken; }

api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

// Auto-redirect on 401 (except for auth endpoints themselves)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";
    const isAuthCall = url.includes("/auth/login") || url.includes("/auth/me");
    if (status === 401 && !isAuthCall) {
      // Surface as a normal axios error; ProtectedRoute will handle redirect.
      _accessToken = null;
      try { localStorage.removeItem("tk.access_token"); } catch {}
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.replace("/login?expired=1");
      }
    }
    return Promise.reject(err);
  }
);

// ============================================================================
// Auth API
// ============================================================================
export const AuthApi = {
  login: ({ email, password }) =>
    api.post("/auth/login", { email, password }).then((r) => r.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
  refresh: () => api.post("/auth/refresh").then((r) => r.data),
  demoAccounts: () => api.get("/auth/demo-accounts").then((r) => r.data),
  impersonate: (userId) =>
    api.post(`/auth/impersonate/${userId}`).then((r) => r.data),
  // Hydrate the manufacturer/distributor/retailer record after login.
  fetchEntity: async (role, entityId) => {
    if (!role || !entityId) return null;
    if (role === "manufacturer") {
      const list = await api.get("/manufacturers").then((r) => r.data);
      return list.find((m) => m.id === entityId) || null;
    }
    if (role === "distributor") {
      const list = await api.get("/distributors").then((r) => r.data);
      return list.find((d) => d.id === entityId) || null;
    }
    if (role === "retailer") {
      const list = await api.get("/retailers").then((r) => r.data);
      return list.find((x) => x.id === entityId) || null;
    }
    return null;
  },
};

export const Api = {
  // entities
  manufacturers: () => api.get("/manufacturers").then((r) => r.data),
  distributors: (manufacturer_id) =>
    api.get("/distributors", { params: manufacturer_id ? { manufacturer_id } : {} }).then((r) => r.data),
  retailers: (distributor_id) =>
    api.get("/retailers", { params: distributor_id ? { distributor_id } : {} }).then((r) => r.data),
  distributorRetailers: (distributor_id) =>
    api.get(`/distributor/${distributor_id}/retailers`).then((r) => r.data),
  distributorRetailerDetail: (distributor_id, retailer_id) =>
    api.get(`/distributor/${distributor_id}/retailer/${retailer_id}`).then((r) => r.data),
  distributorProductDetail: (distributor_id, product_id) =>
    api.get(`/distributor/${distributor_id}/product/${product_id}`).then((r) => r.data),
  distributorExecutiveAnalytics: (distributor_id) =>
    api.get(`/distributor/${distributor_id}/analytics/executive`).then((r) => r.data),
  products: (manufacturer_id) =>
    api.get("/products", { params: manufacturer_id ? { manufacturer_id } : {} }).then((r) => r.data),

  // inventory
  inventory: (owner_type, owner_id) =>
    api.get("/inventory", { params: { owner_type, owner_id } }).then((r) => r.data),

  // shipments
  shipments: (params = {}) => api.get("/shipments", { params }).then((r) => r.data),
  createShipment: (payload) => api.post("/shipments", payload).then((r) => r.data),
  updateShipmentStatus: (id, status) =>
    api.patch(`/shipments/${id}/status`, { status }).then((r) => r.data),

  // requests
  requests: (params = {}) => api.get("/requests", { params }).then((r) => r.data),
  createRequest: (payload) => api.post("/requests", payload).then((r) => r.data),
  decideRequest: (id, action) =>
    api.patch(`/requests/${id}`, { action }).then((r) => r.data),

  // notifications
  notifications: (target_type, target_id) =>
    api.get("/notifications", { params: { target_type, target_id } }).then((r) => r.data),
  markNotificationRead: (id) =>
    api.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllNotificationsRead: (target_type, target_id) =>
    api.patch("/notifications/read-all", null, { params: { target_type, target_id } }).then((r) => r.data),

  // analytics
  analytics: (role, entity_id) =>
    api.get("/analytics", { params: { role, entity_id } }).then((r) => r.data),

  // reports
  reportShipmentsCsv: (role, entity_id) =>
    `${API_BASE}/reports/shipments.csv?role=${role}&entity_id=${entity_id}`,
  reportInventoryCsv: (role, entity_id) =>
    `${API_BASE}/reports/inventory.csv?role=${role}&entity_id=${entity_id}`,

  seed: () => api.post("/seed").then((r) => r.data),

  // Manufacturer drill-down
  manufacturerOverview: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/overview`).then((r) => r.data),
  manufacturerProductIntelligence: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/product-intelligence`).then((r) => r.data),
  manufacturerProductDetailV2: (manufacturer_id, product_id) =>
    api.get(`/manufacturer/${manufacturer_id}/product-detail/${product_id}`).then((r) => r.data),
  createPromotionDraft: (manufacturer_id, payload) =>
    api.post(`/manufacturer/${manufacturer_id}/promotions`, payload).then((r) => r.data),
  manufacturerProducts: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/products`).then((r) => r.data),
  manufacturerProductDetail: (manufacturer_id, product_id) =>
    api.get(`/manufacturer/${manufacturer_id}/product/${product_id}`).then((r) => r.data),
  manufacturerDistributorDetail: (manufacturer_id, distributor_id) =>
    api.get(`/manufacturer/${manufacturer_id}/distributor/${distributor_id}`).then((r) => r.data),
  manufacturerDistributorIntelligence: (manufacturer_id, distributor_id) =>
    api.get(`/manufacturer/${manufacturer_id}/distributor-intelligence/${distributor_id}`).then((r) => r.data),
  manufacturerDistributorNetworkIntelligence: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/distributor-network-intelligence`).then((r) => r.data),
  manufacturerShipmentCommand: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/shipment-command-center`).then((r) => r.data),
  manufacturerShipmentIntelligence: (manufacturer_id, shipment_id) =>
    api.get(`/manufacturer/${manufacturer_id}/shipment-intelligence/${shipment_id}`).then((r) => r.data),
  manufacturerDistributorOrders: (manufacturer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/distributor-orders`).then((r) => r.data),
  manufacturerOrderApprove: (manufacturer_id, order_id) =>
    api.post(`/manufacturer/${manufacturer_id}/distributor-orders/${order_id}/approve`).then((r) => r.data),
  manufacturerOrderReject: (manufacturer_id, order_id, reason) =>
    api.post(`/manufacturer/${manufacturer_id}/distributor-orders/${order_id}/reject`,
             { reason }).then((r) => r.data),
  manufacturerOrderDispatch: (manufacturer_id, order_id) =>
    api.post(`/manufacturer/${manufacturer_id}/distributor-orders/${order_id}/dispatch`).then((r) => r.data),
  manufacturerRetailerDetail: (manufacturer_id, distributor_id, retailer_id) =>
    api.get(`/manufacturer/${manufacturer_id}/distributor/${distributor_id}/retailer/${retailer_id}`).then((r) => r.data),

  // Snapshot recompute (force fresh data — same pattern as Intelligence module)
  refreshOverview: (manufacturer_id) =>
    api.post(`/manufacturer/${manufacturer_id}/overview/refresh`).then((r) => r.data),
  refreshProductIntelligence: (manufacturer_id) =>
    api.post(`/manufacturer/${manufacturer_id}/product-intelligence/refresh`).then((r) => r.data),
  refreshShipmentCommand: (manufacturer_id) =>
    api.post(`/manufacturer/${manufacturer_id}/shipment-command-center/refresh`).then((r) => r.data),
  refreshDistributorNetwork: (manufacturer_id) =>
    api.post(`/manufacturer/${manufacturer_id}/distributor-network-intelligence/refresh`).then((r) => r.data),

  // Mutations
  createProduct: (manufacturer_id, payload) =>
    api.post(`/manufacturer/${manufacturer_id}/products`, payload).then((r) => r.data),
  updateProduct: (product_id, payload) =>
    api.patch(`/products/${product_id}`, payload).then((r) => r.data),
  uploadProductImage: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post("/uploads/product-image", form, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
  productImageUrl: (relative) => {
    if (!relative) return null;
    if (/^https?:\/\//i.test(relative)) return relative;
    return `${BACKEND_URL}${relative}`;
  },
  updateDistributor: (distributor_id, payload) =>
    api.patch(`/distributors/${distributor_id}`, payload).then((r) => r.data),
  adjustInventory: (payload) =>
    api.post(`/inventory/adjust`, payload).then((r) => r.data),

  // Sales Book (retailer)
  salesSummary: (retailer_id) =>
    api.get(`/retailer/${retailer_id}/sales/summary`).then((r) => r.data),
  salesList: (retailer_id, params = {}) =>
    api.get(`/retailer/${retailer_id}/sales`, { params }).then((r) => r.data),
  salesAnalytics: (retailer_id, days = 30) =>
    api.get(`/retailer/${retailer_id}/sales/analytics`, { params: { days } }).then((r) => r.data),
  createSale: (retailer_id, payload) =>
    api.post(`/retailer/${retailer_id}/sales`, payload).then((r) => r.data),
  markSalePaid: (retailer_id, sale_id, payment_method) =>
    api.patch(`/retailer/${retailer_id}/sales/${sale_id}/mark-paid`, { payment_method }).then((r) => r.data),
  salesExportCsvUrl: (retailer_id, date_from, date_to) => {
    const qs = new URLSearchParams();
    if (date_from) qs.set("date_from", date_from);
    if (date_to) qs.set("date_to", date_to);
    return `${API_BASE}/retailer/${retailer_id}/sales/export.csv${qs.toString() ? "?" + qs : ""}`;
  },

  // Proactive Intelligence Layer
  intelFeed: (role, entity_id, limit = 20) =>
    api.get("/intel/feed", { params: { role, entity_id, limit } }).then((r) => r.data),
  intelExecSummary: (role, entity_id) =>
    api.get("/intel/exec-summary", { params: { role, entity_id } }).then((r) => r.data),
  intelExecRegen: (role, entity_id) =>
    api.post("/intel/exec-summary/regenerate", null, { params: { role, entity_id } }).then((r) => r.data),
  intelForecasts: (role, entity_id, params = {}) =>
    api.get("/intel/forecasts/stockout", { params: { role, entity_id, ...params } }).then((r) => r.data),
  intelAlerts: (role, entity_id, params = {}) =>
    api.get("/intel/alerts", { params: { role, entity_id, ...params } }).then((r) => r.data),
  intelRecommendations: (role, entity_id, params = {}) =>
    api.get("/intel/recommendations", { params: { role, entity_id, ...params } }).then((r) => r.data),
  intelAckRecommendation: (rec_id, role, entity_id, status = "acknowledged") =>
    api.patch(`/intel/recommendations/${rec_id}`, { status }, { params: { role, entity_id } }).then((r) => r.data),
  intelRetailerHealth: (role, entity_id, params = {}) =>
    api.get("/intel/retailer-health", { params: { role, entity_id, ...params } }).then((r) => r.data),
  intelDeliveryEta: (role, entity_id, params = {}) =>
    api.get("/intel/delivery-eta", { params: { role, entity_id, ...params } }).then((r) => r.data),
  intelExternal: (role, entity_id) =>
    api.get("/intel/external", { params: { role, entity_id } }).then((r) => r.data),
  intelCopilot: (role, entity_id, message, history = [], session_id) =>
    api.post("/intel/copilot", { role, entity_id, message, history, session_id }).then((r) => r.data),
};

export default api;
