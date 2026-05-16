/**
 * HierarchyContext
 * ─────────────────────────────────────────────────────────────
 * Stores the session identity of the logged-in user.
 * Controls what data each tier can see:
 *
 *   Manufacturer  → sees ALL distributors where @parentMfg === mfgId
 *                   + ALL retailers where @parentDist is owned by those distributors
 *
 *   Distributor   → sees ONLY retailers where @parentDist === distId
 *
 *   Retailer      → sees ONLY their own inventory rows where @ri_ret === retailerId
 *
 * Identity is set on login and cleared on logout.
 * ─────────────────────────────────────────────────────────────
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { UserRole } from '@/lib/theme';

export interface ManufacturerIdentity {
  role: 'manufacturer';
  /** e.g. "MFG-UNILEVER" – used to filter distributors by @parentMfg */
  mfgId: string;
  displayName: string;
}

export interface DistributorIdentity {
  role: 'distributor';
  /** e.g. "DIST-LAG-001" – used to filter retailers by @parentDist */
  distId: string;
  displayName: string;
}

export interface RetailerIdentity {
  role: 'retailer';
  /** e.g. "RET-001" – used to filter inventory by @ri_ret */
  retailerId: string;
  /** The parent distributor ID, auto-set on creation */
  parentDistId: string;
  displayName: string;
}

export type SessionIdentity = ManufacturerIdentity | DistributorIdentity | RetailerIdentity;

interface HierarchyCtx {
  identity: SessionIdentity | null;
  setIdentity: (id: SessionIdentity | null) => void;
  /** Convenience: returns IDs that the current session is allowed to see */
  ownedDistributorIds: string[];
  setOwnedDistributorIds: (ids: string[]) => void;
}

const HierarchyContext = createContext<HierarchyCtx>({
  identity: null,
  setIdentity: () => {},
  ownedDistributorIds: [],
  setOwnedDistributorIds: () => {},
});

export const HierarchyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  // Manufacturer-only: list of distributor IDs they own (resolved after login)
  const [ownedDistributorIds, setOwnedDistributorIds] = useState<string[]>([]);

  return (
    <HierarchyContext.Provider value={{ identity, setIdentity, ownedDistributorIds, setOwnedDistributorIds }}>
      {children}
    </HierarchyContext.Provider>
  );
};

export const useHierarchy = () => useContext(HierarchyContext);

/**
 * Default demo identities – one per role.
 * In a real auth system these come from your OIDC provider.
 */
export const DEFAULT_IDENTITIES: Record<UserRole, SessionIdentity> = {
  manufacturer: {
    role: 'manufacturer',
    mfgId: 'MFG-UNILEVER',
    displayName: 'Unilever Nigeria PLC',
  },
  distributor: {
    role: 'distributor',
    distId: 'DIST-LAG-001',
    displayName: 'SUARA & CO. — Funtime Retail Shop, Ikeja',
  },
  retailer: {
    role: 'retailer',
    retailerId: 'RET-LAG-001',
    parentDistId: 'DIST-LAG-001',
    displayName: 'Funtime Retail Shop, Ikeja',
  },
};
