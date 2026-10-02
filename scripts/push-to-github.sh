#!/bin/bash
# Eén keer inloggen in de browser, daarna altijd: git push.
set -e
cd "$(dirname "$0")/.."
REPO="https://github.com/b22439140-byte/Pokemon-site.git"

clear
echo ""
echo "  PokeVault → GitHub"
echo "  ───────────────────"
echo ""

git remote set-url origin "$REPO"

install_gh() {
  if command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if ! command -v brew >/dev/null 2>&1; then
    echo "  Installeer eerst Homebrew of GitHub CLI:"
    echo "  https://brew.sh  of  https://cli.github.com"
    open "https://cli.github.com" 2>/dev/null || true
    return 1
  fi
  echo "  GitHub CLI installeren (eenmalig, ±1 minuut)…"
  brew install gh
}

if ! gh auth status >/dev/null 2>&1; then
  install_gh || exit 1
  echo ""
  echo "  Er opent zo je browser — log in bij GitHub en keur goed."
  echo "  (Eenmalig; daarna is uploaden automatisch.)"
  echo ""
  gh auth login -h github.com -p https -w -s repo
  gh auth setup-git
  echo ""
fi

echo "  Uploaden…"
if git push -u origin main; then
  echo ""
  echo "  ✓ Klaar! Je code staat op GitHub."
  echo "  $REPO"
else
  echo ""
  echo "  Upload mislukt. Kopieer de foutmelding hierboven en stuur die door."
  exit 1
fi
echo ""
