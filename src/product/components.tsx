/* Shared product-shell UI: sidebar, topbar, file grid/list, avatars, dialogs. */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  Home,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { Modal, ContextMenu, useContextMenu } from '../components/ui';
import type { CtxItem } from '../components/ui';
import { link, navigate } from './router';
import type { Route } from './router';
import { memberById, seeded, timeAgo } from './fixtures';
import type { DemoFile, DemoProject, DemoUser } from './fixtures';
import { activeWorkspace, useProduct } from './store';

/* ---------- avatars ---------- */

export function Avatar({ user, size = 28 }: { user: DemoUser; size?: number }) {
  return (
    <span
      className="p-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: `hsl(${user.hue} 22% 92%)`,
        color: `hsl(${user.hue} 32% 32%)`,
        borderColor: `hsl(${user.hue} 25% 78%)`,
      }}
      aria-hidden="true"
    >
      {user.initials}
    </span>
  );
}

export function AvatarStack({ ids, max = 4 }: { ids: string[]; max?: number }) {
  const show = ids.slice(0, max);
  const extra = ids.length - show.length;
  return (
    <span className="p-avatar-stack">
      {show.map((id) => (
        <Avatar key={id} user={memberById(id)} size={22} />
      ))}
      {extra > 0 && <span className="p-avatar-more">+{extra}</span>}
    </span>
  );
}

/* ---------- generative file thumbnail (pure SVG, deterministic) ---------- */

export function FileThumb({ file, large = false }: { file: DemoFile; large?: boolean }) {
  const r = (i: number) => seeded(file.seed * 7 + i);
  const bars = [0, 1, 2].map((i) => ({
    x: 14 + r(i) * 44,
    y: 12 + i * 16,
    w: 22 + r(i + 9) * 40,
    dark: r(i + 20) > 0.55,
  }));
  const circle = { cx: 96 + r(5) * 40, cy: 30 + r(6) * 40, r: 12 + r(7) * 10 };
  return (
    <svg
      className={`p-thumb${large ? ' large' : ''}`}
      viewBox="0 0 160 100"
      role="img"
      aria-label={`Preview of ${file.name}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="160" height="100" fill={r(30) > 0.5 ? '#f5f5f4' : '#ececea'} />
      <rect x="10" y="10" width="140" height="80" rx="4" fill="#ffffff" stroke="#e2e2e2" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height="7" rx="3.5" fill={b.dark ? '#3a3a3a' : '#d4d4d4'} />
      ))}
      <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill={r(31) > 0.6 ? '#0d99ff' : '#ececea'} />
      <rect x="14" y={66} width={30 + r(8) * 30} height="12" rx="6" fill="#111111" />
    </svg>
  );
}

/* ---------- app shell ---------- */

const NAV: { label: string; icon: ReactNode; route: Route; match: string[] }[] = [
  { label: 'Home', icon: <Home size={16} />, route: { name: 'dashboard' }, match: ['dashboard'] },
  { label: 'Recents', icon: <Clock size={16} />, route: { name: 'recents' }, match: ['recents'] },
  { label: 'Shared', icon: <Users size={16} />, route: { name: 'shared' }, match: ['shared'] },
  { label: 'Projects', icon: <FolderOpen size={16} />, route: { name: 'projects' }, match: ['projects', 'project'] },
  { label: 'Favorites', icon: <Star size={16} />, route: { name: 'favorites' }, match: ['favorites'] },
  { label: 'Trash', icon: <Trash2 size={16} />, route: { name: 'trash' }, match: ['trash'] },
];

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { state, switchWorkspace, setSidebarCollapsed } = useProduct();
  const ws = activeWorkspace(state);
  const [wsOpen, setWsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [wsOpen]);

  const projects = state.projects.filter((p) => p.workspaceId === ws.id).slice(0, 6);
  const collapsed = state.sidebarCollapsed;

  return (
    <div className={`p-app${collapsed ? ' nav-collapsed' : ''}`} data-density={state.density}>
      <a className="skip-link" href="#p-main">
        Skip to content
      </a>
      <aside className="p-nav" aria-label="Product navigation">
        <div className="p-nav-head">
          <div className="p-brand" aria-label="Undesign home">
            <span className="p-brand-mark" aria-hidden="true">
              U
            </span>
            {!collapsed && <span className="p-brand-name">Undesign</span>}
          </div>
          <button
            className="icon-btn"
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft size={16} />
          </button>
        </div>

        <div className="p-ws" ref={wsRef}>
          <button
            className="p-ws-btn"
            onClick={() => setWsOpen(!wsOpen)}
            aria-haspopup="menu"
            aria-expanded={wsOpen}
            title={collapsed ? ws.name : undefined}
          >
            <span className="p-ws-mark" aria-hidden="true">
              {ws.name.slice(0, 1)}
            </span>
            {!collapsed && (
              <>
                <span className="p-ws-name">{ws.name}</span>
                <ChevronDown size={14} />
              </>
            )}
          </button>
          {wsOpen && (
            <div className="p-ws-drop" role="menu" aria-label="Switch workspace">
              {state.workspaces.map((w) => (
                <button
                  key={w.id}
                  role="menuitemradio"
                  aria-checked={w.id === ws.id}
                  className="p-ws-item"
                  onClick={() => {
                    switchWorkspace(w.id);
                    setWsOpen(false);
                  }}
                >
                  <span className="p-ws-mark" aria-hidden="true">
                    {w.name.slice(0, 1)}
                  </span>
                  <span className="p-ws-item-text">
                    <span className="p-ws-item-name">{w.name}</span>
                    <span className="p-ws-item-plan">{w.plan} plan · demo data</span>
                  </span>
                  {w.id === ws.id && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="p-nav-list" aria-label="Sections">
          {NAV.map((n) => {
            const active = n.match.includes(route.name) || (route.name === 'editor' && n.match.includes('recents'));
            return (
              <a
                key={n.label}
                href={link(n.route)}
                className={`p-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? n.label : undefined}
              >
                {n.icon}
                {!collapsed && <span>{n.label}</span>}
              </a>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="p-nav-projects">
            <div className="p-nav-section-head">
              <span>Projects</span>
              <a href={link({ name: 'projects' })} className="mini-btn" aria-label="All projects">
                <ChevronRight size={13} />
              </a>
            </div>
            {projects.length === 0 && <p className="dim small">No projects yet.</p>}
            {projects.map((p) => (
              <a
                key={p.id}
                href={link({ name: 'project', projectId: p.id, folderId: null })}
                className="p-nav-item small"
                aria-current={route.name === 'project' && route.projectId === p.id ? 'page' : undefined}
              >
                <span className="p-dot" style={{ background: p.color }} aria-hidden="true" />
                <span className="p-ellipsis">{p.name}</span>
              </a>
            ))}
          </div>
        )}

        <div className="p-nav-foot">
          <a
            href={link({ name: 'workspace' })}
            className={`p-nav-item${route.name === 'workspace' ? ' active' : ''}`}
            aria-current={route.name === 'workspace' ? 'page' : undefined}
            title={collapsed ? 'Team' : undefined}
          >
            <Users size={16} />
            {!collapsed && <span>Team</span>}
          </a>
          <a
            href={link({ name: 'settings' })}
            className={`p-nav-item${route.name === 'settings' ? ' active' : ''}`}
            aria-current={route.name === 'settings' ? 'page' : undefined}
            title={collapsed ? 'Settings' : undefined}
          >
            <Settings size={16} />
            {!collapsed && <span>Settings</span>}
          </a>
        </div>
      </aside>

      <div className="p-main-col">
        <header className="p-topbar">
          <form
            className="p-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) navigate({ name: 'search', query: query.trim() });
            }}
          >
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files and projects…"
              aria-label="Search files and projects"
            />
            {query && (
              <button type="submit" className="mini-btn" aria-label="Search">
                <ChevronRight size={13} />
              </button>
            )}
          </form>
          <div className="p-topbar-actions">
            <span className="p-demo-pill" title="Product pages run on local demo data in this milestone">
              Demo data
            </span>
            <button className="icon-btn" aria-label="Notifications (3 unread)" data-tip="Notifications">
              <Bell size={16} />
              <span className="p-dot-badge" aria-hidden="true" />
            </button>
            <a
              href={link({ name: 'profile' })}
              className="p-profile-btn"
              aria-label={`Profile: ${state.me.name}`}
              title={state.me.name}
            >
              <Avatar user={state.me} size={30} />
            </a>
          </div>
        </header>
        <main className="p-main" id="p-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

/* ---------- page chrome ---------- */

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="p-page-head">
      <div>
        <h1 className="p-title">{title}</h1>
        {sub && <p className="p-sub">{sub}</p>}
      </div>
      {actions && <div className="p-head-actions">{actions}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; route?: Route }[] }) {
  return (
    <nav className="p-crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="p-crumb">
          {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
          {it.route ? (
            <a href={link(it.route)}>{it.label}</a>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="p-empty">
      <span className="p-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} width={380}>
      <p className="dialog-text">{message}</p>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="p-field">
      <span className="p-field-label">{label}</span>
      {children}
      {error && (
        <span className="p-field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

/* ---------- file grid / list ---------- */

export type ViewMode = 'grid' | 'list';
export type SortKey = 'updated' | 'name' | 'kind';

export function sortFiles(files: DemoFile[], sort: SortKey): DemoFile[] {
  const arr = [...files];
  if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'kind') arr.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  else arr.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return arr;
}

export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Layout">
      <button
        className={`seg-btn${view === 'grid' ? ' active' : ''}`}
        onClick={() => onChange('grid')}
        aria-label="Grid view"
        aria-pressed={view === 'grid'}
      >
        <LayoutGrid size={14} />
      </button>
      <button
        className={`seg-btn${view === 'list' ? ' active' : ''}`}
        onClick={() => onChange('list')}
        aria-label="List view"
        aria-pressed={view === 'list'}
      >
        <List size={14} />
      </button>
    </div>
  );
}

export function SortSelect({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <label className="p-sort">
      <span>Sort</span>
      <select
        className="text-input"
        value={sort}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="Sort files"
      >
        <option value="updated">Last modified</option>
        <option value="name">Name</option>
        <option value="kind">Type</option>
      </select>
    </label>
  );
}

function audienceIcon(a: DemoFile['audience']) {
  if (a === 'anyone') return <Globe size={12} aria-label="Anyone with the link" />;
  if (a === 'workspace') return <Users size={12} aria-label="Workspace" />;
  return <Lock size={12} aria-label="Private" />;
}

export function FileCard({
  file,
  project,
  onRename,
  onShare,
  onDetails,
  onMove,
}: {
  file: DemoFile;
  project: DemoProject | null;
  onRename: () => void;
  onShare: () => void;
  onDetails: () => void;
  onMove: () => void;
}) {
  const { toggleFavoriteFile, duplicateFile, trashFile, restoreFile, markOpened, notify } = useProduct();
  const { menu, open, close } = useContextMenu();
  const owner = memberById(file.ownerId);

  const items: CtxItem[] = file.trashed
    ? [
        { label: 'Restore', onSelect: () => { restoreFile(file.id); notify(`Restored “${file.name}”.`); } },
        { label: 'Delete forever', danger: true, onSelect: () => onDetails() },
      ]
    : [
        { label: 'Open', onSelect: () => openFile() },
        { label: 'Share…', onSelect: onShare },
        { label: file.favorite ? 'Remove favorite' : 'Add to favorites', onSelect: () => toggleFavoriteFile(file.id) },
        { divider: true },
        { label: 'Rename', onSelect: onRename },
        { label: 'Duplicate', onSelect: () => { duplicateFile(file.id); notify(`Duplicated “${file.name}”.`); } },
        { label: 'Move…', onSelect: onMove },
        { label: 'Details', onSelect: onDetails },
        { divider: true },
        { label: 'Move to trash', danger: true, onSelect: () => { trashFile(file.id); notify(`Moved “${file.name}” to trash.`); } },
      ];

  const openFile = () => {
    markOpened(file.id);
    navigate({ name: 'editor', fileId: file.id });
  };

  return (
    <div
      className="p-file-card"
      onContextMenu={(e) => {
        e.preventDefault();
        open(e.clientX, e.clientY, items);
      }}
    >
      <a
        href={link({ name: 'editor', fileId: file.id })}
        className="p-file-thumb"
        onClick={() => markOpened(file.id)}
        aria-label={`Open ${file.name} in the editor`}
      >
        <FileThumb file={file} />
      </a>
      <div className="p-file-meta">
        <div className="p-file-top">
          <a
            href={link({ name: 'editor', fileId: file.id })}
            className="p-file-name"
            onClick={() => markOpened(file.id)}
          >
            {file.name}
          </a>
          <button
            className="mini-btn"
            aria-label={`More actions for ${file.name}`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              open(r.left, r.bottom + 4, items);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        <div className="p-file-sub">
          <span className="p-file-kind">{file.kind}</span>
          <span aria-hidden="true">·</span>
          <span>{project ? project.name : 'Drafts'}</span>
          <span aria-hidden="true">·</span>
          <span>{timeAgo(file.updatedAt)}</span>
        </div>
        <div className="p-file-foot">
          <span className="p-file-owner" title={`Owned by ${owner.name}`}>
            <Avatar user={owner} size={18} />
            <span className="p-ellipsis">{owner.name}</span>
          </span>
          <span className="p-file-flags">
            {audienceIcon(file.audience)}
            {file.favorite && <Star size={12} aria-label="Favorited" className="p-star" />}
          </span>
        </div>
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

export function FileRow({
  file,
  project,
  onRename,
  onShare,
  onDetails,
  onMove,
}: {
  file: DemoFile;
  project: DemoProject | null;
  onRename: () => void;
  onShare: () => void;
  onDetails: () => void;
  onMove: () => void;
}) {
  const { toggleFavoriteFile, duplicateFile, trashFile, restoreFile, markOpened, notify } = useProduct();
  const { menu, open, close } = useContextMenu();
  const owner = memberById(file.ownerId);
  const items: CtxItem[] = file.trashed
    ? [
        { label: 'Restore', onSelect: () => { restoreFile(file.id); notify(`Restored “${file.name}”.`); } },
        { label: 'Delete forever', danger: true, onSelect: () => onDetails() },
      ]
    : [
        { label: 'Open', onSelect: () => { markOpened(file.id); navigate({ name: 'editor', fileId: file.id }); } },
        { label: 'Share…', onSelect: onShare },
        { label: file.favorite ? 'Remove favorite' : 'Add to favorites', onSelect: () => toggleFavoriteFile(file.id) },
        { divider: true },
        { label: 'Rename', onSelect: onRename },
        { label: 'Duplicate', onSelect: () => { duplicateFile(file.id); notify(`Duplicated “${file.name}”.`); } },
        { label: 'Move…', onSelect: onMove },
        { label: 'Details', onSelect: onDetails },
        { divider: true },
        { label: 'Move to trash', danger: true, onSelect: () => { trashFile(file.id); notify(`Moved “${file.name}” to trash.`); } },
      ];
  return (
    <div
      className="p-file-row"
      onContextMenu={(e) => {
        e.preventDefault();
        open(e.clientX, e.clientY, items);
      }}
    >
      <a
        href={link({ name: 'editor', fileId: file.id })}
        className="p-file-row-main"
        onClick={() => markOpened(file.id)}
      >
        <span className="p-file-row-thumb" aria-hidden="true">
          <FileThumb file={file} />
        </span>
        <span className="p-file-row-text">
          <span className="p-file-name">{file.name}</span>
          <span className="p-file-sub">
            {project ? project.name : 'Drafts'} · {owner.name}
          </span>
        </span>
      </a>
      <span className="p-file-row-kind">{file.kind}</span>
      <span className="p-file-row-date">{timeAgo(file.updatedAt)}</span>
      <span className="p-file-row-flags">
        {audienceIcon(file.audience)}
        <button
          className={`mini-btn${file.favorite ? ' on' : ''}`}
          aria-label={file.favorite ? `Remove ${file.name} from favorites` : `Add ${file.name} to favorites`}
          aria-pressed={file.favorite}
          onClick={() => toggleFavoriteFile(file.id)}
        >
          <Star size={13} />
        </button>
        <button
          className="mini-btn"
          aria-label={`More actions for ${file.name}`}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            open(r.left - 120, r.bottom + 4, items);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </span>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

/** Browser section with grid/list toggle + sort + shared rename/share/details dialogs. */
export function FileBrowser({
  files,
  empty,
  onShare,
  onDetails,
  onMove,
  showProject = true,
}: {
  files: DemoFile[];
  empty: ReactNode;
  onShare: (f: DemoFile) => void;
  onDetails: (f: DemoFile) => void;
  onMove: (f: DemoFile) => void;
  showProject?: boolean;
}) {
  const { state, renameFile, notify } = useProduct();
  const [view, setView] = useState<ViewMode>('grid');
  const [sort, setSort] = useState<SortKey>('updated');
  const [renaming, setRenaming] = useState<DemoFile | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sorted = sortFiles(files, sort);
  const projectOf = (f: DemoFile) => (showProject ? state.projects.find((p) => p.id === f.projectId) ?? null : null);

  const commitRename = () => {
    if (!renaming) return;
    if (!draft.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    renameFile(renaming.id, draft);
    notify(`Renamed to “${draft.trim()}”.`);
    setRenaming(null);
  };

  return (
    <div>
      {files.length > 0 && (
        <div className="p-browser-bar">
          <span className="dim small" role="status">
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
          <span className="p-browser-tools">
            <SortSelect sort={sort} onChange={setSort} />
            <ViewToggle view={view} onChange={setView} />
          </span>
        </div>
      )}
      {files.length === 0 ? (
        empty
      ) : view === 'grid' ? (
        <div className="p-file-grid">
          {sorted.map((f) => (
            <FileCard
              key={f.id}
              file={f}
              project={projectOf(f)}
              onShare={() => onShare(f)}
              onDetails={() => onDetails(f)}
              onMove={() => onMove(f)}
              onRename={() => {
                setRenaming(f);
                setDraft(f.name);
                setError(null);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="p-file-list" role="list" aria-label="Files">
          {sorted.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              project={projectOf(f)}
              onShare={() => onShare(f)}
              onDetails={() => onDetails(f)}
              onMove={() => onMove(f)}
              onRename={() => {
                setRenaming(f);
                setDraft(f.name);
                setError(null);
              }}
            />
          ))}
        </div>
      )}
      {renaming && (
        <Modal title="Rename file" onClose={() => setRenaming(null)} width={380}>
          <Field label="Name" error={error}>
            <input
              className="text-input"
              value={draft}
              autoFocus
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
              }}
              aria-label="File name"
            />
          </Field>
          <div className="dialog-actions">
            <button className="btn secondary" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={commitRename}>
              Rename
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ProjectCard({
  project,
  fileCount,
  onRename,
  onDelete,
}: {
  project: DemoProject;
  fileCount: number;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { toggleFavoriteProject } = useProduct();
  const { menu, open, close } = useContextMenu();
  const items: CtxItem[] = [
    { label: 'Open', onSelect: () => navigate({ name: 'project', projectId: project.id, folderId: null }) },
    { label: project.favorite ? 'Remove favorite' : 'Add to favorites', onSelect: () => toggleFavoriteProject(project.id) },
    { divider: true },
    { label: 'Rename', onSelect: onRename },
    { label: 'Delete project', danger: true, onSelect: onDelete },
  ];
  return (
    <div
      className="p-project-card"
      onContextMenu={(e) => {
        e.preventDefault();
        open(e.clientX, e.clientY, items);
      }}
    >
      <a
        href={link({ name: 'project', projectId: project.id, folderId: null })}
        className="p-project-cover"
        style={{ background: `linear-gradient(135deg, ${project.color}26, ${project.color}0d)` }}
        aria-label={`Open project ${project.name}`}
      >
        <span className="p-project-glyph" style={{ background: project.color }} aria-hidden="true">
          <FileText size={18} color="#fff" />
        </span>
      </a>
      <div className="p-file-meta">
        <div className="p-file-top">
          <a href={link({ name: 'project', projectId: project.id, folderId: null })} className="p-file-name">
            {project.name}
          </a>
          <button
            className="mini-btn"
            aria-label={`More actions for project ${project.name}`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              open(r.left, r.bottom + 4, items);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        <div className="p-file-sub">
          <span>
            {fileCount} file{fileCount === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true">·</span>
          <span>{timeAgo(project.updatedAt)}</span>
        </div>
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

/* ---------- creation ---------- */

export function NewFileButton({ projectId, folderId = null }: { projectId: string | null; folderId?: string | null }) {
  const { createFile, notify } = useProduct();
  return (
    <button
      className="btn primary"
      onClick={() => {
        const f = createFile('Untitled file', projectId, folderId);
        notify(`Created “${f.name}”.`);
        navigate({ name: 'editor', fileId: f.id });
      }}
    >
      <Plus size={14} />
      <span>New file</span>
    </button>
  );
}

export function NewFolderButton({ projectId, parentId }: { projectId: string; parentId: string | null }) {
  const { createFolder, notify } = useProduct();
  const [openDlg, setOpenDlg] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="btn secondary" onClick={() => { setOpenDlg(true); setName(''); setError(null); }}>
        <FolderPlus size={14} />
        <span>New folder</span>
      </button>
      {openDlg && (
        <Modal title="New folder" onClose={() => setOpenDlg(false)} width={360}>
          <Field label="Folder name" error={error}>
            <input
              className="text-input"
              value={name}
              autoFocus
              maxLength={60}
              placeholder="e.g. Explorations"
              onChange={(e) => setName(e.target.value)}
              aria-label="Folder name"
            />
          </Field>
          <div className="dialog-actions">
            <button className="btn secondary" onClick={() => setOpenDlg(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (!name.trim()) {
                  setError('Folder name cannot be empty.');
                  return;
                }
                createFolder(projectId, name, parentId);
                notify(`Created folder “${name.trim()}”.`);
                setOpenDlg(false);
              }}
            >
              Create folder
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- misc ---------- */

export function Toasts() {
  const { toasts } = useProduct();
  return (
    <div className="p-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="p-toast" role="status">
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function UserChip({ id }: { id: string }) {
  const u = memberById(id);
  return (
    <span className="p-user-chip">
      <Avatar user={u} size={20} />
      <span>{u.name}</span>
    </span>
  );
}
