#!/bin/sh
# Sprinty: MCP connection + project-local skills. Run from your project.
set -eu

fail() { printf 'Sprinty: %s\n' "$*" >&2; exit 1; }
usage() { printf 'Usage: sh install.sh [--client codex|claude]\nRun from your project. Requires Node.js 20+, npx, Git, and a client CLI.\n'; }
sprinty_install() {
sprinty_client=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --client) [ "$#" -ge 2 ] || fail '--client needs codex or claude'; sprinty_client=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
for sprinty_dependency in node npx git; do
  command -v "$sprinty_dependency" >/dev/null 2>&1 || fail "Install $sprinty_dependency first."
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || fail 'Node.js 20+ is required.'
git rev-parse --show-toplevel >/dev/null 2>&1 || fail 'Run this command inside your project’s Git repository.'
if [ -z "$sprinty_client" ]; then
  sprinty_found=''
  for sprinty_candidate in codex claude; do
    if command -v "$sprinty_candidate" >/dev/null 2>&1; then
      sprinty_found="$sprinty_found $sprinty_candidate"
    fi
  done
  case "$sprinty_found" in
    ' codex') sprinty_client=codex ;;
    ' claude') sprinty_client=claude ;;
    '') fail 'Install the Codex or Claude Code CLI first. Other clients: https://github.com/ebursztein/sprinty#install' ;;
    *)
      printf 'Install for which client? [codex/claude]: ' >&2
      if ! { IFS= read -r sprinty_client < /dev/tty; } 2>/dev/null; then
        fail 'Both clients found. Run with: sh -s -- --client codex (or claude).'
      fi
      ;;
  esac
fi
case "$sprinty_client" in
  codex) sprinty_skill_agent=codex ;;
  claude) sprinty_skill_agent=claude-code ;;
  *) fail 'Choose --client codex or --client claude.' ;;
esac
command -v "$sprinty_client" >/dev/null 2>&1 || fail "Install the $sprinty_client CLI first."
# Use the repository root so a nested invocation does not scatter skill installs.
sprinty_project=$(git rev-parse --show-toplevel)
cd "$sprinty_project"
printf 'Installing Sprinty skills for %s in %s\n' "$sprinty_client" "$sprinty_project"
npx --yes skills add ebursztein/sprinty --skill how-to-run-a-sprint --skill using-sprinty --agent "$sprinty_skill_agent" --yes || fail 'Skills installation failed; MCP configuration was not changed.'
if "$sprinty_client" mcp get sprinty >/dev/null 2>&1; then
  printf 'Keeping your existing Sprinty MCP configuration.\n'
else
  case "$sprinty_client" in
    codex) codex mcp add sprinty -- npx -y sprinty-mcp@latest ;;
    claude) claude mcp add --scope local --transport stdio sprinty -- npx -y sprinty-mcp@latest ;;
  esac
fi
# Verify registration, without claiming a live tool connection before restart.
"$sprinty_client" mcp get sprinty >/dev/null || fail 'MCP registration could not be verified. Skills are installed; check your client configuration.'
printf '\nSprinty configured. Restart your coding client, then ask it to start or resume a sprint.\n'
if [ "$sprinty_client" = claude ]; then
  printf 'Shared Claude subagents also need the Sprinty plugin identity hook: https://github.com/ebursztein/sprinty#claude-code\n'
fi
}

sprinty_install "$@"
