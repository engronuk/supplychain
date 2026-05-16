import React, { useState, useEffect } from 'react';
import { LoginScreen } from '@/views/LoginScreen';
import { ManufacturerDashboard } from '@/views/manufacturer/ManufacturerDashboard';
import { DistributorDashboard } from '@/views/distributor/DistributorDashboard';
import { RetailerApp } from '@/views/retailer/RetailerApp';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { UserRole, ThemeMode } from '@/lib/theme';
import { getStoredTheme } from '@/lib/theme';
import { HierarchyProvider, useHierarchy, DEFAULT_IDENTITIES } from '@/lib/hierarchy';
import { getNodes, PROJECTS, field } from '@/lib/api';

function AppShell() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const { setIdentity, setOwnedDistributorIds } = useHierarchy();

  const handleRoleSelect = async (r: UserRole) => {
    const t = getStoredTheme(r);
    setTheme(t);

    // Set the session identity for this role
    const identity = DEFAULT_IDENTITIES[r];
    setIdentity(identity);

    // For manufacturer: pre-resolve which distributor IDs they own
    if (r === 'manufacturer' && identity.role === 'manufacturer') {
      const mfgId = identity.mfgId;
      const dists = await getNodes(PROJECTS.distributors);
      const owned = dists
        .filter(n => n.parentId === null && field(n, '@parentMfg') === mfgId)
        .map(n => field(n, '@did01') as string)
        .filter(Boolean);
      setOwnedDistributorIds(owned);
    }

    setRole(r);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'wabi');
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'wabi') root.classList.add('wabi');
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'wabi');
  }, []);

  if (!role) {
    return <LoginScreen onRoleSelect={handleRoleSelect} />;
  }

  return (
    <div className="relative min-h-screen overflow-auto">
      <div className="absolute top-3 right-4 z-50">
        <ThemeToggle role={role} theme={theme} onThemeChange={setTheme} />
      </div>
      {role === 'manufacturer' && <ManufacturerDashboard />}
      {role === 'distributor' && <DistributorDashboard />}
      {role === 'retailer' && <RetailerApp />}
    </div>
  );
}

const App: React.FC = function () {
  return (
    <HierarchyProvider>
      <AppShell />
    </HierarchyProvider>
  );
};

export default App;
