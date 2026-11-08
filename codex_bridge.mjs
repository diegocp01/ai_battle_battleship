// One Codex turn through the Codex SDK, for the CLIs connection (cli_players.py runs this with Node).
// Reads a JSON request on stdin, {prompt, model, effort, schema}, and prints one JSON line:
// {response, reasoning} with the model's final answer, or {error}.
// The turn runs in an empty temporary folder in a read-only sandbox, with network and web search off.
// CODEX_PATH points the SDK at the Codex CLI already installed and signed in on this machine.
import { Codex } from '@openai/codex-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const folder = await mkdtemp(join(tmpdir(), 'battleship-codex-'));
try {
    const codex = new Codex(process.env.CODEX_PATH ? {codexPathOverride: process.env.CODEX_PATH} : {});
    const thread = codex.startThread({
        model: request.model,
        modelReasoningEffort: request.effort && request.effort !== 'default' ? request.effort : undefined,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        workingDirectory: folder,
        skipGitRepoCheck: true,
        networkAccessEnabled: false,
        webSearchEnabled: false,
    });
    const turn = await thread.run(request.prompt, {outputSchema: request.schema});
    const reasoning = turn.items.filter(item => item.type === 'reasoning').map(item => item.text).join('\n\n');
    process.stdout.write(JSON.stringify({response: turn.finalResponse, reasoning}) + '\n');
} catch (error) {
    process.stdout.write(JSON.stringify({error: String(error?.message || error)}) + '\n');
    process.exitCode = 1;
} finally {
    await rm(folder, {recursive: true, force: true});
}
