"""The CLIs connection: Claude plays through the Claude Code CLI and GPT through the Codex SDK.

Both run on the sign-ins already on this machine (`claude` and `codex login`), so no API keys are needed. The model
menus come from the tools themselves: Codex's model catalog (`codex debug models`) lists each model with the
reasoning efforts it supports, and the Claude Code CLI's own help lists the effort levels it accepts.

Every call is one self-contained turn with no tools: Claude runs with its tools switched off, no MCP servers and no
saved session; Codex runs in a read-only sandbox in an empty temporary folder with network and web search off.
Both must answer in a JSON schema, so the move comes back as data instead of prose to parse.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from moves import FIRE_SCHEMA, FIRE_SYSTEM, PLACEMENT_SCHEMA, PLACEMENT_SYSTEM, MoveError, json_in, read_placement, read_shot

ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / 'codex_bridge.mjs'
SDK = ROOT / 'node_modules' / '@openai' / 'codex-sdk'
# A deep reasoning effort can think for minutes on one move.
TIMEOUT = float(os.getenv('CLI_TIMEOUT', '900'))
CATALOG_TTL = 600
# A side that is not ready (a tool missing, a key not added yet) is checked again soon, so a fix shows on reload.
RETRY_TTL = 10

# The Claude Code CLI takes an alias or a full model name but has no command that lists them, so these are the
# current Claude models. Any extra ones Claude Code has offered this account are added from its settings.
CLAUDE_MODELS = [
    ('claude-opus-5-5', 'Opus 5.5'),
    ('claude-sonnet-5-5', 'Sonnet 5.5'),
    ('claude-haiku-5-5', 'Haiku 5.5'),
    ('claude-fable-5-1', 'Fable 5.1'),
]
CLAUDE_DEFAULT = 'claude-opus-5-5'
CLAUDE_EFFORTS_FALLBACK = ['low', 'medium', 'high', 'xhigh', 'max']


class CLIError(MoveError):
    pass


def _tool(env_name, default):
    return shutil.which(os.getenv(env_name) or default)


# ---------------------------------------------------------------------------------------------------------------
# What is installed, and the models and efforts it offers
# ---------------------------------------------------------------------------------------------------------------

def _claude_efforts(claude):
    """The effort levels `claude --effort` accepts, read from its help."""
    try:
        text = subprocess.run([claude, '--help'], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return CLAUDE_EFFORTS_FALLBACK
    match = re.search(r'--effort <level>[^(]*\(([^)]*)\)', text, re.S)
    levels = [level.strip() for level in match.group(1).split(',')] if match else []
    return [level for level in levels if re.fullmatch(r'[a-z]+', level)] or CLAUDE_EFFORTS_FALLBACK


def _claude_extra_models():
    """Models Claude Code has offered this account beyond the standard ones (from ~/.claude.json)."""
    try:
        data = json.loads((Path.home() / '.claude.json').read_text())
    except (OSError, ValueError):
        return []
    extra = []
    for item in data.get('additionalModelOptionsCache') or []:
        value = str(item.get('value') or '')
        # Skip long-context variants: a Battleship turn needs no million-token window.
        if value.startswith('claude-') and '[' not in value:
            extra.append((value, str(item.get('label') or value)))
    return extra


def _claude_side():
    claude = _tool('CLAUDE_CLI', 'claude')
    if not claude:
        return {'models': [], 'default': '', 'error': 'Claude Code CLI not found. Install it and sign in with `claude`.'}
    efforts = ['default'] + _claude_efforts(claude)
    known = {model_id for model_id, _ in CLAUDE_MODELS}
    models = [{'id': model_id, 'name': name, 'efforts': efforts, 'default_effort': 'default', 'effort_supported': True}
              for model_id, name in CLAUDE_MODELS + [m for m in _claude_extra_models() if m[0] not in known]]
    return {'models': models, 'default': CLAUDE_DEFAULT, 'tool': 'Claude Code CLI'}


def _pretty_gpt(name):
    # "GPT-6.1-Sol" reads as "GPT-6.1 Sol" in the HUD, like the other model names.
    return re.sub(r'^(GPT-[\d.]+)-(?=[A-Za-z])', r'\1 ', name)


_codex_cache = {'at': 0.0, 'value': None}
_codex_lock = threading.Lock()


def codex_catalog():
    """Codex's raw model catalog (`codex debug models`), or None when Codex is not installed. Besides the models
    Codex offers, it says which of them the OpenAI API serves, their reasoning efforts and their speed tiers, so
    the API connection reads it too."""
    with _codex_lock:
        if time.time() - _codex_cache['at'] > CATALOG_TTL or _codex_cache['value'] is None:
            codex = _tool('CODEX_CLI', 'codex')
            value = None
            if codex:
                try:
                    result = subprocess.run([codex, 'debug', 'models'], capture_output=True, text=True, timeout=30)
                    value = [m for m in json.loads(result.stdout).get('models', []) if isinstance(m, dict) and m.get('slug')]
                except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
                    value = None
            _codex_cache.update(at=time.time() if value else time.time() - CATALOG_TTL + RETRY_TTL, value=value)
        return _codex_cache['value']


def codex_option(item):
    """A menu entry for a model from Codex's catalog: its name and the reasoning efforts it supports."""
    efforts = [level.get('effort') for level in item.get('supported_reasoning_levels') or [] if level.get('effort')]
    default = item.get('default_reasoning_level')
    return {'id': item['slug'], 'name': _pretty_gpt(item.get('display_name') or item['slug']),
            'efforts': efforts or ['default'], 'default_effort': default if default in efforts else (efforts or ['default'])[0],
            'effort_supported': bool(efforts)}


def _codex_side():
    if not _tool('CODEX_CLI', 'codex'):
        return {'models': [], 'default': '', 'error': 'Codex CLI not found. Install it and sign in with `codex login`.'}
    if not _tool('NODE_BIN', 'node'):
        return {'models': [], 'default': '', 'error': 'Node.js not found. The Codex SDK needs it.'}
    if not SDK.exists():
        return {'models': [], 'default': '', 'error': 'Codex SDK not installed. Run `npm install` in the project folder.'}
    catalog = codex_catalog()
    if catalog is None:
        return {'models': [], 'default': '', 'error': 'Could not read the Codex model list. Check `codex debug models`.'}
    models = [codex_option(item) for item in sorted(catalog, key=lambda m: m.get('priority', 99)) if item.get('visibility') == 'list']
    if not models:
        return {'models': [], 'default': '', 'error': 'Codex lists no models. Check `codex login`.'}
    return {'models': models, 'default': models[0]['id'], 'tool': 'Codex SDK'}


_cache = {'at': 0.0, 'value': None}
_cache_lock = threading.Lock()


def cli_catalog(refresh=False):
    """Models and reasoning efforts for each side, read from the installed tools (cached for ten minutes)."""
    with _cache_lock:
        value = _cache['value']
        ttl = RETRY_TTL if value and any(side.get('error') for side in value.values()) else CATALOG_TTL
        if refresh or not value or time.time() - _cache['at'] > ttl:
            if refresh:
                _codex_cache['at'] = 0.0
            _cache['value'] = {'gpt': _codex_side(), 'claude': _claude_side()}
            _cache['at'] = time.time()
        return _cache['value']


# ---------------------------------------------------------------------------------------------------------------
# One move
# ---------------------------------------------------------------------------------------------------------------

def _tail(text, limit=400):
    text = (text or '').strip()
    return text[-limit:] if len(text) > limit else text


def _run(args, payload, cwd, env=None):
    try:
        return subprocess.run(args, input=payload, capture_output=True, text=True, timeout=TIMEOUT, cwd=cwd, env=env)
    except subprocess.TimeoutExpired:
        raise CLIError(f'No answer within {int(TIMEOUT)} s. Try a lower reasoning effort.')
    except OSError as error:
        raise CLIError(f'Could not start {Path(args[0]).name}: {error}')


def _claude(prompt, system, schema, model, effort):
    claude = _tool('CLAUDE_CLI', 'claude')
    if not claude:
        raise CLIError('Claude Code CLI not found. Install it and sign in with `claude`.')
    args = [claude, '-p', '--model', model, '--output-format', 'json', '--json-schema', json.dumps(schema),
            '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--disable-slash-commands',
            '--no-session-persistence']
    if effort and effort != 'default':
        args += ['--effort', effort]
    # Started from inside a Claude Code session, the CLI would think it is nested in it.
    env = {key: value for key, value in os.environ.items() if key != 'CLAUDECODE'}
    with tempfile.TemporaryDirectory(prefix='battleship-claude-') as folder:
        result = _run(args, prompt, folder, env)
    try:
        data = json.loads(result.stdout)
    except ValueError:
        raise CLIError('Claude Code CLI: ' + (_tail(result.stderr) or _tail(result.stdout) or f'exited with code {result.returncode}.'))
    if isinstance(data, list):
        data = next((item for item in reversed(data) if isinstance(item, dict) and item.get('type') == 'result'), {})
    if data.get('is_error') or data.get('subtype') not in (None, 'success'):
        raise CLIError('Claude Code CLI: ' + (_tail(str(data.get('result') or '')) or str(data.get('subtype') or 'error')))
    answer = data.get('structured_output')
    return answer if isinstance(answer, dict) else json_in(data.get('result'))


def _codex(prompt, system, schema, model, effort):
    node, codex = _tool('NODE_BIN', 'node'), _tool('CODEX_CLI', 'codex')
    if not node or not codex:
        raise CLIError('The Codex SDK needs Node.js and the Codex CLI. Install them and sign in with `codex login`.')
    payload = json.dumps({'prompt': f'{system}\n\n{prompt}', 'model': model, 'effort': effort, 'schema': schema})
    result = _run([node, str(BRIDGE)], payload, str(ROOT), dict(os.environ, CODEX_PATH=codex))
    lines = [line for line in (result.stdout or '').splitlines() if line.strip()]
    try:
        data = json.loads(lines[-1])
    except (IndexError, ValueError):
        raise CLIError('Codex SDK: ' + (_tail(result.stderr) or f'exited with code {result.returncode}.'))
    if data.get('error'):
        raise CLIError('Codex SDK: ' + _tail(data['error']))
    return json_in(data.get('response'))


def _call(player, prompt, system, schema, model, effort):
    return (_codex if player == 'gpt' else _claude)(prompt, system, schema, model, effort)


def cli_placement(player, prompt, model, effort):
    return read_placement(_call(player, prompt, PLACEMENT_SYSTEM, PLACEMENT_SCHEMA, model, effort))


def cli_shot(player, prompt, model, effort):
    return read_shot(_call(player, prompt, FIRE_SYSTEM, FIRE_SCHEMA, model, effort))
