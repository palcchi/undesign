/* Product root: hash-route switch between product pages and the editor.
 *
 * The design editor (src/App.tsx) is rendered UNTOUCHED on #/files/:fileId.
 * A floating "back to dashboard" affordance is overlaid by this wrapper so
 * no shared toolbar file needs editing (see INTEGRATION.md).
 */
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import EditorApp from '../App';
import { link, useHashRoute } from './router';
import { ProductProvider, useProduct } from './store';
import { Shell, Toasts } from './components';
import {
  DashboardPage,
  FavoritesPage,
  NotFoundPage,
  ProjectDetailPage,
  ProjectsPage,
  RecentsPage,
  SearchPage,
  SharedPage,
  TrashPage,
} from './pages';
import { ProfilePage, SettingsPage, WorkspacePage } from './account';

const TITLES: Record<string, string> = {
  dashboard: 'Home — Undesign',
  recents: 'Recents — Undesign',
  shared: 'Shared — Undesign',
  favorites: 'Favorites — Undesign',
  trash: 'Trash — Undesign',
  projects: 'Projects — Undesign',
  project: 'Project — Undesign',
  workspace: 'Team — Undesign',
  profile: 'Profile — Undesign',
  settings: 'Settings — Undesign',
  search: 'Search — Undesign',
  editor: 'Editor — Undesign',
  'not-found': 'Not found — Undesign',
};

function Routed() {
  const route = useHashRoute();

  useEffect(() => {
    document.title = TITLES[route.name] ?? 'Undesign — Visual Design Editor';
  }, [route.name]);

  if (route.name === 'editor') return <EditorRoute fileId={route.fileId} />;

  return (
    <Shell route={route}>
      {route.name === 'dashboard' && <DashboardPage />}
      {route.name === 'recents' && <RecentsPage />}
      {route.name === 'shared' && <SharedPage />}
      {route.name === 'favorites' && <FavoritesPage />}
      {route.name === 'trash' && <TrashPage />}
      {route.name === 'projects' && <ProjectsPage />}
      {route.name === 'project' && <ProjectDetailPage projectId={route.projectId} folderId={route.folderId} />}
      {route.name === 'workspace' && <WorkspacePage />}
      {route.name === 'profile' && <ProfilePage />}
      {route.name === 'settings' && <SettingsPage />}
      {route.name === 'search' && <SearchPage query={route.query} />}
      {route.name === 'not-found' && <NotFoundPage path={route.path} />}
    </Shell>
  );
}

function EditorRoute({ fileId }: { fileId: string }) {
  const { state } = useProduct();
  const file = state.files.find((f) => f.id === fileId);
  return (
    <div className="p-editor-route">
      <a href={link({ name: 'dashboard' })} className="p-back-dash" aria-label="Back to dashboard">
        <ArrowLeft size={15} />
        <span>{file ? file.name : 'Dashboard'}</span>
      </a>
      <EditorApp />
    </div>
  );
}

export default function ProductApp() {
  return (
    <ProductProvider>
      <Routed />
      <Toasts />
    </ProductProvider>
  );
}
