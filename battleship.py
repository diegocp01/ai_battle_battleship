"""Battleship rules: the grid, fleets, placement checks, shots and the prompts sent to model players.

Pure functions only, so the server, the simulated players and the API adapters share one source of truth.
Coordinates are strings like "A1" … "J10": a column letter (A–J, left to right) and a row number (1–10, top to
bottom). Ships extend right (H) or down (V) from their start cell.
"""
from __future__ import annotations

import random

COLUMNS = 'ABCDEFGHIJ'
SIZE = 10
SHIPS = {'Carrier': 5, 'Battleship': 4, 'Cruiser': 3, 'Submarine': 3, 'Destroyer': 2}
COORDS = [f'{col}{row}' for row in range(1, SIZE + 1) for col in COLUMNS]
COORD_SET = set(COORDS)


def to_index(coord):
    """'C7' → (col 2, row 6), both zero-based."""
    return COLUMNS.index(coord[0]), int(coord[1:]) - 1


def to_coord(col, row):
    return f'{COLUMNS[col]}{row + 1}' if 0 <= col < SIZE and 0 <= row < SIZE else None


def normalize_coord(value):
    """Accept ' c7 ', 'C07' and similar; return 'C7' or None."""
    if not isinstance(value, str):
        return None
    text = value.strip().upper().replace(' ', '')
    if len(text) < 2 or text[0] not in COLUMNS or not text[1:].isdigit():
        return None
    coord = f'{text[0]}{int(text[1:])}'
    return coord if coord in COORD_SET else None


def ship_cells(start, direction, size):
    """Cells covered by a ship, or None when it would leave the grid."""
    col, row = to_index(start)
    cells = []
    for step in range(size):
        cell = to_coord(col + step, row) if direction == 'H' else to_coord(col, row + step)
        if cell is None:
            return None
        cells.append(cell)
    return cells


def validate_placement(placement):
    """Check a fleet laid out as {ship: {'start': 'A1', 'direction': 'H'|'V'}}.

    Returns (cells_by_ship, None) when legal, otherwise (None, reason).
    """
    if not isinstance(placement, dict):
        return None, 'Placement must be an object with one entry per ship.'
    missing = [name for name in SHIPS if name not in placement]
    if missing:
        return None, 'Missing ships: ' + ', '.join(missing)
    occupied, fleet = set(), {}
    for name, size in SHIPS.items():
        entry = placement[name] if isinstance(placement[name], dict) else {}
        start = normalize_coord(entry.get('start'))
        direction = str(entry.get('direction', '')).strip().upper()[:1]
        if not start:
            return None, f'{name} has an invalid start cell.'
        if direction not in ('H', 'V'):
            return None, f'{name} needs direction H or V.'
        cells = ship_cells(start, direction, size)
        if cells is None:
            return None, f'{name} runs off the grid from {start}.'
        overlap = occupied.intersection(cells)
        if overlap:
            return None, f'{name} overlaps another ship at {sorted(overlap)[0]}.'
        occupied.update(cells)
        fleet[name] = cells
    return fleet, None


def random_placement(rng=None, spacing=True):
    """A legal random fleet. With spacing, ships avoid touching each other when there is room."""
    rng = rng or random.Random()
    for attempt in range(400):
        occupied, halo, placement = set(), set(), {}
        for name, size in sorted(SHIPS.items(), key=lambda item: -item[1]):
            options = []
            for coord in COORDS:
                for direction in 'HV':
                    cells = ship_cells(coord, direction, size)
                    if not cells or occupied.intersection(cells):
                        continue
                    if spacing and attempt < 300 and halo.intersection(cells):
                        continue
                    options.append((coord, direction, cells))
            if not options:
                break
            start, direction, cells = rng.choice(options)
            placement[name] = {'start': start, 'direction': direction}
            occupied.update(cells)
            for cell in cells:
                col, row = to_index(cell)
                for dc in (-1, 0, 1):
                    for dr in (-1, 0, 1):
                        neighbor = to_coord(col + dc, row + dr)
                        if neighbor:
                            halo.add(neighbor)
        if len(placement) == len(SHIPS):
            return {name: placement[name] for name in SHIPS}
    raise RuntimeError('Could not place the fleet.')


def new_player():
    return {
        'placement': {},       # ship → {'start', 'direction'}
        'ships': {},           # ship → [cells]
        'hits_taken': {name: [] for name in SHIPS},
        'sunk': [],            # ships lost, in order
        'shots': [],           # shots this player fired: {'turn', 'target', 'result', 'ship', 'why'}
        'notes': '',           # the player's notes to itself, carried from one turn to the next in this match
        'plan': '',            # what it said about its fleet when it placed it: where its match memory begins
    }


def fire(defender, target):
    """Resolve a shot against the defender. Returns (result, ship) with result 'miss', 'hit' or 'sunk'."""
    for name, cells in defender['ships'].items():
        if target in cells:
            if target not in defender['hits_taken'][name]:
                defender['hits_taken'][name].append(target)
            if len(defender['hits_taken'][name]) == len(cells):
                if name not in defender['sunk']:
                    defender['sunk'].append(name)
                return 'sunk', name
            return 'hit', name
    return 'miss', None


def fleet_destroyed(player):
    return len(player['sunk']) == len(SHIPS)


def knowledge(shooter, defender):
    """What the shooter may know: its shots, and the cells of ships it has sunk (announced in Battleship)."""
    fired = {shot['target']: shot['result'] for shot in shooter['shots']}
    sunk_cells = {cell for name in defender['sunk'] for cell in defender['ships'][name]}
    hits = {cell for cell, result in fired.items() if result in ('hit', 'sunk')}
    misses = {cell for cell, result in fired.items() if result == 'miss'}
    remaining = [name for name in SHIPS if name not in defender['sunk']]
    return {
        'fired': set(fired),
        'hits': hits,
        'misses': misses,
        'sunk_cells': sunk_cells,
        'open_hits': hits - sunk_cells,   # hits on ships still afloat
        'remaining': remaining,
        'sunk': list(defender['sunk']),
    }


def board_view(info):
    """The shooter's radar: X hit, # sunk, O miss, . unknown."""
    lines = ['    ' + ' '.join(COLUMNS)]
    for row in range(SIZE):
        marks = []
        for col in range(SIZE):
            cell = to_coord(col, row)
            marks.append('#' if cell in info['sunk_cells'] else 'X' if cell in info['hits'] else 'O' if cell in info['misses'] else '.')
        lines.append(f'{row + 1:>3} ' + ' '.join(marks))
    return '\n'.join(lines)


# Both sides get exactly the same words: no name, brand or color tells a model which side or which model family it
# is, so neither seat is favoured and neither model is cued to play "as itself".
def placement_prompt():
    return f"""You are an admiral in a game of Battleship.

GRID: 10×10. Columns A–J (left to right), rows 1–10 (top to bottom).

YOUR FLEET:
- Carrier: 5 cells
- Battleship: 4 cells
- Cruiser: 3 cells
- Submarine: 3 cells
- Destroyer: 2 cells

RULES:
- Give each ship a start cell and a direction: H extends RIGHT from the start, V extends DOWN.
- Ships must stay on the grid and must not overlap.
- Your opponent cannot see your fleet. Place it to survive as long as possible.

Return every ship's start cell and direction, and one short sentence about your plan."""


def fire_prompt(shooter, info, turn):
    # The player's memory of this match: every shot it has fired, what came of it and what it was thinking at the
    # time, and the notes it left itself last turn. It starts empty with every new match.
    def entry(shot):
        result = f"SUNK the {shot['ship']}" if shot['result'] == 'sunk' else shot['result'].upper()
        # The reason as it gave it (it was asked to keep it to 150 characters; longer ones end at a whole word).
        why = ' '.join((shot.get('why') or '').split())
        if len(why) > 160:
            why = why[:159].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
        return f"Turn {shot['turn']}: {shot['target']} → {result}" + (f' (you thought: "{why}")' if why else '')
    history = '\n'.join(entry(shot) for shot in shooter['shots']) or 'No shots yet. This is your first shot.'
    notes = (shooter.get('notes') or '').strip() or 'None yet.'
    # Its own fleet as it placed it at the start, and what the enemy has done to it since.
    fleet_lines = []
    for name, cells in shooter['ships'].items():
        spec = shooter['placement'].get(name, {})
        hits = shooter['hits_taken'].get(name, [])
        status = 'SUNK' if name in shooter['sunk'] else (f"hit at {', '.join(hits)}" if hits else 'untouched')
        fleet_lines.append(f"{name} ({len(cells)}): {cells[0]}–{cells[-1]} ({spec.get('direction', '?')}), {status}")
    fleet = '\n'.join(fleet_lines) or 'Not placed.'
    plan = (shooter.get('plan') or '').strip()
    fired = ', '.join(sorted(info['fired'], key=lambda c: (to_index(c)[1], to_index(c)[0]))) or 'none'
    afloat = ', '.join(f'{name} ({SHIPS[name]})' for name in info['remaining'])
    sunk = ', '.join(info['sunk']) or 'none yet'
    return f"""You are an admiral in a game of Battleship. Turn {turn}.

YOUR RADAR OF THE ENEMY GRID:
{board_view(info)}

Legend: X = hit on a ship still afloat, # = part of a sunk ship, O = miss, . = not fired at yet

ENEMY SHIPS STILL AFLOAT: {afloat}
ENEMY SHIPS SUNK: {sunk}
SCORE: you have sunk {len(info['sunk'])} of the enemy's 5 ships; the enemy has sunk {len(shooter['sunk'])} of your 5.

YOUR MEMORY OF THIS MATCH
Your fleet, as you placed it at the start of the match, and what the enemy has done to it:
{fleet}{chr(10) + 'Your plan when you placed it: ' + plan if plan else ''}

Every shot you have fired, what it hit, and what you were thinking:
{history}

Your notes from your last turn:
{notes}

CELLS ALREADY FIRED AT (never repeat these): {fired}

Choose ONE new cell to fire at, like E5 or J10, give a one-sentence explanation (at most 150 characters), and
write your updated notes to yourself (what you know about the enemy fleet and your plan, at most 600 characters)
for your next turns."""
