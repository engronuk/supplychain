import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API_BASE });

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
};

export default api;
