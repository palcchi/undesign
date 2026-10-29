/* Isolated product-shell state. Seeded from demo fixtures and persisted to
 * localStorage (key below) so creates/renames/favorites survive refresh ON
 * THIS BROWSER ONLY. This is explicitly local demo persistence — not cloud
 * sync, not auth, not permission enforcement. Resettable from Settings.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ACTIVITY,
  FILES,
  ME,
  MEMBERS,
  PROJECTS,
  WORKSPACES,
} from './fixtures';
import type {
  DemoActivity,
  DemoFile,
  DemoMember,
  DemoProject,
  DemoUser,
  DemoWorkspace,
  ShareAudience,
} from './fixtures';

const STORAGE_KEY = 'undesign.product.v1';

export interface ProductState {
  me: DemoUser;
  members: DemoMember[];
  workspaces: DemoWorkspace[];
  activeWorkspaceId: string;
  projects: DemoProject[];
  files: DemoFile[];
  activity: DemoActivity[];
  density: 'comfortable' | 'compact';
  sidebarCollapsed: boolean;
}

export interface Toast {
  id: number;
  message: string;
}

interface ProductApi {
  state: ProductState;
  toasts: Toast[];
  notify: (message: string) => void;
  switchWorkspace: (id: string) => void;
  setDensity: (d: ProductState['density']) => void;
  setSidebarCollapsed: (v: boolean) => void;
  updateProfile: (patch: Partial<Pick<DemoUser, 'name' | 'username' | 'bio'>>) => string | null;
  // files
  createFile: (name: string, projectId: string | null, folderId?: string | null) => DemoFile;
  renameFile: (id: string, name: string) => void;
  duplicateFile: (id: string) => void;
  moveFile: (id: string, projectId: string | null, folderId: string | null) => void;
  trashFile: (id: string) => void;
  restoreFile: (id: string) => void;
  deleteFileForever: (id: string) => void;
  emptyTrash: () => void;
  toggleFavoriteFile: (id: string) => void;
  markOpened: (id: string) => void;
  setAudience: (id: string, audience: ShareAudience) => void;
  setFileRole: (fileId: string, memberId: string, role: 'editor' | 'viewer' | 'none') => void;
  // projects & folders
  createProject: (name: string, description: string) => DemoProject;
  renameProject: (id: string, name: string) => void;
  toggleFavoriteProject: (id: string) => void;
  deleteProject: (id: string) => void;
  createFolder: (projectId: string, name: string, parentId: string | null) => void;
  renameFolder: (projectId: string, folderId: string, name: string) => void;
  // members
  inviteMember: (email: string, role: 'editor' | 'viewer') => string | null;
  removeMember: (id: string) => void;
  resetDemo: () => void;
}

const ProductCtx = createContext<ProductApi | null>(null);

function seed(): ProductState {
  return {
    me: { ...ME },
    members: MEMBERS.map((m) => ({ ...m })),
    workspaces: WORKSPACES.map((w) => ({ ...w, memberIds: [...w.memberIds] })),
    activeWorkspaceId: 'w-1',
    projects: PROJECTS.map((p) => ({ ...p, folders: p.folders.map((f) => ({ ...f })) })),
    files: FILES.map((f) => ({ ...f, editors: [...f.editors], viewers: [...f.viewers] })),
    activity: ACTIVITY.map((a) => ({ ...a })),
    density: 'comfortable',
    sidebarCollapsed: false,
  };
}

function load(): ProductState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as Partial<ProductState>;
    if (!Array.isArray(parsed.files) || !Array.isArray(parsed.projects)) return seed();
    return { ...seed(), ...parsed };
  } catch {
    return seed();
  }
}

let toastSeq = 1;
let idSeq = 100;

function nid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-local-${Date.now().toString(36)}-${idSeq}`;
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductState>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode — session-only state */
    }
  }, [state]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const notify = useCallback((message: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-2), { id, message }]);
    const timer = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3200);
    timers.current.push(timer);
  }, []);

  const patch = useCallback((fn: (s: ProductState) => ProductState) => setState((s) => fn(s)), []);

  const api = useMemo<ProductApi>(() => {
    const now = () => new Date().toISOString();
    return {
      state,
      toasts,
      notify,
      switchWorkspace: (id) => patch((s) => ({ ...s, activeWorkspaceId: id })),
      setDensity: (density) => patch((s) => ({ ...s, density })),
      setSidebarCollapsed: (sidebarCollapsed) => patch((s) => ({ ...s, sidebarCollapsed })),
      updateProfile: (values) => {
        const name = (values.name ?? '').trim();
        const username = (values.username ?? '').trim();
        if (values.name !== undefined && name.length < 2) return 'Name needs at least 2 characters.';
        if (values.username !== undefined && !/^[a-z0-9][a-z0-9._-]{1,29}$/i.test(username))
          return 'Username must be 2–30 letters, numbers, or . _ -';
        if (values.bio !== undefined && values.bio.length > 200) return 'Bio must be under 200 characters.';
        patch((s) => ({ ...s, me: { ...s.me, ...values, name: name || s.me.name, username: username || s.me.username } }));
        return null;
      },

      createFile: (name, projectId, folderId = null) => {
        const file: DemoFile = {
          id: nid('d'),
          name: name.trim() || 'Untitled file',
          projectId,
          folderId,
          ownerId: 'u-me',
          kind: 'design',
          updatedAt: now(),
          openedAt: now(),
          favorite: false,
          trashed: false,
          sharedWithMe: false,
          sharedByMe: false,
          audience: 'private',
          editors: [],
          viewers: [],
          seed: Math.floor(Math.random() * 1000),
        };
        patch((s) => ({ ...s, files: [file, ...s.files] }));
        return file;
      },
      renameFile: (id, name) => {
        const clean = name.trim();
        if (!clean) return;
        patch((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === id ? { ...f, name: clean, updatedAt: now() } : f)),
        }));
      },
      duplicateFile: (id) => {
        patch((s) => {
          const src = s.files.find((f) => f.id === id);
          if (!src) return s;
          const copy: DemoFile = {
            ...src,
            id: nid('d'),
            name: `${src.name} (copy)`,
            updatedAt: now(),
            openedAt: null,
            favorite: false,
            trashed: false,
            editors: [...src.editors],
            viewers: [...src.viewers],
          };
          return { ...s, files: [copy, ...s.files] };
        });
      },
      moveFile: (id, projectId, folderId) =>
        patch((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === id ? { ...f, projectId, folderId, updatedAt: now() } : f)),
        })),
      trashFile: (id) =>
        patch((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? { ...f, trashed: true } : f)) })),
      restoreFile: (id) =>
        patch((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? { ...f, trashed: false } : f)) })),
      deleteFileForever: (id) => patch((s) => ({ ...s, files: s.files.filter((f) => f.id !== id) })),
      emptyTrash: () => patch((s) => ({ ...s, files: s.files.filter((f) => !f.trashed) })),
      toggleFavoriteFile: (id) =>
        patch((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? { ...f, favorite: !f.favorite } : f)) })),
      markOpened: (id) =>
        patch((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === id ? { ...f, openedAt: now() } : f)),
        })),
      setAudience: (id, audience) =>
        patch((s) => ({
          ...s,
          files: s.files.map((f) =>
            f.id === id ? { ...f, audience, sharedByMe: audience !== 'private' ? true : f.sharedByMe } : f,
          ),
        })),
      setFileRole: (fileId, memberId, role) =>
        patch((s) => ({
          ...s,
          files: s.files.map((f) => {
            if (f.id !== fileId) return f;
            const editors = f.editors.filter((m) => m !== memberId);
            const viewers = f.viewers.filter((m) => m !== memberId);
            if (role === 'editor') editors.push(memberId);
            if (role === 'viewer') viewers.push(memberId);
            return { ...f, editors, viewers, sharedByMe: true };
          }),
        })),

      createProject: (name, description) => {
        const project: DemoProject = {
          id: nid('p'),
          workspaceId: state.activeWorkspaceId,
          name: name.trim() || 'Untitled project',
          description: description.trim(),
          color: '#111111',
          favorite: false,
          updatedAt: now(),
          folders: [],
        };
        patch((s) => ({ ...s, projects: [project, ...s.projects] }));
        return project;
      },
      renameProject: (id, name) => {
        const clean = name.trim();
        if (!clean) return;
        patch((s) => ({
          ...s,
          projects: s.projects.map((p) => (p.id === id ? { ...p, name: clean, updatedAt: now() } : p)),
        }));
      },
      toggleFavoriteProject: (id) =>
        patch((s) => ({
          ...s,
          projects: s.projects.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
        })),
      deleteProject: (id) =>
        patch((s) => ({
          ...s,
          projects: s.projects.filter((p) => p.id !== id),
          files: s.files.map((f) => (f.projectId === id ? { ...f, projectId: null, folderId: null } : f)),
        })),
      createFolder: (projectId, name, parentId) => {
        const clean = name.trim();
        if (!clean) return;
        patch((s) => ({
          ...s,
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, folders: [...p.folders, { id: nid('f'), name: clean, parentId }] } : p,
          ),
        }));
      },
      renameFolder: (projectId, folderId, name) => {
        const clean = name.trim();
        if (!clean) return;
        patch((s) => ({
          ...s,
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, folders: p.folders.map((f) => (f.id === folderId ? { ...f, name: clean } : f)) }
              : p,
          ),
        }));
      },

      inviteMember: (email, role) => {
        const clean = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'Enter a valid email address.';
        const name = clean.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const member: DemoMember = {
          id: nid('u'),
          name,
          username: clean.split('@')[0].toLowerCase(),
          bio: '',
          initials: name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?',
          hue: Math.floor(Math.random() * 360),
          role,
          pending: true,
        };
        patch((s) => ({
          ...s,
          members: [...s.members, member],
          workspaces: s.workspaces.map((w) =>
            w.id === s.activeWorkspaceId ? { ...w, memberIds: [...w.memberIds, member.id] } : w,
          ),
        }));
        return null;
      },
      removeMember: (id) =>
        patch((s) => ({
          ...s,
          members: s.members.filter((m) => m.id !== id),
          workspaces: s.workspaces.map((w) => ({ ...w, memberIds: w.memberIds.filter((m) => m !== id) })),
        })),
      resetDemo: () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* noop */
        }
        setState(seed());
      },
    };
  }, [state, notify, patch]);

  return <ProductCtx.Provider value={api}>{children}</ProductCtx.Provider>;
}

export function useProduct(): ProductApi {
  const api = useContext(ProductCtx);
  if (!api) throw new Error('useProduct must be used inside ProductProvider');
  return api;
}

export function activeWorkspace(state: ProductState): DemoWorkspace {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? state.workspaces[0];
}
