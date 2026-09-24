export const REPO_URL = 'https://github.com/akarshgopal/treechat'
export const ISSUES_URL = `${REPO_URL}/issues`

/**
 * A new-issue link, optionally prefilled with what went wrong. Nothing is
 * sent until the person reviews it and submits on GitHub.
 */
export function newIssueUrl(details?: { title: string; body: string }): string {
  const url = new URL(`${ISSUES_URL}/new`)
  if (details) {
    url.searchParams.set('title', details.title)
    // Keep the URL well under GitHub's length limit.
    url.searchParams.set('body', details.body.slice(0, 4_000))
  }
  return url.toString()
}
