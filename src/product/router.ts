/* Minimal hash router for the product shell.
 *
 * Decision: no routing dependency. Hash routes (#/projects/…) work with any
 * static host (vite preview included) without SPA-fallback rewrites, survive
 * refresh, and keep browser back/forward working. When a backend exists this
 * can be swapped for path routing behind the same `navigate()` API.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'recents' }
  | { name: 'shared' }
  | { name: 'favorites' }
  | { name: 'trash' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string; folderId: string | null }
  | { name: 'editor'; fileId: string }
  | { name: 'workspace' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'search'; query: string }
  | { name: 'not-found'; path: string };

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart ?? '');

  if (segs.length === 0) return { name: 'dashboard' };
  const [head, ...rest] = segs;
  switch (head) {
    case 'recents':
      return { name: 'recents' };
    case 'shared':
      return { name: 'shared' };
    case 'favorites':
      return { name: 'favorites' };
    case 'trash':
      return { name: 'trash' };
    case 'projects':
      if (rest.length === 0) return { name: 'projects' };
      if (rest.length === 1) return { name: 'project', projectId: rest[0], folderId: query.get('folder') };
      break;
    case 'files':
      if (rest.length === 1) return { name: 'editor', fileId: rest[0] };
      break;
    case 'workspace':
      return { name: 'workspace' };
    case 'profile':
      return { name: 'profile' };
    case 'settings':
      return { name: 'settings' };
    case 'search':
      return { name: 'search', query: query.get('q') ?? '' };
    default:
      break;
  }
  return { name: 'not-found', path: raw || '/' };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'recents':
      return '#/recents';
    case 'shared':
      return '#/shared';
    case 'favorites':
      return '#/favorites';
    case 'trash':
      return '#/trash';
    case 'projects':
      return '#/projects';
    case 'project':
      return `#/projects/${route.projectId}${route.folderId ? `?folder=${route.folderId}` : ''}`;
    case 'editor':
      return `#/files/${route.fileId}`;
    case 'workspace':
      return '#/workspace';
    case 'profile':
      return '#/profile';
    case 'settings':
      return '#/settings';
    case 'search':
      return `#/search?q=${encodeURIComponent(route.query)}`;
    case 'not-found':
      return `#${route.path}`;
  }
}

export function navigate(route: Route, replace = false) {
  const href = routeHref(route);
  if (replace) {
    window.location.replace(href);
    return;
  }
  window.location.hash = href.startsWith('#') ? href.slice(1) : href;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Hash links navigate natively — no interception needed, so back/forward,
// middle-click, and refresh all behave like real links. */
export function link(route: Route): string {
  return routeHref(route);
}
