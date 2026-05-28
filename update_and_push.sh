#!/bin/bash
# Regenerate exercises.json from latest class content + commit + push.
# Run on demand or via cron.

set -e
cd "$(dirname "$0")"

echo "── Regenerating exercises from class doc ──"
python3 generate_exercises.py --merge --weeks 6

if ! git diff --quiet exercises.json theory.json; then
  EX=$(python3 -c "import json; print(len(json.load(open('exercises.json'))['exercises']))")
  TH=$(python3 -c "import json; print(len(json.load(open('theory.json')).get('lessons', [])))" 2>/dev/null || echo "0")
  git add exercises.json theory.json
  git commit -m "refresh from class notes: $EX exercises, $TH theory lessons"
  git push
  echo "✓ Updated and pushed ($EX exercises, $TH theory lessons)."
else
  echo "No new content — files unchanged."
fi
