"""API connection, blue fleet: GPT through the OpenAI API (official Python SDK, Responses API).

The model list comes from the OpenAI Models API (`client.models.list()`), which gives model IDs only. Each model's
reasoning efforts and speed tiers come from Codex's model catalog when Codex is installed: it marks which models
the API serves, the efforts each supports and its Fast tier (Priority processing, `service_tier: "priority"`).
GPT models the catalog doesn't cover are still listed, with the effort levels every current GPT reasoning model
takes and no Fast tier.

Each move is one Responses request: the chosen reasoning effort, strict JSON-schema output, and the Fast tier when
picked.
"""
from __future__ import annotations

import os
import re
import typing

from moves import MoveError, json_in

KEY = 'OPENAI_API_KEY'
STANDARD = {'id': 'standard', 'name': 'Standard'}
# GPT models outside Codex's catalog: the families that take reasoning effort, and the levels they all take.
REASONING_FAMILY = re.compile(r'^gpt-(?:[5-9]|\d\d)(?:\.\d+)?(?:-[a-z]+)?$')
COMMON_EFFORTS = ['low', 'medium', 'high']
TIMEOUT = float(os.getenv('CLI_TIMEOUT', '900'))

# Per model, the speed tiers the catalog offered (tier id -> service_tier value).
_tiers = {}


def _client():
    from openai import OpenAI
    return OpenAI(api_key=os.getenv(KEY), timeout=TIMEOUT)


def _api_values(alias):
    """The literal values an SDK type accepts (reasoning efforts, service tiers)."""
    values = set()
    for arg in typing.get_args(alias):
        values.update(a for a in typing.get_args(arg) if isinstance(a, str))
    return values


def _api_efforts():
    from openai.types.shared.reasoning_effort import ReasoningEffort
    return _api_values(ReasoningEffort) - {'none'}


def _api_tiers():
    from openai.types.responses import response_create_params
    return _api_values(typing.get_type_hints(response_create_params.ResponseCreateParamsBase)['service_tier'])


def _name(model_id):
    # "gpt-6-luna" reads as "GPT-6 Luna".
    match = re.match(r'^gpt-([\d.]+)(?:-(.+))?$', model_id)
    if not match:
        return model_id
    return f'GPT-{match.group(1)}' + (' ' + match.group(2).replace('-', ' ').title() if match.group(2) else '')


def catalog():
    """The GPT models this key can use, with reasoning efforts and speed tiers."""
    if not os.getenv(KEY):
        return {'models': [], 'default': '', 'error': f'Add {KEY} to the .env file in the project folder, then reload.'}
    import openai
    try:
        listed = {model.id for model in _client().models.list()}
    except openai.AuthenticationError:
        return {'models': [], 'default': '', 'error': f'The {KEY} in .env was rejected. Check it and reload.'}
    except openai.APIConnectionError:
        return {'models': [], 'default': '', 'error': 'Could not reach the OpenAI API to list models.'}
    except openai.APIStatusError as error:
        return {'models': [], 'default': '', 'error': f'OpenAI API error {error.status_code} while listing models.'}
    from cli_players import codex_catalog, codex_option
    efforts_ok, tiers_ok = _api_efforts(), _api_tiers()
    models, seen = [], set()
    for item in sorted(codex_catalog() or [], key=lambda m: m.get('priority', 99)):
        if not item.get('supported_in_api') or item['slug'] not in listed:
            continue
        option = codex_option(item)
        # Codex-only levels (such as task delegation) are not API reasoning efforts.
        efforts = [e for e in option['efforts'] if e in efforts_ok]
        default = option['default_effort'] if option['default_effort'] in efforts else None
        speeds = [STANDARD] + [{'id': tier['id'], 'name': tier.get('name') or tier['id'].title(), 'description': tier.get('description', '')}
                               for tier in item.get('service_tiers') or [] if tier.get('id') in tiers_ok]
        _tiers[item['slug']] = {speed['id'] for speed in speeds[1:]}
        models.append({**option, 'efforts': ['default', *efforts], 'default_effort': 'default',
                       'effort_supported': bool(efforts), 'speeds': speeds, 'model_default': default})
        seen.add(item['slug'])
    for model_id in sorted(listed - seen, reverse=True):
        if REASONING_FAMILY.match(model_id):
            models.append({'id': model_id, 'name': _name(model_id), 'efforts': ['default', *COMMON_EFFORTS],
                           'default_effort': 'default', 'effort_supported': True, 'speeds': [STANDARD]})
    if not models:
        return {'models': [], 'default': '', 'error': 'This OpenAI key lists no GPT models that can play.'}
    return {'models': models, 'default': models[0]['id'], 'tool': 'OpenAI API'}


def ask(system, prompt, schema, model, effort='default', speed='standard'):
    """One move: returns the answer as a dict, read from the model's strict JSON output."""
    if not os.getenv(KEY):
        raise MoveError(f'Add {KEY} to the .env file in the project folder, then reload.')
    import openai
    params = {'model': model, 'instructions': system, 'input': prompt,
              'text': {'format': {'type': 'json_schema', 'name': 'battleship_move', 'schema': schema, 'strict': True}}}
    if effort and effort != 'default':
        params['reasoning'] = {'effort': effort}
    if speed and speed != 'standard' and speed in _tiers.get(model, {speed}):
        params['service_tier'] = speed
    try:
        response = _client().responses.create(**params)
    except openai.AuthenticationError:
        raise MoveError(f'The {KEY} in .env was rejected.')
    except openai.NotFoundError:
        raise MoveError(f'The model {model} is not available to this key.')
    except openai.RateLimitError:
        raise MoveError('Rate limited by the OpenAI API. Wait a moment, then retry the move.')
    except openai.BadRequestError as error:
        raise MoveError(f'The OpenAI API rejected the request: {error.message}')
    except openai.APIStatusError as error:
        raise MoveError(f'OpenAI API error {error.status_code}: {error.message}')
    except openai.APIConnectionError:
        raise MoveError('Could not reach the OpenAI API.')
    if getattr(response, 'status', None) == 'incomplete':
        reason = getattr(getattr(response, 'incomplete_details', None), 'reason', None)
        raise MoveError('The model stopped before answering' + (f' ({reason}).' if reason else '.'))
    return json_in(response.output_text)
