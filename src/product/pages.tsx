/* Product pages: dashboard, projects, project detail, recents/shared/
/ favorites/trash/search browsers. */
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  FolderOpen,
  Inbox,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { link, navigate } from './router';
import { memberById, projectById, timeAgo } from './fixtures';
import type { DemoFile } from './fixtures';
import { activeWorkspace, useProduct } from './store';
import {
  Avatar,
  Breadcrumbs,
  ConfirmDialog,
  EmptyState,
  FileBrowser,
  FileThumb,
  NewFileButton,
  NewFolderButton,
  PageHead,
  ProjectCard,
} from './components';
import { CreateProjectDialog, FileDetailsDialog, MoveDialog, PromptDialog, ShareDialog } from './dialogs';

/* Shared dialog wiring for every file surface. */
export function useFileDialogs() {
  const [shareTarget, setShareTarget] = useState<DemoFile | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<DemoFile | null>(null);
  const [moveTarget, setMoveTarget] = useState<DemoFile | null>(null);
  const { state } = useProduct();
  const live = (f: DemoFile | null) => (f ? state.files.find((x) => x.id === f.id) ?? null : null);
  const dialogs = (
    <>
      {live(shareTarget) && <ShareDialog file={live(shareTarget)!} onClose={() => setShareTarget(null)} />}
      {live(detailsTarget) && (
        <FileDetailsDialog
          file={live(detailsTarget)!}
          onClose={() => setDetailsTarget(null)}
          onShare={() => setShareTarget(live(detailsTarget))}
        />
      )}
      {live(moveTarget) && <MoveDialog file={live(moveTarget)!} onClose={() => setMoveTarget(null)} />}
    </>
  );
  return { setShareTarget, setDetailsTarget, setMoveTarget, dialogs };
}

/* ---------- dashboard ---------- */

export function DashboardPage() {
  const { state } = useProduct();
  const ws = activeWorkspace(state);
  const [showCreateProject, setShowCreateProject] = useState(false);

  const live = state.files.filter((f) => !f.trashed);
  const myFiles = live.filter((f) => f.ownerId === 'u-me');
  const recents = live.filter((f) => f.openedAt).sort((a, b) => +new Date(b.openedAt!) - +new Date(a.openedAt!)).slice(0, 4);
  const favorites = live.filter((f) => f.favorite).slice(0, 4);
  const shared = live.filter((f) => f.sharedWithMe).slice(0, 4);
  const drafts = myFiles.filter((f) => !f.projectId).slice(0, 4);
  const projects = state.projects.filter((p) => p.workspaceId === ws.id).slice(0, 3);
  const activity = [...state.activity].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5);

  const Section = ({ title, href, children }: { title: string; href: string; children: React.ReactNode }) => (
    <section className="p-section" aria-label={title}>
      <div className="p-section-head">
        <h2>{title}</h2>
        <a href={href} className="p-see-all">
          See all <ArrowRight size={13} />
        </a>
      </div>
      {children}
    </section>
  );

  const MiniRow = ({ files, empty }: { files: DemoFile[]; empty: string }) =>
    files.length === 0 ? (
      <p className="dim small">{empty}</p>
    ) : (
      <div className="p-mini-grid">
        {files.map((f) => (
          <a
            key={f.id}
            href={link({ name: 'editor', fileId: f.id })}
            className="p-mini-card"
            aria-label={`Open ${f.name}`}
          >
            <FileThumb file={f} />
            <span className="p-mini-name">{f.name}</span>
            <span className="dim small">{timeAgo(f.updatedAt)}</span>
          </a>
        ))}
      </div>
    );

  return (
    <div>
      <div className="p-welcome">
        <div>
          <h1 className="p-title">Good to see you, {state.me.name.split(' ')[0]}.</h1>
          <p className="p-sub">
            {ws.name} · {myFiles.length} file{myFiles.length === 1 ? '' : 's'} · {projects.length} project
            {projects.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="p-head-actions">
          <button className="btn secondary" onClick={() => setShowCreateProject(true)}>
            <Plus size={14} />
            <span>New project</span>
          </button>
          <NewFileButton projectId={null} />
        </div>
      </div>

      <div className="p-dash-grid">
        <div className="p-dash-main">
          <Section title="Jump back in" href={link({ name: 'recents' })}>
            <MiniRow files={recents} empty="Open a file and it will show up here." />
          </Section>
          <Section title="Favorites" href={link({ name: 'favorites' })}>
            <MiniRow files={favorites} empty="Star files to pin them here." />
          </Section>
          <Section title="Shared with you" href={link({ name: 'shared' })}>
            <MiniRow files={shared} empty="Files teammates share will land here." />
          </Section>
          <Section title="Your drafts" href={link({ name: 'projects' })}>
            <MiniRow files={drafts} empty="Drafts live outside projects until you file them." />
          </Section>
        </div>
        <div className="p-dash-side">
          <section className="p-side-card" aria-label="Projects">
            <div className="p-section-head">
              <h2>Projects</h2>
              <a href={link({ name: 'projects' })} className="p-see-all">
                All <ArrowRight size={13} />
              </a>
            </div>
            {projects.length === 0 && <p className="dim small">No projects in this workspace yet.</p>}
            {projects.map((p) => {
              const count = live.filter((f) => f.projectId === p.id).length;
              return (
                <a
                  key={p.id}
                  href={link({ name: 'project', projectId: p.id, folderId: null })}
                  className="p-side-project"
                >
                  <span className="p-dot" style={{ background: p.color }} aria-hidden="true" />
                  <span className="p-ellipsis">{p.name}</span>
                  <span className="dim small">{count}</span>
                </a>
              );
            })}
          </section>
          <section className="p-side-card" aria-label="Recent activity">
            <h2>Activity</h2>
            {activity.map((a) => (
              <div key={a.id} className="p-activity">
                <Avatar user={memberById(a.actorId)} size={24} />
                <div>
                  <p>
                    <strong>{memberById(a.actorId).name}</strong> {a.text}
                  </p>
                  <span className="dim small">{timeAgo(a.at)}</span>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
      {showCreateProject && <CreateProjectDialog onClose={() => setShowCreateProject(false)} />}
    </div>
  );
}

/* ---------- projects ---------- */

export function ProjectsPage() {
  const { state, renameProject, deleteProject, notify } = useProduct();
  const ws = activeWorkspace(state);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const projects = state.projects
    .filter((p) => p.workspaceId === ws.id)
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const live = state.files.filter((f) => !f.trashed);
  const countOf = (id: string) => live.filter((f) => f.projectId === id).length;

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Projects' }]} />
      <PageHead
        title="Projects"
        sub={`${projects.length} project${projects.length === 1 ? '' : 's'} in ${ws.name}`}
        actions={
          <button className="btn primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            <span>New project</span>
          </button>
        }
      />
      <div className="p-toolbar">
        <div className="p-search inline">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects…"
            aria-label="Filter projects"
          />
        </div>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={22} />}
          title={query ? 'No matching projects' : 'No projects yet'}
          body={query ? `Nothing in ${ws.name} matches “${query}”.` : 'Group related files so the team can find them.'}
          action={
            !query ? (
              <button className="btn primary" onClick={() => setShowCreate(true)}>
                <Plus size={14} />
                <span>Create your first project</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="p-file-grid">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              fileCount={countOf(p.id)}
              onRename={() => setRenaming({ id: p.id, name: p.name })}
              onDelete={() => setDeleting(p.id)}
            />
          ))}
        </div>
      )}
      {showCreate && <CreateProjectDialog onClose={() => setShowCreate(false)} />}
      {renaming && (
        <PromptDialog
          title="Rename project"
          label="Project name"
          initial={renaming.name}
          confirmLabel="Rename"
          maxLength={60}
          onClose={() => setRenaming(null)}
          onConfirm={(v) => {
            renameProject(renaming.id, v);
            notify('Project renamed.');
          }}
        />
      )}
      {deleting &&
        (() => {
          const p = state.projects.find((x) => x.id === deleting);
          const n = countOf(deleting);
          return (
            <ConfirmDialog
              title="Delete project?"
              message={`“${p?.name}” will be removed. Its ${n} file${n === 1 ? '' : 's'} move back to Drafts — nothing is trashed.`}
              confirmLabel="Delete project"
              danger
              onClose={() => setDeleting(null)}
              onConfirm={() => {
                deleteProject(deleting);
                notify('Project deleted; files moved to Drafts.');
              }}
            />
          );
        })()}
    </div>
  );
}

/* ---------- project detail ---------- */

export function ProjectDetailPage({ projectId, folderId }: { projectId: string; folderId: string | null }) {
  const { state, renameFolder, notify } = useProduct();
  const ws = activeWorkspace(state);
  const { setShareTarget, setDetailsTarget, setMoveTarget, dialogs } = useFileDialogs();
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);

  const project = state.projects.find((p) => p.id === projectId && p.workspaceId === ws.id) ?? null;
  const live = state.files.filter((f) => !f.trashed);
  const filesHere = useMemo(() => {
    if (!project) return [];
    return live.filter((f) => f.projectId === project.id && (f.folderId ?? null) === folderId);
  }, [live, project, folderId]);

  if (!project) {
    return (
      <EmptyState
        icon={<FolderOpen size={22} />}
        title="Project not found"
        body="It may have been deleted or belong to another workspace."
        action={
          <a href={link({ name: 'projects' })} className="btn secondary">
            Back to projects
          </a>
        }
      />
    );
  }

  const foldersHere = project.folders.filter((f) => (f.parentId ?? null) === folderId);
  const crumbs: { label: string; route?: { name: 'project'; projectId: string; folderId: string | null } | { name: 'projects' } | { name: 'dashboard' } }[] = [
    { label: 'Home', route: { name: 'dashboard' } },
    { label: 'Projects', route: { name: 'projects' } },
    { label: project.name, route: folderId ? { name: 'project', projectId: project.id, folderId: null } : undefined },
  ];
  // Expand breadcrumb trail through parent folders.
  const trail: { id: string; name: string }[] = [];
  let cursor: string | null = folderId;
  while (cursor) {
    const f = project.folders.find((x) => x.id === cursor);
    if (!f) break;
    trail.unshift({ id: f.id, name: f.name });
    cursor = f.parentId;
  }
  trail.forEach((t, i) => {
    crumbs.push({
      label: t.name,
      route: i < trail.length - 1 ? { name: 'project', projectId: project.id, folderId: t.id } : undefined,
    });
  });

  return (
    <div>
      <Breadcrumbs items={crumbs} />
      <PageHead
        title={trail.length ? trail[trail.length - 1].name : project.name}
        sub={
          trail.length
            ? `Folder in ${project.name} · ${filesHere.length} file${filesHere.length === 1 ? '' : 's'}`
            : `${project.description || 'No description'} · ${live.filter((f) => f.projectId === project.id).length} files`
        }
        actions={
          <>
            <NewFolderButton projectId={project.id} parentId={folderId} />
            <NewFileButton projectId={project.id} folderId={folderId} />
          </>
        }
      />
      {foldersHere.length > 0 && (
        <section className="p-section" aria-label="Folders">
          <div className="p-folder-grid">
            {foldersHere.map((f) => {
              const count = live.filter((x) => x.folderId === f.id).length;
              return (
                <div key={f.id} className="p-folder-card">
                  <a href={link({ name: 'project', projectId: project.id, folderId: f.id })}>
                    <FolderOpen size={18} />
                    <span className="p-ellipsis">{f.name}</span>
                    <span className="dim small">{count}</span>
                  </a>
                  <button
                    className="mini-btn"
                    aria-label={`Rename folder ${f.name}`}
                    title="Rename folder"
                    onClick={() => setRenamingFolder({ id: f.id, name: f.name })}
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <FileBrowser
        files={filesHere}
        onShare={(f) => setShareTarget(f)}
        onDetails={(f) => setDetailsTarget(f)}
        onMove={(f) => setMoveTarget(f)}
        showProject={false}
        empty={
          <EmptyState
            icon={<Inbox size={22} />}
            title={foldersHere.length ? 'No files in this folder' : 'This folder is empty'}
            body="Create a file here or move one in from another location."
            action={<NewFileButton projectId={project.id} folderId={folderId} />}
          />
        }
      />
      {renamingFolder && (
        <PromptDialog
          title="Rename folder"
          label="Folder name"
          initial={renamingFolder.name}
          confirmLabel="Rename"
          maxLength={60}
          onClose={() => setRenamingFolder(null)}
          onConfirm={(v) => {
            renameFolder(project.id, renamingFolder.id, v);
            notify('Folder renamed.');
          }}
        />
      )}
      {dialogs}
    </div>
  );
}

/* ---------- recents / shared / favorites / trash / search ---------- */

function groupByTime(files: DemoFile[]): { label: string; files: DemoFile[] }[] {
  const now = Date.now();
  const day = 86400000;
  const groups: { label: string; test: (f: DemoFile) => boolean }[] = [
    { label: 'Today', test: (f) => now - +new Date(f.openedAt ?? f.updatedAt) < day },
    { label: 'This week', test: (f) => now - +new Date(f.openedAt ?? f.updatedAt) < 7 * day },
    { label: 'Earlier', test: () => true },
  ];
  const out: { label: string; files: DemoFile[] }[] = [];
  const rest = [...files];
  for (const g of groups.slice(0, 2)) {
    const hit = rest.filter(g.test);
    hit.forEach((h) => rest.splice(rest.indexOf(h), 1));
    if (hit.length) out.push({ label: g.label, files: hit });
  }
  if (rest.length) out.push({ label: 'Earlier', files: rest });
  return out;
}

export function RecentsPage() {
  const { state } = useProduct();
  const { setShareTarget, setDetailsTarget, setMoveTarget, dialogs } = useFileDialogs();
  const files = state.files
    .filter((f) => !f.trashed && f.openedAt)
    .sort((a, b) => +new Date(b.openedAt!) - +new Date(a.openedAt!));
  const groups = groupByTime(files);
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Recents' }]} />
      <PageHead title="Recents" sub="Everything you opened lately, grouped by time" />
      {files.length === 0 ? (
        <EmptyState
          icon={<Clock size={22} />}
          title="Nothing opened yet"
          body="Files you open in the editor will appear here."
          action={<NewFileButton projectId={null} />}
        />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="p-section" aria-label={g.label}>
            <h2 className="p-group-title">{g.label}</h2>
            <FileBrowser
              files={g.files}
              onShare={(f) => setShareTarget(f)}
              onDetails={(f) => setDetailsTarget(f)}
              onMove={(f) => setMoveTarget(f)}
              empty={null}
            />
          </section>
        ))
      )}
      {dialogs}
    </div>
  );
}

export function SharedPage() {
  const { state } = useProduct();
  const { setShareTarget, setDetailsTarget, setMoveTarget, dialogs } = useFileDialogs();
  const withMe = state.files.filter((f) => !f.trashed && f.sharedWithMe);
  const byMe = state.files.filter((f) => !f.trashed && f.sharedByMe);
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Shared' }]} />
      <PageHead title="Shared" sub="Collaboration in both directions" />
      <section className="p-section" aria-label="Shared with me">
        <h2 className="p-group-title">Shared with me</h2>
        <FileBrowser
          files={withMe}
          onShare={(f) => setShareTarget(f)}
          onDetails={(f) => setDetailsTarget(f)}
          onMove={(f) => setMoveTarget(f)}
          empty={
            <EmptyState
              icon={<Users size={22} />}
              title="No shares yet"
              body="When teammates share a file with you, it shows up here."
            />
          }
        />
      </section>
      <section className="p-section" aria-label="Shared by me">
        <h2 className="p-group-title">Shared by me</h2>
        <FileBrowser
          files={byMe}
          onShare={(f) => setShareTarget(f)}
          onDetails={(f) => setDetailsTarget(f)}
          onMove={(f) => setMoveTarget(f)}
          empty={
            <EmptyState
              icon={<Users size={22} />}
              title="You have not shared anything"
              body="Use Share on any file to collaborate."
            />
          }
        />
      </section>
      {dialogs}
    </div>
  );
}

export function FavoritesPage() {
  const { state } = useProduct();
  const ws = activeWorkspace(state);
  const { setShareTarget, setDetailsTarget, setMoveTarget, dialogs } = useFileDialogs();
  const files = state.files.filter((f) => !f.trashed && f.favorite);
  const projects = state.projects.filter((p) => p.workspaceId === ws.id && p.favorite);
  const live = state.files.filter((f) => !f.trashed);
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Favorites' }]} />
      <PageHead title="Favorites" sub="Starred files and projects, one glance away" />
      {files.length === 0 && projects.length === 0 ? (
        <EmptyState
          icon={<Star size={22} />}
          title="No favorites yet"
          body="Star anything to pin it here for fast access."
        />
      ) : (
        <>
          {projects.length > 0 && (
            <section className="p-section" aria-label="Favorite projects">
              <h2 className="p-group-title">Projects</h2>
              <div className="p-file-grid">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    fileCount={live.filter((f) => f.projectId === p.id).length}
                    onRename={() => navigate({ name: 'projects' })}
                    onDelete={() => navigate({ name: 'projects' })}
                  />
                ))}
              </div>
            </section>
          )}
          {files.length > 0 && (
            <section className="p-section" aria-label="Favorite files">
              <h2 className="p-group-title">Files</h2>
              <FileBrowser
                files={files}
                onShare={(f) => setShareTarget(f)}
                onDetails={(f) => setDetailsTarget(f)}
                onMove={(f) => setMoveTarget(f)}
                empty={null}
              />
            </section>
          )}
        </>
      )}
      {dialogs}
    </div>
  );
}

export function TrashPage() {
  const { state, restoreFile, emptyTrash, notify } = useProduct();
  const { setDetailsTarget, dialogs } = useFileDialogs();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const files = state.files.filter((f) => f.trashed);
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Trash' }]} />
      <PageHead
        title="Trash"
        sub="Deleted files rest here until you restore or remove them forever"
        actions={
          files.length > 0 ? (
            <button className="btn secondary danger-hover" onClick={() => setConfirmEmpty(true)}>
              <Trash2 size={14} />
              <span>Empty trash</span>
            </button>
          ) : undefined
        }
      />
      {files.length === 0 ? (
        <EmptyState icon={<Trash2 size={22} />} title="Trash is empty" body="Deleted files will wait here for 30 days in the real product." />
      ) : (
        <div className="p-file-list" role="list" aria-label="Trashed files">
          {files.map((f) => {
            const project = projectById(state.projects, f.projectId);
            return (
              <div key={f.id} className="p-file-row" role="listitem">
                <span className="p-file-row-main">
                  <span className="p-file-row-thumb" aria-hidden="true">
                    <FileThumb file={f} />
                  </span>
                  <span className="p-file-row-text">
                    <span className="p-file-name">{f.name}</span>
                    <span className="p-file-sub">{project ? project.name : 'Drafts'}</span>
                  </span>
                </span>
                <span className="p-file-row-date">{timeAgo(f.updatedAt)}</span>
                <span className="p-trash-actions">
                  <button
                    className="btn secondary"
                    onClick={() => {
                      restoreFile(f.id);
                      notify(`Restored “${f.name}”.`);
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="btn secondary danger-hover"
                    onClick={() => setDetailsTarget(f)}
                    aria-label={`Delete ${f.name} forever`}
                  >
                    Delete
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {confirmEmpty && (
        <ConfirmDialog
          title="Empty trash?"
          message={`Permanently delete ${files.length} file${files.length === 1 ? '' : 's'}? This cannot be undone.`}
          confirmLabel="Empty trash"
          danger
          onClose={() => setConfirmEmpty(false)}
          onConfirm={() => {
            emptyTrash();
            notify('Trash emptied.');
          }}
        />
      )}
      {dialogs}
    </div>
  );
}

export function SearchPage({ query }: { query: string }) {
  const { state } = useProduct();
  const { setShareTarget, setDetailsTarget, setMoveTarget, dialogs } = useFileDialogs();
  const q = query.trim().toLowerCase();
  const files = q ? state.files.filter((f) => !f.trashed && f.name.toLowerCase().includes(q)) : [];
  const projects = q ? state.projects.filter((p) => p.name.toLowerCase().includes(q)) : [];
  const live = state.files.filter((f) => !f.trashed);
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Search' }]} />
      <PageHead title={`Results for “${query.trim()}”`} sub={`${files.length + projects.length} match${files.length + projects.length === 1 ? '' : 'es'}`} />
      {!q ? (
        <EmptyState icon={<Search size={22} />} title="Type to search" body="Use the search field above to find files and projects." />
      ) : files.length + projects.length === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title="No matches"
          body={`Nothing matches “${query.trim()}”. Try a different keyword.`}
          action={<NewFileButton projectId={null} />}
        />
      ) : (
        <>
          {projects.length > 0 && (
            <section className="p-section" aria-label="Matching projects">
              <h2 className="p-group-title">Projects</h2>
              <div className="p-file-grid">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    fileCount={live.filter((f) => f.projectId === p.id).length}
                    onRename={() => navigate({ name: 'projects' })}
                    onDelete={() => navigate({ name: 'projects' })}
                  />
                ))}
              </div>
            </section>
          )}
          {files.length > 0 && (
            <section className="p-section" aria-label="Matching files">
              <h2 className="p-group-title">Files</h2>
              <FileBrowser
                files={files}
                onShare={(f) => setShareTarget(f)}
                onDetails={(f) => setDetailsTarget(f)}
                onMove={(f) => setMoveTarget(f)}
                empty={null}
              />
            </section>
          )}
        </>
      )}
      {dialogs}
    </div>
  );
}

export function NotFoundPage({ path }: { path: string }) {
  return (
    <EmptyState
      icon={<Search size={22} />}
      title="Page not found"
      body={`“${path}” does not exist in this workspace.`}
      action={
        <a href={link({ name: 'dashboard' })} className="btn primary">
          Back to home
        </a>
      }
    />
  );
}
