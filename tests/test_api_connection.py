"""The API connection end to end, with stand-ins for the OpenAI and Anthropic clients, so nothing is sent.

Run from the project folder:  .venv/bin/python -m unittest tests/test_api_connection.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PLACEMENT = {'Carrier': {'start': 'A1', 'direction': 'H'}, 'Battleship': {'start': 'A3', 'direction': 'H'},
             'Cruiser': {'start': 'A5', 'direction': 'H'}, 'Submarine': {'start': 'A7', 'direction': 'H'},
             'Destroyer': {'start': 'A9', 'direction': 'H'}, 'plan': 'West edge.'}


def answer(schema, target):
    return dict(PLACEMENT) if 'plan' in schema['properties'] else {'target': target, 'reasoning': f'Firing at {target}.'}


def caps(efforts=('low', 'medium', 'high', 'xhigh', 'max'), structured=True, adaptive=True):
    tree = {'structured_outputs': {'supported': structured},
            'thinking': {'supported': True, 'types': {'adaptive': {'supported': adaptive}, 'enabled': {'supported': not adaptive}}},
            'effort': {'supported': bool(efforts), **{level: {'supported': level in efforts} for level in ('low', 'medium', 'high', 'xhigh', 'max')}}}
    return NS(to_dict=lambda: tree)


class FakeAnthropic:
    def __init__(self, calls, refuse=False):
        self.calls, self.refuse = calls, refuse
        self.models = NS(list=lambda: [
            NS(id='claude-opus-5-5', display_name='Claude Opus 5.5', capabilities=caps()),
            NS(id='claude-haiku-5-5', display_name='Claude Haiku 5.5', capabilities=caps()),
            NS(id='claude-old', display_name='Claude Old', capabilities=caps(efforts=(), structured=False, adaptive=False)),
        ])
        self.beta = NS(messages=NS(stream=self.stream))

    @contextmanager
    def stream(self, **params):
        self.calls.append(('anthropic', params))
        if self.refuse:
            message = NS(stop_reason='refusal', stop_details=NS(category='cyber'), content=[])
        else:
            text = json.dumps(answer(params['output_config']['format']['schema'], 'E5'))
            # Thinking text comes back only when it is asked for summarized.
            summarized = params.get('thinking', {}).get('display') == 'summarized'
            thought = 'The centre is open. E5 crosses the most places a ship can still fit, so I will fire there.' if summarized else ''
            message = NS(stop_reason='end_turn', content=[NS(type='thinking', thinking=thought), NS(type='text', text=text)])
        yield NS(get_final_message=lambda: message)


class FakeOpenAI:
    def __init__(self, calls, no_summaries=False):
        self.calls, self.no_summaries = calls, no_summaries
        self.models = NS(list=lambda: [NS(id=i) for i in ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-nano', 'dall-e-3', 'text-embedding-3-large')])
        self.responses = NS(create=self.create)

    def create(self, **params):
        self.calls.append(('openai', params))
        summary = params.get('reasoning', {}).get('summary')
        if summary and self.no_summaries:
            import httpx, openai
            raise openai.BadRequestError('Reasoning summaries are not available for this organization.',
                                         response=httpx.Response(400, request=httpx.Request('POST', 'https://api.openai.com/v1/responses')), body=None)
        output = [NS(type='reasoning', summary=[NS(type='summary_text', text='**Opening shot**\n\nNo hits yet. A1 starts a sweep from the corner, so I will fire at A1.')] if summary else []),
                  NS(type='message')]
        return NS(status='completed', output=output, output_text=json.dumps(answer(params['text']['format']['schema'], 'A1')))


CODEX_CATALOG = [
    {'slug': 'gpt-6.1-sol', 'display_name': 'GPT-6.1-Sol', 'priority': 1, 'visibility': 'list', 'supported_in_api': True,
     'default_reasoning_level': 'low', 'supported_reasoning_levels': [{'effort': e} for e in ('low', 'medium', 'high', 'max', 'ultra')],
     'service_tiers': [{'id': 'priority', 'name': 'Fast', 'description': '2x speed, increased usage'}]},
    {'slug': 'gpt-6-luna', 'display_name': 'GPT-6-Luna', 'priority': 6, 'visibility': 'list', 'supported_in_api': True,
     'default_reasoning_level': 'medium', 'supported_reasoning_levels': [{'effort': e} for e in ('low', 'medium', 'high')],
     'service_tiers': [{'id': 'priority', 'name': 'Fast', 'description': '1.5x speed'}]},
    {'slug': 'gpt-not-on-api', 'display_name': 'Hidden', 'priority': 2, 'visibility': 'list', 'supported_in_api': True,
     'supported_reasoning_levels': [{'effort': 'low'}]},
]


class APIConnectionTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.saved_env = dict(os.environ)
        os.environ.update({'OPENAI_API_KEY': 'test-openai', 'ANTHROPIC_API_KEY': 'test-anthropic',
                           'ARENA_HISTORY_PATH': str(Path(self.folder) / 'history.json')})
        import anthropic_player, cli_players, openai_player, players
        self.calls = []
        self.patches = [(anthropic_player, '_client', anthropic_player._client), (openai_player, '_client', openai_player._client),
                        (cli_players, 'codex_catalog', cli_players.codex_catalog), (players, 'cli_catalog', players.cli_catalog),
                        (players, '_load_env', players._load_env)]
        # Never read the real .env: the tests set their own (fake) keys.
        players._load_env = lambda: None
        anthropic_player._client = lambda: FakeAnthropic(self.calls, refuse=bool(os.getenv('FAKE_REFUSE')))
        openai_player._client = lambda: FakeOpenAI(self.calls, no_summaries=bool(os.getenv('FAKE_NO_SUMMARIES')))
        cli_players.codex_catalog = lambda: CODEX_CATALOG
        players.cli_catalog = lambda: {'gpt': {'models': [], 'default': ''}, 'claude': {'models': [], 'default': ''}}
        players.api_catalog(refresh=True)
        import app
        app.STATE = {}
        self.client = app.app.test_client()

    def tearDown(self):
        for module, name, value in self.patches:
            setattr(module, name, value)
        os.environ.clear()
        os.environ.update(self.saved_env)
        import players
        players.api_catalog(refresh=True)

    def start(self, **settings):
        return self.client.post('/api/start-games', json={'mode': 'api', **settings})

    def play_two_turns(self):
        for _ in range(2):
            self.assertTrue(self.client.post('/api/place-ships').get_json()['success'])
        for _ in range(2):
            self.assertTrue(self.client.post('/api/next-move').get_json()['success'])
        return {provider: [params for name, params in self.calls if name == provider] for provider in ('anthropic', 'openai')}

    def test_catalog_reads_models_efforts_and_speeds(self):
        api = self.client.get('/api/config').get_json()['models']['api']
        claude = {m['id']: m for m in api['claude']['models']}
        self.assertEqual(list(claude), ['claude-opus-5-5', 'claude-haiku-5-5'])
        self.assertEqual(claude['claude-opus-5-5']['name'], 'Opus 5.5')
        self.assertEqual(claude['claude-opus-5-5']['efforts'], ['default', 'low', 'medium', 'high', 'xhigh', 'max'])
        self.assertEqual([s['id'] for s in claude['claude-opus-5-5']['speeds']], ['standard', 'fast'])
        self.assertEqual([s['id'] for s in claude['claude-haiku-5-5']['speeds']], ['standard'])
        gpt = {m['id']: m for m in api['gpt']['models']}
        self.assertEqual(list(gpt), ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-nano'])
        self.assertEqual(gpt['gpt-6.1-sol']['efforts'], ['default', 'low', 'medium', 'high', 'max'])
        self.assertEqual(gpt['gpt-6.1-sol']['model_default'], 'low')
        self.assertEqual(gpt['gpt-6-luna']['speeds'][1], {'id': 'priority', 'name': 'Fast', 'description': '1.5x speed'})
        self.assertEqual(gpt['gpt-5.6-nano']['name'], 'GPT-5.6 Nano')
        self.assertEqual([s['id'] for s in gpt['gpt-5.6-nano']['speeds']], ['standard'])

    def test_effort_and_fast_modes_reach_the_requests(self):
        state = self.start(gpt_model='gpt-6-luna', gpt_effort='high', gpt_speed='priority',
                           claude_model='claude-opus-5-5', claude_effort='xhigh', claude_speed='fast').get_json()['game_state']
        self.assertEqual((state['players']['claude']['effort'], state['players']['claude']['speed']), ('xhigh', 'fast'))
        calls = self.play_two_turns()
        claude = calls['anthropic'][-1]
        self.assertEqual(claude['model'], 'claude-opus-5-5')
        self.assertEqual(claude['speed'], 'fast')
        self.assertEqual(claude['betas'], ['fast-mode-2026-02-01'])
        self.assertEqual(claude['output_config']['effort'], 'xhigh')
        self.assertEqual(claude['output_config']['format']['type'], 'json_schema')
        self.assertEqual(claude['thinking'], {'type': 'adaptive', 'display': 'summarized'})
        self.assertNotIn('fallbacks', claude)
        gpt = calls['openai'][-1]
        self.assertEqual(gpt['model'], 'gpt-6-luna')
        self.assertEqual(gpt['reasoning'], {'effort': 'high', 'summary': 'auto'})
        self.assertEqual(gpt['service_tier'], 'priority')
        self.assertTrue(gpt['text']['format']['strict'])
        moves = self.client.get('/api/game-state').get_json()['players']
        self.assertEqual({moves['claude']['shots'][0]['target'], moves['gpt']['shots'][0]['target']}, {'E5', 'A1'})
        # The legend line comes from each model's reasoning summary.
        self.assertEqual(moves['claude']['thought'], 'E5 crosses the most places a ship can still fit, so I will fire there.')
        self.assertEqual(moves['gpt']['thought'], 'A1 starts a sweep from the corner, so I will fire at A1.')

    def test_defaults_send_no_effort_and_standard_speed(self):
        self.start(gpt_model='gpt-6-luna', claude_model='claude-opus-5-5')
        calls = self.play_two_turns()
        claude, gpt = calls['anthropic'][-1], calls['openai'][-1]
        self.assertNotIn('effort', claude['output_config'])
        self.assertNotIn('speed', claude)
        # Standard speed keeps the server-side fallback for safety declines.
        self.assertEqual((claude['fallbacks'], claude['betas']), ('default', ['server-side-fallback-2026-07-01']))
        # No effort is sent, only the request for a reasoning summary.
        self.assertEqual(gpt['reasoning'], {'summary': 'auto'})
        self.assertNotIn('service_tier', gpt)

    def test_move_plays_when_reasoning_summaries_are_refused(self):
        os.environ['FAKE_NO_SUMMARIES'] = '1'
        self.start(gpt_model='gpt-6-luna', claude_model='claude-opus-5-5')
        calls = self.play_two_turns()
        # Each refused request is asked again without the summary, and the legend falls back to the answer's reason.
        self.assertEqual([c.get('reasoning') for c in calls['openai'][-2:]], [{'summary': 'auto'}, None])
        gpt = self.client.get('/api/game-state').get_json()['players']['gpt']
        self.assertEqual((gpt['thought'], gpt['reasoning']), ('', 'Firing at A1.'))

    def test_speed_a_model_lacks_falls_back_to_standard(self):
        state = self.start(gpt_model='gpt-5.6-nano', gpt_speed='priority', claude_model='claude-haiku-5-5', claude_speed='fast').get_json()['game_state']
        self.assertEqual(state['players']['gpt']['speed'], 'standard')
        self.assertEqual(state['players']['claude']['speed'], 'standard')

    def test_refusal_is_reported(self):
        os.environ['FAKE_REFUSE'] = '1'
        self.start(gpt_model='gpt-6-luna', claude_model='claude-opus-5-5')
        errors = [r.get_json()['error'] for r in (self.client.post('/api/place-ships') for _ in range(2)) if r.status_code == 502]
        self.assertTrue(errors)
        self.assertIn('Opus 5.5: The model declined this move (cyber).', errors)

    def test_missing_key_says_where_it_goes(self):
        del os.environ['ANTHROPIC_API_KEY']
        import players
        players.api_catalog(refresh=True)
        side = self.client.get('/api/config').get_json()['models']['api']['claude']
        self.assertEqual(side['models'], [])
        self.assertIn('Add ANTHROPIC_API_KEY to the .env file', side['error'])
        self.assertEqual(self.start().status_code, 400)


if __name__ == '__main__':
    unittest.main()
