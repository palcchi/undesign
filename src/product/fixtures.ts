/* Undesign product UI — typed demo fixtures.
 *
 * Everything in this file is explicit DEMO data for the product shell
 * (dashboard, projects, sharing, workspace). It is NOT the editor document
 * model and never touches src/store.tsx. See INTEGRATION.md for the contract
 * the real backend will eventually satisfy.
 */

export interface DemoUser {
  id: string;
  name: string;
  username: string;
  bio: string;
  initials: string;
  hue: number; // avatar tint, deterministic
}

export interface DemoMember extends DemoUser {
  role: 'owner' | 'editor' | 'viewer';
  pending?: boolean;
}

export interface DemoWorkspace {
  id: string;
  name: string;
  plan: 'Free' | 'Pro' | 'Team';
  memberIds: string[];
}

export interface DemoProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  color: string; // cover accent
  favorite: boolean;
  updatedAt: string; // ISO
  folders: DemoFolder[];
}

export interface DemoFolder {
  id: string;
  name: string;
  parentId: string | null; // null = project root
}

export type ShareAudience = 'private' | 'workspace' | 'anyone';

export interface DemoFile {
  id: string;
  name: string;
  projectId: string | null; // null = drafts / unfiled
  folderId: string | null;
  ownerId: string;
  kind: 'design' | 'prototype' | 'spec';
  updatedAt: string;
  openedAt: string | null;
  favorite: boolean;
  trashed: boolean;
  sharedWithMe: boolean;
  sharedByMe: boolean;
  audience: ShareAudience;
  editors: string[]; // member ids with edit access
  viewers: string[]; // member ids with view access
  seed: number; // deterministic thumbnail
}

export interface DemoActivity {
  id: string;
  actorId: string;
  text: string;
  fileId: string | null;
  at: string;
}

export const ME: DemoUser = {
  id: 'u-me',
  name: 'Ayu Lestari',
  username: 'ayulestari',
  bio: 'Product designer. Design systems, prototyping, and too many frames.',
  initials: 'AL',
  hue: 222,
};

export const MEMBERS: DemoMember[] = [
  { ...ME, role: 'owner' },
  { id: 'u-2', name: 'Bima Pratama', username: 'bimap', bio: '', initials: 'BP', hue: 16, role: 'editor' },
  { id: 'u-3', name: 'Citra Dewi', username: 'citradewi', bio: '', initials: 'CD', hue: 150, role: 'editor' },
  { id: 'u-4', name: 'Dimas Angga', username: 'dimasangg', bio: '', initials: 'DA', hue: 265, role: 'viewer' },
  { id: 'u-5', name: 'Eka Putri', username: 'ekaputri', bio: '', initials: 'EP', hue: 330, role: 'viewer', pending: true },
];

export const WORKSPACES: DemoWorkspace[] = [
  { id: 'w-1', name: 'Nusa Studio', plan: 'Team', memberIds: ['u-me', 'u-2', 'u-3', 'u-4', 'u-5'] },
  { id: 'w-2', name: 'Side Projects', plan: 'Free', memberIds: ['u-me'] },
];

export const PROJECTS: DemoProject[] = [
  {
    id: 'p-1',
    workspaceId: 'w-1',
    name: 'Marketing Site',
    description: 'Landing pages, blog templates, and campaign assets.',
    color: '#0d99ff',
    favorite: true,
    updatedAt: '2026-10-27T09:12:00.000Z',
    folders: [
      { id: 'f-11', name: 'Landing', parentId: null },
      { id: 'f-12', name: 'Blog', parentId: null },
      { id: 'f-13', name: 'Q4 campaign', parentId: 'f-11' },
    ],
  },
  {
    id: 'p-2',
    workspaceId: 'w-1',
    name: 'Mobile App',
    description: 'Customer-facing iOS and Android flows.',
    color: '#16a34a',
    favorite: false,
    updatedAt: '2026-10-25T14:40:00.000Z',
    folders: [
      { id: 'f-21', name: 'Onboarding', parentId: null },
      { id: 'f-22', name: 'Checkout', parentId: null },
    ],
  },
  {
    id: 'p-3',
    workspaceId: 'w-1',
    name: 'Design System',
    description: 'Tokens, components, and usage guidelines.',
    color: '#f59e0b',
    favorite: true,
    updatedAt: '2026-10-20T08:05:00.000Z',
    folders: [{ id: 'f-31', name: 'Foundations', parentId: null }],
  },
  {
    id: 'p-4',
    workspaceId: 'w-2',
    name: 'Portfolio',
    description: 'Personal experiments and case studies.',
    color: '#8a8a8a',
    favorite: false,
    updatedAt: '2026-09-30T11:00:00.000Z',
    folders: [],
  },
];

export const FILES: DemoFile[] = [
  {
    id: 'd-1', name: 'Homepage — hero exploration', projectId: 'p-1', folderId: 'f-11',
    ownerId: 'u-me', kind: 'design', updatedAt: '2026-10-28T08:20:00.000Z', openedAt: '2026-10-28T08:20:00.000Z',
    favorite: true, trashed: false, sharedWithMe: false, sharedByMe: true,
    audience: 'workspace', editors: ['u-2'], viewers: ['u-4'], seed: 11,
  },
  {
    id: 'd-2', name: 'Pricing page', projectId: 'p-1', folderId: 'f-11',
    ownerId: 'u-2', kind: 'design', updatedAt: '2026-10-27T16:02:00.000Z', openedAt: '2026-10-27T16:02:00.000Z',
    favorite: false, trashed: false, sharedWithMe: true, sharedByMe: false,
    audience: 'workspace', editors: ['u-me'], viewers: [], seed: 23,
  },
  {
    id: 'd-3', name: 'Blog template', projectId: 'p-1', folderId: 'f-12',
    ownerId: 'u-me', kind: 'design', updatedAt: '2026-10-24T10:44:00.000Z', openedAt: null,
    favorite: false, trashed: false, sharedWithMe: false, sharedByMe: false,
    audience: 'private', editors: [], viewers: [], seed: 37,
  },
  {
    id: 'd-4', name: 'Launch checklist prototype', projectId: 'p-1', folderId: 'f-13',
    ownerId: 'u-3', kind: 'prototype', updatedAt: '2026-10-22T13:15:00.000Z', openedAt: '2026-10-26T09:00:00.000Z',
    favorite: true, trashed: false, sharedWithMe: true, sharedByMe: false,
    audience: 'anyone', editors: [], viewers: ['u-me'], seed: 41,
  },
  {
    id: 'd-5', name: 'Signup flow', projectId: 'p-2', folderId: 'f-21',
    ownerId: 'u-me', kind: 'prototype', updatedAt: '2026-10-26T15:31:00.000Z', openedAt: '2026-10-26T15:31:00.000Z',
    favorite: false, trashed: false, sharedWithMe: false, sharedByMe: true,
    audience: 'workspace', editors: ['u-2', 'u-3'], viewers: [], seed: 53,
  },
  {
    id: 'd-6', name: 'Checkout — payment step', projectId: 'p-2', folderId: 'f-22',
    ownerId: 'u-3', kind: 'design', updatedAt: '2026-10-21T11:11:00.000Z', openedAt: null,
    favorite: false, trashed: false, sharedWithMe: false, sharedByMe: false,
    audience: 'private', editors: [], viewers: [], seed: 67,
  },
  {
    id: 'd-7', name: 'Color tokens v2', projectId: 'p-3', folderId: 'f-31',
    ownerId: 'u-me', kind: 'spec', updatedAt: '2026-10-20T08:05:00.000Z', openedAt: '2026-10-25T08:00:00.000Z',
    favorite: true, trashed: false, sharedWithMe: false, sharedByMe: true,
    audience: 'anyone', editors: ['u-2'], viewers: ['u-3', 'u-4'], seed: 71,
  },
  {
    id: 'd-8', name: 'Button anatomy', projectId: 'p-3', folderId: 'f-31',
    ownerId: 'u-2', kind: 'spec', updatedAt: '2026-10-18T09:52:00.000Z', openedAt: null,
    favorite: false, trashed: false, sharedWithMe: true, sharedByMe: false,
    audience: 'workspace', editors: [], viewers: ['u-me'], seed: 83,
  },
  {
    id: 'd-9', name: 'Untitled exploration', projectId: null, folderId: null,
    ownerId: 'u-me', kind: 'design', updatedAt: '2026-10-28T07:02:00.000Z', openedAt: '2026-10-28T07:02:00.000Z',
    favorite: false, trashed: false, sharedWithMe: false, sharedByMe: false,
    audience: 'private', editors: [], viewers: [], seed: 97,
  },
  {
    id: 'd-10', name: 'Old onboarding draft', projectId: 'p-2', folderId: null,
    ownerId: 'u-me', kind: 'design', updatedAt: '2026-09-12T10:00:00.000Z', openedAt: null,
    favorite: false, trashed: true, sharedWithMe: false, sharedByMe: false,
    audience: 'private', editors: [], viewers: [], seed: 5,
  },
  {
    id: 'd-11', name: 'Case study — transit app', projectId: 'p-4', folderId: null,
    ownerId: 'u-me', kind: 'design', updatedAt: '2026-09-30T11:00:00.000Z', openedAt: '2026-10-02T12:00:00.000Z',
    favorite: false, trashed: false, sharedWithMe: false, sharedByMe: false,
    audience: 'private', editors: [], viewers: [], seed: 29,
  },
];

export const ACTIVITY: DemoActivity[] = [
  { id: 'a-1', actorId: 'u-2', text: 'edited Pricing page', fileId: 'd-2', at: '2026-10-27T16:02:00.000Z' },
  { id: 'a-2', actorId: 'u-me', text: 'shared Homepage — hero exploration with the workspace', fileId: 'd-1', at: '2026-10-27T10:20:00.000Z' },
  { id: 'a-3', actorId: 'u-3', text: 'commented on Signup flow', fileId: 'd-5', at: '2026-10-26T15:31:00.000Z' },
  { id: 'a-4', actorId: 'u-me', text: 'created Untitled exploration', fileId: 'd-9', at: '2026-10-28T07:02:00.000Z' },
];

export function memberById(id: string): DemoMember {
  return MEMBERS.find((m) => m.id === id) ?? { ...ME, role: 'viewer' as const };
}

export function projectById(projects: DemoProject[], id: string | null): DemoProject | null {
  if (!id) return null;
  return projects.find((p) => p.id === id) ?? null;
}

/** Deterministic pseudo-random from a seed — stable thumbnails. */
export function seeded(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
