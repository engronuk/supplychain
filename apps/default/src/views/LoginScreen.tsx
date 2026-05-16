import React, { useState } from 'react';
import type { UserRole } from '@/lib/theme';

interface Props {
  onRoleSelect: (role: UserRole) => void;
}

const ROLES: { id: UserRole; label: string; description: string; icon: string; accent: string }[] = [
  {
    id: 'manufacturer',
    label: 'Manufacturer',
    description: 'Unilever Nigeria PLC — full downstream visibility across all 68 distributors and retailers nationwide.',
    icon: '🏭',
    accent: '#39ff14',
  },
  {
    id: 'distributor',
    label: 'Distributor',
    description: 'SUARA & CO. (Ikeja, Lagos) — manage Funtime Retail Shop, fulfil restock requests, track inventory.',
    icon: '🚛',
    accent: '#1e90ff',
  },
  {
    id: 'retailer',
    label: 'Retailer',
    description: 'Funtime Retail Shop, Ikeja — view your 15 Unilever product stock levels and submit restock requests.',
    icon: '🛒',
    accent: '#8b7d6b',
  },
];

export const LoginScreen: React.FC<Props> = ({ onRoleSelect }) => {
  const [hoveredRole, setHoveredRole] = useState<UserRole | null>(null);
  const [selecting, setSelecting] = useState<UserRole | null>(null);

  const handleSelect = (role: UserRole) => {
    setSelecting(role);
    setTimeout(() => onRoleSelect(role), 300);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#050d1a' }}>
      {/* Background grid */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(#1e90ff 1px, transparent 1px), linear-gradient(90deg, #1e90ff 1px, transparent 1px)',
        backgroundSize: '60px 60px'
      }} />

      <div className="relative z-10 w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#39ff14', boxShadow: '0 0 20px #39ff1440' }}>
              <span className="text-black font-black text-xs">UL</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Unilever Supply OS</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Select your portal</h1>
          <p className="text-gray-500 text-sm">Choose your role to enter your dashboard</p>
        </div>

        <div className="space-y-3">
          {ROLES.map(role => (
            <button
              key={role.id}
              onClick={() => handleSelect(role.id)}
              onMouseEnter={() => setHoveredRole(role.id)}
              onMouseLeave={() => setHoveredRole(null)}
              className="w-full text-left rounded-2xl p-5 transition-all duration-200 group"
              style={{
                background: selecting === role.id ? `${role.accent}20` : hoveredRole === role.id ? '#0a1829' : '#06101f',
                border: `1px solid ${hoveredRole === role.id || selecting === role.id ? role.accent + '50' : '#1a2a3a'}`,
                transform: selecting === role.id ? 'scale(0.98)' : 'scale(1)',
              }}
            >
              <div className="flex items-center gap-4">
                <div className="text-3xl flex-shrink-0">{role.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-base">{role.label}</span>
                    {selecting === role.id && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: role.accent + '20', color: role.accent }}>
                        Entering…
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm leading-relaxed">{role.description}</p>
                </div>
                <div className="flex-shrink-0 transition-transform duration-200 group-hover:translate-x-1" style={{ color: role.accent }}>
                  →
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
