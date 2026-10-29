/* Product dialogs: sharing, file details, project creation, invites, move.
 * All state changes are local-demo only and labeled as such in the UI. */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy, Globe, Link2, Lock, Users } from 'lucide-react';
import { Modal } from '../components/ui';
import { memberById, projectById, timeAgo } from './fixtures';
import type { DemoFile, ShareAudience } from './fixtures';
import { activeWorkspace, useProduct } from './store';
import { Avatar, Field, UserChip } from './components';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const AUDIENCE_HELP: Record<ShareAudience, string> = {
  private: 'Only people you add can open this file.',
  workspace: 'Everyone in the workspace can find and open it.',
  anyone: 'Anyone with the link can view. Demo only — no public hosting exists yet.',
};

/* ---------- share ---------- */

export function ShareDialog({ file, onClose }: { file: DemoFile; onClose: () => void }) {
  const { state, setAudience, setFileRole, notify } = useProduct();
  const ws = activeWorkspace(state);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}${window.location.pathname}#/files/${file.id}`;
  const people = useMemo(() => {
    const ids = new Set([file.ownerId, ...file.editors, ...file.viewers]);
    return [...ids].map((id) => ({
      member: memberById(id),
      access: id === file.ownerId ? 'owner' : file.editors.includes(id) ? 'editor' : 'viewer',
    }));
  }, [file]);

  const invite = () => {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Enter a valid email address.');
      return;
    }
    const known = state.members.find((m) => `${m.username}@example.com` === clean || m.username === clean.split('@')[0]);
    if (!known) {
      // Demo honesty: only fixture members can actually be granted access.
      setError('Demo workspace: only existing team members can be added. Use the Team page to invite.');
      return;
    }
    if (known.id === 'u-me') {
      setError('That is your own account.');
      return;
    }
    setFileRole(file.id, known.id, role);
    notify(`Added ${known.name} as ${role}.`);
    setEmail('');
    setError(null);
  };

  return (
    <Modal title={`Share “${file.name}”`} onClose={onClose} width={480}>
      <div className="p-share-row">
        <input
          className="text-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') invite();
          }}
          placeholder="Invite by email…"
          aria-label="Invite by email"
          autoComplete="off"
        />
        <select
          className="text-input p-role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          aria-label="Role for new member"
        >
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <button className="btn primary" onClick={invite}>
          Invite
        </button>
      </div>
      {error && (
        <p className="dialog-text error" role="alert">
          {error}
        </p>
      )}

      <div className="p-share-people" role="list" aria-label="People with access">
        {people.map(({ member, access }) => (
          <div className="p-share-person" key={member.id} role="listitem">
            <Avatar user={member} size={30} />
            <span className="p-share-person-text">
              <span className="p-share-person-name">
                {member.name}
                {member.id === 'u-me' ? ' (you)' : ''}
              </span>
              <span className="dim small">@{member.username}</span>
            </span>
            {access === 'owner' ? (
              <span className="dim small">Owner</span>
            ) : (
              <select
                className="text-input p-role-select"
                value={access}
                onChange={(e) =>
                  setFileRole(file.id, member.id, e.target.value as 'editor' | 'viewer' | 'none')
                }
                aria-label={`Access for ${member.name}`}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
                <option value="none">Remove</option>
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="p-share-link">
        <div className="p-share-link-head">
          <Link2 size={14} aria-hidden="true" />
          <span>Link access</span>
        </div>
        <div className="seg" role="group" aria-label="Link access">
          {(
            [
              { v: 'private', label: 'Private', icon: <Lock size={13} /> },
              { v: 'workspace', label: ws.name, icon: <Users size={13} /> },
              { v: 'anyone', label: 'Anyone', icon: <Globe size={13} /> },
            ] as { v: ShareAudience; label: string; icon: ReactNode }[]
          ).map((o) => (
            <button
              key={o.v}
              className={`seg-btn${file.audience === o.v ? ' active' : ''}`}
              onClick={() => setAudience(file.id, o.v)}
              aria-pressed={file.audience === o.v}
            >
              {o.icon}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
        <p className="dim small">{AUDIENCE_HELP[file.audience]}</p>
        <button
          className="btn secondary full"
          disabled={file.audience === 'private'}
          title={file.audience === 'private' ? 'Choose Workspace or Anyone to enable the link' : undefined}
          onClick={async () => {
            const ok = await copyText(shareUrl);
            if (ok) {
              setCopied(true);
              notify('Link copied to clipboard.');
              window.setTimeout(() => setCopied(false), 2000);
            } else {
              notify('Clipboard unavailable in this browser.');
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy link'}</span>
        </button>
      </div>
      <p className="dim small">Invitations and link access are simulated locally in this milestone.</p>
    </Modal>
  );
}

/* ---------- file details ---------- */

export function FileDetailsDialog({
  file,
  onClose,
  onShare,
}: {
  file: DemoFile;
  onClose: () => void;
  onShare: () => void;
}) {
  const { state, trashFile, restoreFile, deleteFileForever, notify } = useProduct();
  const project = projectById(state.projects, file.projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Modal title="File details" onClose={onClose} width={420}>
      <div className="p-details">
        <div className="p-details-row">
          <span className="dim">Name</span>
          <strong>{file.name}</strong>
        </div>
        <div className="p-details-row">
          <span className="dim">Type</span>
          <span className="p-file-kind">{file.kind}</span>
        </div>
        <div className="p-details-row">
          <span className="dim">Location</span>
          <span>{project ? project.name : 'Drafts'}</span>
        </div>
        <div className="p-details-row">
          <span className="dim">Owner</span>
          <UserChip id={file.ownerId} />
        </div>
        <div className="p-details-row">
          <span className="dim">Modified</span>
          <span>
            {new Date(file.updatedAt).toLocaleString()} ({timeAgo(file.updatedAt)})
          </span>
        </div>
        <div className="p-details-row">
          <span className="dim">Sharing</span>
          <span>
            {file.audience === 'private'
              ? 'Private'
              : file.audience === 'workspace'
                ? 'Shared with workspace'
                : 'Anyone with the link'}
            {` · ${file.editors.length + file.viewers.length} collaborator${file.editors.length + file.viewers.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
      <div className="dialog-actions">
        {file.trashed ? (
          <>
            <button
              className="btn secondary danger-hover"
              onClick={() => {
                if (confirmDelete) {
                  deleteFileForever(file.id);
                  notify(`Deleted “${file.name}” forever.`);
                  onClose();
                } else {
                  setConfirmDelete(true);
                }
              }}
            >
              {confirmDelete ? 'Confirm delete forever' : 'Delete forever'}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                restoreFile(file.id);
                notify(`Restored “${file.name}”.`);
                onClose();
              }}
            >
              Restore
            </button>
          </>
        ) : (
          <>
            <button
              className="btn secondary danger-hover"
              onClick={() => {
                trashFile(file.id);
                notify(`Moved “${file.name}” to trash.`);
                onClose();
              }}
            >
              Move to trash
            </button>
            <button
              className="btn primary"
              onClick={() => {
                onClose();
                onShare();
              }}
            >
              Share…
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------- create project ---------- */

export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const { createProject, notify } = useProduct();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="New project" onClose={onClose} width={400}>
      <Field label="Project name" error={error}>
        <input
          className="text-input"
          value={name}
          autoFocus
          maxLength={60}
          placeholder="e.g. Onboarding refresh"
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          className="text-input"
          rows={2}
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What will this project hold?"
          aria-label="Project description"
        />
      </Field>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            if (!name.trim()) {
              setError('Project name cannot be empty.');
              return;
            }
            const p = createProject(name, description);
            notify(`Created project “${p.name}”.`);
            onClose();
          }}
        >
          Create project
        </button>
      </div>
    </Modal>
  );
}

/* ---------- invite member ---------- */

export function InviteMemberDialog({ onClose }: { onClose: () => void }) {
  const { inviteMember, notify } = useProduct();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Invite to workspace" onClose={onClose} width={400}>
      <p className="dialog-text dim">
        Demo only: the invite is recorded locally as pending. No email is sent in this milestone.
      </p>
      <Field label="Email" error={error}>
        <input
          className="text-input"
          value={email}
          autoFocus
          placeholder="teammate@studio.com"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget.closest('.modal')?.querySelector('.btn.primary') as HTMLButtonElement)?.click();
          }}
          aria-label="Email address"
          autoComplete="off"
        />
      </Field>
      <Field label="Role">
        <select
          className="text-input"
          value={role}
          onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          aria-label="Role"
        >
          <option value="editor">Editor — can create and edit</option>
          <option value="viewer">Viewer — can view and comment</option>
        </select>
      </Field>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const err = inviteMember(email, role);
            if (err) {
              setError(err);
              return;
            }
            notify(`Invite recorded for ${email.trim()}.`);
            onClose();
          }}
        >
          Send invite
        </button>
      </div>
    </Modal>
  );
}

/* ---------- generic rename prompt ---------- */

export function PromptDialog({
  title,
  label,
  initial,
  confirmLabel,
  maxLength = 80,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  maxLength?: number;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose} width={380}>
      <Field label={label} error={error}>
        <input
          className="text-input"
          value={value}
          autoFocus
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (!value.trim()) setError('Name cannot be empty.');
              else {
                onConfirm(value.trim());
                onClose();
              }
            }
          }}
          aria-label={label}
        />
      </Field>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            if (!value.trim()) {
              setError('Name cannot be empty.');
              return;
            }
            onConfirm(value.trim());
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- move file ---------- */

export function MoveDialog({ file, onClose }: { file: DemoFile; onClose: () => void }) {
  const { state, moveFile, notify } = useProduct();
  const ws = activeWorkspace(state);
  const projects = state.projects.filter((p) => p.workspaceId === ws.id);
  const [target, setTarget] = useState<string>(file.projectId ?? '');

  const foldersOf = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.folders ?? [];

  return (
    <Modal title={`Move “${file.name}”`} onClose={onClose} width={400}>
      <Field label="Destination">
        <select
          className="text-input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Destination project or folder"
        >
          <option value="">Drafts (no project)</option>
          {projects.map((p) => (
            <optgroup key={p.id} label={p.name}>
              <option value={`${p.id}:`}>{p.name} — root</option>
              {foldersOf(p.id).map((f) => (
                <option key={f.id} value={`${p.id}:${f.id}`}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            if (!target) {
              moveFile(file.id, null, null);
            } else {
              const [projectId, folderId] = target.split(':');
              moveFile(file.id, projectId, folderId || null);
            }
            notify(`Moved “${file.name}”.`);
            onClose();
          }}
        >
          Move
        </button>
      </div>
    </Modal>
  );
}
