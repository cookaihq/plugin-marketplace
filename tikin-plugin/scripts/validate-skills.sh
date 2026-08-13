#!/usr/bin/env bash
# Structural validator for tikin-plugin.
# Exit 0 = all checks pass. Run before every commit.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

pass=0
fail=0
check() {
  if [ "$1" -eq 0 ]; then
    pass=$((pass + 1)); echo "PASS: $2"
  else
    fail=$((fail + 1)); echo "FAIL: $2"
  fi
}

# 1. Required Claude and Codex manifests exist and are valid JSON.
required_json=(
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  .codex-plugin/plugin.json
  .agents/plugins/marketplace.json
)
for manifest in "${required_json[@]}"; do
  if [ -f "$manifest" ] && python3 -c "import json; json.load(open('$manifest'))" 2>/dev/null; then
    check 0 "$manifest exists and is valid JSON"
  else
    check 1 "$manifest exists and is valid JSON"
  fi
done

# 2. Plugin names and release versions are synchronized across both plugin formats.
python3 - <<'PY' 2>/dev/null
import json
import re

with open('.claude-plugin/plugin.json') as handle:
    claude_plugin = json.load(handle)
with open('.codex-plugin/plugin.json') as handle:
    codex_plugin = json.load(handle)
with open('.claude-plugin/marketplace.json') as handle:
    claude_marketplace = json.load(handle)
with open('.agents/plugins/marketplace.json') as handle:
    codex_marketplace = json.load(handle)

for manifest in (claude_plugin, codex_plugin):
    assert manifest.get('name')
    assert manifest.get('description')
    assert manifest.get('version')

assert codex_plugin.get('skills') == './skills/'
assert isinstance(claude_marketplace.get('plugins'), list) and claude_marketplace['plugins']
assert isinstance(codex_marketplace.get('plugins'), list) and codex_marketplace['plugins']
assert claude_marketplace.get('name') == codex_marketplace.get('name')

plugin_name = claude_plugin['name']
version = claude_plugin['version']
assert plugin_name == codex_plugin['name']
assert version == codex_plugin['version']

with open('CHANGELOG.md') as handle:
    release_heading = re.search(r'^## ([0-9]+\.[0-9]+\.[0-9]+)$', handle.read(), re.MULTILINE)
assert release_heading and version == release_heading.group(1)

for marketplace in (claude_marketplace, codex_marketplace):
    entries = [entry for entry in marketplace['plugins'] if entry.get('name') == plugin_name]
    assert len(entries) == 1
    entry = entries[0]
    if entry.get('version') is not None:
        assert entry['version'] == version

codex_entry = next(entry for entry in codex_marketplace['plugins'] if entry['name'] == plugin_name)
assert codex_entry.get('source')
assert codex_entry.get('policy', {}).get('installation')
assert codex_entry.get('policy', {}).get('authentication')
assert codex_entry.get('category')

metadata_version = claude_marketplace.get('metadata', {}).get('version')
if metadata_version is not None:
    assert metadata_version == version
PY
check $? "plugin names and latest release version are synchronized; Codex bundles ./skills/"

# 3. Exactly 17 skills exist; every directory matches its frontmatter name and uses tikin-*.
shopt -s nullglob
skill_files=(skills/*/SKILL.md)
if [ "${#skill_files[@]}" -eq 17 ]; then
  check 0 "exactly 17 skills are present"
else
  check 1 "exactly 17 skills are present (found ${#skill_files[@]})"
fi

python3 - <<'PY' 2>/dev/null
import pathlib

expected = {
    'tikin-bulk-data-export', 'tikin-comments-analysis', 'tikin-competitor-analysis',
    'tikin-creator-analytics', 'tikin-douyin', 'tikin-endpoint-discovery',
    'tikin-hashtag-research', 'tikin-instagram', 'tikin-rest-api', 'tikin-setup',
    'tikin-social-listening', 'tikin-social-media-downloader', 'tikin-tiktok',
    'tikin-trend-research', 'tikin-twitter-threads', 'tikin-xiaohongshu',
    'tikin-youtube',
}
actual = {path.parent.name for path in pathlib.Path('skills').glob('*/SKILL.md')}
assert actual == expected
PY
check $? "the canonical set of 17 tikin-* skills is present"

for sk in "${skill_files[@]}"; do
  skill_dir="$(basename "$(dirname "$sk")")"
  skill_name="$(awk '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && /^---$/ { exit }
    /^name:[[:space:]]*/ {
      sub(/^name:[[:space:]]*/, "")
      print
      exit
    }
  ' "$sk")"

  if head -1 "$sk" | grep -q '^---$' && awk 'NR>1 && /^---$/{exit} /^description:/{found=1} END{exit !found}' "$sk"; then
    check 0 "$sk has frontmatter with description"
  else
    check 1 "$sk has frontmatter with description"
  fi

  if [ "$skill_name" = "$skill_dir" ]; then
    check 0 "$sk frontmatter name matches directory"
  else
    check 1 "$sk frontmatter name matches directory (name: ${skill_name:-missing})"
  fi

  case "$skill_dir" in
    tikin-*) check 0 "$skill_dir uses the tikin-* namespace" ;;
    *) check 1 "$skill_dir uses the tikin-* namespace" ;;
  esac
done

# 4. Legacy skill identifiers and the old dotenv path are absent from active documentation and skills.
python3 - <<'PY' 2>/dev/null
import pathlib
import re

legacy_paths = (
    'bulk-data-export', 'comments-analysis', 'competitor-analysis', 'creator-analytics',
    'douyin', 'hashtag-research', 'instagram', 'social-listening',
    'social-media-downloader', 'tikin-onboarding', 'tiktok', 'trend-research',
    'twitter-threads', 'xiaohongshu', 'youtube',
)
legacy_task_references = (
    'bulk-data-export', 'comments-analysis', 'competitor-analysis', 'creator-analytics',
    'hashtag-research', 'social-listening', 'social-media-downloader', 'trend-research',
)
roots = [pathlib.Path('README.md'), pathlib.Path('CONTRIBUTING.md'), pathlib.Path('CHANGELOG.md')]
roots.extend(pathlib.Path('skills').glob('*/SKILL.md'))
roots.extend(pathlib.Path('.claude-plugin').glob('*.json'))
roots.extend(pathlib.Path('.codex-plugin').glob('*.json'))
roots.extend(pathlib.Path('.agents').rglob('*.json'))

for path in roots:
    text = path.read_text()
    assert '/tikin/' + 'env' not in text, f'legacy dotenv path in {path}'
    for name in legacy_task_references:
        assert f'`{name}`' not in text, f'legacy task skill reference {name} in {path}'
    for name in legacy_paths:
        assert not re.search(rf'skills/{re.escape(name)}(?:/|\b)', text), (
            f'legacy skill path {name} in {path}'
        )
    assert 'tikin-' + 'onboarding' not in text, f'legacy setup skill in {path}'
PY
check $? "no legacy skill identifiers or old dotenv path remain"

# 5. Each reference path mentioned in a SKILL.md exists.
for sk in "${skill_files[@]}"; do
  skdir="$(dirname "$sk")"
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    if [ -e "$skdir/$ref" ]; then
      check 0 "$sk -> $ref exists"
    else
      check 1 "$sk -> $ref exists"
    fi
  done < <(grep -oE 'references/[A-Za-z0-9._/-]+' "$sk" | sort -u)
done

# 6. The setup helper is executable and its public file contracts pass.
if [ -x skills/tikin-setup/scripts/tikin-config ]; then
  check 0 "tikin-config is executable"
else
  check 1 "tikin-config is executable"
fi
python3 -m unittest tests/test_tikin_config.py >/dev/null 2>&1
check $? "tikin-config behavior tests pass"

# 7. Every operational skill carries the routing gate, and none curls a supported source page.
runtime_gate_count="$(grep -l '^## Runtime gate$' skills/*/SKILL.md | wc -l | tr -d ' ')"
if [ "$runtime_gate_count" -eq 16 ]; then
  check 0 "all 16 non-setup skills contain a runtime gate"
else
  check 1 "all 16 non-setup skills contain a runtime gate (found $runtime_gate_count)"
fi

xdg_routing_count="$(grep -l 'XDG_CONFIG_HOME.*settings.json' skills/*/SKILL.md | wc -l | tr -d ' ')"
if [ "$xdg_routing_count" -eq 16 ]; then
  check 0 "all 16 non-setup skills honor XDG_CONFIG_HOME for routing"
else
  check 1 "all 16 non-setup skills honor XDG_CONFIG_HOME for routing (found $xdg_routing_count)"
fi

direct_social_curl="$(grep -rEn 'curl[^[:cntrl:]]*(tiktok\.com|douyin\.com|xiaohongshu\.com|xhslink\.com|instagram\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|threads\.net)' skills --include='SKILL.md' 2>/dev/null || true)"
if [ -z "$direct_social_curl" ]; then
  check 0 "skills never curl supported user-facing social URLs directly"
else
  check 1 "skills never curl supported user-facing social URLs directly ($direct_social_curl)"
fi

# 8. No vendor brand leakage in shipped files. Keep the allowlist explicit so validation never
#    reads ignored credentials, local environments, caches, or maintainer-only root scripts.
product_files=(
  README.md
  CONTRIBUTING.md
  CHANGELOG.md
  .claude-plugin/*.json
  .codex-plugin/*.json
  .agents/plugins/*.json
  skills/*/SKILL.md
  skills/*/scripts/*
  skills/*/references/*
)
leak="$(grep -Il -i 'tikhub' "${product_files[@]}" 2>/dev/null | tr '\n' ' ')"
if [ -n "$leak" ]; then
  check 1 "no vendor brand leakage in shipped surface (found in: $leak)"
else
  check 0 "no vendor brand leakage in shipped surface"
fi

echo "----"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
