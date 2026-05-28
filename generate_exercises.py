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
SYSTEM_PROMPT = """You are a German language teacher creating exercises for a C1 student. The student is preparing for advanced exams (Goethe C1 / TestDaF).

Your job: read excerpts from her recent group German classes, identify the GRAMMAR TOPICS and VOCABULARY THEMES that came up, and generate fresh, holistic exercises that cover those topics comprehensively — not just repeat the exact class examples.

Output JSON only — a single object with two keys: "topics" (list) and "exercises" (list). Exercise types and schemas:

1. mcq:        {id, topic, type:"mcq", prompt, sentence_pre, blank:true, sentence_post, options:[4], correct_index, explanation, theme}
2. transform:  {id, topic, type:"transform", prompt, source, answer, accepted_alternatives:[], hint, theme}
3. wortstellung: {id, topic, type:"wortstellung", prompt, context, prefix:"", words:[shuffled], answer:[ordered], theme}
4. lueckentext: {id, topic, type:"lueckentext", prompt, context?, segments:[{text}|{blank:true,answer}], theme}
5. vocab:      {id, topic:"wortschatz", type:"vocab", word, pos, morphology, definition (1-2 sentences with HTML <em> tags), examples:[2-3 strings], theme}
6. writing:    {id, topic, type:"writing", prompt, task (HTML allowed, bold key concepts with <strong>), min_words, max_words, theme}

Topic slugs (you may add new ones): konjunktionen, konjunktiv1, praepositionen, wortschatz, wortstellung, adjektivendungen, modalverben, passiv, nominalstil, partizipien, relativsaetze, konditionalsaetze.

Rules:
- Generate ~6-10 exercises per identified topic. Mix difficulty.
- Sentences must be ORIGINAL, on contemporary German news / professional / everyday themes — not verbatim from the class doc.
- For C1 level: rich vocabulary, complex syntax, journalism/business/cultural topics.
- IDs are kebab-case: {type}-{topic-short}-{number}. Sequential per type.
- explanation/hint fields are in German, learner-friendly, 1-2 sentences.
- For writing exercises: include 1-2 per topic with concrete constraints (e.g., "use ≥3 Konnektoren from this list", "use Konjunktiv I throughout").
- Themes are 3-7 word labels describing the focus.

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
    """Keep existing exercises (by id), add new ones from fresh."""
    if not existing:
        return fresh
    existing_ids = {e['id'] for e in existing.get('exercises', [])}
    merged = existing.copy()
    merged['exercises'] = existing.get('exercises', []) + [
        e for e in fresh.get('exercises', []) if e['id'] not in existing_ids
    ]
    # Topics: union
    topic_slugs = {t['slug'] for t in existing.get('topics', [])}
    merged['topics'] = existing.get('topics', []) + [
        t for t in fresh.get('topics', []) if t['slug'] not in topic_slugs
    ]
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--merge', action='store_true', help='Merge with existing exercises.json')
    ap.add_argument('--weeks', type=int, default=6, help='Look at the last N weeks of classes')
    ap.add_argument('--dry-run', action='store_true', help='Print sample input + LLM response, do not write')
    args = ap.parse_args()

    print(f'[1/4] Fetching class doc (weeks={args.weeks})…')
    tok = get_google_access_token()
    text = download_doc_text(tok)
    classes = split_into_classes(text)
    recent = recent_classes(classes, weeks=args.weeks)
    print(f'   {len(classes)} total classes found, {len(recent)} in the last {args.weeks} weeks')

    if not recent:
        sys.stderr.write('No recent classes found.\n')
        sys.exit(1)

    excerpts = '\n\n'.join(
        f"### Klasse {c['date'].isoformat()}\n{compact_class(c)}"
        for c in recent
    )
    if len(excerpts) > 50_000:
        excerpts = excerpts[:50_000] + '\n…[gekürzt]'

    user_msg = (
        f"Generate fresh C1-level exercises based on the grammar topics, vocabulary, and themes "
        f"that came up in the following German class notes. Cover each identified topic with 6-10 exercises. "
        f"Return JSON only.\n\n--- CLASS NOTES ---\n\n{excerpts}"
    )

    if args.dry_run:
        print('[2/4] DRY RUN — would send to Claude:')
        print(user_msg[:2000])
        print('…')
        return

    print('[2/4] Calling Claude…')
    raw = call_claude(user_msg)
    print(f'   got {len(raw)} chars')

    print('[3/4] Parsing JSON…')
    fresh = parse_json_from_response(raw)
    fresh.setdefault('owner', 'Cami')
    fresh.setdefault('level', 'C1')
    fresh.setdefault('source_doc', DOC_ID)
    fresh.setdefault('whatsapp_target', '4916093175902')
    fresh['generated_at'] = date.today().isoformat()
    print(f'   {len(fresh.get("exercises", []))} exercises across {len(fresh.get("topics", []))} topics')

    existing = None
    if args.merge and EXERCISES_PATH.exists():
        with open(EXERCISES_PATH) as f:
            existing = json.load(f)

    out = merge_exercises(existing, fresh) if existing else fresh
    print(f'[4/4] Writing {EXERCISES_PATH} ({len(out.get("exercises", []))} total exercises)')
    with open(EXERCISES_PATH, 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print('   done.')


if __name__ == '__main__':
    main()
