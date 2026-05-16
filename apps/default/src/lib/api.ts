import axios from 'axios';

const BASE = '/api/taskade';

export const PROJECTS = {
  inventory: 'GpKLNkH97bDnXk6f',
  analytics: 'rWjJsnZp5vHJdZnV',
  requests: 'sn1NQp1AmNivsa9e',
  retailers: 'ZJSXAhrdGkSm626R',
  distributors: 'Cfoe9dpyX5vx4Vxq',
  products: '1QiDGeN43RJRrXfj',
  distOrders:     'isCBt1eVVyUh1iHv',  // Distributor → Manufacturer stock orders
  distInventory:  'dr1PtWyzsRD59QT1',  // Distributor own warehouse inventory
} as const;

export const AGENT_ID = '01KRQWJ4C4G86NAF13RJ2MH629';

export interface Node {
  id: string;
  parentId: string | null;
  fieldValues: Record<string, unknown>;
}

export async function getNodes(projectId: string): Promise<Node[]> {
  const res = await axios.get(`${BASE}/projects/${projectId}/nodes`);
  return res.data?.payload?.nodes ?? [];
}

export async function createNode(projectId: string, body: Record<string, unknown>) {
  const res = await axios.post(`${BASE}/projects/${projectId}/nodes`, body);
  return res.data;
}

export async function updateNode(projectId: string, nodeId: string, body: Record<string, unknown>) {
  const res = await axios.patch(`${BASE}/projects/${projectId}/nodes/${nodeId}`, body);
  return res.data;
}

export function field(node: Node, key: string): unknown {
  return node.fieldValues?.[`/attributes/${key}`] ?? node.fieldValues?.[key];
}

export function text(node: Node): string {
  return (node.fieldValues?.['/text'] as string) ?? '';
}
