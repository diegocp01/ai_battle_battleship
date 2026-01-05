// DOM Elements
const modalOverlay = document.getElementById('modal-overlay');
const gameCountSelect = document.getElementById('game-count');
const gptModelSelect = document.getElementById('gpt-model');
const claudeModelSelect = document.getElementById('claude-model');
const btnRun = document.getElementById('btn-run');
const gameContainer = document.getElementById('game-container');
const statsSection = document.getElementById('stats-section');
const phaseIndicator = document.getElementById('phase-indicator');

// Model name display elements
const gptModelNameEl = document.getElementById('gpt-model-name');
const claudeModelNameEl = document.getElementById('claude-model-name');

// Game state display elements
const gameNumberEl = document.getElementById('game-number');
const totalGamesEl = document.getElementById('total-games');
const gameStatusEl = document.getElementById('game-status');

// Board elements
const gptBoardEl = document.getElementById('gpt-board');
const claudeBoardEl = document.getElementById('claude-board');

// GPT elements
const gptThinkingEl = document.getElementById('gpt-thinking');
const gptWinsEl = document.getElementById('gpt-wins');
const gptLossesEl = document.getElementById('gpt-losses');
const gptReasoningEl = document.getElementById('gpt-reasoning');
const gptTimerEl = document.getElementById('gpt-timer');
const gptLastTimeEl = document.getElementById('gpt-last-time');
const gptTotalTimeEl = document.getElementById('gpt-total-time');
const gptLastMoveEl = document.getElementById('gpt-last-move');
const gptShipsEl = document.getElementById('gpt-ships');

// Claude elements
const claudeThinkingEl = document.getElementById('claude-thinking');
const claudeWinsEl = document.getElementById('claude-wins');
const claudeLossesEl = document.getElementById('claude-losses');
const claudeReasoningEl = document.getElementById('claude-reasoning');
const claudeTimerEl = document.getElementById('claude-timer');
const claudeLastTimeEl = document.getElementById('claude-last-time');
const claudeTotalTimeEl = document.getElementById('claude-total-time');
const claudeLastMoveEl = document.getElementById('claude-last-move');
const claudeShipsEl = document.getElementById('claude-ships');

// Stats table
const statsBody = document.getElementById('stats-body');

// Constants
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SHIPS = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

// Game state
let isRunning = false;
let timerInterval = null;
let timerStartTime = null;
let currentTimerEl = null;

// Initialize boards
function initBoards() {
    gptBoardEl.innerHTML = '';
    claudeBoardEl.innerHTML = '';

    for (let row of ROWS) {
        for (let col of COLUMNS) {
            const coord = `${col}${row}`;

            // GPT board cell
            const gptCell = document.createElement('div');
            gptCell.className = 'cell';
            gptCell.dataset.coord = coord;
            gptBoardEl.appendChild(gptCell);

            // Claude board cell
            const claudeCell = document.createElement('div');
            claudeCell.className = 'cell';
            claudeCell.dataset.coord = coord;
            claudeBoardEl.appendChild(claudeCell);
        }
    }
}

// Initialize
initBoards();
btnRun.addEventListener('click', startGames);

function startTimer(timerEl) {
    stopTimer();
    timerStartTime = Date.now();
    currentTimerEl = timerEl;
    timerEl.textContent = '0.0s';

    timerInterval = setInterval(() => {
        const elapsed = (Date.now() - timerStartTime) / 1000;
        timerEl.textContent = elapsed.toFixed(1) + 's';
    }, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function startGames() {
    const numGames = parseInt(gameCountSelect.value);
    const gptModel = gptModelSelect.value;
    const claudeModel = claudeModelSelect.value;

    try {
        const response = await fetch('/api/start-games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                num_games: numGames,
                gpt_model: gptModel,
                claude_model: claudeModel
            })
        });

        const data = await response.json();
        if (data.success) {
            modalOverlay.classList.add('hidden');
            gameContainer.classList.remove('hidden');
            statsSection.classList.remove('hidden');

            initBoards();
            resetShipTags();
            updateUI(data.game_state);
            runGameLoop();
        }
    } catch (error) {
        console.error('Error starting games:', error);
        alert('Failed to start games. Check console for details.');
    }
}

function resetShipTags() {
    document.querySelectorAll('.ship-tag').forEach(tag => {
        tag.classList.remove('sunk');
    });
}

async function runGameLoop() {
    if (isRunning) return;
    isRunning = true;

    while (isRunning) {
        // Get current state
        const stateResponse = await fetch('/api/game-state');
        const state = await stateResponse.json();

        if (state.all_games_complete) {
            gameStatusEl.textContent = '🏆 All battles complete!';
            phaseIndicator.textContent = 'Series Complete';
            isRunning = false;
            break;
        }

        if (state.game_over) {
            // Show result briefly, then start next game
            await sleep(3000);

            const nextResponse = await fetch('/api/next-game', { method: 'POST' });
            const nextData = await nextResponse.json();

            if (nextData.success) {
                initBoards();
                resetShipTags();
                updateUI(nextData.game_state);
                gptReasoningEl.textContent = 'Waiting for move...';
                claudeReasoningEl.textContent = 'Waiting for move...';
                gptLastMoveEl.textContent = '—';
                claudeLastMoveEl.textContent = '—';
            } else {
                isRunning = false;
                break;
            }

            await sleep(1000);
            continue;
        }

        // Handle placement phase
        if (state.current_phase === 'placement') {
            phaseIndicator.textContent = '🚢 Ship Placement Phase';

            // Place ships for each player that hasn't placed yet
            if (!state.placement_done.gpt || !state.placement_done.claude) {
                const placingPlayer = !state.placement_done.gpt ? 'gpt' : 'claude';

                if (placingPlayer === 'gpt') {
                    gptThinkingEl.classList.remove('hidden');
                    gameStatusEl.textContent = "GPT is placing ships...";
                    startTimer(gptTimerEl);
                } else {
                    claudeThinkingEl.classList.remove('hidden');
                    gameStatusEl.textContent = "Claude is placing ships...";
                    startTimer(claudeTimerEl);
                }

                try {
                    const placeResponse = await fetch('/api/place-ships', { method: 'POST' });
                    const placeData = await placeResponse.json();

                    stopTimer();
                    gptThinkingEl.classList.add('hidden');
                    claudeThinkingEl.classList.add('hidden');

                    if (placeData.success) {
                        updateUI(placeData.game_state);
                        gameStatusEl.textContent = `${placeData.player === 'gpt' ? 'GPT' : 'Claude'} placed ships!`;
                    } else {
                        console.error('Placement error:', placeData.error);
                        gameStatusEl.textContent = 'Error: ' + placeData.error;
                        isRunning = false;
                        break;
                    }
                } catch (error) {
                    console.error('API error:', error);
                    stopTimer();
                    gptThinkingEl.classList.add('hidden');
                    claudeThinkingEl.classList.add('hidden');
                    gameStatusEl.textContent = 'API Error - check console';
                    isRunning = false;
                    break;
                }

                await sleep(1500);
                continue;
            }
        }

        // Handle firing phase
        if (state.current_phase === 'firing') {
            phaseIndicator.textContent = '🎯 Battle Phase';

            // Show thinking indicator for current player
            if (state.current_player === 'gpt') {
                gptThinkingEl.classList.remove('hidden');
                claudeThinkingEl.classList.add('hidden');
                gameStatusEl.textContent = "GPT is aiming...";
                startTimer(gptTimerEl);
            } else {
                claudeThinkingEl.classList.remove('hidden');
                gptThinkingEl.classList.add('hidden');
                gameStatusEl.textContent = "Claude is aiming...";
                startTimer(claudeTimerEl);
            }

            // Make the move
            try {
                const moveResponse = await fetch('/api/next-move', { method: 'POST' });
                const moveData = await moveResponse.json();

                stopTimer();
                gptThinkingEl.classList.add('hidden');
                claudeThinkingEl.classList.add('hidden');

                if (moveData.success) {
                    updateUI(moveData.game_state);

                    // Update last move display
                    const resultEmoji = moveData.result === 'miss' ? '💨' :
                        moveData.result.startsWith('sunk') ? '💥🔥' : '💥';
                    if (moveData.player === 'gpt') {
                        gptLastMoveEl.textContent = `${moveData.target} ${resultEmoji}`;
                    } else {
                        claudeLastMoveEl.textContent = `${moveData.target} ${resultEmoji}`;
                    }

                    // Show result
                    if (moveData.game_state.game_over) {
                        const winner = moveData.game_state.winner;
                        gameStatusEl.textContent = winner === 'gpt' ?
                            '🎉 GPT wins the battle!' : '🎉 Claude wins the battle!';
                        phaseIndicator.textContent = 'Battle Complete';
                    } else {
                        let resultText = moveData.result === 'miss' ? 'Miss!' : 'Hit!';
                        if (moveData.sunk_ship) {
                            resultText = `SUNK ${moveData.sunk_ship}! 🔥`;
                        }
                        gameStatusEl.textContent = `${moveData.player === 'gpt' ? 'GPT' : 'Claude'} fired at ${moveData.target}: ${resultText}`;
                    }
                } else {
                    console.error('Move error:', moveData.error);
                    gameStatusEl.textContent = 'Error: ' + moveData.error;
                    isRunning = false;
                    break;
                }
            } catch (error) {
                console.error('API error:', error);
                gameStatusEl.textContent = 'API Error - check console';
                stopTimer();
                gptThinkingEl.classList.add('hidden');
                claudeThinkingEl.classList.add('hidden');
                isRunning = false;
                break;
            }

            await sleep(2000);
        }
    }
}

function updateUI(state) {
    // Update game number
    gameNumberEl.textContent = state.current_game;
    totalGamesEl.textContent = state.total_games;

    // Update boards
    updateBoard(gptBoardEl, state.gpt_board, state.gpt_ships, 'gpt');
    updateBoard(claudeBoardEl, state.claude_board, state.claude_ships, 'claude');

    // Update stats
    gptWinsEl.textContent = state.gpt_stats.wins;
    gptLossesEl.textContent = state.gpt_stats.losses;
    claudeWinsEl.textContent = state.claude_stats.wins;
    claudeLossesEl.textContent = state.claude_stats.losses;

    // Update timing
    gptLastTimeEl.textContent = state.gpt_last_time + 's';
    gptTotalTimeEl.textContent = state.gpt_total_time + 's';
    claudeLastTimeEl.textContent = state.claude_last_time + 's';
    claudeTotalTimeEl.textContent = state.claude_total_time + 's';

    // Update reasoning
    if (state.gpt_reasoning) {
        gptReasoningEl.textContent = state.gpt_reasoning;
    }
    if (state.claude_reasoning) {
        claudeReasoningEl.textContent = state.claude_reasoning;
    }

    // Update ships remaining
    updateShipsRemaining('gpt', state.gpt_ships_remaining);
    updateShipsRemaining('claude', state.claude_ships_remaining);

    // Update game history table
    updateStatsTable(state.game_history);

    // Update model display names
    if (state.gpt_display_name) {
        gptModelNameEl.textContent = state.gpt_display_name;
    }
    if (state.claude_display_name) {
        claudeModelNameEl.textContent = state.claude_display_name;
    }
}

function updateBoard(boardEl, boardState, ships, player) {
    const cells = boardEl.querySelectorAll('.cell');

    // Build a map of ship cells for styling with direction detection
    const shipCells = {};
    if (ships) {
        for (const [shipName, coords] of Object.entries(ships)) {
            // Detect direction by checking if coordinates are horizontal or vertical
            let direction = 'H'; // Default horizontal
            if (coords.length >= 2) {
                const first = coords[0];
                const second = coords[1];
                // If column (first char) is same, it's vertical
                if (first[0] === second[0]) {
                    direction = 'V';
                }
            }

            coords.forEach((coord, idx) => {
                shipCells[coord] = {
                    ship: shipName,
                    isFirst: idx === 0,
                    isLast: idx === coords.length - 1,
                    isMiddle: idx > 0 && idx < coords.length - 1,
                    direction: direction,
                    total: coords.length,
                    position: idx
                };
            });
        }
    }

    cells.forEach(cell => {
        const coord = cell.dataset.coord;
        const value = boardState[coord];

        // Reset classes
        cell.className = 'cell';
        cell.textContent = '';

        if (value === 'S') {
            // Ship cell
            cell.classList.add('ship');
            cell.classList.add(player === 'gpt' ? 'ship-gpt' : 'ship-claude');

            // Add ship part styling
            if (shipCells[coord]) {
                const info = shipCells[coord];
                cell.classList.add(info.direction === 'H' ? 'ship-horizontal' : 'ship-vertical');

                if (info.isFirst) {
                    cell.classList.add('ship-bow');
                } else if (info.isLast) {
                    cell.classList.add('ship-stern');
                } else {
                    cell.classList.add('ship-hull');
                }
            }
        } else if (value === 'X') {
            // Hit - check if this was a ship cell
            cell.classList.add('hit');
            if (shipCells[coord]) {
                cell.classList.add('hit-ship');
                const info = shipCells[coord];
                cell.classList.add(player === 'gpt' ? 'ship-gpt' : 'ship-claude');
                cell.classList.add(info.direction === 'H' ? 'ship-horizontal' : 'ship-vertical');
                if (info.isFirst) cell.classList.add('ship-bow');
                else if (info.isLast) cell.classList.add('ship-stern');
                else cell.classList.add('ship-hull');
            }
            cell.textContent = '💥';
        } else if (value === 'O') {
            // Miss
            cell.classList.add('miss');
            cell.textContent = '•';
        }
    });
}

function updateShipsRemaining(player, remaining) {
    const container = player === 'gpt' ? gptShipsEl : claudeShipsEl;
    const tags = container.querySelectorAll('.ship-tag');

    tags.forEach(tag => {
        const shipName = tag.dataset.ship;
        if (!remaining.includes(shipName)) {
            tag.classList.add('sunk');
        } else {
            tag.classList.remove('sunk');
        }
    });
}

function updateStatsTable(history) {
    statsBody.innerHTML = '';

    history.forEach(game => {
        const row = document.createElement('tr');

        let winnerClass = game.winner === 'GPT' ? 'winner-gpt' : 'winner-claude';

        row.innerHTML = `
            <td>${game.game}</td>
            <td>${game.time}</td>
            <td class="${winnerClass}">${game.winner}</td>
            <td>${game.turns || 0}</td>
            <td>${game.gpt_time || 0}</td>
            <td>${game.claude_time || 0}</td>
        `;

        statsBody.appendChild(row);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
