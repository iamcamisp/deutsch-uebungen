#!/usr/bin/env python3
"""Generate Deutsch Übungen from Cami's class doc.

Workflow:
  1. Download the class doc as text via Google Drive API
  2. Extract the most recent N classes (default: last 6 weeks)
  3. Identify grammar topics & vocabulary covered
  4. Use Claude API to generate fresh, holistic exercises per topic
  5. Write exercises.json (merged with existing if --merge)

Run:
    python3 generate_exercises.py            # full regenerate
    python3 generate_exercises.py --merge    # add new, keep existing IDs
    python3 generate_exercises.py --weeks 12 # consider last 12 weeks
"""

import json, os, re, sys, argparse, subprocess, urllib.request, urllib.parse
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
EXERCISES_PATH = ROOT / 'exercises.json'
THEORY_PATH = ROOT / 'theory.json'

DOC_ID = '1JubdmZ0B7WzVfXLLv8onLDuIedAyq3pL2losV9-vmbw'
ACCOUNT = 'almeidap.camila@gmail.com'
CLIENT = 'radiant'

ANTH_OAUTH_CREDS = Path.home() / '.claude' / '.credentials.json'
GOG_CONFIG_DIR = Path.home() / 'Library' / 'Application Support' / 'gogcli'

MODEL = 'claude-opus-4-7'  # newest Opus for content generation

# ────────────────────────────────────────────────────────────────
# Doc fetch
# ────────────────────────────────────────────────────────────────
def get_google_access_token():
    """Mint a Drive access token using the gog refresh token."""
    creds_path = GOG_CONFIG_DIR / 'credentials-radiant.json'
    with open(creds_path) as f:
        creds = json.load(f)
    # Export refresh token
    tok_path = '/tmp/gog_token_radiant.json'
    subprocess.run(['gog', 'auth', 'tokens', 'export', ACCOUNT,
                    '--client', CLIENT, '--out', tok_path, '--overwrite'],
                   check=True, capture_output=True)
    with open(tok_path) as f:
        tok = json.load(f)
    data = urllib.parse.urlencode({
        'client_id': creds['client_id'],
        'client_secret': creds['client_secret'],
        'refresh_token': tok['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode()
    resp = json.loads(urllib.request.urlopen(urllib.request.Request(
        'https://oauth2.googleapis.com/token', data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'})).read())
    os.unlink(tok_path)
    return resp['access_token']


def download_doc_text(access_token):
    url = (f'https://www.googleapis.com/drive/v3/files/{DOC_ID}'
           f'/export?mimeType=text%2Fplain')
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {access_token}'})
    return urllib.request.urlopen(req, timeout=120).read().decode('utf-8', errors='replace')


# ────────────────────────────────────────────────────────────────
# Extract recent classes
# ────────────────────────────────────────────────────────────────
DATE_HEADER_RE = re.compile(
    r'^(?:\(\d+\)\s+)?(?:Donnerstag|Dienstag|Montag|Mittwoch|Freitag|Samstag|Sonntag)\s+'
    r'(\d{2})\.(\d{2})\.(\d{4})\s+um\s+\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}\s*Uhr',
    re.IGNORECASE
)

def split_into_classes(text):
    """Split doc into class entries indexed by date."""
    lines = text.splitlines()
    classes = []
    current = None
    for line in lines:
        m = DATE_HEADER_RE.match(line.strip())
        if m:
            if current:
                classes.append(current)
            d, mo, y = m.groups()
            current = {'date': date(int(y), int(mo), int(d)), 'lines': []}
        elif current:
            current['lines'].append(line)
    if current:
        classes.append(current)
    return classes


def recent_classes(classes, weeks=6):
    cutoff = date.today() - timedelta(weeks=weeks)
    return [c for c in classes if c['date'] >= cutoff]


def compact_class(c):
    """Trim a class entry to a compact text for the LLM."""
    txt = '\n'.join(c['lines'])
    # Strip Zoom links + zero-width chars
    txt = re.sub(r'https?://\S*zoom\S*', '', txt)
    txt = re.sub(r'[​-‏]+', '', txt)
    # Collapse whitespace
    txt = re.sub(r'\n{3,}', '\n\n', txt).strip()
    return txt


# ────────────────────────────────────────────────────────────────
# Claude API call
# ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a German language teacher creating BOTH theory pages AND exercises for a C1 student preparing for advanced exams (Goethe C1 / TestDaF).

Your job: read excerpts from her recent group German classes, identify the GRAMMAR TOPICS and VOCABULARY SETS that came up, and generate two parallel artifacts:

1. **THEORY** (theory.json) — structured explanation pages, one per coherent theme
2. **EXERCISES** (exercises.json) — practice exercises grouped by the same themes

Both are grouped BY `theme` (same 3-7 word label) so the app can cross-link.

OUTPUT FORMAT — return ONE JSON object with two top-level keys: "theory" and "exercises", each holding {topics, lessons|exercises}.

═════════════════════════════════════════════════════════
THEORY schema — each lesson:
{
  id, topic, theme, title,
  intro: "1 paragraph, HTML allowed, set the context",
  body: [
    {type:"heading", text},
    {type:"paragraph", text},
    {type:"table", headers:[...], rows:[[...],[...]]},
    {type:"examples", items:[strings (German sentences)]},
    {type:"callout", kind:"tip"|"warning"|"info", title, text},
    {type:"list", items:[strings]}
  ],
  exercise_theme: "<exact theme label matching the exercises lesson>"
}

Theory rules:
- Each theory lesson is a self-contained reference page on ONE coherent theme.
- Cover the topic comprehensively: definition, table of all items (e.g. all Konnektoren in the set), 3+ subsections (Verwendung, Regel, Stolperfallen).
- Tables are the most valuable format — use them for declension paradigms, item lists with meaning + example, conjugation patterns.
- Callouts: `tip` for stylistic advice, `warning` for common mistakes, `info` for register/cross-reference.
- Examples blocks for sample sentences (use <em> for the target structure).
- Write in C1-level German with embedded English glosses only when crucial.

═════════════════════════════════════════════════════════
EXERCISE schema — exercise types:

1. mcq:          {id, topic, type:"mcq", prompt, sentence_pre, blank:true, sentence_post, options:[4], correct_index, explanation, theme}
2. transform:    {id, topic, type:"transform", prompt, source, answer, accepted_alternatives:[], hint, theme}
3. wortstellung: {id, topic, type:"wortstellung", prompt, context, prefix:"", words:[shuffled], answer:[ordered], theme}
4. lueckentext:  {id, topic, type:"lueckentext", prompt, context?, segments:[{text}|{blank:true,answer}], theme}
5. vocab:        {id, topic:"wortschatz", type:"vocab", word, pos, morphology, definition (HTML <em>), examples:[2-3], theme}
6. writing:      {id, topic, type:"writing", prompt, task (HTML), min_words, max_words, theme}

Exercise rules:
- Match theme labels to theory lessons exactly so they cross-link.
- 8-15 exercises per theme: targeted single-item → contrastive → applied (with 1 writing).
- For a set of N items (Konnektoren, cases, verbs): produce at least 1 targeted exercise PER item.
- Original C1-level sentences (news, professional, cultural). Never verbatim from class notes.
- All German labels/explanations/hints. Kebab-case IDs.

═════════════════════════════════════════════════════════
Topic slugs (extend as needed): konjunktionen, konjunktiv1, konjunktiv2, praepositionen, wortschatz, wortstellung, adjektivendungen, modalverben, passiv, nominalstil, partizipien, relativsaetze, konditionalsaetze, n-deklination, verbvalenz.

═════════════════════════════════════════════════════════
MERGE INSTRUCTION: I will give you EXISTING_THEMES (a list of theme labels already covered in the database). For new content from the class notes:
- If a new sub-topic fits an existing theme → mark it as `extend: "<existing-theme-label>"` at the lesson/exercise level so I can merge it into that page.
- If it requires a new dedicated theme → create a new lesson with a new theme label.

Return ONLY valid JSON. No markdown fences, no prose, no commentary."""


def call_claude(user_content):
    """Call Anthropic API using Claude Code OAuth token (no API key needed)."""
    with open(ANTH_OAUTH_CREDS) as f:
        c = json.load(f)
    oauth = c['claudeAiOauth']
    token = oauth['accessToken']

    body = {
        'model': MODEL,
        'max_tokens': 16000,
        'system': SYSTEM_PROMPT,
        'messages': [{'role': 'user', 'content': user_content}]
    }
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps(body).encode(),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'oauth-2025-04-20',
        },
        method='POST',
    )
    try:
        resp = json.loads(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as e:
        sys.stderr.write(f'Claude API error: {e.code}\n{e.read().decode()}\n')
        raise
    text = ''.join(b.get('text', '') for b in resp.get('content', []) if b.get('type') == 'text')
    return text


def parse_json_from_response(text):
    """Strip markdown fences if any, parse JSON."""
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```\s*$', '', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        sys.stderr.write(f'JSON parse error: {e}\n--- response ---\n{text[:2000]}\n')
        raise


# ────────────────────────────────────────────────────────────────
# Merge + write
# ────────────────────────────────────────────────────────────────
def merge_exercises(existing, fresh):
    if not existing: return fresh
    eids = {e['id'] for e in existing.get('exercises', [])}
    out = dict(existing)
    out['exercises'] = existing.get('exercises', []) + [
        e for e in fresh.get('exercises', []) if e['id'] not in eids
    ]
    tslugs = {t['slug'] for t in existing.get('topics', [])}
    out['topics'] = existing.get('topics', []) + [
        t for t in fresh.get('topics', []) if t['slug'] not in tslugs
    ]
    return out


def merge_theory(existing, fresh):
    """Merge theory lessons. For each new lesson:
       - if its `extend` field matches an existing theme, append its body blocks
       - else add as a new lesson.
    """
    if not existing: return fresh
    out = dict(existing)
    out.setdefault('lessons', list(existing.get('lessons', [])))
    out.setdefault('topics', list(existing.get('topics', [])))

    existing_by_theme = {l['theme']: l for l in out['lessons']}
    existing_ids = {l['id'] for l in out['lessons']}

    for nl in fresh.get('lessons', []):
        extend = nl.get('extend')
        if extend and extend in existing_by_theme:
            target = existing_by_theme[extend]
            target.setdefault('body', []).extend(nl.get('body', []))
            # If extend block also adds intro/title, ignore (keep existing)
        elif nl.get('id') not in existing_ids:
            nl.pop('extend', None)
            out['lessons'].append(nl)
            existing_by_theme[nl['theme']] = nl
            existing_ids.add(nl['id'])

    tslugs = {t['slug'] for t in out['topics']}
    out['topics'].extend([t for t in fresh.get('topics', []) if t['slug'] not in tslugs])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--merge', action='store_true', help='Merge with existing JSON files')
    ap.add_argument('--weeks', type=int, default=6, help='Look at the last N weeks of classes')
    ap.add_argument('--dry-run', action='store_true', help='Print sample input, do not write')
    args = ap.parse_args()

    print(f'[1/5] Fetching class doc (weeks={args.weeks})…')
    tok = get_google_access_token()
    text = download_doc_text(tok)
    classes = split_into_classes(text)
    recent = recent_classes(classes, weeks=args.weeks)
    print(f'   {len(classes)} total classes, {len(recent)} in the last {args.weeks} weeks')

    if not recent:
        sys.stderr.write('No recent classes found.\n'); sys.exit(1)

    excerpts = '\n\n'.join(
        f"### Klasse {c['date'].isoformat()}\n{compact_class(c)}" for c in recent
    )
    if len(excerpts) > 45_000:
        excerpts = excerpts[:45_000] + '\n…[gekürzt]'

    # Existing themes
    existing_ex = None
    existing_th = None
    existing_themes = set()
    if args.merge:
        if EXERCISES_PATH.exists():
            existing_ex = json.load(open(EXERCISES_PATH))
            existing_themes.update(e.get('theme') for e in existing_ex.get('exercises', []) if e.get('theme'))
        if THEORY_PATH.exists():
            existing_th = json.load(open(THEORY_PATH))
            existing_themes.update(l.get('theme') for l in existing_th.get('lessons', []) if l.get('theme'))

    existing_themes_str = '\n'.join(f'- "{t}"' for t in sorted(existing_themes)) or '(none yet)'

    user_msg = (
        f"Generate fresh C1-level THEORY pages and EXERCISES based on the grammar topics, "
        f"vocabulary sets, and themes from these recent German class notes. Coverage must be EXHAUSTIVE per topic set.\n\n"
        f"EXISTING_THEMES (use `extend: \"<theme>\"` if your new content fits one of these; otherwise create a new theme):\n"
        f"{existing_themes_str}\n\n"
        f"--- CLASS NOTES ---\n\n{excerpts}"
    )

    if args.dry_run:
        print('[2/5] DRY RUN — would send to Claude:')
        print(user_msg[:2500])
        print('…')
        return

    print('[2/5] Calling Claude…')
    raw = call_claude(user_msg)
    print(f'   got {len(raw)} chars')

    print('[3/5] Parsing JSON…')
    parsed = parse_json_from_response(raw)
    fresh_ex = parsed.get('exercises', {})
    fresh_th = parsed.get('theory', {})

    for d in (fresh_ex, fresh_th):
        if not d: continue
        d.setdefault('owner', 'Cami')
        d.setdefault('level', 'C1')
        d.setdefault('source_doc', DOC_ID)
        d['generated_at'] = date.today().isoformat()
    if fresh_ex:
        fresh_ex.setdefault('whatsapp_target', '4916093175902')

    print(f'   theory: {len(fresh_th.get("lessons", []))} lessons')
    print(f'   exercises: {len(fresh_ex.get("exercises", []))} items')

    print('[4/5] Merging…')
    out_ex = merge_exercises(existing_ex, fresh_ex) if existing_ex else fresh_ex
    out_th = merge_theory(existing_th, fresh_th) if existing_th else fresh_th

    print(f'[5/5] Writing files…')
    if out_ex:
        with open(EXERCISES_PATH, 'w') as f:
            json.dump(out_ex, f, indent=2, ensure_ascii=False)
        print(f'   {EXERCISES_PATH.name}: {len(out_ex.get("exercises", []))} total')
    if out_th:
        with open(THEORY_PATH, 'w') as f:
            json.dump(out_th, f, indent=2, ensure_ascii=False)
        print(f'   {THEORY_PATH.name}: {len(out_th.get("lessons", []))} lessons')
    print('   done.')


if __name__ == '__main__':
    main()
