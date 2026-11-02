/* Account area: public profile, workspace/team, and settings. */
import { useState } from 'react';
import { Check, Crown, Eye, MailPlus, Pencil, Search, ShieldCheck, Trash2, User } from 'lucide-react';
import { link } from './router';
import { timeAgo } from './fixtures';
import { activeWorkspace, useProduct } from './store';
import { Avatar, Breadcrumbs, ConfirmDialog, EmptyState, Field, PageHead } from './components';
import { InviteMemberDialog } from './dialogs';

/* ---------- profile ---------- */

export function ProfilePage() {
  const { state, updateProfile, notify } = useProduct();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(state.me.name);
  const [username, setUsername] = useState(state.me.username);
  const [bio, setBio] = useState(state.me.bio);
  const [error, setError] = useState<string | null>(null);

  const myFiles = state.files.filter((f) => !f.trashed && f.ownerId === 'u-me').length;
  const shared = state.files.filter((f) => !f.trashed && f.sharedByMe).length;

  const beginEdit = () => {
    setName(state.me.name);
    setUsername(state.me.username);
    setBio(state.me.bio);
    setError(null);
    setEditing(true);
  };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Profile' }]} />
      <div className="p-profile-hero">
        <Avatar user={state.me} size={72} />
        <div className="p-profile-id">
          <h1 className="p-title">{state.me.name}</h1>
          <p className="p-sub">@{state.me.username}</p>
          {state.me.bio && <p className="p-bio">{state.me.bio}</p>}
          <div className="p-profile-stats">
            <span>
              <strong>{myFiles}</strong> files
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong>{shared}</strong> shared
            </span>
          </div>
        </div>
        <div className="p-head-actions">
          {!editing && (
            <button className="btn secondary" onClick={beginEdit}>
              <Pencil size={14} />
              <span>Edit profile</span>
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <section className="p-card" aria-label="Edit profile">
          <h2>Public profile</h2>
          <p className="dim small">This is how teammates see you. Nothing here is sensitive.</p>
          <div className="p-form-grid">
            <Field label="Display name" error={error}>
              <input className="text-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
            </Field>
            <Field label="Username">
              <input className="text-input" value={username} maxLength={30} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
            </Field>
          </div>
          <Field label={`Bio (${bio.length}/200)`}>
            <textarea className="text-input" rows={3} maxLength={220} value={bio} onChange={(e) => setBio(e.target.value)} aria-label="Bio" />
          </Field>
          <div className="dialog-actions">
            <button className="btn secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                const err = updateProfile({ name, username, bio });
                if (err) {
                  setError(err);
                  return;
                }
                notify('Profile saved.');
                setEditing(false);
              }}
            >
              Save changes
            </button>
          </div>
        </section>
      ) : (
        <section className="p-card" aria-label="Profile preview">
          <h2>Preview</h2>
          <div className="p-preview-person">
            <Avatar user={state.me} size={40} />
            <div>
              <strong>{state.me.name}</strong>
              <p className="dim small">
                @{state.me.username}
                {state.me.bio ? ` — ${state.me.bio}` : ''}
              </p>
            </div>
          </div>
          <p className="dim small">
            Account settings (password, sessions, billing) live under <a href={link({ name: 'settings' })}>Settings</a> and
            are intentionally read-only until the accounts backend exists.
          </p>
        </section>
      )}
    </div>
  );
}

/* ---------- workspace / team ---------- */

const ROLE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  owner: { label: 'Owner', icon: <Crown size={13} /> },
  editor: { label: 'Editor', icon: <Pencil size={13} /> },
  viewer: { label: 'Viewer', icon: <Eye size={13} /> },
};

export function WorkspacePage() {
  const { state, removeMember, notify } = useProduct();
  const ws = activeWorkspace(state);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'editor' | 'viewer'>('all');
  const [showInvite, setShowInvite] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const members = state.members
    .filter((m) => ws.memberIds.includes(m.id))
    .filter((m) => roleFilter === 'all' || m.role === roleFilter || m.role === 'owner')
    .filter(
      (m) =>
        !query ||
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.username.toLowerCase().includes(query.toLowerCase()),
    );
  const pending = members.filter((m) => m.pending);
  const projects = state.projects.filter((p) => p.workspaceId === ws.id);

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Team' }]} />
      <PageHead
        title={ws.name}
        sub={`${ws.plan} plan · ${ws.memberIds.length} member${ws.memberIds.length === 1 ? '' : 's'} · ${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          <button className="btn primary" onClick={() => setShowInvite(true)}>
            <MailPlus size={14} />
            <span>Invite member</span>
          </button>
        }
      />
      <div className="p-toolbar">
        <div className="p-search inline">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members…" aria-label="Search members" />
        </div>
        <div className="seg" role="group" aria-label="Filter by role">
          {(['all', 'editor', 'viewer'] as const).map((r) => (
            <button
              key={r}
              className={`seg-btn${roleFilter === r ? ' active' : ''}`}
              onClick={() => setRoleFilter(r)}
              aria-pressed={roleFilter === r}
            >
              {r === 'all' ? 'All' : ROLE_META[r].label + 's'}
            </button>
          ))}
        </div>
      </div>

      {pending.length > 0 && (
        <section className="p-section" aria-label="Pending invitations">
          <h2 className="p-group-title">Pending invitations</h2>
          <div className="p-member-list">
            {pending.map((m) => (
              <MemberRow key={m.id} id={m.id} onRemove={() => setRemoving(m.id)} />
            ))}
          </div>
        </section>
      )}

      <section className="p-section" aria-label="Members">
        <h2 className="p-group-title">Members</h2>
        {members.filter((m) => !m.pending).length === 0 ? (
          <EmptyState
            icon={<User size={22} />}
            title="No members match"
            body="Try a different search or role filter."
          />
        ) : (
          <div className="p-member-list">
            {members
              .filter((m) => !m.pending)
              .map((m) => (
                <MemberRow key={m.id} id={m.id} onRemove={() => setRemoving(m.id)} />
              ))}
          </div>
        )}
      </section>

      <section className="p-section" aria-label="Workspace projects">
        <h2 className="p-group-title">Shared projects</h2>
        {projects.length === 0 ? (
          <p className="dim small">No projects in this workspace yet.</p>
        ) : (
          <div className="p-project-rows">
            {projects.map((p) => (
              <a
                key={p.id}
                className="p-project-row"
                href={link({ name: 'project', projectId: p.id, folderId: null })}
              >
                <span className="p-dot" style={{ background: p.color }} aria-hidden="true" />
                <span className="p-ellipsis">{p.name}</span>
                <span className="dim small">{timeAgo(p.updatedAt)}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <p className="dim small">
        Membership changes apply to local demo data only. Real invitations, roles, and permission enforcement need the
        accounts backend (see integration notes).
      </p>

      {showInvite && <InviteMemberDialog onClose={() => setShowInvite(false)} />}
      {removing &&
        (() => {
          const m = state.members.find((x) => x.id === removing);
          if (!m) return null;
          if (m.role === 'owner') {
            return (
              <ConfirmDialog
                title="Cannot remove owner"
                message="Ownership transfer is not available in this milestone."
                confirmLabel="Understood"
                onClose={() => setRemoving(null)}
                onConfirm={() => {}}
              />
            );
          }
          return (
            <ConfirmDialog
              title={`Remove ${m.name}?`}
              message={m.pending ? 'Their pending invite will be revoked (local demo).' : 'They lose access to this workspace (local demo).'}
              confirmLabel="Remove"
              danger
              onClose={() => setRemoving(null)}
              onConfirm={() => {
                removeMember(m.id);
                notify(`Removed ${m.name}.`);
              }}
            />
          );
        })()}
    </div>
  );
}

function MemberRow({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { state } = useProduct();
  const m = state.members.find((x) => x.id === id);
  if (!m) return null;
  const meta = ROLE_META[m.role];
  const mine = m.id === 'u-me';
  return (
    <div className="p-member-row">
      <Avatar user={m} size={34} />
      <div className="p-member-text">
        <strong>
          {m.name}
          {mine ? ' (you)' : ''}
        </strong>
        <span className="dim small">@{m.username}</span>
      </div>
      {m.pending && <span className="p-pill">Pending</span>}
      <span className="p-role" title={meta.label}>
        {meta.icon}
        <span>{meta.label}</span>
      </span>
      {!mine && (
        <button className="mini-btn danger-hover" onClick={onRemove} aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/* ---------- settings ---------- */

export function SettingsPage() {
  const { state, setDensity, resetDemo, notify } = useProduct();
  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState<'preferences' | 'account' | 'about'>('preferences');

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', route: { name: 'dashboard' } }, { label: 'Settings' }]} />
      <PageHead title="Settings" sub="Preferences apply immediately; account changes need the backend" />
      <div className="p-settings-grid">
        <nav className="p-settings-nav" aria-label="Settings sections">
          {(
            [
              { id: 'preferences', label: 'Preferences' },
              { id: 'account', label: 'Account' },
              { id: 'about', label: 'About & data' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={`p-settings-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="p-settings-body">
          {tab === 'preferences' && (
            <section className="p-card" aria-label="Preferences">
              <h2>Appearance & density</h2>
              <div className="p-setting-row">
                <div>
                  <strong>Interface density</strong>
                  <p className="dim small">Changes spacing across dashboard, lists, and dialogs.</p>
                </div>
                <div className="seg" role="group" aria-label="Interface density">
                  {(['comfortable', 'compact'] as const).map((d) => (
                    <button
                      key={d}
                      className={`seg-btn${state.density === d ? ' active' : ''}`}
                      onClick={() => {
                        setDensity(d);
                        notify(`Density: ${d}.`);
                      }}
                      aria-pressed={state.density === d}
                    >
                      {d === 'comfortable' ? 'Comfortable' : 'Compact'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-setting-row">
                <div>
                  <strong>Theme</strong>
                  <p className="dim small">Undesign ships a single light theme until the editor supports dark mode.</p>
                </div>
                <div className="seg" role="group" aria-label="Theme">
                  <button className="seg-btn active" aria-pressed="true">
                    Light
                  </button>
                  <button className="seg-btn" disabled title="Dark mode needs editor theme support first">
                    Dark
                  </button>
                </div>
              </div>
              <div className="p-setting-row">
                <div>
                  <strong>Motion</strong>
                  <p className="dim small">
                    Animations follow your OS “reduce motion” setting automatically. No toggle needed.
                  </p>
                </div>
                <span className="p-pill">
                  <Check size={12} /> System
                </span>
              </div>
            </section>
          )}
          {tab === 'account' && (
            <section className="p-card" aria-label="Account">
              <h2>Account</h2>
              <div className="p-setting-row">
                <div>
                  <strong>Signed in as</strong>
                  <p className="dim small">
                    {state.me.name} · @{state.me.username} (demo session, no real auth)
                  </p>
                </div>
              </div>
              <div className="p-setting-row">
                <div>
                  <strong>Password & sessions</strong>
                  <p className="dim small">Managed by the accounts backend once it exists.</p>
                </div>
                <span className="p-pill">
                  <ShieldCheck size={12} /> Backend-owned
                </span>
              </div>
              <div className="dialog-actions">
                <a href={link({ name: 'profile' })} className="btn secondary">
                  Edit public profile
                </a>
              </div>
            </section>
          )}
          {tab === 'about' && (
            <section className="p-card" aria-label="About and demo data">
              <h2>About & demo data</h2>
              <p className="dialog-text dim">
                Undesign 0.1.0 (product shell). Dashboard, projects, sharing, and team pages run on typed demo
                fixtures stored only in this browser. The design editor keeps its own document store.
              </p>
              <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn secondary danger-hover" onClick={() => setConfirmReset(true)}>
                  <Trash2 size={14} />
                  <span>Reset demo data</span>
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title="Reset demo data?"
          message="All local product changes (renames, new files, invites) return to the original fixtures."
          confirmLabel="Reset everything"
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            resetDemo();
            notify('Demo data reset.');
          }}
        />
      )}
    </div>
  );
}
