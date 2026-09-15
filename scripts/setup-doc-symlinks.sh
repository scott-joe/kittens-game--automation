#!/usr/bin/env bash
# Create documentation symlinks from a manifest.
#
# Canonical docs live in docs/. Agent-facing directories hold symlinks into
# them, so one file can serve several organizational views without duplication.
#
# Usage: setup-doc-symlinks.sh [manifest]
#   manifest  TSV of "<canonical-path>\t<link-path>", both repo-relative.
#             Default: docs/symlinks.tsv
#
# Blank lines and lines beginning with # are ignored.

set -euo pipefail

# Resolve from the invoking repo, not the script location: this script is often
# run from a plugin asset directory outside the target repo.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MANIFEST="${1:-$REPO_ROOT/docs/symlinks.tsv}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

cd "$REPO_ROOT"

if [[ ! -f "$MANIFEST" ]]; then
  log_error "Manifest not found: $MANIFEST"
  log_info  "Create one with lines of the form: docs/architecture/foo.md<TAB>agents/rules/foo.md"
  exit 1
fi

# Portable relative path: GNU realpath supports --relative-to, BSD/macOS does not.
relpath() {
  local target="$1" base="$2"
  realpath --relative-to="$base" "$target" 2>/dev/null \
    || python3 -c 'import os.path,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$target" "$base"
}

create_symlink() {
  local target="$1" link="$2"
  local link_dir; link_dir="$(dirname "$link")"

  if [[ ! -f "$target" ]]; then
    log_error "Canonical doc missing: $target"
    return 1
  fi

  mkdir -p "$link_dir"

  if [[ -L "$link" ]]; then
    rm "$link"
  elif [[ -e "$link" ]]; then
    # Never clobber a real file; preserve it so the author can recover content.
    log_warning "Real file at link location, backing up: $link -> ${link}.backup"
    mv "$link" "${link}.backup"
  fi

  ln -s "$(relpath "$target" "$link_dir")" "$link"
  log_success "$link -> $(readlink "$link")"
}

FAILED=0
CREATED=0
while IFS=$'\t' read -r target link _rest || [[ -n "${target:-}" ]]; do
  [[ -z "${target// }" ]] && continue
  [[ "$target" == \#* ]] && continue
  if [[ -z "${link:-}" ]]; then
    log_error "Malformed manifest line (expected TAB-separated pair): $target"
    FAILED=$((FAILED + 1)); continue
  fi
  if create_symlink "$target" "$link"; then
    CREATED=$((CREATED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done < "$MANIFEST"

echo ""
log_info "$CREATED symlink(s) in place from $(basename "$MANIFEST")"
if (( FAILED > 0 )); then
  log_error "$FAILED entr(ies) failed"
  exit 1
fi
