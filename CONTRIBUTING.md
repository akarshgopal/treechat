# Contributing

Thanks for helping. Bug reports and ideas go in [issues](https://github.com/akarshgopal/treechat/issues); for a security problem, see [SECURITY.md](SECURITY.md) instead.

## Setup

```bash
pnpm install
pnpm dev                                # http://localhost:5173, demo replies without a key
pnpm exec playwright install chromium   # once, for the e2e suite
```

## Before you open a pull request

Nothing runs these checks for you (deploys only build), so run all three:

```bash
pnpm lint          # one standing warning is expected
pnpm test          # unit tests
pnpm test:e2e      # Playwright, desktop and phone Chromium
```

- Read [docs/decisions.md](docs/decisions.md) first. It records what was decided and why (the UI stays minimal; old saved chats must keep loading), and the checks to do by hand before a release.
- Tests never use real keys or contact real providers: fake endpoints with `page.route` or rely on the demo stream.
- A fix comes with the test that would have caught it; a new flow comes with an e2e test.
- Keep a pull request to one change, and say what you checked in the browser.

By contributing you agree that your work is released under the [MIT License](LICENSE).
