import React from 'react';

export const SkeletonRow: React.FC<{ cols?: number }> = ({ cols = 4 }) => (
  <tr>
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="shimmer h-4 rounded w-full max-w-[120px]" />
      </td>
    ))}
  </tr>
);

export const SkeletonCard: React.FC<{ height?: string }> = ({ height = 'h-24' }) => (
  <div className={`shimmer rounded-xl ${height} w-full`} />
);
