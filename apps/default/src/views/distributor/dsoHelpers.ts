export const DSO_STATUS: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  'dso-pending':   { label: 'Pending',    color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200',  dot: 'bg-amber-500'  },
  'dso-approved':  { label: 'Approved',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   dot: 'bg-blue-500'   },
  'dso-intransit': { label: 'In Transit', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500' },
  'dso-received':  { label: 'Received',   color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  dot: 'bg-green-500'  },
  'dso-rejected':  { label: 'Rejected',   color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    dot: 'bg-red-500'    },
};
export const dsoStyle = (s: string) => DSO_STATUS[s] ?? DSO_STATUS['dso-pending'];

export const PRI_COLOR: Record<string, string> = {
  'dso-pri-high':   'border-l-red-500',
  'dso-pri-medium': 'border-l-amber-400',
  'dso-pri-low':    'border-l-green-400',
};

export const PRODUCTS = [
  { sku: 'BBM-MARG',  name: 'Blue Band Margarine' },
  { sku: 'LYT-TEA',   name: 'Lipton Yellow Label Tea' },
  { sku: 'RBC-CUBES', name: 'Royco Bouillon Cubes' },
  { sku: 'KBC-CUBES', name: 'Knorr Bouillon Cubes' },
  { sku: 'OMO-DET',   name: 'OMO Multi-Active Detergent' },
  { sku: 'SWP-WASH',  name: 'Sunlight Washing Powder' },
  { sku: 'SDL-DISH',  name: 'Sunlight Dishwashing Liquid' },
  { sku: 'CUT-TOOTH', name: 'Close-Up Toothpaste' },
  { sku: 'PPT-TOOTH', name: 'Pepsodent Toothpaste' },
  { sku: 'LUX-SOAP',  name: 'LUX Beauty Soap' },
  { sku: 'LFS-SOAP',  name: 'Lifebuoy Soap' },
  { sku: 'RXN-DEO',   name: 'Rexona Deodorant' },
  { sku: 'PRS-BABY',  name: 'Pears Baby Products' },
  { sku: 'VSL-LOT',   name: 'Vaseline Lotion & Jelly' },
  { sku: 'AXE-BODY',  name: 'Axe Body Spray' },
];

export const healthDot   = (h: string) => h === 'rhlth-healthy' ? 'bg-green-500' : h === 'rhlth-low' ? 'bg-amber-500' : 'bg-red-500';
export const healthLabel = (h: string) => h === 'rhlth-healthy' ? 'Healthy' : h === 'rhlth-low' ? 'Low' : 'Critical';
