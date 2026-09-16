#!/usr/bin/env bash
# Vendors Claw3D office GLBs (MIT) into public/office-assets.
# https://github.com/iamlukethedev/Claw3D
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/office-assets/models/furniture"
BG="$ROOT/public/office-assets/backgrounds"
BASE="https://raw.githubusercontent.com/iamlukethedev/Claw3D/main/public/office-assets/models/furniture"
mkdir -p "$DEST" "$BG"
files=(
  bookcaseClosed.glb
  chairDesk.glb
  chairModernCushion.glb
  computerScreen.glb
  desk.glb
  deskCorner.glb
  kitchenCabinet.glb
  kitchenCoffeeMachine.glb
  kitchenFridgeSmall.glb
  lampRoundFloor.glb
  loungeDesignChair.glb
  loungeSofa.glb
  plantSmall1.glb
  pottedPlant.glb
  table.glb
  tableCoffee.glb
  tableRound.glb
)
for f in "${files[@]}"; do
  echo "fetch $f"
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
done
curl -fsSL "https://raw.githubusercontent.com/iamlukethedev/Claw3D/main/public/office-assets/backgrounds/office-bg.png" \
  -o "$BG/office-bg.png"
echo "done -> $DEST"
