import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Asset roots are shared by the Core static route and the desktop presence
 * resolver. The data directory is the authoritative root for imported assets;
 * private assets are a local-only developer/owner fallback so the persona's
 * Live2D model can be used before it is imported into the database.
 */
export function resolveAssetRoots(dataDir: string): string[] {
  const roots = [
    process.env.HEREIN_ASSETS_DIR,
    path.join(dataDir, 'assets'),
    path.join(process.cwd(), 'private', 'assets'),
  ].filter((root): root is string => Boolean(root && root.trim()));

  const seen = new Set<string>();

  return roots.filter(root => {
    const resolved = path.resolve(root);

    if (seen.has(resolved)) {
      return false;
    }

    seen.add(resolved);
    return true;
  });
}

export function findExistingAsset(
  roots: readonly string[],
  candidates: readonly string[],
): { root: string; absolutePath: string; relativePath: string } | null {
  for (const root of roots) {
    const rootResolved = path.resolve(root);

    for (const candidate of candidates) {
      const normalized = candidate.replace(/\\/g, '/').replace(/^\/+/, '');

      if (!normalized || normalized.split('/').includes('..')) {
        continue;
      }

      const absolutePath = path.resolve(rootResolved, normalized);

      if (absolutePath !== rootResolved && !absolutePath.startsWith(`${rootResolved}${path.sep}`)) {
        continue;
      }

      try {
        if (!statSync(absolutePath).isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      return {
        root: rootResolved,
        absolutePath,
        relativePath: path.relative(rootResolved, absolutePath).split(path.sep).join('/'),
      };
    }
  }

  return null;
}

export function assetUrl(coreUrl: string | null, relativePath: string) {
  if (!coreUrl) {
    return null;
  }

  const normalized = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^assets\//, '');
  const encoded = normalized
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `${coreUrl.replace(/\/+$/, '')}/assets/${encoded}`;
}

export function fileExists(filePath: string) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
