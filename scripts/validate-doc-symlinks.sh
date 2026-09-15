#!/usr/bin/env bash
# Validate documentation symlinks: none broken, none circular.
# Safe for CI and pre-commit hooks; exits non-zero on any problem.
#
# Usage: validate-doc-symlinks.sh [link-root ...]
#   link-root  Directory to scan for symlinks (repo-relative or absolute).
#              Defaults to $DOC_LINK_ROOTS (space-separated) or "agents".

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if (( $# > 0 )); then
  ROOTS=("$@")
else
  # shellcheck disable=SC2206  # deliberate word-splitting of a space-separated env var
  ROOTS=(${DOC_LINK_ROOTS:-agents})
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

EXIT_CODE=0
VALID=0
BROKEN=0
CIRCULAR=0

echo "🔍 Validating documentation symlinks in: ${ROOTS[*]}"
echo ""

for root in "${ROOTS[@]}"; do
  if [[ ! -d "$root" ]]; then
    log_warning "No such directory, skipping: $root"
    continue
  fi

  while IFS= read -r -d '' link; do
    if [[ ! -e "$link" ]]; then
      # -L but not -e: the link exists, its target does not.
      log_error "Broken: $link -> $(readlink "$link")"
      BROKEN=$((BROKEN + 1)); EXIT_CODE=1; continue
    fi

    # readlink -f is GNU-only; use a portable resolution to detect cycles.
    if ! resolved="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1], strict=True))' "$link" 2>/dev/null)"; then
      log_error "Circular or unresolvable: $link"
      CIRCULAR=$((CIRCULAR + 1)); EXIT_CODE=1; continue
    fi

    log_success "$link -> $(readlink "$link")"
    VALID=$((VALID + 1))
  done < <(find "$root" -type l -print0)
done

echo ""
echo "📊 Valid: $VALID"
(( BROKEN   > 0 )) && echo "   Broken: $BROKEN"
(( CIRCULAR > 0 )) && echo "   Circular: $CIRCULAR"
echo ""

if (( EXIT_CODE == 0 )); then
  log_success "All documentation symlinks are valid."
else
  log_error "Fix with: ./scripts/setup-doc-symlinks.sh"
fi
exit "$EXIT_CODE"
