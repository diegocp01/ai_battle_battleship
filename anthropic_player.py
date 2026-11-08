"""API connection, orange fleet: Claude through the Anthropic API (official Python SDK).

The menus come from the API itself. The Models API (`client.models.list()`) returns every model this key can use
with its capabilities, so the model list, each model's effort levels and whether it takes adaptive thinking are read
live. Fast mode (a research preview that runs the same model at up to 2.5x the output speed, at twice the price) is
offered on the models that have it.

Each move is one streamed Messages request on the beta endpoint: adaptive thinking, the chosen effort, structured
JSON output, fast mode when picked, and on models that support it a server-side fallback so a safety decline hands
the turn to another model instead of stopping the game.
"""
from __future__ import annotations

import os
import re

from moves import MoveError, json_in

KEY = 'ANTHROPIC_API_KEY'
DEFAULT_MODEL = 'claude-opus-5-5'
EFFORT_LEVELS = ('low', 'medium', 'high', 'xhigh', 'max')
# Fast mode is documented for these models; when the Models API reports it in a model's capabilities, that wins.
FAST_MODE_MODELS = {'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8'}
FAST_BETA = 'fast-mode-2026-02-01'
FAST = {'id': 'fast', 'name': 'Fast', 'description': 'up to 2.5x output speed, 2x price'}
STANDARD = {'id': 'standard', 'name': 'Standard'}
# Models whose safety declines can fall back to another model on the server ("default" picks it by category).
FALLBACK_MODELS = {'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'}
FALLBACK_BETA = 'server-side-fallback-2026-07-01'
MAX_TOKENS = 32000

# Per model, what the catalog learned from the Models API: adaptive thinking and fast mode.
_features = {}


def _client():
    import anthropic
    return anthropic.Anthropic(api_key=os.getenv(KEY))


def _supported(node, *path):
    for key in path:
        node = node.get(key) if isinstance(node, dict) else None
    return bool(node.get('supported')) if isinstance(node, dict) else False


def _fast(model_id, caps):
    for key in ('speed', 'fast_mode'):
        if key in caps:
            return _supported(caps, key, 'fast') if key == 'speed' else _supported(caps, key)
    return model_id in FAST_MODE_MODELS


def _name(display_name, model_id):
    # "Claude Opus 5.5" reads as "Opus 5.5" in the HUD.
    return re.sub(r'^Claude\s+', '', display_name or model_id)


def catalog():
    """The models this key can use, with their effort levels and speeds, read from the Models API."""
    if not os.getenv(KEY):
        return {'models': [], 'default': '', 'error': f'Add {KEY} to the .env file in the project folder, then reload.'}
    import anthropic
    try:
        listed = list(_client().models.list())
    except anthropic.AuthenticationError:
        return {'models': [], 'default': '', 'error': f'The {KEY} in .env was rejected. Check it and reload.'}
    except anthropic.APIConnectionError:
        return {'models': [], 'default': '', 'error': 'Could not reach the Anthropic API to list models.'}
    except anthropic.APIStatusError as error:
        return {'models': [], 'default': '', 'error': f'Anthropic API error {error.status_code} while listing models.'}
    models = []
    for model in listed:
        caps = model.capabilities.to_dict() if getattr(model, 'capabilities', None) else {}
        # A move needs structured output; models without it are left out.
        if caps and not _supported(caps, 'structured_outputs'):
            continue
        efforts = [level for level in EFFORT_LEVELS if _supported(caps, 'effort') and _supported(caps, 'effort', level)]
        fast = _fast(model.id, caps)
        _features[model.id] = {'adaptive': _supported(caps, 'thinking', 'types', 'adaptive') if caps else True, 'fast': fast}
        models.append({
            'id': model.id, 'name': _name(model.display_name, model.id),
            # "default" sends no effort, so the model uses its own default level.
            'efforts': ['default', *efforts], 'default_effort': 'default', 'effort_supported': bool(efforts),
            'speeds': [STANDARD, FAST] if fast else [STANDARD],
        })
    if not models:
        return {'models': [], 'default': '', 'error': 'This Anthropic key lists no models that can play.'}
    default = DEFAULT_MODEL if any(m['id'] == DEFAULT_MODEL for m in models) else models[0]['id']
    return {'models': models, 'default': default, 'tool': 'Anthropic API'}


def ask(system, prompt, schema, model, effort='default', speed='standard'):
    """One move: returns (answer, thinking), the answer read from the model's structured JSON output and the
    summary of its thinking ('' when it did not think)."""
    if not os.getenv(KEY):
        raise MoveError(f'Add {KEY} to the .env file in the project folder, then reload.')
    import anthropic
    features = _features.get(model, {'adaptive': True, 'fast': model in FAST_MODE_MODELS})
    output_config = {'format': {'type': 'json_schema', 'schema': schema}}
    if effort and effort != 'default':
        output_config['effort'] = effort
    params = {'model': model, 'max_tokens': MAX_TOKENS, 'system': system,
              'messages': [{'role': 'user', 'content': prompt}], 'output_config': output_config}
    if features['adaptive']:
        # Summarized, so the thinking comes back as text the legend can show (by default it is left out).
        params['thinking'] = {'type': 'adaptive', 'display': 'summarized'}
    betas = []
    if speed == 'fast' and features['fast']:
        params['speed'] = 'fast'
        betas.append(FAST_BETA)
    elif model in FALLBACK_MODELS:
        params['fallbacks'] = 'default'
        betas.append(FALLBACK_BETA)
    if betas:
        params['betas'] = betas
    try:
        with _client().beta.messages.stream(**params) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise MoveError(f'The {KEY} in .env was rejected.')
    except anthropic.NotFoundError:
        raise MoveError(f'The model {model} is not available to this key.')
    except anthropic.RateLimitError:
        raise MoveError('Rate limited by the Anthropic API. Wait a moment, then retry the move.')
    except anthropic.BadRequestError as error:
        raise MoveError(f'The Anthropic API rejected the request: {error.message}')
    except anthropic.APIStatusError as error:
        raise MoveError(f'Anthropic API error {error.status_code}: {error.message}')
    except anthropic.APIConnectionError:
        raise MoveError('Could not reach the Anthropic API.')
    if message.stop_reason == 'refusal':
        details = getattr(message, 'stop_details', None)
        category = getattr(details, 'category', None)
        raise MoveError('The model declined this move' + (f' ({category}).' if category else '.'))
    if message.stop_reason == 'max_tokens':
        raise MoveError('The model ran out of output tokens before answering. Try a lower effort.')
    thinking = '\n\n'.join(block.thinking for block in message.content if block.type == 'thinking' and block.thinking)
    return json_in(''.join(block.text for block in message.content if block.type == 'text')), thinking
