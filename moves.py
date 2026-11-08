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
# The legend shows one line of the model's own reasoning (its thinking summary), not the answer's reason.
THOUGHT_LIMIT = 150
_CELL = re.compile(r'\b[A-J](?:10|[1-9])\b')
_GAME = re.compile(r'\b(?:hit|hits|miss|misses|sunk|sink|ship|ships|carrier|battleship|cruiser|submarine|destroyer|'
                   r'fleet|row|column|parity|checkerboard|diagonal|adjacent|edge|corner|orientation|probability)\b', re.I)
_DECIDE = re.compile(r"\b(?:I'll|I will|I'm going|going with|go with|settl\w*|choos\w*|chose|choice|best|pick\w*|fire|"
                     r'firing|target\w*|aim\w*|place|placing)\b', re.I)
# The why: a sentence that gives the reason beats one that only names the cell.
_WHY = re.compile(r'\b(?:since|because|which|so the|means|meaning|suggest\w*|hint\w*|implies|rules? out|leaves|still fit\w*)\b', re.I)
# Talk about the answer format rather than the game ("answer in JSON", "the reasoning field").
_META = re.compile(r'\b(?:json|schema|structured ?output|tool|field|fields|format|output)\b', re.I)
# The closing clause that is only about the format ("in the target field"): it stops at a cell or another clause.
_META_CLAUSE = re.compile(r',?\s+(?:with|in|for|as|via|through|using)\s+(?:(?!\b[A-J](?:10|[1-9])\b|\b(?:with|in|for|as|via|'
                          r'through|using)\b)[^,.;])*?\b(?:json|schema|structured ?output|tool|field|fields|format)\b[^,.;]*', re.I)


def clip(text, limit):
    """Text cut to at most `limit` characters, at a word boundary, with an ellipsis when it was cut."""
    text = ' '.join(str(text or '').split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    if ' ' in cut[limit // 2:]:
        cut = cut[:cut.rfind(' ')]
    return cut.rstrip(' ,;:') + '…'


def one_liner(thinking, target=''):
    """The sentence of a model's reasoning summary that carries its decision, as one line for the legend: the one
    that names the chosen cell and the game (not the answer format), the later one when two tie."""
    text = re.sub(r'^\s*(?:#+\s*)?\*\*[^*\n]+\*\*\s*$', ' ', str(thinking or ''), flags=re.M)
    text = ' '.join(re.sub(r'[*#`_]+', '', text).split())
    if not text:
        return ''
    best, best_score = '', None
    for sentence in re.split(r'(?<=[.!?])\s+(?=[A-Z"\'(])', text):
        sentence = sentence.strip()
        if len(sentence) < 12:
            continue
        score = (4 if target and re.search(r'\b' + re.escape(target) + r'\b', sentence) else 0)
        score += bool(_CELL.search(sentence)) + bool(_GAME.search(sentence)) + 2 * bool(_DECIDE.search(sentence))
        score += 2 * bool(_WHY.search(sentence))
        score -= 3 * bool(_META.search(sentence)) + 2 * (len(sentence) < 30)
        if best_score is None or score >= best_score:
            best, best_score = sentence, score
    best = re.sub(r'^(?:so|and|then|okay|ok|alright|now)\b,?\s+', '', _META_CLAUSE.sub('', best).strip(), flags=re.I)
    best = best[:1].upper() + best[1:]
    if best and best[-1] not in '.!?…':
        best += '.'
    return clip(best, THOUGHT_LIMIT)


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


def read_placement(data, thinking=''):
    """(placement, plan, thought) from a model's answer and its reasoning summary."""
    try:
        placement = {name: {'start': str(data[name]['start']).upper(), 'direction': str(data[name]['direction']).upper()} for name in SHIPS}
    except (KeyError, TypeError):
        raise MoveError('The model left a ship out of its placement.')
    return placement, clip(data.get('plan'), PLAN_LIMIT), one_liner(thinking)


def read_shot(data, thinking=''):
    """(target, reasoning, notes, thought) from a model's answer and its reasoning summary."""
    target = str(data.get('target') or '')
    return (target, clip(data.get('reasoning'), REASON_LIMIT), clip(data.get('notes'), NOTES_LIMIT),
            one_liner(thinking, target.strip().upper()))
