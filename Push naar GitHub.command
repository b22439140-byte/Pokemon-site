#!/bin/bash
cd "$(dirname "$0")"
bash ./scripts/push-to-github.sh
echo ""
read -n 1 -s -r -p "  Druk een toets om te sluiten… "
echo ""
