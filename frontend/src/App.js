import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider, useSession } from "@/context/SessionContext";
import LandingPage from "@/components/LandingPage";
import LoginPage from "@/views/LoginPage";
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
import DistributorProductDetail from "@/views/DistributorProductDetail";
import SalesBookView from "@/views/SalesBookView";
import IntelligenceCenter from "@/views/IntelligenceCenter";
import SuperAdminConsole from "@/views/SuperAdminConsole";
import DemoAccountsPage from "@/views/DemoAccountsPage";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

function RoleDashboard() {
  const { session } = useSession();
  if (!session) return null;
  if (session.role === "super_admin") return <SuperAdminConsole />;
  if (session.role === "manufacturer") return <ManufacturerDashboard />;
  if (session.role === "distributor") return <DistributorDashboard />;
  return <RetailerDashboardV2 />;
}

function BootGate({ children }) {
  const { bootstrapping } = useSession();
  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center" data-testid="boot-gate">
        <div className="flex items-center gap-3 text-graphite">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-display text-lg">Connecting to TradeKonekt…</span>
        </div>
      </div>
    );
  }
  return children;
}

function Protected({ children }) {
  const { session, bootstrapping } = useSession();
  if (bootstrapping) return null;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function PublicHome() {
  const { session, bootstrapping } = useSession();
  if (bootstrapping) return null;
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <SessionProvider>
      <BootGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<PublicHome />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/demo" element={<DemoAccountsPage />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route path="/dashboard" element={<RoleDashboard />} />
              <Route path="/inventory" element={<InventoryView />} />
              <Route path="/shipments" element={<ShipmentTracker />} />
              <Route path="/requests" element={<RequestsView />} />
              <Route path="/network" element={<NetworkView />} />
              <Route path="/network/retailer/:retailerId" element={<DistributorRetailerDetail />} />
              <Route path="/inventory/product/:productId" element={<DistributorProductDetail />} />
              <Route path="/network-map" element={<ManufacturerNetworkView />} />
              <Route path="/analytics" element={<AnalyticsView />} />
              <Route path="/sales" element={<SalesBookView />} />
              <Route path="/intel" element={<IntelligenceCenter />} />
              <Route path="/reports" element={<ReportsView />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </BootGate>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  );
}

export default App;
