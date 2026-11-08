"""The CLIs connection end to end, with stand-ins for `claude`, `codex` and `node`, so no model is called.

Run from the project folder:  .venv/bin/python -m unittest tests/test_cli_connection.py
"""
from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FAKE_CLAUDE = r'''
import json, os, sys
args = sys.argv[1:]
log = os.environ['FAKE_LOG']
if args == ['--help']:
    print('  --effort <level>      Effort level for the current session\n                        (low, medium, high, xhigh, max)')
    sys.exit(0)
prompt = sys.stdin.read()
with open(log, 'a') as f:
    f.write(json.dumps({'tool': 'claude', 'args': args, 'nested': 'CLAUDECODE' in os.environ, 'cwd': os.getcwd(), 'prompt': prompt}) + '\n')
if os.environ.get('FAKE_FAIL'):
    print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': True, 'result': 'Not logged in'}))
    sys.exit(1)
schema = json.loads(args[args.index('--json-schema') + 1])
if 'plan' in schema['properties']:
    answer = {'Carrier': {'start': 'A1', 'direction': 'H'}, 'Battleship': {'start': 'A3', 'direction': 'H'},
              'Cruiser': {'start': 'A5', 'direction': 'H'}, 'Submarine': {'start': 'A7', 'direction': 'H'},
              'Destroyer': {'start': 'A9', 'direction': 'H'}, 'plan': 'Stacked along the west edge.'}
elif os.environ.get('FAKE_MEMORY'):
    import re
    fired = re.search(r'CELLS ALREADY FIRED AT[^:]*: (.*)', prompt).group(1).split(', ')
    target = next(c for c in ('E5', 'F6', 'G7', 'H8') if c not in fired)
    turn = re.search(r'Turn (\d+)\.', prompt).group(1)
    answer = {'target': target, 'reasoning': f'Reason for {target}.', 'notes': f'Notes written on turn {turn}.'}
else:
    answer = {'target': 'E5', 'reasoning': 'Claude stand-in fires at the centre.'}
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': '', 'structured_output': answer}))
'''

FAKE_CODEX = r'''
import json, sys
if sys.argv[1:] == ['debug', 'models']:
    level = lambda e: {'effort': e, 'description': e}
    print(json.dumps({'models': [
        {'slug': 'gpt-6-luna', 'display_name': 'GPT-6-Luna', 'visibility': 'list', 'priority': 2, 'default_reasoning_level': 'medium',
         'supported_reasoning_levels': [level('low'), level('medium'), level('high')]},
        {'slug': 'gpt-6.1-sol', 'display_name': 'GPT-6.1-Sol', 'visibility': 'list', 'priority': 1, 'default_reasoning_level': 'low',
         'supported_reasoning_levels': [level('low'), level('max')]},
        {'slug': 'hidden-model', 'display_name': 'Hidden', 'visibility': 'hide', 'priority': 0, 'supported_reasoning_levels': []},
    ]}))
'''

# Stands in for `node codex_bridge.mjs`: answers the way the bridge does.
FAKE_NODE = r'''
import json, os, sys
request = json.loads(sys.stdin.read())
with open(os.environ['FAKE_LOG'], 'a') as f:
    f.write(json.dumps({'tool': 'node', 'script': sys.argv[1], 'model': request['model'], 'effort': request['effort'],
                        'codex': os.environ.get('CODEX_PATH'), 'has_schema': 'properties' in request['schema']}) + '\n')
if 'plan' in request['schema']['properties']:
    answer = {'Carrier': {'start': 'J1', 'direction': 'V'}, 'Battleship': {'start': 'H1', 'direction': 'V'},
              'Cruiser': {'start': 'F1', 'direction': 'V'}, 'Submarine': {'start': 'D1', 'direction': 'V'},
              'Destroyer': {'start': 'B1', 'direction': 'V'}, 'plan': 'Columns on the east side.'}
elif os.environ.get('FAKE_MEMORY'):
    import re
    fired = re.search(r'CELLS ALREADY FIRED AT[^:]*: (.*)', request['prompt']).group(1).split(', ')
    answer = {'target': next(c for c in ('A1', 'B2', 'C3', 'D4') if c not in fired), 'reasoning': 'Codex stand-in.', 'notes': 'Codex notes.'}
else:
    answer = {'target': 'A1', 'reasoning': 'Codex stand-in opens in the corner.'}
print(json.dumps({'response': '```json\n' + json.dumps(answer) + '\n```', 'reasoning': ''}))
'''


def write_tool(folder, name, body):
    path = Path(folder) / name
    path.write_text(f'#!{sys.executable}\n' + textwrap.dedent(body))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


class CLIConnectionTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.log = Path(self.folder) / 'calls.jsonl'
        self.saved_env = dict(os.environ)
        os.environ.update({
            'CLAUDE_CLI': write_tool(self.folder, 'claude', FAKE_CLAUDE),
            'CODEX_CLI': write_tool(self.folder, 'codex', FAKE_CODEX),
            'NODE_BIN': write_tool(self.folder, 'node', FAKE_NODE),
            'FAKE_LOG': str(self.log),
            'CLAUDECODE': '1',
            'ARENA_HISTORY_PATH': str(Path(self.folder) / 'history.json'),
        })
        import cli_players
        cli_players.SDK = Path(self.folder)
        cli_players.cli_catalog(refresh=True)
        import app
        app.STATE = {}
        self.app = app
        self.client = app.app.test_client()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved_env)
        import cli_players
        cli_players.cli_catalog(refresh=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_catalog_lists_models_and_efforts(self):
        catalog = self.client.get('/api/config').get_json()['models']['cli']
        gpt = catalog['gpt']['models']
        self.assertEqual([m['id'] for m in gpt], ['gpt-6.1-sol', 'gpt-6-luna'])
        self.assertEqual(gpt[1]['name'], 'GPT-6 Luna')
        self.assertEqual(gpt[1]['efforts'], ['low', 'medium', 'high'])
        self.assertEqual(gpt[1]['default_effort'], 'medium')
        claude = catalog['claude']['models']
        self.assertIn('claude-haiku-5-5', [m['id'] for m in claude])
        self.assertEqual(claude[0]['efforts'], ['default', 'low', 'medium', 'high', 'xhigh', 'max'])

    def test_match_runs_through_both_tools(self):
        start = self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'gpt_effort': 'low',
                                                           'claude_model': 'claude-haiku-5-5', 'claude_effort': 'xhigh'}).get_json()
        players = start['game_state']['players']
        self.assertEqual((players['gpt']['name'], players['gpt']['effort']), ('GPT-6 Luna', 'low'))
        self.assertEqual((players['claude']['name'], players['claude']['effort']), ('Haiku 5.5', 'xhigh'))
        for _ in range(2):
            self.assertTrue(self.client.post('/api/place-ships').get_json()['success'])
        state = self.client.get('/api/game-state').get_json()
        self.assertEqual(state['phase'], 'battle')
        self.assertEqual(state['players']['claude']['reasoning'], 'Stacked along the west edge.')
        self.assertEqual(state['players']['gpt']['reasoning'], 'Columns on the east side.')
        shots = [self.client.post('/api/next-move').get_json() for _ in range(2)]
        by_player = {move['player']: move['shot']['target'] for move in shots}
        self.assertEqual(by_player, {'claude': 'E5', 'gpt': 'A1'})
        claude_calls = [c for c in self.calls() if c['tool'] == 'claude']
        args = claude_calls[-1]['args']
        self.assertEqual(args[args.index('--model') + 1], 'claude-haiku-5-5')
        self.assertEqual(args[args.index('--effort') + 1], 'xhigh')
        self.assertEqual(args[args.index('--tools') + 1], '')
        self.assertIn('--no-session-persistence', args)
        self.assertFalse(claude_calls[-1]['nested'])
        node_calls = [c for c in self.calls() if c['tool'] == 'node']
        self.assertTrue(node_calls[-1]['script'].endswith('codex_bridge.mjs'))
        self.assertEqual((node_calls[-1]['model'], node_calls[-1]['effort']), ('gpt-6-luna', 'low'))
        self.assertEqual(node_calls[-1]['codex'], os.environ['CODEX_CLI'])

    def test_model_default_effort_sends_no_flag(self):
        self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-opus-5-5'})
        for _ in range(2):
            self.client.post('/api/place-ships')
        args = [c for c in self.calls() if c['tool'] == 'claude'][-1]['args']
        self.assertNotIn('--effort', args)
        node = [c for c in self.calls() if c['tool'] == 'node'][-1]
        self.assertEqual(node['effort'], 'medium')

    def test_repeated_shot_stops_the_match(self):
        self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-haiku-5-5'})
        for _ in range(2):
            self.client.post('/api/place-ships')
        moves = [self.client.post('/api/next-move').get_json() for _ in range(2)]
        # The stand-ins always fire at the same cell, so each side's second shot repeats its first.
        repeat = self.client.post('/api/next-move')
        self.assertEqual(repeat.status_code, 502)
        self.assertIn('which it already fired at', repeat.get_json()['error'])
        state = self.client.get('/api/game-state').get_json()
        self.assertEqual(state['turn'], 2)
        self.assertEqual(sum(len(p['shots']) for p in state['players'].values()), 2)

    def test_memory_carries_through_the_match_and_resets(self):
        os.environ['FAKE_MEMORY'] = '1'
        # Play until Claude has fired twice.
        self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-haiku-5-5'})
        for _ in range(2):
            self.client.post('/api/place-ships')
        while len(self.client.get('/api/game-state').get_json()['players']['claude']['shots']) < 2:
            self.assertEqual(self.client.post('/api/next-move').status_code, 200)
        prompts = [c['prompt'] for c in self.calls() if c['tool'] == 'claude' and 'Turn ' in c['prompt']]
        last = prompts[-1]
        self.assertIn('YOUR MEMORY OF THIS MATCH', last)
        # The memory begins at placement: its own fleet as placed, and the plan it gave then.
        self.assertIn('Carrier (5): A1–E1 (H)', last)
        self.assertIn('Your plan when you placed it: Stacked along the west edge.', last)
        self.assertRegex(last, r'Turn \d+: E5 → (MISS|HIT)')
        self.assertIn('you thought: "Reason for E5."', last)
        self.assertRegex(last, r'Your notes from your last turn:\nNotes written on turn \d+\.')
        # A new match starts with a fresh memory.
        self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-haiku-5-5'})
        for _ in range(2):
            self.client.post('/api/place-ships')
        state = self.client.get('/api/game-state').get_json()
        if state['current_player'] == 'gpt':
            self.client.post('/api/next-move')
        self.client.post('/api/next-move')
        first = [c['prompt'] for c in self.calls() if c['tool'] == 'claude' and 'Turn ' in c['prompt']][-1]
        self.assertIn('No shots yet. This is your first shot.', first)
        self.assertIn('Your notes from your last turn:\nNone yet.', first)

    def test_illegal_placement_stops_the_match(self):
        import cli_players
        original = cli_players.read_placement
        cli_players.read_placement = lambda data: ({**original(data)[0], 'Carrier': {'start': 'J10', 'direction': 'H'}}, 'Off the edge.')
        try:
            self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-haiku-5-5'})
            response = self.client.post('/api/place-ships')
            self.assertEqual(response.status_code, 502)
            self.assertIn('placed an illegal fleet', response.get_json()['error'])
            state = self.client.get('/api/game-state').get_json()
            self.assertEqual(state['phase'], 'placement')
            self.assertFalse(any(state['placement_done'].values()))
        finally:
            cli_players.read_placement = original

    def test_cli_failure_is_reported(self):
        os.environ['FAKE_FAIL'] = '1'
        self.client.post('/api/start-games', json={'mode': 'cli', 'gpt_model': 'gpt-6-luna', 'claude_model': 'claude-haiku-5-5'})
        responses = [self.client.post('/api/place-ships') for _ in range(2)]
        # Claude's placement fails each time it is asked (once or twice, depending on who deploys first).
        failed = [r for r in responses if r.status_code == 502]
        self.assertTrue(failed)
        for response in failed:
            self.assertIn('Haiku 5.5: Claude Code CLI: Not logged in', response.get_json()['error'])

    def test_missing_tool_blocks_the_side(self):
        os.environ['CODEX_CLI'] = str(Path(self.folder) / 'missing-codex')
        import cli_players
        cli_players.cli_catalog(refresh=True)
        catalog = self.client.get('/api/config').get_json()['models']['cli']
        self.assertEqual(catalog['gpt']['models'], [])
        self.assertIn('Codex CLI not found', catalog['gpt']['error'])
        response = self.client.post('/api/start-games', json={'mode': 'cli'})
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
