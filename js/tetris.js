/**
 * 테트리스 멀티플레이어 게임 로직
 */

import { getDatabase, ref, set, update as updateDB, onValue, off } from './firebase-config.js';
import { Storage, URLParams, showNotification } from './utils.js';

// 게임 설정
const CONFIG = {
    COLS: 10,
    ROWS: 20,
    BLOCK_SIZE: 30,
    INITIAL_SPEED: 1000, // 1초
    SPEED_DECREASE: 50, // 레벨당 속도 증가
    MIN_SPEED: 100,
};

// 테트리미노 모양 정의 (SRS - Super Rotation System)
const TETROMINOS = {
    'I': {
        shape: [[1,1,1,1]],
        color: '#00F0F0'
    },
    'O': {
        shape: [[1,1],[1,1]],
        color: '#F0F000'
    },
    'T': {
        shape: [[0,1,0],[1,1,1]],
        color: '#A000F0'
    },
    'S': {
        shape: [[0,1,1],[1,1,0]],
        color: '#00F000'
    },
    'Z': {
        shape: [[1,1,0],[0,1,1]],
        color: '#F00000'
    },
    'J': {
        shape: [[1,0,0],[1,1,1]],
        color: '#0000F0'
    },
    'L': {
        shape: [[0,0,1],[1,1,1]],
        color: '#F0A000'
    }
};

const TETROMINO_TYPES = Object.keys(TETROMINOS);

// 게임 상태
let gameState = {
    roomId: null,
    playerId: null,
    gameId: 'tetris',
    players: {},
    isHost: false,
    gameOver: false,

    // 내 게임 보드
    board: [],
    currentPiece: null,
    nextPiece: null,
    holdPiece: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    garbageQueue: 0,

    // 게임 진행
    dropCounter: 0,
    dropInterval: CONFIG.INITIAL_SPEED,
    lastTime: 0,

    // 순위
    rankings: [],
};

// Canvas 설정
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-piece-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-piece-canvas');
const holdCtx = holdCanvas.getContext('2d');

// 키보드 입력
const keys = {
    ArrowLeft: false,
    ArrowRight: false,
    ArrowDown: false,
    ArrowUp: false,
    Space: false,
};

let db = null;
let roomRef = null;
let lastKeyPress = 0;
const KEY_REPEAT_DELAY = 100;

/**
 * 초기화
 */
async function init() {
    const roomId = URLParams.get('room');
    const playerId = Storage.getPlayerId();
    const gameId = 'tetris';

    if (!roomId) {
        showNotification('방 정보가 없습니다.', 'error');
        setTimeout(() => URLParams.navigate('lobby.html', { game: gameId }), 1500);
        return;
    }

    gameState.roomId = roomId;
    gameState.playerId = playerId;
    gameState.gameId = gameId;
    gameState.players = {};

    // Firebase 초기화
    db = await getDatabase();
    roomRef = ref(db, `rooms/${gameId}/${roomId}`);

    // 보드 초기화
    initBoard();

    // 이벤트 리스너
    setupEventListeners();

    // Firebase 동기화
    setupFirebaseSync();

    // 게임 루프 시작
    gameLoop(0);
}

/**
 * 보드 초기화
 */
function initBoard() {
    gameState.board = Array(CONFIG.ROWS).fill(null).map(() => Array(CONFIG.COLS).fill(0));
}

/**
 * Firebase 동기화 설정
 */
function setupFirebaseSync() {
    // 방 정보 동기화
    onValue(roomRef, (snapshot) => {
        const roomData = snapshot.val();
        if (!roomData) {
            showNotification('방이 존재하지 않습니다.', 'error');
            setTimeout(() => URLParams.navigate('lobby.html', { game: gameState.gameId }), 1500);
            return;
        }

        gameState.isHost = roomData.hostId === gameState.playerId;

        // 플레이어 정보 업데이트
        if (roomData.players) {
            const playersList = Object.values(roomData.players);

            playersList.forEach((player) => {
                if (!gameState.players[player.id]) {
                    gameState.players[player.id] = {
                        id: player.id,
                        name: player.name,
                        color: player.color,
                        alive: true,
                        score: 0,
                        lines: 0,
                        rank: 0,
                        board: Array(CONFIG.ROWS).fill(null).map(() => Array(CONFIG.COLS).fill(0)),
                    };
                }
            });

            updateOpponentBoards();
        }

        // 호스트가 게임 상태를 초기화
        if (gameState.isHost && !roomData.game) {
            initGameState();
        }
    });

    // 게임 상태 동기화
    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
    onValue(gameRef, (snapshot) => {
        const gameData = snapshot.val();
        if (gameData) {
            // 다른 플레이어들의 보드 동기화
            if (gameData.players) {
                Object.keys(gameData.players).forEach(playerId => {
                    if (playerId !== gameState.playerId && gameState.players[playerId]) {
                        const serverPlayer = gameData.players[playerId];
                        gameState.players[playerId].alive = serverPlayer.alive;
                        gameState.players[playerId].score = serverPlayer.score;
                        gameState.players[playerId].lines = serverPlayer.lines;
                        gameState.players[playerId].board = serverPlayer.board || gameState.players[playerId].board;
                        gameState.players[playerId].rank = serverPlayer.rank || 0;
                    }
                });

                updateOpponentBoards();
                updateRankingUI();
            }

            // 방해줄 수신
            if (gameData.garbage && gameData.garbage[gameState.playerId]) {
                const garbageCount = gameData.garbage[gameState.playerId];
                if (garbageCount > 0) {
                    gameState.garbageQueue += garbageCount;
                    updateGarbageIndicator();

                    // 방해줄 소비
                    const garbageRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/garbage/${gameState.playerId}`);
                    set(garbageRef, 0);
                }
            }

            // 게임 오버 체크
            if (gameData.gameFinished) {
                handleGameOver(gameData.rankings);
            }
        }
    });
}

/**
 * 게임 상태 초기화 (호스트만)
 */
async function initGameState() {
    const playersData = {};
    Object.values(gameState.players).forEach(player => {
        playersData[player.id] = {
            id: player.id,
            name: player.name,
            alive: true,
            score: 0,
            lines: 0,
            rank: 0,
            board: Array(CONFIG.ROWS).fill(null).map(() => Array(CONFIG.COLS).fill(0)),
        };
    });

    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
    await set(gameRef, {
        players: playersData,
        garbage: {},
        gameFinished: false,
        rankings: [],
        startTime: Date.now(),
    });
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 키보드 입력
    document.addEventListener('keydown', (e) => {
        if (gameState.gameOver) return;

        if (e.key === 'Shift') {
            holdCurrentPiece();
            e.preventDefault();
            return;
        }

        if (!gameState.currentPiece) return;

        if (e.key === 'ArrowLeft') {
            movePiece(-1, 0);
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            movePiece(1, 0);
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            movePiece(0, 1);
            gameState.dropCounter = 0;
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            rotatePiece();
            e.preventDefault();
        } else if (e.key === ' ') {
            hardDrop();
            e.preventDefault();
        }
    });

    // 나가기 버튼
    document.getElementById('leave-game-btn').addEventListener('click', () => {
        if (confirm('게임을 나가시겠습니까?')) {
            URLParams.navigate('lobby.html', { game: gameState.gameId });
        }
    });

    // 게임 오버 모달 버튼
    document.getElementById('return-lobby-btn').addEventListener('click', () => {
        URLParams.navigate('lobby.html', { game: gameState.gameId });
    });

    document.getElementById('restart-game-btn').addEventListener('click', async () => {
        await resetGame();
    });
}

/**
 * 게임 리셋
 */
async function resetGame() {
    try {
        const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
        await set(gameRef, null);

        const statusRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/status`);
        await set(statusRef, 'waiting');

        const playersRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/players`);
        const players = gameState.players;
        const resetPlayers = {};
        for (const playerId in players) {
            resetPlayers[playerId] = {
                id: playerId,
                name: players[playerId].name,
                color: players[playerId].color,
                ready: false,
                joinedAt: players[playerId].joinedAt || Date.now()
            };
        }
        await set(playersRef, resetPlayers);

        URLParams.navigate('room.html', { game: gameState.gameId, room: gameState.roomId });
    } catch (error) {
        console.error('게임 리셋 실패:', error);
        showNotification('게임 리셋에 실패했습니다.', 'error');
    }
}

/**
 * 새 블록 생성
 */
function spawnPiece() {
    if (!gameState.nextPiece) {
        gameState.nextPiece = getRandomTetromino();
    }

    gameState.currentPiece = gameState.nextPiece;
    gameState.currentPiece.x = Math.floor(CONFIG.COLS / 2) - Math.floor(gameState.currentPiece.shape[0].length / 2);
    gameState.currentPiece.y = 0;

    gameState.nextPiece = getRandomTetromino();
    gameState.canHold = true; // 새 블록이 나오면 다시 Hold 가능

    // 게임 오버 체크 (새 블록이 바로 충돌)
    if (checkCollision(gameState.currentPiece.x, gameState.currentPiece.y, gameState.currentPiece.shape)) {
        playerDied();
    }
}

/**
 * Hold 기능 (현재 블록을 보관)
 */
function holdCurrentPiece() {
    if (!gameState.canHold || !gameState.currentPiece) return;

    if (gameState.holdPiece === null) {
        // 처음 Hold하는 경우
        gameState.holdPiece = {
            type: gameState.currentPiece.type,
            shape: TETROMINOS[gameState.currentPiece.type].shape.map(row => [...row]),
            color: gameState.currentPiece.color,
        };
        spawnPiece();
    } else {
        // Hold된 블록과 교체
        const temp = {
            type: gameState.currentPiece.type,
            shape: TETROMINOS[gameState.currentPiece.type].shape.map(row => [...row]),
            color: gameState.currentPiece.color,
        };

        gameState.currentPiece = {
            type: gameState.holdPiece.type,
            shape: gameState.holdPiece.shape.map(row => [...row]),
            color: gameState.holdPiece.color,
            x: Math.floor(CONFIG.COLS / 2) - Math.floor(gameState.holdPiece.shape[0].length / 2),
            y: 0,
        };

        gameState.holdPiece = temp;

        // Hold 블록이 바로 충돌하는 경우 게임 오버
        if (checkCollision(gameState.currentPiece.x, gameState.currentPiece.y, gameState.currentPiece.shape)) {
            playerDied();
        }
    }

    gameState.canHold = false; // 한 번 Hold하면 다음 블록이 나올 때까지 불가
    gameState.dropCounter = 0; // 드롭 카운터 리셋
}

/**
 * 랜덤 테트로미노 생성
 */
function getRandomTetromino() {
    const type = TETROMINO_TYPES[Math.floor(Math.random() * TETROMINO_TYPES.length)];
    const tetromino = TETROMINOS[type];
    return {
        type: type,
        shape: tetromino.shape.map(row => [...row]),
        color: tetromino.color,
        x: 0,
        y: 0,
    };
}

/**
 * Ghost piece의 Y 위치 계산 (하드 드롭 위치)
 */
function getGhostY() {
    if (!gameState.currentPiece) return 0;

    let ghostY = gameState.currentPiece.y;

    // 충돌할 때까지 아래로 이동
    while (!checkCollision(gameState.currentPiece.x, ghostY + 1, gameState.currentPiece.shape)) {
        ghostY++;
    }

    return ghostY;
}

/**
 * 블록 이동
 */
function movePiece(dx, dy) {
    const newX = gameState.currentPiece.x + dx;
    const newY = gameState.currentPiece.y + dy;

    if (!checkCollision(newX, newY, gameState.currentPiece.shape)) {
        gameState.currentPiece.x = newX;
        gameState.currentPiece.y = newY;
        return true;
    }

    // 아래로 이동 실패 시 블록 고정
    if (dy > 0) {
        lockPiece();
    }

    return false;
}

/**
 * 블록 회전
 */
function rotatePiece() {
    const rotated = rotateMatrix(gameState.currentPiece.shape);

    // 회전 가능한지 체크 (벽 킥 시도)
    const kicks = [
        [0, 0],   // 그대로
        [-1, 0],  // 왼쪽
        [1, 0],   // 오른쪽
        [0, -1],  // 위
    ];

    for (const [dx, dy] of kicks) {
        const newX = gameState.currentPiece.x + dx;
        const newY = gameState.currentPiece.y + dy;

        if (!checkCollision(newX, newY, rotated)) {
            gameState.currentPiece.shape = rotated;
            gameState.currentPiece.x = newX;
            gameState.currentPiece.y = newY;
            return;
        }
    }
}

/**
 * 행렬 회전 (시계방향 90도)
 */
function rotateMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = Array(cols).fill(null).map(() => Array(rows).fill(0));

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            rotated[x][rows - 1 - y] = matrix[y][x];
        }
    }

    return rotated;
}

/**
 * 즉시 낙하 (하드 드롭)
 */
function hardDrop() {
    while (movePiece(0, 1)) {
        gameState.score += 2; // 하드 드롭 보너스
    }
    updateScoreUI();
}

/**
 * 충돌 감지
 */
function checkCollision(x, y, shape) {
    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col]) {
                const newX = x + col;
                const newY = y + row;

                // 경계 체크
                if (newX < 0 || newX >= CONFIG.COLS || newY >= CONFIG.ROWS) {
                    return true;
                }

                // 보드와 충돌 체크
                if (newY >= 0 && gameState.board[newY][newX]) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * 블록 고정
 */
function lockPiece() {
    const piece = gameState.currentPiece;

    // 보드에 블록 추가
    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            if (piece.shape[row][col]) {
                const y = piece.y + row;
                const x = piece.x + col;
                if (y >= 0 && y < CONFIG.ROWS && x >= 0 && x < CONFIG.COLS) {
                    gameState.board[y][x] = piece.color;
                }
            }
        }
    }

    // 라인 제거
    const linesCleared = clearLines();

    // 방해줄 추가
    if (gameState.garbageQueue > 0) {
        addGarbageLines(gameState.garbageQueue);
        gameState.garbageQueue = 0;
        updateGarbageIndicator();
    }

    // 라인 제거 시 방해줄 전송
    if (linesCleared > 0) {
        sendGarbageToOpponents(linesCleared);
    }

    // 서버에 보드 상태 업데이트
    updateBoardToServer();

    // 새 블록 생성
    spawnPiece();
}

/**
 * 라인 제거
 */
function clearLines() {
    let linesCleared = 0;

    for (let y = CONFIG.ROWS - 1; y >= 0; y--) {
        if (gameState.board[y].every(cell => cell !== 0)) {
            // 라인 제거
            gameState.board.splice(y, 1);
            gameState.board.unshift(Array(CONFIG.COLS).fill(0));
            linesCleared++;
            y++; // 같은 라인 다시 체크
        }
    }

    if (linesCleared > 0) {
        gameState.lines += linesCleared;

        // 점수 계산
        const scoreTable = [0, 100, 300, 500, 800]; // 0, 1, 2, 3, 4줄
        gameState.score += scoreTable[linesCleared] * gameState.level;

        // 레벨 업 (10줄마다)
        const newLevel = Math.floor(gameState.lines / 10) + 1;
        if (newLevel > gameState.level) {
            gameState.level = newLevel;
            gameState.dropInterval = Math.max(
                CONFIG.MIN_SPEED,
                CONFIG.INITIAL_SPEED - (gameState.level - 1) * CONFIG.SPEED_DECREASE
            );
        }

        updateScoreUI();
    }

    return linesCleared;
}

/**
 * 방해줄 추가
 */
function addGarbageLines(count) {
    for (let i = 0; i < count; i++) {
        // 맨 위 줄 제거
        gameState.board.shift();

        // 맨 아래에 랜덤 구멍이 있는 줄 추가
        const garbageLine = Array(CONFIG.COLS).fill('#808080');
        const holeIndex = Math.floor(Math.random() * CONFIG.COLS);
        garbageLine[holeIndex] = 0;
        gameState.board.push(garbageLine);
    }
}

/**
 * 방해줄 전송
 */
async function sendGarbageToOpponents(linesCleared) {
    // 살아있는 상대 찾기
    const opponents = Object.values(gameState.players).filter(
        p => p.id !== gameState.playerId && p.alive
    );

    if (opponents.length === 0) return;

    // 각 상대에게 방해줄 전송
    for (const opponent of opponents) {
        const garbageRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/garbage/${opponent.id}`);
        const currentGarbage = await garbageRef.get().then(s => s.val() || 0);
        await set(garbageRef, currentGarbage + linesCleared);
    }
}

/**
 * 플레이어 사망 처리
 */
async function playerDied() {
    gameState.gameOver = true;
    gameState.currentPiece = null;

    // 죽기 전 살아있는 플레이어 수 확인 (본인 포함)
    const alivePlayersBeforeDeath = Object.values(gameState.players).filter(p => p.alive);
    const rank = alivePlayersBeforeDeath.length; // 현재 순위 (죽기 전 살아있던 플레이어 수)

    // 본인 상태 업데이트 (먼저 로컬에서)
    if (gameState.players[gameState.playerId]) {
        gameState.players[gameState.playerId].alive = false;
        gameState.players[gameState.playerId].rank = rank;
    }

    // 서버에 사망 상태 업데이트
    const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${gameState.playerId}`);
    await updateDB(playerRef, {
        alive: false,
        rank: rank,
    });

    showNotification(`${rank}등으로 탈락했습니다!`, 'error');

    // 남은 플레이어 수 확인 (본인이 죽은 후)
    const alivePlayersAfterDeath = Object.values(gameState.players).filter(p => p.alive);

    // 1명만 남았거나 모두 죽었으면 게임 종료
    if (alivePlayersAfterDeath.length <= 1 && gameState.isHost) {
        // 마지막 생존자에게 1등 부여
        if (alivePlayersAfterDeath.length === 1) {
            const winner = alivePlayersAfterDeath[0];
            const winnerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${winner.id}`);
            await updateDB(winnerRef, {
                rank: 1,
            });
            if (gameState.players[winner.id]) {
                gameState.players[winner.id].rank = 1;
            }
        }
        await finishGame();
    }
}

/**
 * 게임 종료 처리
 */
async function finishGame() {
    const rankings = Object.values(gameState.players)
        .sort((a, b) => a.rank - b.rank)
        .map(p => ({
            id: p.id,
            name: p.name,
            rank: p.rank,
            score: p.score,
        }));

    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
    await updateDB(gameRef, {
        gameFinished: true,
        rankings: rankings,
    });
}

/**
 * 게임 오버 처리
 */
function handleGameOver(rankings) {
    if (!rankings || rankings.length === 0) return;

    gameState.gameOver = true;
    gameState.rankings = rankings;

    const modal = document.getElementById('game-over-modal');
    const finalRanking = document.getElementById('final-ranking');

    finalRanking.innerHTML = '<h3>🏆 최종 순위</h3>';
    rankings.forEach(player => {
        const rankClass = `rank-${player.rank}`;
        const div = document.createElement('div');
        div.className = 'rank-item';
        div.innerHTML = `
            <span class="rank-number ${rankClass}">${player.rank}위</span>
            <span>${player.name}</span>
            <span>${player.score}점</span>
        `;
        finalRanking.appendChild(div);
    });

    modal.classList.add('show');
}

/**
 * 보드 상태 서버 업데이트
 */
async function updateBoardToServer() {
    const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${gameState.playerId}`);
    await updateDB(playerRef, {
        board: gameState.board,
        score: gameState.score,
        lines: gameState.lines,
    });
}

/**
 * 상대 보드 UI 업데이트
 */
function updateOpponentBoards() {
    const opponentsLeft = document.getElementById('opponents-left');
    opponentsLeft.innerHTML = '';

    Object.values(gameState.players).forEach(player => {
        if (player.id === gameState.playerId) return;

        const boardDiv = document.createElement('div');
        boardDiv.className = `player-board-mini ${player.alive ? 'alive' : 'dead'}`;
        boardDiv.innerHTML = `
            <h4>
                <span class="player-color" style="background: ${player.color}"></span>
                ${player.name}
                ${player.rank > 0 ? `(${player.rank}위)` : ''}
            </h4>
            <canvas class="mini-canvas" width="100" height="200"></canvas>
            <div style="font-size: 12px; margin-top: 5px;">
                ${player.score}점 / ${player.lines}줄
            </div>
        `;

        opponentsLeft.appendChild(boardDiv);

        // 미니 보드 렌더링
        const miniCanvas = boardDiv.querySelector('.mini-canvas');
        const miniCtx = miniCanvas.getContext('2d');
        renderMiniBoard(miniCtx, player.board, 10);
    });
}

/**
 * 미니 보드 렌더링
 */
function renderMiniBoard(ctx, board, blockSize) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (let y = 0; y < CONFIG.ROWS; y++) {
        for (let x = 0; x < CONFIG.COLS; x++) {
            if (board[y][x]) {
                ctx.fillStyle = board[y][x];
                ctx.fillRect(x * blockSize, y * blockSize, blockSize - 1, blockSize - 1);
            }
        }
    }
}

/**
 * 점수 UI 업데이트
 */
function updateScoreUI() {
    document.getElementById('score').textContent = gameState.score;
    document.getElementById('lines').textContent = gameState.lines;
    document.getElementById('level').textContent = gameState.level;
}

/**
 * 방해줄 표시 업데이트
 */
function updateGarbageIndicator() {
    const indicator = document.getElementById('garbage-indicator');
    const count = document.getElementById('garbage-count');

    if (gameState.garbageQueue > 0) {
        indicator.style.display = 'block';
        count.textContent = gameState.garbageQueue;
    } else {
        indicator.style.display = 'none';
    }
}

/**
 * 순위 UI 업데이트
 */
function updateRankingUI() {
    const rankingList = document.getElementById('ranking-list');
    rankingList.innerHTML = '';

    const sortedPlayers = Object.values(gameState.players)
        .filter(p => p.rank > 0 || !p.alive)
        .sort((a, b) => a.rank - b.rank);

    sortedPlayers.forEach(player => {
        const rankClass = `rank-${player.rank}`;
        const div = document.createElement('div');
        div.className = 'rank-item';
        div.innerHTML = `
            <span class="rank-number ${rankClass}">${player.rank}위</span>
            <span>${player.name}</span>
        `;
        rankingList.appendChild(div);
    });
}

/**
 * 게임 루프
 */
function gameLoop(time = 0) {
    const deltaTime = time - gameState.lastTime;
    gameState.lastTime = time;

    if (!gameState.gameOver) {
        // 첫 블록 생성
        if (!gameState.currentPiece) {
            spawnPiece();
        }

        // 자동 낙하
        gameState.dropCounter += deltaTime;
        if (gameState.dropCounter > gameState.dropInterval) {
            movePiece(0, 1);
            gameState.dropCounter = 0;
        }
    }

    render();
    updateTimer();

    requestAnimationFrame(gameLoop);
}

/**
 * 타이머 업데이트
 */
function updateTimer() {
    const elapsed = Math.floor((Date.now() - (gameState.gameStartTime || Date.now())) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    document.getElementById('game-timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 렌더링
 */
function render() {
    // 메인 보드 클리어
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 그리드 라인
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let y = 0; y <= CONFIG.ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CONFIG.BLOCK_SIZE);
        ctx.lineTo(CONFIG.COLS * CONFIG.BLOCK_SIZE, y * CONFIG.BLOCK_SIZE);
        ctx.stroke();
    }
    for (let x = 0; x <= CONFIG.COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CONFIG.BLOCK_SIZE, 0);
        ctx.lineTo(x * CONFIG.BLOCK_SIZE, CONFIG.ROWS * CONFIG.BLOCK_SIZE);
        ctx.stroke();
    }

    // 보드 렌더링
    for (let y = 0; y < CONFIG.ROWS; y++) {
        for (let x = 0; x < CONFIG.COLS; x++) {
            if (gameState.board[y][x]) {
                ctx.fillStyle = gameState.board[y][x];
                ctx.fillRect(
                    x * CONFIG.BLOCK_SIZE + 1,
                    y * CONFIG.BLOCK_SIZE + 1,
                    CONFIG.BLOCK_SIZE - 2,
                    CONFIG.BLOCK_SIZE - 2
                );
            }
        }
    }

    // Ghost piece (그림자 블록) 렌더링
    if (gameState.currentPiece) {
        const ghostY = getGhostY();
        const piece = gameState.currentPiece;

        // 흐릿한 색상으로 그림자 표시
        ctx.fillStyle = piece.color + '40'; // 25% 투명도

        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) {
                    ctx.fillRect(
                        (piece.x + x) * CONFIG.BLOCK_SIZE + 1,
                        (ghostY + y) * CONFIG.BLOCK_SIZE + 1,
                        CONFIG.BLOCK_SIZE - 2,
                        CONFIG.BLOCK_SIZE - 2
                    );
                }
            }
        }
    }

    // 현재 블록 렌더링
    if (gameState.currentPiece) {
        ctx.fillStyle = gameState.currentPiece.color;
        const piece = gameState.currentPiece;

        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) {
                    ctx.fillRect(
                        (piece.x + x) * CONFIG.BLOCK_SIZE + 1,
                        (piece.y + y) * CONFIG.BLOCK_SIZE + 1,
                        CONFIG.BLOCK_SIZE - 2,
                        CONFIG.BLOCK_SIZE - 2
                    );
                }
            }
        }
    }

    // Next 블록 렌더링
    if (gameState.nextPiece) {
        nextCtx.fillStyle = '#F5F5F5';
        nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

        nextCtx.fillStyle = gameState.nextPiece.color;
        const next = gameState.nextPiece;
        const offsetX = (4 - next.shape[0].length) / 2;
        const offsetY = (4 - next.shape.length) / 2;

        for (let y = 0; y < next.shape.length; y++) {
            for (let x = 0; x < next.shape[y].length; x++) {
                if (next.shape[y][x]) {
                    nextCtx.fillRect(
                        (offsetX + x) * 30,
                        (offsetY + y) * 30,
                        28,
                        28
                    );
                }
            }
        }
    }

    // Hold 블록 렌더링
    holdCtx.fillStyle = '#F5F5F5';
    holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);

    if (gameState.holdPiece) {
        // canHold가 false면 약간 어둡게 표시
        const opacity = gameState.canHold ? 'FF' : '80';
        holdCtx.fillStyle = gameState.holdPiece.color + opacity;
        const hold = gameState.holdPiece;
        const offsetX = (4 - hold.shape[0].length) / 2;
        const offsetY = (4 - hold.shape.length) / 2;

        for (let y = 0; y < hold.shape.length; y++) {
            for (let x = 0; x < hold.shape[y].length; x++) {
                if (hold.shape[y][x]) {
                    holdCtx.fillRect(
                        (offsetX + x) * 30,
                        (offsetY + y) * 30,
                        28,
                        28
                    );
                }
            }
        }
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
