#!/usr/bin/env bash
# Install PiB platform skills for local agent runtimes.
#
# Hermes is the canonical runtime home. This script delegates to
# install-mac-hermes-skills.sh. Claude Code discovery is optional via
# --claude-compat (symlinks into Hermes — never a second content tree).
#
# Usage:
#   bash partnersinbiz-web/scripts/install-platform-skills.sh
#   bash partnersinbiz-web/scripts/install-platform-skills.sh --claude-compat
#   bash partnersinbiz-web/scripts/install-platform-skills.sh --quarantine-claude
set -euo pipefail

ROOT="/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
exec bash "$ROOT/scripts/install-mac-hermes-skills.sh" "$@"
