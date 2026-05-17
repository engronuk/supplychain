import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider, useSession } from "@/context/SessionContext";
import LandingPage from "@/components/LandingPage";
import Layout from "@/components/Layout";
import ManufacturerDashboard from "@/views/ManufacturerDashboard";
import DistributorDashboard from "@/views/DistributorDashboard";
import RetailerDashboardV2 from "@/views/RetailerDashboardV2";
import InventoryView from "@/views/InventoryView";
import ShipmentTracker from "@/views/ShipmentTracker";
import RequestsView from "@/views/RequestsView";
import AnalyticsView from "@/views/AnalyticsView";
import ReportsView from "@/views/ReportsView";
import NetworkView from "@/views/NetworkView";
import ManufacturerNetworkView from "@/views/ManufacturerNetworkView";
import DistributorRetailerDetail from "@/views/DistributorRetailerDetail";
import { Toaster } from "@/components/ui/sonner";

function RoleDashboard() {
  const { session } = useSession();
  if (session.role === "manufacturer") return <ManufacturerDashboard />;
  if (session.role === "distributor") return <DistributorDashboard />;
  return <RetailerDashboardV2 />;
}

function Protected({ children }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/" replace />;
  return children;
}

function PublicHome() {
  const { session } = useSession();
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path="/dashboard" element={<RoleDashboard />} />
            <Route path="/inventory" element={<InventoryView />} />
            <Route path="/shipments" element={<ShipmentTracker />} />
            <Route path="/requests" element={<RequestsView />} />
            <Route path="/network" element={<NetworkView />} />
            <Route path="/network/retailer/:retailerId" element={<DistributorRetailerDetail />} />
            <Route path="/network-map" element={<ManufacturerNetworkView />} />
            <Route path="/analytics" element={<AnalyticsView />} />
            <Route path="/reports" element={<ReportsView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  );
}

export default App;
