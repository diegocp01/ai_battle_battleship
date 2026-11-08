"""What a live model is asked for on its turn, shared by the CLIs and API connections: the instructions, the JSON
schemas its answer must follow (a fleet placement, or one cell to fire at), and reading that answer back.
"""
from __future__ import annotations

import json
import re

from battleship import COORDS, SHIPS

CELL = {'type': 'string', 'enum': COORDS}
PLACEMENT_SCHEMA = {
    'type': 'object',
    'properties': {
        **{name: {'type': 'object', 'properties': {'start': CELL, 'direction': {'type': 'string', 'enum': ['H', 'V']}},
                  'required': ['start', 'direction'], 'additionalProperties': False} for name in SHIPS},
        'plan': {'type': 'string', 'description': 'One sentence (at most 200 characters) about how the fleet is placed.'},
    },
    'required': [*SHIPS, 'plan'],
    'additionalProperties': False,
}
FIRE_SCHEMA = {
    'type': 'object',
    'properties': {
        'target': CELL,
        'reasoning': {'type': 'string', 'description': 'One sentence (at most 150 characters) on why this cell.'},
        'notes': {'type': 'string', 'description': 'Your notes to yourself for the rest of this match (at most 600 '
                  'characters): what you have learned about the enemy fleet and your plan for the next shots. They '
                  'replace your previous notes and are shown to you on your next turn.'},
    },
    'required': ['target', 'reasoning', 'notes'],
    'additionalProperties': False,
}
PLACEMENT_SYSTEM = ('You are an admiral playing Battleship. Do not use any tools. Answer only with the requested JSON: '
                    'every ship\'s start cell and direction (H extends right, V extends down), and a one-sentence plan.')
FIRE_SYSTEM = ('You are an admiral playing Battleship. Do not use any tools. Answer only with the requested JSON: one '
               'cell to fire at that you have not fired at before, one sentence (at most 150 characters) explaining '
               'why, and your updated notes to yourself for the rest of the match (at most 600 characters).')
# The limits the model is told; longer text is cut at a word boundary, never mid-word.
NOTES_LIMIT, REASON_LIMIT, PLAN_LIMIT = 600, 150, 200


def clip(text, limit):
    """Text cut to at most `limit` characters, at a word boundary, with an ellipsis when it was cut."""
    text = ' '.join(str(text or '').split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    if ' ' in cut[limit // 2:]:
        cut = cut[:cut.rfind(' ')]
    return cut.rstrip(' ,;:') + '…'


class MoveError(RuntimeError):
    pass


def json_in(text):
    """The JSON object in a reply, with or without a code fence around it."""
    text = (text or '').strip()
    fenced = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end < start:
        raise MoveError('The model did not answer with JSON.')
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        raise MoveError('The model answered with malformed JSON.')


def read_placement(data):
    try:
        placement = {name: {'start': str(data[name]['start']).upper(), 'direction': str(data[name]['direction']).upper()} for name in SHIPS}
    except (KeyError, TypeError):
        raise MoveError('The model left a ship out of its placement.')
    return placement, clip(data.get('plan'), PLAN_LIMIT)


def read_shot(data):
    """(target, reasoning, notes) from a model's answer."""
    return str(data.get('target') or ''), clip(data.get('reasoning'), REASON_LIMIT), clip(data.get('notes'), NOTES_LIMIT)
