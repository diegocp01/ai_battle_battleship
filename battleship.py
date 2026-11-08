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
        'shots': [],           # shots this player fired: {'turn', 'target', 'result', 'ship'}
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


def placement_prompt(player_name):
    return f"""You are {player_name}, an admiral in a game of Battleship.

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


def fire_prompt(player_name, shooter, info, turn):
    recent = shooter['shots'][-12:]
    history = '\n'.join(
        f"Turn {shot['turn']}: {shot['target']} → " + (f"SUNK the {shot['ship']}" if shot['result'] == 'sunk' else shot['result'].upper())
        for shot in recent
    ) or 'No shots yet. This is your first shot.'
    if len(shooter['shots']) > len(recent):
        history = f'(last {len(recent)} of {len(shooter["shots"])} shots)\n' + history
    fired = ', '.join(sorted(info['fired'], key=lambda c: (to_index(c)[1], to_index(c)[0]))) or 'none'
    afloat = ', '.join(f'{name} ({SHIPS[name]})' for name in info['remaining'])
    sunk = ', '.join(info['sunk']) or 'none yet'
    return f"""You are {player_name}, an admiral in a game of Battleship. Turn {turn}.

YOUR RADAR OF THE ENEMY GRID:
{board_view(info)}

Legend: X = hit on a ship still afloat, # = part of a sunk ship, O = miss, . = not fired at yet

ENEMY SHIPS STILL AFLOAT: {afloat}
ENEMY SHIPS SUNK: {sunk}

YOUR RECENT SHOTS:
{history}

CELLS ALREADY FIRED AT (never repeat these): {fired}

Choose ONE new cell to fire at, like E5 or J10, and give a one-sentence explanation."""
