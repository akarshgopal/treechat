/**
 * The site is served at the root of treechat.cc, and `pnpm dev` / `pnpm
 * preview` at the root too. `VITE_BASE` (e.g. `/sub/`) builds for a subpath.
 */
export function resolveViteBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.VITE_BASE?.trim()
  if (!override) return '/'
  return override.endsWith('/') ? override : `${override}/`
}
