import path from 'node:path';

export function resolveSqlitePath(databaseUrl: string): string {
  const trimmed = databaseUrl.trim();
  if (trimmed === ':memory:' || trimmed === 'file::memory:' || trimmed === 'file://:memory:') {
    return ':memory:';
  }
  let pathname = trimmed;
  if (pathname.startsWith('file:')) {
    pathname = pathname.slice('file:'.length);
    if (pathname.startsWith('//')) {
      const slash = pathname.indexOf('/', 2);
      pathname = slash === -1 ? '' : pathname.slice(slash);
    }
  }
  if (/^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1);
  }
  if (!path.isAbsolute(pathname)) {
    pathname = path.resolve(pathname);
  }
  return pathname;
}
