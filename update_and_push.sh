#!/bin/bash
# Regenerate exercises.json from latest class content + commit + push.
# Run on demand or via cron.

set -e
cd "$(dirname "$0")"

echo "── Regenerating exercises from class doc ──"
python3 generate_exercises.py --merge --weeks 6

if ! git diff --quiet exercises.json; then
  COUNT=$(python3 -c "import json; print(len(json.load(open('exercises.json'))['exercises']))")
  git add exercises.json
  git commit -m "exercises: refresh from class notes ($COUNT total)"
  git push
  echo "✓ Updated and pushed ($COUNT exercises)."
else
  echo "No new exercises — exercises.json unchanged."
fi
