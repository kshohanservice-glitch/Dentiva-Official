import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart] = raw.split('?');
  const path = pathPart.replace(/^\/+|\/+$/g, '');
  return {
    path,
    segments: path ? path.split('/') : [],
    query: new URLSearchParams(queryPart ?? ''),
  };
}

export function useRoute(): Route & { navigate: (to: string, options?: { replace?: boolean }) => void } {
  const [hash, setHash] = useState(() => window.location.hash || '#/dashboard');

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.hash = '#/dashboard';
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = useMemo(() => parse(hash), [hash]);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = to.startsWith('#') ? to : `#/${to.replace(/^\/+/, '')}`;
    if (options?.replace) window.history.replaceState(null, '', target);
    else window.location.hash = target;
    if (options?.replace) setHash(target);
    const content = document.getElementById('main-content');
    if (content) content.scrollTop = 0;
  }, []);

  return { ...route, navigate };
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function NotFound({ path }: { path: string }): JSX.Element {
  return (
    <div className="state" role="alert">
      <div className="state-icon">404</div>
      <div className="state-title">This screen does not exist</div>
      <div className="state-text">
        <span className="mono">/{path}</span> is not part of Dentiva Pro. Use the sidebar or press Ctrl+K to search.
      </div>
      <div className="state-actions">
        <a className="btn btn--primary" href="#/dashboard">Go to Dashboard</a>
      </div>
    </div>
  );
}
