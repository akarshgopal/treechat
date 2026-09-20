/**
 * GitHub Pages project site lives at /treechat/ (akarshgopal.github.io/treechat/).
 * Local `pnpm dev` / `pnpm preview` keep base `/`.
 *
 * Resolution:
 * 1. `VITE_BASE` (e.g. `/` or `/treechat/`)
 * 2. `GITHUB_REPOSITORY` (`owner/treechat` → `/treechat/`) — set in Actions
 * 3. `/`
 */
export function resolveViteBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.VITE_BASE?.trim()
  if (override) return override.endsWith('/') ? override : `${override}/`
  const repo = env.GITHUB_REPOSITORY?.trim()
  if (repo) {
    const name = repo.split('/')[1]?.trim()
    if (name) return `/${name}/`
  }
  return '/'
}
