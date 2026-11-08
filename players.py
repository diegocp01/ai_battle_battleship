"""Player adapters: simulated admirals for Test mode, and the OpenAI / Anthropic APIs for API mode.

Test mode never imports an SDK, so the app runs with no keys and no network. API mode loads its SDK only when a
move is requested, and reports a missing key as a readable error instead of crashing at startup.
"""
from __future__ import annotations

import os
import random

from battleship import COLUMNS, COORDS, SHIPS, SIZE, random_placement, ship_cells, to_coord, to_index

MODES = ('test', 'api')

# The models each side can field. The HUD shows the display name and the API gets the ID. Test mode fields the
# same models but simulates their moves, so the battle looks the same before any key is connected.
MODELS = {
    'gpt': ({'gpt-6.1-terra': 'GPT-6.1 Terra', 'gpt-6.1-sol': 'GPT-6.1 Sol', 'gpt-5.2': 'GPT-5.2'}, 'gpt-6.1-terra'),
    'claude': ({'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5',
                'claude-fable-5-1': 'Fable 5.1'}, 'claude-opus-5-5'),
}
API_MODEL_IDS = {model_id: model_id for names, _ in MODELS.values() for model_id in names}
# Simulated moves use the probability-map strategy. The weaker ones remain for experiments.
SIMULATED_STRATEGY = 'admiral'
# Simulated strategies, strongest first.
STRATEGIES = {
    'admiral': 'Admiral · probability map',
    'hunter': 'Hunter · hunt and target',
    'rookie': 'Rookie · random fire',
}


class ProviderError(RuntimeError):
    pass


def _option(model_id, name):
    return {'id': model_id, 'name': name, 'efforts': ['default'], 'default_effort': 'default', 'effort_supported': False}


def model_catalog():
    catalog = {key: {'models': [_option(model_id, name) for model_id, name in names.items()], 'default': default}
               for key, (names, default) in MODELS.items()}
    return {'test': catalog, 'api': catalog}


def select_models(mode, settings):
    catalog = model_catalog()[mode]
    selected = {}
    for key in ('gpt', 'claude'):
        requested = settings.get(key + '_model') or catalog[key]['default']
        info = next((item for item in catalog[key]['models'] if item['id'] == requested), None)
        if not info:
            raise ProviderError('Choose a model from the available options.')
        selected[key + '_model'] = requested
        selected[key + '_effort'] = 'default'
        selected[key + '_name'] = info['name']
    return selected


# ---------------------------------------------------------------------------------------------------------------
# Simulated admirals
# ---------------------------------------------------------------------------------------------------------------

def _neighbors(cell):
    col, row = to_index(cell)
    return [c for c in (to_coord(col + 1, row), to_coord(col - 1, row), to_coord(col, row + 1), to_coord(col, row - 1)) if c]


def _describe_placement(placement):
    carrier = placement['Carrier']
    col, row = to_index(carrier['start'])
    vertical = sum(1 for spec in placement.values() if spec['direction'] == 'V')
    quarter = ('north' if row < 5 else 'south') + ('west' if col < 5 else 'east')
    return (f"Spread the fleet so no two ships touch, {vertical} running north–south and {5 - vertical} east–west. "
            f"The Carrier anchors the {quarter} quarter from {carrier['start']}.")


def simulated_placement(strategy, rng):
    placement = random_placement(rng, spacing=strategy != 'rookie')
    return placement, _describe_placement(placement)


def _placements(info):
    """Every position a surviving ship could still occupy, given misses and sunk ships."""
    blocked = info['misses'] | info['sunk_cells']
    for name in info['remaining']:
        size = SHIPS[name]
        for coord in COORDS:
            for direction in 'HV':
                cells = ship_cells(coord, direction, size)
                if cells and not blocked.intersection(cells):
                    yield name, cells


def _admiral_shot(info, rng, voice):
    open_hits = info['open_hits']
    scores = {cell: 0.0 for cell in COORDS if cell not in info['fired']}
    support = {cell: set() for cell in scores}
    targeting = False
    if open_hits:
        for name, cells in _placements(info):
            covered = open_hits.intersection(cells)
            if not covered:
                continue
            weight = 1 + 40 * len(covered) ** 2
            for cell in cells:
                if cell in scores:
                    scores[cell] += weight
                    support[cell].add(name)
        targeting = any(scores.values())
    if not targeting:
        smallest = min(SHIPS[name] for name in info['remaining'])
        offset = rng.randrange(2)
        for name, cells in _placements(info):
            if open_hits.intersection(cells):
                continue
            for cell in cells:
                if cell in scores:
                    scores[cell] += 1
                    support[cell].add(name)
        for cell in scores:
            col, row = to_index(cell)
            if smallest >= 2 and (col + row + offset) % 2:
                scores[cell] *= 0.55
    for cell in scores:
        scores[cell] *= 1 + rng.random() * 0.12
    target = max(scores, key=scores.get)
    if not scores[target]:
        target = rng.choice(list(scores))
    if targeting:
        anchor = min(open_hits, key=lambda hit: abs(to_index(hit)[0] - to_index(target)[0]) + abs(to_index(hit)[1] - to_index(target)[1]))
        line = sorted(open_hits, key=to_index)
        aligned = len(line) > 1 and (len({to_index(h)[0] for h in line}) == 1 or len({to_index(h)[1] for h in line}) == 1)
        candidates = ' or '.join(sorted(support[target])) or 'damaged ship'
        if aligned:
            axis = 'column' if len({to_index(h)[0] for h in line}) == 1 else 'row'
            text = voice('extend', target=target, anchor=anchor, axis=axis, hits=len(line), ships=candidates)
        else:
            text = voice('follow', target=target, anchor=anchor, ships=candidates)
    else:
        text = voice('hunt', target=target, count=int(sum(1 for _ in support[target])), ships=len(info['remaining']))
    return target, text


def _hunter_shot(info, rng, voice):
    unknown = [cell for cell in COORDS if cell not in info['fired']]
    open_hits = sorted(info['open_hits'], key=to_index)
    if open_hits:
        if len(open_hits) > 1:
            cols = {to_index(h)[0] for h in open_hits}
            rows = {to_index(h)[1] for h in open_hits}
            if len(cols) == 1 or len(rows) == 1:
                first, last = to_index(open_hits[0]), to_index(open_hits[-1])
                step = (0, 1) if len(cols) == 1 else (1, 0)
                for end in (to_coord(last[0] + step[0], last[1] + step[1]), to_coord(first[0] - step[0], first[1] - step[1])):
                    if end and end not in info['fired']:
                        return end, voice('extend', target=end, anchor=open_hits[-1], axis='column' if len(cols) == 1 else 'row', hits=len(open_hits), ships='damaged ship')
        for hit in rng.sample(open_hits, len(open_hits)):
            options = [cell for cell in _neighbors(hit) if cell not in info['fired']]
            if options:
                target = rng.choice(options)
                return target, voice('follow', target=target, anchor=hit, ships='damaged ship')
    checker = [cell for cell in unknown if sum(to_index(cell)) % 2 == 0] or unknown
    target = rng.choice(checker)
    return target, voice('sweep', target=target)


def _rookie_shot(info, rng, voice):
    unknown = [cell for cell in COORDS if cell not in info['fired']]
    near = [cell for hit in info['open_hits'] for cell in _neighbors(hit) if cell not in info['fired']]
    if near and rng.random() < 0.55:
        target = rng.choice(near)
        return target, voice('follow', target=target, anchor='the last hit', ships='contact')
    target = rng.choice(unknown)
    return target, voice('guess', target=target)


# Two voices so the simulated players read differently in the reasoning panels.
PHRASES = {
    'gpt': {
        'hunt': ['{target} has the highest density on my probability map: {count} of the remaining fleet could cover it.',
                 'Hunting. {target} is the hottest open cell — {count} surviving ship classes still fit through it.',
                 'Probability peak at {target}. Checkerboard parity keeps the search efficient with {ships} ships left.'],
        'extend': ['{hits} hits stacked in one {axis}. {target} extends the line toward the rest of the {ships}.',
                   'The hits at {anchor} form a {axis}. {target} is the next cell on that axis.'],
        'follow': ['Hit confirmed at {anchor}. Probing {target} to find which way the {ships} runs.',
                   'Following up {anchor}: {target} is the best-supported neighbor ({ships}).'],
        'sweep': ['Sweeping the checkerboard: {target} is untested water.'],
        'guess': ['Firing at {target}. No better information yet.'],
    },
    'claude': {
        'hunt': ['Open water, so I am reasoning about where ships can still fit: {target} is crossed by the most possible positions ({count} classes).',
                 'Nothing to chase right now. {target} sits where the remaining {ships} ships are most likely to overlap.',
                 'I will search {target}. It is central to the space that can still hide a ship, and it keeps my shots on a checkerboard.'],
        'extend': ['My {hits} hits line up along a {axis}, so the ship most likely continues to {target}.',
                   'The damage at {anchor} runs along a {axis}; {target} should finish the job on the {ships}.'],
        'follow': ['I hit something at {anchor}. Checking {target} to learn its orientation — it could be the {ships}.',
                   'Staying on the contact at {anchor}: {target} is the neighbor most consistent with a surviving ship ({ships}).'],
        'sweep': ['Searching {target}, a cell my checkerboard pattern has not covered yet.'],
        'guess': ['Trying {target}. A guess for now.'],
    },
}


def simulated_shot(player, strategy, info, rng):
    def voice(kind, **values):
        return rng.choice(PHRASES[player][kind]).format(**values)
    shooter = {'admiral': _admiral_shot, 'hunter': _hunter_shot}.get(strategy, _rookie_shot)
    return shooter(info, rng, voice)


# ---------------------------------------------------------------------------------------------------------------
# API players (connected later; loaded lazily)
# ---------------------------------------------------------------------------------------------------------------

def _require_key(player):
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    key = 'OPENAI_API_KEY' if player == 'gpt' else 'ANTHROPIC_API_KEY'
    if not os.getenv(key):
        raise ProviderError(f'API mode needs {key} in your .env file. Add it, restart the app, and retry — or use Test mode.')


def api_placement(player, prompt, model_key):
    _require_key(player)
    model_id = API_MODEL_IDS.get(model_key, model_key)
    if player == 'gpt':
        from openai_model_v1 import call_chatgpt_placement
        return call_chatgpt_placement(prompt, model_id)
    from anthropic_model_v1 import call_claude_placement
    return call_claude_placement(prompt, model_id)


def api_shot(player, prompt, model_key):
    _require_key(player)
    model_id = API_MODEL_IDS.get(model_key, model_key)
    if player == 'gpt':
        from openai_model_v1 import call_chatgpt_fire
        return call_chatgpt_fire(prompt, model_id)
    from anthropic_model_v1 import call_claude_fire
    return call_claude_fire(prompt, model_id)


__all__ = ['MODES', 'MODELS', 'STRATEGIES', 'SIMULATED_STRATEGY', 'ProviderError', 'model_catalog', 'select_models', 'simulated_placement',
           'simulated_shot', 'api_placement', 'api_shot', 'COLUMNS', 'SIZE']
