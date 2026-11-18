<p align="center">
  <img src="build/vibeyard-black.png" alt="Vibeyard" width="128" />
</p>

<h1 align="center">Vibeyard</h1>

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard/releases"><img src="https://img.shields.io/github/v/release/elirantutia/vibeyard" alt="GitHub Release" /></a>
  <a href="https://github.com/elirantutia/vibeyard/blob/main/LICENSE"><img src="https://img.shields.io/github/license/elirantutia/vibeyard" alt="License" /></a>
  <a href="https://github.com/elirantutia/vibeyard/issues"><img src="https://img.shields.io/github/issues/elirantutia/vibeyard" alt="Issues" /></a>
  <a href="https://github.com/elirantutia/vibeyard/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
  <a href="https://star-history.com/#elirantutia/vibeyard&Date"><img src="https://img.shields.io/github/stars/elirantutia/vibeyard?style=social" alt="GitHub Stars" /></a>
  <a href="https://x.com/EliranTutia"><img src="https://img.shields.io/badge/Follow-%40EliranTutia-black?logo=x" alt="Follow on X" /></a>
</p>

<p align="center">
  <strong>The IDE built for AI coding agents.</strong><br/>
  Manage multiple agent sessions, run them in parallel, track costs, and never lose context — with Claude Code, Codex CLI, and Gemini CLI.
</p>

---

<p align="center">
  <img src="assets/vibyard_720.gif" alt="Vibeyard Demo" width="800" />
</p>

<p align="center">
  <img src="assets/web-ui-short.gif" alt="Vibeyard UI Edit Demo" width="800" />
</p>

<p align="center">
  <img src="assets/kanban.gif" alt="Vibeyard Kanban Board Demo" width="800" />
</p>

## Why Vibeyard?

Running AI coding agents in a bare terminal gets messy fast. Vibeyard gives you a lean workspace — multi-session management, split panes, cost tracking, and session resume — that opens instantly, so you can focus on building, not juggling terminals.

## Highlights

- **Multi-session management** — run multiple agent sessions per project, each in its own PTY; split the view side by side and spin up new sessions with `Cmd+\`
- **Multiple Claude profiles** — run separate Claude Code logins side by side (e.g. work and personal licenses), each session backed by its own isolated config directory so credentials, settings, and history never mix; pick a profile per session or set a per-project / global default
- **Cost & context tracking** — real-time spend, token usage, and context window monitoring per session
- **Session inspector** — real-time session telemetry with timeline, cost breakdown, tool usage stats, and context window monitoring (`Cmd+Shift+I`)
- **Session resume** — pick up where you left off, even after restarting the app
- **Light and dark themes** — switch the app appearance from Preferences, including live re-theming of open terminals
- **Smart alerts** — detects missing tools, context bloat, and session health issues
- **Session status indicators** — color-coded dots on each tab show real-time session state (working, waiting, input needed, completed), with optional desktop notifications
- **Keyboard-driven** — full shortcut support, built for speed

> Supports Claude Code, OpenAI Codex CLI, and Gemini CLI. More AI CLI providers coming soon.

## Install

Requires at least one supported CLI installed and authenticated: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli).

### macOS

Download the latest `.dmg` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases), drag to Applications, and launch. Signed and notarized by Apple.

### Linux

Download the latest `.deb` (Debian/Ubuntu) or `.AppImage` (universal) from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases).

```bash
# Debian/Ubuntu
sudo dpkg -i vibeyard_*.deb

# AppImage
chmod +x Vibeyard-*.AppImage
./Vibeyard-*.AppImage
```

### Windows

Download the latest Setup `.exe` (NSIS installer) or portable `.exe` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases). Run the installer and launch Vibeyard from the Start menu, or run the portable build directly.

### npm (macOS, Linux & Windows)

```bash
npm i -g vibeyard
vibeyard
```

On first run, the app is automatically downloaded and launched. No extra steps needed.

### Build from Source

```bash
git clone https://github.com/elirantutia/vibeyard.git
cd vibeyard
npm install && npm start
```

Requires Node v24+ (see `.nvmrc`).

## Contributing

PRs welcome! See the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard"><img src="https://img.shields.io/badge/Star%20Vibeyard%20on%20GitHub-%E2%AD%90-yellow?style=for-the-badge&logo=github" alt="Star on GitHub" /></a>
</p>

<p align="center">
  If Vibeyard helps your workflow, a star helps us grow. Thanks for the support!
</p>

<p align="center">
  <sub>Vibeyard is an independent project and is not affiliated with or endorsed by Anthropic.</sub>
</p>
