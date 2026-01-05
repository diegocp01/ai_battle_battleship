from flask import Flask, render_template, jsonify, request
import random
from datetime import datetime
import time
import os

# Import the model functions
from openai_model_v1 import call_chatgpt_placement, call_chatgpt_fire
from anthropic_model_v1 import call_claude_placement, call_claude_fire

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Use server-side storage instead of session cookies (which have 4KB limit)
GAME_STATE = {}

# Grid configuration
COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
ROWS = list(range(1, 11))  # 1-10

# Generate all valid coordinates
COORDS = [f"{col}{row}" for col in COLUMNS for row in ROWS]

# Ship definitions: name -> size
SHIPS = {
    'Carrier': 5,
    'Battleship': 4,
    'Cruiser': 3,
    'Submarine': 3,
    'Destroyer': 2
}

# Model name mappings
GPT_MODELS = {
    'gpt-5.1': 'gpt-5.1',
    'gpt-5.2': 'gpt-5.2'
}

CLAUDE_MODELS = {
    'claude-haiku-4.5': 'claude-haiku-4-5-20251001',
    'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929'
}

GPT_DISPLAY_NAMES = {
    'gpt-5.1': 'GPT 5.1 Medium',
    'gpt-5.2': 'GPT 5.2 Medium'
}

CLAUDE_DISPLAY_NAMES = {
    'claude-haiku-4.5': 'Claude Haiku 4.5 Thinking',
    'claude-sonnet-4.5': 'Claude Sonnet 4.5 Thinking'
}


def coord_to_index(coord):
    """Convert coordinate like 'A1' to (col_idx, row_idx)."""
    col = coord[0].upper()
    row = int(coord[1:])
    return (COLUMNS.index(col), row - 1)


def index_to_coord(col_idx, row_idx):
    """Convert indices to coordinate string."""
    if 0 <= col_idx < 10 and 0 <= row_idx < 10:
        return f"{COLUMNS[col_idx]}{row_idx + 1}"
    return None


def get_ship_coords(start_coord, direction, size):
    """
    Get list of coordinates for a ship.
    direction: 'H' (horizontal) or 'V' (vertical)
    Returns list of coords or None if invalid.
    """
    col_idx, row_idx = coord_to_index(start_coord)
    coords = []
    
    for i in range(size):
        if direction == 'H':
            new_col = col_idx + i
            new_row = row_idx
        else:  # 'V'
            new_col = col_idx
            new_row = row_idx + i
        
        coord = index_to_coord(new_col, new_row)
        if coord is None:
            return None  # Out of bounds
        coords.append(coord)
    
    return coords


def validate_placement(ships_placement, existing_coords=None):
    """
    Validate ship placement.
    ships_placement: {ship_name: {'start': 'A1', 'direction': 'H'|'V'}}
    Returns (is_valid, ship_coords_dict, error_message)
    """
    if existing_coords is None:
        existing_coords = set()
    
    all_coords = {}
    occupied = set(existing_coords)
    
    for ship_name, placement in ships_placement.items():
        if ship_name not in SHIPS:
            return False, None, f"Unknown ship: {ship_name}"
        
        size = SHIPS[ship_name]
        start = placement.get('start', '').upper()
        direction = placement.get('direction', '').upper()
        
        if start not in COORDS:
            return False, None, f"Invalid start coordinate for {ship_name}: {start}"
        
        if direction not in ['H', 'V']:
            return False, None, f"Invalid direction for {ship_name}: {direction}"
        
        coords = get_ship_coords(start, direction, size)
        if coords is None:
            return False, None, f"Ship {ship_name} goes out of bounds"
        
        # Check for overlaps
        for coord in coords:
            if coord in occupied:
                return False, None, f"Ship {ship_name} overlaps at {coord}"
            occupied.add(coord)
        
        all_coords[ship_name] = coords
    
    # Check all ships are placed
    if set(ships_placement.keys()) != set(SHIPS.keys()):
        missing = set(SHIPS.keys()) - set(ships_placement.keys())
        return False, None, f"Missing ships: {missing}"
    
    return True, all_coords, None


def init_player_state():
    """Initialize state for one player."""
    return {
        'ships': {},           # {ship_name: [coords]}
        'ships_placement': {}, # {ship_name: {'start': 'A1', 'direction': 'H'}}
        'board': {coord: '.' for coord in COORDS},  # . = empty, S = ship, X = hit, O = miss
        'shots_fired': [],     # [(coord, result), ...]  result = 'hit'|'miss'|'sunk:ShipName'
        'ships_remaining': list(SHIPS.keys()),
        'ships_hits': {ship: [] for ship in SHIPS},  # Track hits per ship
    }


def init_game_state(gpt_model='gpt-5.1', claude_model='claude-haiku-4.5'):
    """Initialize a fresh game state."""
    # Randomly decide who goes first in firing phase
    gpt_first = random.choice([True, False])
    
    return {
        'gpt': init_player_state(),
        'claude': init_player_state(),
        'current_phase': 'placement',  # 'placement' -> 'firing' -> 'complete'
        'placement_done': {'gpt': False, 'claude': False},
        'current_player': 'gpt' if gpt_first else 'claude',
        'first_player': 'gpt' if gpt_first else 'claude',
        'game_over': False,
        'winner': None,
        'turn_count': 0,
        'gpt_reasoning': '',
        'claude_reasoning': '',
        'gpt_stats': {'wins': 0, 'losses': 0},
        'claude_stats': {'wins': 0, 'losses': 0},
        'current_game': 1,
        'total_games': 1,
        'game_history': [],
        'gpt_total_time': 0.0,
        'claude_total_time': 0.0,
        'gpt_last_time': 0.0,
        'claude_last_time': 0.0,
        # Model settings
        'gpt_model': gpt_model,
        'claude_model': claude_model,
        'gpt_model_id': GPT_MODELS.get(gpt_model, 'gpt-5.1'),
        'claude_model_id': CLAUDE_MODELS.get(claude_model, 'claude-haiku-4-5-20251001'),
        'gpt_display_name': GPT_DISPLAY_NAMES.get(gpt_model, 'GPT 5.1 Medium'),
        'claude_display_name': CLAUDE_DISPLAY_NAMES.get(claude_model, 'Claude Haiku 4.5 Thinking'),
    }


def generate_placement_prompt(player_name):
    """Generate prompt for AI to place ships."""
    return f"""You are {player_name} in a game of Battleship.

GRID: 10x10
- Columns: A, B, C, D, E, F, G, H, I, J
- Rows: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

SHIPS TO PLACE:
- Carrier: 5 cells
- Battleship: 4 cells
- Cruiser: 3 cells
- Submarine: 3 cells
- Destroyer: 2 cells

RULES:
- Ships cannot overlap
- Ships cannot extend beyond the grid
- Direction: H = horizontal (extends right), V = vertical (extends down)

Place all 5 ships. For each ship, specify the starting cell and direction."""


def generate_fire_prompt(player_name, own_shots, opponent_board_view, turn_count):
    """Generate prompt for AI to fire a shot."""
    # Build shot history text (limit to last 10 for brevity)
    shots_text = ""
    recent_shots = own_shots[-10:] if len(own_shots) > 10 else own_shots
    if recent_shots:
        shots_list = []
        for shot, result in recent_shots:
            if result.startswith('sunk:'):
                ship_name = result.split(':')[1]
                shots_list.append(f"{shot}: SUNK {ship_name}!")
            elif result == 'hit':
                shots_list.append(f"{shot}: HIT")
            else:
                shots_list.append(f"{shot}: MISS")
        shots_text = "\n".join(shots_list)
        if len(own_shots) > 10:
            shots_text = f"(showing last 10 of {len(own_shots)} shots)\n" + shots_text
    else:
        shots_text = "No shots fired yet."
    
    # Build opponent board view (what we know about their board)
    board_lines = []
    board_lines.append("   " + " ".join(COLUMNS))
    for row in ROWS:
        row_cells = []
        for col in COLUMNS:
            coord = f"{col}{row}"
            cell = opponent_board_view.get(coord, '.')
            if cell == 'X':
                row_cells.append('X')  # Hit
            elif cell == 'O':
                row_cells.append('O')  # Miss
            else:
                row_cells.append('.')  # Unknown
        row_str = f"{row:2d} " + " ".join(row_cells)
        board_lines.append(row_str)
    board_text = "\n".join(board_lines)
    
    # List already-shot coordinates
    already_shot = [shot for shot, _ in own_shots]
    already_shot_text = ", ".join(already_shot) if already_shot else "None"
    
    return f"""You are {player_name} in Battleship. Turn {turn_count}.

OPPONENT'S BOARD (your view):
{board_text}

Legend: X = Hit, O = Miss, . = Unknown

YOUR RECENT SHOT HISTORY:
{shots_text}

COORDINATES ALREADY FIRED (do NOT repeat): {already_shot_text}

Choose ONE coordinate to fire at (e.g., A1, J10). Pick a coordinate you have NOT fired at before."""


def process_shot(game_state, shooter, target_coord):
    """
    Process a shot from shooter to opponent.
    Returns (result, sunk_ship_name or None)
    result: 'hit', 'miss', or 'sunk:ShipName'
    """
    opponent = 'claude' if shooter == 'gpt' else 'gpt'
    opponent_state = game_state[opponent]
    
    # Check what's at that coordinate
    cell = opponent_state['board'].get(target_coord)
    
    if cell == 'S':  # Ship present
        opponent_state['board'][target_coord] = 'X'  # Mark as hit
        
        # Find which ship was hit
        for ship_name, coords in opponent_state['ships'].items():
            if target_coord in coords:
                opponent_state['ships_hits'][ship_name].append(target_coord)
                
                # Check if ship is sunk
                if len(opponent_state['ships_hits'][ship_name]) == len(coords):
                    opponent_state['ships_remaining'].remove(ship_name)
                    return f'sunk:{ship_name}', ship_name
                
                return 'hit', None
    else:
        # Miss
        opponent_state['board'][target_coord] = 'O'
        return 'miss', None
    
    return 'miss', None


def get_opponent_board_view(game_state, viewer):
    """Get what the viewer can see of opponent's board (only their shots)."""
    opponent = 'claude' if viewer == 'gpt' else 'gpt'
    opponent_board = game_state[opponent]['board']
    
    # Only show hits and misses, not ship locations
    view = {}
    for coord, cell in opponent_board.items():
        if cell in ['X', 'O']:
            view[coord] = cell
        else:
            view[coord] = '.'
    return view


def check_game_over(game_state):
    """Check if game is over (all ships of one player sunk)."""
    if not game_state['gpt']['ships_remaining']:
        return True, 'claude'
    if not game_state['claude']['ships_remaining']:
        return True, 'gpt'
    return False, None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/start-games', methods=['POST'])
def start_games():
    """Start a new series of games."""
    global GAME_STATE
    data = request.get_json()
    num_games = int(data.get('num_games', 1))
    num_games = max(1, min(10, num_games))
    
    gpt_model = data.get('gpt_model', 'gpt-5.1')
    claude_model = data.get('claude_model', 'claude-haiku-4.5')
    
    state = init_game_state(gpt_model=gpt_model, claude_model=claude_model)
    state['total_games'] = num_games
    GAME_STATE = state
    
    return jsonify({
        'success': True,
        'game_state': get_client_state(state)
    })


@app.route('/api/game-state', methods=['GET'])
def get_game_state_route():
    """Get current game state."""
    global GAME_STATE
    if not GAME_STATE:
        GAME_STATE = init_game_state()
    return jsonify(get_client_state(GAME_STATE))


@app.route('/api/place-ships', methods=['POST'])
def place_ships():
    """Have one player place their ships."""
    global GAME_STATE
    state = GAME_STATE
    if not state:
        return jsonify({'error': 'No game in progress'}), 400
    
    if state['current_phase'] != 'placement':
        return jsonify({'error': 'Not in placement phase'}), 400
    
    # Determine which player to place next
    if not state['placement_done']['gpt']:
        player = 'gpt'
        prompt = generate_placement_prompt("Player A (GPT)")
        
        start_time = time.time()
        try:
            placement, reasoning = call_chatgpt_placement(prompt, state['gpt_model_id'])
        except Exception as e:
            return jsonify({'error': f'GPT API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['gpt_reasoning'] = reasoning or 'Ship placement complete.'
        state['gpt_last_time'] = round(elapsed, 2)
        state['gpt_total_time'] = round(state['gpt_total_time'] + elapsed, 2)
        
    elif not state['placement_done']['claude']:
        player = 'claude'
        prompt = generate_placement_prompt("Player B (Claude)")
        
        start_time = time.time()
        try:
            placement, reasoning = call_claude_placement(prompt, state['claude_model_id'])
        except Exception as e:
            return jsonify({'error': f'Claude API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['claude_reasoning'] = reasoning or 'Ship placement complete.'
        state['claude_last_time'] = round(elapsed, 2)
        state['claude_total_time'] = round(state['claude_total_time'] + elapsed, 2)
    else:
        return jsonify({'error': 'All placements done'}), 400
    
    # Validate placement
    is_valid, ship_coords, error = validate_placement(placement)
    if not is_valid:
        return jsonify({'error': f'Invalid placement from {player}: {error}'}), 400
    
    # Apply placement
    state[player]['ships'] = ship_coords
    state[player]['ships_placement'] = placement
    
    # Mark ship locations on board
    for coords in ship_coords.values():
        for coord in coords:
            state[player]['board'][coord] = 'S'
    
    state['placement_done'][player] = True
    
    # Check if both done
    if state['placement_done']['gpt'] and state['placement_done']['claude']:
        state['current_phase'] = 'firing'
    
    GAME_STATE = state
    
    return jsonify({
        'success': True,
        'player': player,
        'game_state': get_client_state(state)
    })


@app.route('/api/next-move', methods=['POST'])
def next_move():
    """Execute the next firing move."""
    global GAME_STATE
    state = GAME_STATE
    if not state:
        return jsonify({'error': 'No game in progress'}), 400
    
    if state['current_phase'] != 'firing':
        return jsonify({'error': 'Not in firing phase'}), 400
    
    if state['game_over']:
        return jsonify({'error': 'Game is over'}), 400
    
    current_player = state['current_player']
    state['turn_count'] += 1
    
    # Get opponent board view and shot history
    own_shots = state[current_player]['shots_fired']
    opponent_view = get_opponent_board_view(state, current_player)
    
    if current_player == 'gpt':
        prompt = generate_fire_prompt("Player A (GPT)", own_shots, opponent_view, state['turn_count'])
        
        start_time = time.time()
        try:
            target, reasoning = call_chatgpt_fire(prompt, state['gpt_model_id'])
        except Exception as e:
            return jsonify({'error': f'GPT API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['gpt_reasoning'] = reasoning or 'No reasoning provided.'
        state['gpt_last_time'] = round(elapsed, 2)
        state['gpt_total_time'] = round(state['gpt_total_time'] + elapsed, 2)
    else:
        prompt = generate_fire_prompt("Player B (Claude)", own_shots, opponent_view, state['turn_count'])
        
        start_time = time.time()
        try:
            target, reasoning = call_claude_fire(prompt, state['claude_model_id'])
        except Exception as e:
            return jsonify({'error': f'Claude API error: {str(e)}'}), 500
        elapsed = time.time() - start_time
        
        state['claude_reasoning'] = reasoning or 'No reasoning provided.'
        state['claude_last_time'] = round(elapsed, 2)
        state['claude_total_time'] = round(state['claude_total_time'] + elapsed, 2)
    
    target = target.upper()
    
    # Validate move
    if target not in COORDS:
        return jsonify({'error': f'Invalid coordinate: {target}'}), 400
    
    # Check if already fired at this location
    already_fired = [shot for shot, _ in own_shots]
    if target in already_fired:
        return jsonify({'error': f'Already fired at {target}'}), 400
    
    # Process the shot
    result, sunk_ship = process_shot(state, current_player, target)
    state[current_player]['shots_fired'].append((target, result))
    
    # Check for game over
    is_over, winner = check_game_over(state)
    if is_over:
        state['game_over'] = True
        state['winner'] = winner
        state['current_phase'] = 'complete'
        
        # Update stats
        if winner == 'gpt':
            state['gpt_stats']['wins'] += 1
            state['claude_stats']['losses'] += 1
            winner_name = state['gpt_display_name']
        else:
            state['claude_stats']['wins'] += 1
            state['gpt_stats']['losses'] += 1
            winner_name = state['claude_display_name']
        
        state['game_history'].append({
            'game': state['current_game'],
            'time': datetime.now().strftime('%H:%M:%S'),
            'winner': winner_name,
            'turns': state['turn_count'],
            'gpt_time': state['gpt_total_time'],
            'claude_time': state['claude_total_time']
        })
    else:
        # Switch turns
        state['current_player'] = 'claude' if current_player == 'gpt' else 'gpt'
    
    GAME_STATE = state
    
    return jsonify({
        'success': True,
        'player': current_player,
        'target': target,
        'result': result,
        'sunk_ship': sunk_ship,
        'game_state': get_client_state(state)
    })


@app.route('/api/next-game', methods=['POST'])
def next_game():
    """Start the next game in the series."""
    global GAME_STATE
    state = GAME_STATE
    if not state:
        return jsonify({'error': 'No game in progress'}), 400
    
    if state['current_game'] >= state['total_games']:
        return jsonify({'error': 'All games completed'}), 400
    
    # Preserve stats, history, and model settings
    gpt_stats = state['gpt_stats']
    claude_stats = state['claude_stats']
    history = state['game_history']
    total_games = state['total_games']
    current_game = state['current_game'] + 1
    gpt_model = state['gpt_model']
    claude_model = state['claude_model']
    
    # Create fresh game state
    new_state = init_game_state(gpt_model=gpt_model, claude_model=claude_model)
    new_state['gpt_stats'] = gpt_stats
    new_state['claude_stats'] = claude_stats
    new_state['game_history'] = history
    new_state['total_games'] = total_games
    new_state['current_game'] = current_game
    
    GAME_STATE = new_state
    
    return jsonify({
        'success': True,
        'game_state': get_client_state(new_state)
    })


def get_client_state(state):
    """Get state formatted for the client."""
    # Build board views for client
    # GPT board shows GPT's ships and where Claude has fired
    # Claude board shows Claude's ships and where GPT has fired
    
    def build_board_display(player_state, show_ships=True):
        """Build display board for client."""
        display = {}
        for coord, cell in player_state['board'].items():
            if cell == 'S':
                display[coord] = 'S' if show_ships else '.'
            elif cell == 'X':
                display[coord] = 'X'
            elif cell == 'O':
                display[coord] = 'O'
            else:
                display[coord] = '.'
        return display
    
    # For display, show ships on own board
    gpt_board = build_board_display(state['gpt'], show_ships=True)
    claude_board = build_board_display(state['claude'], show_ships=True)
    
    return {
        'current_phase': state['current_phase'],
        'placement_done': state['placement_done'],
        'current_player': state['current_player'],
        'first_player': state['first_player'],
        'turn_count': state['turn_count'],
        'game_over': state['game_over'],
        'winner': state['winner'],
        
        # Board states
        'gpt_board': gpt_board,
        'claude_board': claude_board,
        
        # Ship info
        'gpt_ships': state['gpt']['ships'],
        'claude_ships': state['claude']['ships'],
        'gpt_ships_remaining': state['gpt']['ships_remaining'],
        'claude_ships_remaining': state['claude']['ships_remaining'],
        
        # Shot history (limit to avoid large payloads)
        'gpt_shots': state['gpt']['shots_fired'][-20:],
        'claude_shots': state['claude']['shots_fired'][-20:],
        
        # Reasoning (truncate if too long)
        'gpt_reasoning': state['gpt_reasoning'][:500] if state['gpt_reasoning'] else '',
        'claude_reasoning': state['claude_reasoning'][:500] if state['claude_reasoning'] else '',
        
        # Stats
        'gpt_stats': state['gpt_stats'],
        'claude_stats': state['claude_stats'],
        'current_game': state['current_game'],
        'total_games': state['total_games'],
        'game_history': state['game_history'],
        'all_games_complete': state['game_over'] and state['current_game'] >= state['total_games'],
        
        # Timing
        'gpt_total_time': state.get('gpt_total_time', 0.0),
        'claude_total_time': state.get('claude_total_time', 0.0),
        'gpt_last_time': state.get('gpt_last_time', 0.0),
        'claude_last_time': state.get('claude_last_time', 0.0),
        
        # Model names for UI
        'gpt_display_name': state.get('gpt_display_name', 'GPT 5.1 Medium'),
        'claude_display_name': state.get('claude_display_name', 'Claude Haiku 4.5 Thinking'),
    }


if __name__ == '__main__':
    app.run(debug=True, port=5001)
