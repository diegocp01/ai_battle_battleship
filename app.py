"""AI Battleship arena: two AI admirals deploy their fleets and trade fire while you watch in 3D."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
import json
import os
import random
import threading
import time
import uuid

from flask import Flask, jsonify, render_template, request

from battleship import SHIPS, fire, fire_prompt, fleet_destroyed, knowledge, new_player, normalize_coord, \
    placement_prompt, validate_placement
from players import MODES, SIMULATED_STRATEGY, ProviderError, api_placement, api_shot, cli_placement, cli_shot, model_catalog, \
    select_models, simulated_placement, simulated_shot

app = Flask(__name__)

STATE = {}
# One model call at a time: a second tab cannot fire a shot while one is in flight.
MOVE_LOCK = threading.Lock()

# Every finished real game is saved here so the setup page can show all-time results.
HISTORY_PATH = Path(os.getenv('ARENA_HISTORY_PATH') or Path(__file__).resolve().parent / 'data' / 'battle-history.json')
HISTORY_LOCK = threading.Lock()
PLAYERS = ('gpt', 'claude')


def other(player):
    return 'claude' if player == 'gpt' else 'gpt'


def new_state(mode='test', players=None):
    players = players or select_models('test', {})
    first = random.choice(PLAYERS)
    return {
        'match_id': uuid.uuid4().hex,
        'mode': mode,
        'phase': 'placement',
        'turn': 0,
        'current_player': first,
        'first_player': first,
        'game_over': False,
        'winner': None,
        'last_shot': None,
        'seed': random.randrange(1 << 30),
        'players': {
            key: {
                **new_player(),
                'model': players[key + '_model'],
                'effort': players[key + '_effort'],
                'speed': players[key + '_speed'],
                'name': players[key + '_name'],
                'reasoning': '',
                'last_time': 0.0,
                'total_time': 0.0,
            } for key in PLAYERS
        },
    }


def read_history():
    if not HISTORY_PATH.exists():
        return []
    try:
        games = json.loads(HISTORY_PATH.read_text()).get('games', [])
    except (OSError, ValueError, AttributeError):
        raise RuntimeError('Match history is damaged.')
    return games if isinstance(games, list) else []


def save_game(state):
    """Append a finished game to the history file. Test games are not saved."""
    if state['mode'] == 'test':
        return
    gpt, claude = state['players']['gpt'], state['players']['claude']
    entry = {
        'match_id': state['match_id'],
        'winner': state['winner'],
        'turns': state['turn'],
        'mode': state['mode'],
        'gpt_name': gpt['name'],
        'claude_name': claude['name'],
        'gpt_effort': gpt['effort'],
        'claude_effort': claude['effort'],
        'gpt_speed': gpt.get('speed', 'standard'),
        'claude_speed': claude.get('speed', 'standard'),
        'gpt_shots': len(gpt['shots']),
        'claude_shots': len(claude['shots']),
        'gpt_hits': sum(1 for shot in gpt['shots'] if shot['result'] != 'miss'),
        'claude_hits': sum(1 for shot in claude['shots'] if shot['result'] != 'miss'),
        'gpt_time': round(gpt['total_time'], 1),
        'claude_time': round(claude['total_time'], 1),
        'finished_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }
    with HISTORY_LOCK:
        try:
            games = read_history()
        except RuntimeError:
            app.logger.warning('History at %s is damaged; this game was not saved.', HISTORY_PATH)
            return
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = HISTORY_PATH.with_suffix('.tmp')
        temporary.write_text(json.dumps({'games': games + [entry]}, indent=2) + '\n')
        os.replace(temporary, HISTORY_PATH)


def rng_for(state, player, salt):
    """Deterministic per move, so a retried request gives the same simulated answer."""
    return random.Random(f"{state['seed']}:{player}:{salt}")


def client_state(state, started=True):
    players = {}
    for key in PLAYERS:
        player = state['players'][key]
        fleet = []
        for name, size in SHIPS.items():
            spec = player['placement'].get(name)
            if not spec:
                continue
            fleet.append({
                'name': name,
                'size': size,
                'start': spec['start'],
                'direction': spec['direction'],
                'cells': player['ships'][name],
                'hits': list(player['hits_taken'][name]),
                'sunk': name in player['sunk'],
            })
        shots = player['shots']
        hits = sum(1 for shot in shots if shot['result'] != 'miss')
        players[key] = {
            'name': player['name'],
            'model': player['model'],
            'effort': player['effort'],
            'speed': player.get('speed', 'standard'),
            'fleet': fleet,
            'sunk': list(player['sunk']),
            'shots': shots,
            'reasoning': player['reasoning'][:700],
            'last_time': round(player['last_time'], 2),
            'total_time': round(player['total_time'], 2),
            'stats': {'shots': len(shots), 'hits': hits, 'sunk': sum(1 for shot in shots if shot['result'] == 'sunk')},
        }
    return {
        'started': started,
        'match_id': state['match_id'],
        'mode': state['mode'],
        'phase': state['phase'],
        'turn': state['turn'],
        'current_player': state['current_player'],
        'first_player': state['first_player'],
        'placement_done': {key: bool(state['players'][key]['ships']) for key in PLAYERS},
        'game_over': state['game_over'],
        'winner': state['winner'],
        'last_shot': state['last_shot'],
        'players': players,
    }


def busy():
    return jsonify({'error': 'A move is already in progress. Wait for it to finish.'}), 409


@app.before_request
def local_requests_only():
    # Only this app's own page may post to it.
    if request.method == 'POST' and request.headers.get('Origin'):
        if urlparse(request.headers['Origin']).netloc != request.host:
            return jsonify({'error': 'Use the app from its own localhost page.'}), 403


@app.route('/')
def index():
    return render_template('index.html', ships=SHIPS)


@app.route('/api/config')
def config():
    return jsonify({'default_mode': 'test', 'models': model_catalog(), 'ships': SHIPS})


@app.route('/api/match-history')
def match_history():
    try:
        games = read_history()
    except RuntimeError:
        return jsonify({'error': 'Match history is unavailable.'}), 503
    totals = {'gpt': 0, 'claude': 0}
    for game in games:
        if game.get('winner') in totals:
            totals[game['winner']] += 1
    response = jsonify({'games': games, 'totals': totals})
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/api/reset', methods=['POST'])
def reset():
    global STATE
    STATE = {}
    return jsonify({'success': True})


@app.route('/api/start-games', methods=['POST'])
def start_games():
    global STATE
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Send a JSON object with mode and models.'}), 400
    mode = data.get('mode', 'test')
    if mode not in MODES:
        return jsonify({'error': 'Choose Test, CLIs or API keys.'}), 400
    try:
        players = select_models(mode, data)
    except ProviderError as error:
        return jsonify({'error': str(error)}), 400
    STATE = new_state(mode, players)
    return jsonify({'success': True, 'game_state': client_state(STATE)})


@app.route('/api/game-state')
def game_state():
    if not STATE:
        return jsonify(client_state(new_state(), started=False))
    return jsonify(client_state(STATE))


@app.route('/api/place-ships', methods=['POST'])
def place_ships():
    state = STATE
    if not state:
        return jsonify({'error': 'No match in progress. Start a new match.'}), 400
    if state['phase'] != 'placement':
        return jsonify({'error': 'Both fleets are already deployed.'}), 400
    if not MOVE_LOCK.acquire(blocking=False):
        return busy()
    try:
        # The first player to fire also deploys first.
        order = [state['first_player'], other(state['first_player'])]
        player = next(key for key in order if not state['players'][key]['ships'])
        seat = state['players'][player]
        started = time.time()
        try:
            if state['mode'] == 'test':
                placement, reasoning = simulated_placement(SIMULATED_STRATEGY, rng_for(state, player, 'placement'))
            elif state['mode'] == 'cli':
                placement, reasoning = cli_placement(player, placement_prompt(), seat['model'], seat['effort'])
            else:
                placement, reasoning = api_placement(player, placement_prompt(), seat['model'], seat['effort'], seat['speed'])
        except ProviderError as error:
            return jsonify({'error': f"{seat['name']}: {error}"}), 502
        except Exception as error:  # SDK and network errors
            return jsonify({'error': f"{seat['name']} error: {error}"}), 502
        elapsed = time.time() - started
        fleet, problem = validate_placement(placement)
        if problem:
            # An illegal fleet stops the match: nothing is placed for it, and the move can be retried. The app
            # never deploys a fleet on a model's behalf, so results only ever reflect the model's own play.
            return jsonify({'error': f"{seat['name']} placed an illegal fleet ({problem}). Nothing was placed; retry the move."}), 502
        # Store the normalized layout, read back from the validated cells.
        seat['placement'] = {name: {'start': cells[0], 'direction': 'H' if cells[0][1:] == cells[1][1:] else 'V'} for name, cells in fleet.items()}
        seat['ships'] = fleet
        seat['reasoning'] = reasoning or 'Fleet deployed.'
        # The match memory begins here: the fleet as placed and the plan behind it come back in every shot prompt.
        seat['plan'] = (reasoning or '')[:300]
        seat['last_time'] = elapsed
        seat['total_time'] += elapsed
        if all(state['players'][key]['ships'] for key in PLAYERS):
            state['phase'] = 'battle'
        return jsonify({'success': True, 'player': player, 'game_state': client_state(state)})
    finally:
        MOVE_LOCK.release()


@app.route('/api/next-move', methods=['POST'])
def next_move():
    state = STATE
    if not state:
        return jsonify({'error': 'No match in progress. Start a new match.'}), 400
    if state['phase'] != 'battle' or state['game_over']:
        return jsonify({'error': 'The battle is not in progress.'}), 400
    if not MOVE_LOCK.acquire(blocking=False):
        return busy()
    try:
        player = state['current_player']
        shooter, defender = state['players'][player], state['players'][other(player)]
        turn = state['turn'] + 1
        info = knowledge(shooter, defender)
        started = time.time()
        try:
            notes = ''
            if state['mode'] == 'test':
                target, reasoning = simulated_shot(player, SIMULATED_STRATEGY, info, rng_for(state, player, turn))
            elif state['mode'] == 'cli':
                target, reasoning, notes = cli_shot(player, fire_prompt(shooter, info, turn), shooter['model'], shooter['effort'])
            else:
                target, reasoning, notes = api_shot(player, fire_prompt(shooter, info, turn), shooter['model'], shooter['effort'], shooter['speed'])
        except ProviderError as error:
            return jsonify({'error': f"{shooter['name']}: {error}"}), 502
        except Exception as error:
            return jsonify({'error': f"{shooter['name']} error: {error}"}), 502
        elapsed = time.time() - started
        requested = normalize_coord(target)
        if not requested or requested in info['fired']:
            # An invalid or repeated shot stops the match: the turn is not played and can be retried. The app never
            # fires a shot on a model's behalf, so saved results only ever reflect the model's own moves.
            problem = 'which it already fired at' if requested else 'which is not a cell on the grid'
            return jsonify({'error': f"{shooter['name']} fired at {requested or repr(target)[:16]}, {problem}. The turn was not played; retry the move."}), 502
        target = requested
        result, ship = fire(defender, target)
        shot = {'turn': turn, 'target': target, 'result': result, 'ship': ship, 'why': (reasoning or '')[:300]}
        shooter['shots'].append(shot)
        # The player's memory for its next turn: its notes replace the old ones (kept if it wrote none).
        if notes:
            shooter['notes'] = notes
        shooter['reasoning'] = reasoning or 'Fired.'
        shooter['last_time'] = elapsed
        shooter['total_time'] += elapsed
        state['turn'] = turn
        state['last_shot'] = {**shot, 'player': player, 'sunk_cells': defender['ships'][ship] if result == 'sunk' else None}
        if fleet_destroyed(defender):
            state['game_over'] = True
            state['winner'] = player
            state['phase'] = 'complete'
            save_game(state)
        else:
            state['current_player'] = other(player)
        return jsonify({'success': True, 'player': player, 'shot': state['last_shot'], 'game_state': client_state(state)})
    finally:
        MOVE_LOCK.release()


if __name__ == '__main__':
    app.run(debug=True, port=int(os.getenv('PORT', '5001')))
