/**
 * 오목 게임 로직
 * 15×15 바둑판, 1v1 대전
 */

import { getDatabase } from './firebase-config.js';
import { ref, set, update as updateDB, onValue, off } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
import { URLParams, Storage, showNotification } from './utils.js';

// ========== 설정 ==========
const CONFIG = {
    BOARD_SIZE: 15,        // 15×15 바둑판
    TILE_SIZE: 38,         // 570px / 15 = 38px
    CANVAS_WIDTH: 570,
    CANVAS_HEIGHT: 570,
    TURN_TIME_LIMIT: 60,   // 60초 제한
    STONE_RADIUS: 16,      // 돌 반지름
};

const STONE_COLOR = {
    BLACK: 'black',
    WHITE: 'white',
    EMPTY: 0  // Firebase는 null을 저장하지 않으므로 0 사용
};

// ========== 상태 ==========
const gameState = {
    roomId: null,
    gameId: null,
    playerId: null,
    playerName: null,
    myColor: null,          // 'black' or 'white'
    opponentId: null,
    opponentName: null,
    opponentColor: null,
    board: [],              // 15×15 배열
    currentTurn: 'black',   // 'black' 선공
    gameOver: false,
    winner: null,
    startTime: null,
    turnStartTime: null,
    stoneCount: 0,
    hoverX: -1,
    hoverY: -1,
};

// ========== DOM 요소 ==========
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const timerElement = document.getElementById('game-timer');
const turnIndicator = document.getElementById('turn-indicator');
const myNameElement = document.getElementById('my-name');
const myStoneElement = document.getElementById('my-stone');
const myStatusElement = document.getElementById('my-status');
const opponentNameElement = document.getElementById('opponent-name');
const opponentStoneElement = document.getElementById('opponent-stone');
const opponentStatusElement = document.getElementById('opponent-status');
const myBoxElement = document.getElementById('my-box');
const opponentBoxElement = document.getElementById('opponent-box');
const stoneCountElement = document.getElementById('stone-count');
const remainingMovesElement = document.getElementById('remaining-moves');
const gameOverModal = document.getElementById('game-over-modal');
const gameResultElement = document.getElementById('game-result');
const winnerNameElement = document.getElementById('winner-name');

// Firebase 참조
let db = null;
let roomRef = null;
let gameRef = null;

// ========== 초기화 ==========
async function init() {
    // URL 파라미터에서 방 ID 가져오기
    gameState.roomId = URLParams.get('room');
    if (!gameState.roomId) {
        showNotification('방 정보를 찾을 수 없습니다.', 'error');
        setTimeout(() => URLParams.navigate('lobby.html', { game: 'omok' }), 2000);
        return;
    }

    // 플레이어 정보 가져오기
    gameState.playerId = Storage.getPlayerId();
    gameState.playerName = Storage.getPlayerName();

    if (!gameState.playerId || !gameState.playerName) {
        showNotification('플레이어 정보를 찾을 수 없습니다.', 'error');
        setTimeout(() => URLParams.navigate('index.html'), 2000);
        return;
    }

    // 내 이름 표시
    myNameElement.textContent = gameState.playerName;

    // Firebase 초기화
    try {
        db = await getDatabase();
        roomRef = ref(db, `rooms/omok/${gameState.roomId}`);
        gameRef = ref(db, `rooms/omok/${gameState.roomId}/game`);

        // 게임 상태 감지
        onValue(gameRef, handleGameStateUpdate);

        // F5 방지 (게임 진행 중 표시)
        localStorage.setItem('game_in_progress', 'true');
        localStorage.setItem('current_room_id', gameState.roomId);
        localStorage.setItem('current_game_id', 'omok');

    } catch (error) {
        console.error('Firebase 초기화 실패:', error);
        showNotification('게임 연결에 실패했습니다.', 'error');
    }

    // 이벤트 리스너 등록
    setupEventListeners();

    // 초기 보드 렌더링
    initBoard();
    drawBoard();

    // 타이머 시작
    startTimer();
}

// ========== 보드 초기화 ==========
function initBoard() {
    gameState.board = [];
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            row.push(STONE_COLOR.EMPTY);
        }
        gameState.board.push(row);
    }
}

// ========== 보드 평탄화 (Firebase 저장용) ==========
function flattenBoard(board) {
    const flat = [];
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            flat.push(board[y][x]);
        }
    }
    return flat;
}

// ========== 보드 복원 (Firebase에서 읽기) ==========
function unflattenBoard(flat) {
    if (!flat || !Array.isArray(flat)) {
        // 데이터가 없으면 빈 보드 반환
        const board = [];
        for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
            const row = [];
            for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
                row.push(STONE_COLOR.EMPTY);
            }
            board.push(row);
        }
        return board;
    }

    const board = [];
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            const index = y * CONFIG.BOARD_SIZE + x;
            row.push(flat[index] || STONE_COLOR.EMPTY);
        }
        board.push(row);
    }
    return board;
}

// ========== Firebase 게임 상태 업데이트 핸들러 ==========
function handleGameStateUpdate(snapshot) {
    const data = snapshot.val();
    if (!data) {
        // 게임 상태가 없으면 초기화 (호스트만)
        initializeGame();
        return;
    }

    // 플레이어 색상 할당
    if (data.players) {
        const playerIds = Object.keys(data.players);
        const myData = data.players[gameState.playerId];

        if (myData) {
            gameState.myColor = myData.color;
            myStoneElement.className = `stone-preview stone-${myData.color}`;
            myStatusElement.textContent = myData.color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
        }

        // 상대방 정보
        const opponentId = playerIds.find(id => id !== gameState.playerId);
        if (opponentId) {
            gameState.opponentId = opponentId;
            const opponentData = data.players[opponentId];
            gameState.opponentName = opponentData.name;
            gameState.opponentColor = opponentData.color;

            opponentNameElement.textContent = opponentData.name;
            opponentStoneElement.className = `stone-preview stone-${opponentData.color}`;
            opponentStatusElement.textContent = opponentData.color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
        }
    }

    // 보드 상태 동기화 (평탄화된 배열을 2차원 배열로 복원)
    if (data.board) {
        gameState.board = unflattenBoard(data.board);
        gameState.stoneCount = countStones();
        stoneCountElement.textContent = gameState.stoneCount;
        remainingMovesElement.textContent = CONFIG.BOARD_SIZE * CONFIG.BOARD_SIZE - gameState.stoneCount;
    }

    // 현재 턴
    if (data.currentTurn) {
        gameState.currentTurn = data.currentTurn;
        gameState.turnStartTime = data.turnStartTime || Date.now();
        updateTurnIndicator();
    }

    // 게임 오버
    if (data.gameOver) {
        gameState.gameOver = true;
        gameState.winner = data.winner;
        showGameOver();
    }

    // 화면 다시 그리기
    drawBoard();
}

// ========== 게임 초기화 (호스트만 실행) ==========
async function initializeGame() {
    try {
        // 방 정보 확인
        const roomSnapshot = await new Promise((resolve) => {
            onValue(roomRef, (snapshot) => {
                resolve(snapshot);
            }, { onlyOnce: true });
        });

        const roomData = roomSnapshot.val();
        if (!roomData) return;

        // 호스트만 초기화
        if (roomData.hostId !== gameState.playerId) return;

        const playerIds = Object.keys(roomData.players || {});
        if (playerIds.length !== 2) {
            // 2명이 아니면 대기
            return;
        }

        // 랜덤으로 흑/백 배정
        const shuffled = playerIds.sort(() => Math.random() - 0.5);
        const players = {
            [shuffled[0]]: {
                id: shuffled[0],
                name: roomData.players[shuffled[0]].name,
                color: 'black'
            },
            [shuffled[1]]: {
                id: shuffled[1],
                name: roomData.players[shuffled[1]].name,
                color: 'white'
            }
        };

        // 빈 보드 생성 (2차원 배열)
        const board2D = [];
        for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
            const row = [];
            for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
                row.push(STONE_COLOR.EMPTY);
            }
            board2D.push(row);
        }

        // 게임 상태 초기화 (보드는 평탄화해서 저장)
        await set(gameRef, {
            players: players,
            board: flattenBoard(board2D),
            currentTurn: 'black',
            turnStartTime: Date.now(),
            gameOver: false,
            winner: null,
            startTime: Date.now()
        });

    } catch (error) {
        console.error('게임 초기화 실패:', error);
    }
}

// ========== 돌 개수 세기 ==========
function countStones() {
    let count = 0;
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            if (gameState.board[y][x] !== STONE_COLOR.EMPTY) {
                count++;
            }
        }
    }
    return count;
}

// ========== 턴 표시 업데이트 ==========
function updateTurnIndicator() {
    const isMyTurn = gameState.currentTurn === gameState.myColor;

    if (isMyTurn) {
        turnIndicator.textContent = `내 차례입니다 (${gameState.myColor === 'black' ? '흑' : '백'})`;
        turnIndicator.classList.add('my-turn');
        myBoxElement.classList.add('current-turn');
        opponentBoxElement.classList.remove('current-turn');
    } else {
        turnIndicator.textContent = `${gameState.opponentName}의 차례 (${gameState.opponentColor === 'black' ? '흑' : '백'})`;
        turnIndicator.classList.remove('my-turn');
        myBoxElement.classList.remove('current-turn');
        opponentBoxElement.classList.add('current-turn');
    }
}

// ========== 이벤트 리스너 ==========
function setupEventListeners() {
    // 캔버스 클릭
    canvas.addEventListener('click', handleCanvasClick);

    // 캔버스 마우스 이동 (hover 미리보기)
    canvas.addEventListener('mousemove', handleCanvasHover);

    // 캔버스 마우스 나감
    canvas.addEventListener('mouseleave', () => {
        gameState.hoverX = -1;
        gameState.hoverY = -1;
        drawBoard();
    });

    // 게임 종료 후 버튼
    document.getElementById('return-lobby-btn').addEventListener('click', () => {
        cleanupAndLeave('lobby.html', { game: 'omok' });
    });

    document.getElementById('restart-game-btn').addEventListener('click', async () => {
        // 게임 다시 시작 (방 유지)
        if (db && gameRef) {
            await initializeGame();
            gameOverModal.classList.remove('show');
            gameState.gameOver = false;
        }
    });

    // 나가기 버튼
    document.getElementById('leave-game-btn').addEventListener('click', () => {
        if (confirm('게임을 나가시겠습니까?')) {
            cleanupAndLeave('lobby.html', { game: 'omok' });
        }
    });

    // 페이지 종료 전 정리
    window.addEventListener('beforeunload', handleBeforeUnload);
}

// ========== 캔버스 클릭 핸들러 ==========
async function handleCanvasClick(event) {
    if (gameState.gameOver) return;
    if (gameState.currentTurn !== gameState.myColor) {
        showNotification('내 차례가 아닙니다.', 'warning');
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // 클릭한 교차점 계산
    const gridX = Math.round(mouseX / CONFIG.TILE_SIZE);
    const gridY = Math.round(mouseY / CONFIG.TILE_SIZE);

    // 보드 범위 체크
    if (gridX < 0 || gridX >= CONFIG.BOARD_SIZE || gridY < 0 || gridY >= CONFIG.BOARD_SIZE) {
        return;
    }

    // 이미 돌이 있는지 체크
    if (gameState.board[gridY][gridX] !== STONE_COLOR.EMPTY) {
        showNotification('이미 돌이 놓여있습니다.', 'warning');
        return;
    }

    // 돌 놓기
    await placeStone(gridX, gridY);
}

// ========== 캔버스 호버 핸들러 ==========
function handleCanvasHover(event) {
    if (gameState.gameOver) return;
    if (gameState.currentTurn !== gameState.myColor) {
        gameState.hoverX = -1;
        gameState.hoverY = -1;
        drawBoard();
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridX = Math.round(mouseX / CONFIG.TILE_SIZE);
    const gridY = Math.round(mouseY / CONFIG.TILE_SIZE);

    // 보드 범위 체크
    if (gridX < 0 || gridX >= CONFIG.BOARD_SIZE || gridY < 0 || gridY >= CONFIG.BOARD_SIZE) {
        gameState.hoverX = -1;
        gameState.hoverY = -1;
        drawBoard();
        return;
    }

    // 빈 칸만 hover
    if (gameState.board[gridY][gridX] === STONE_COLOR.EMPTY) {
        gameState.hoverX = gridX;
        gameState.hoverY = gridY;
    } else {
        gameState.hoverX = -1;
        gameState.hoverY = -1;
    }

    drawBoard();
}

// ========== 돌 놓기 ==========
async function placeStone(x, y) {
    try {
        // 보드 업데이트
        const newBoard = JSON.parse(JSON.stringify(gameState.board));
        newBoard[y][x] = gameState.myColor;

        // 승리 검사
        const hasWon = checkWin(newBoard, x, y, gameState.myColor);

        // 턴 전환
        const nextTurn = gameState.currentTurn === 'black' ? 'white' : 'black';

        const updates = {
            board: flattenBoard(newBoard),  // 평탄화해서 저장
            currentTurn: nextTurn,
            turnStartTime: Date.now()
        };

        if (hasWon) {
            updates.gameOver = true;
            updates.winner = gameState.playerId;
        }

        await updateDB(gameRef, updates);

    } catch (error) {
        console.error('돌 놓기 실패:', error);
        showNotification('돌을 놓을 수 없습니다.', 'error');
    }
}

// ========== 승리 검사 ==========
function checkWin(board, x, y, color) {
    // 4방향 검사: 가로, 세로, 대각선(\), 대각선(/)
    const directions = [
        [1, 0],   // 가로
        [0, 1],   // 세로
        [1, 1],   // 대각선 \
        [1, -1]   // 대각선 /
    ];

    for (const [dx, dy] of directions) {
        let count = 1; // 현재 돌 포함

        // 정방향 카운트
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (board[ny][nx] !== color) break;
            count++;
        }

        // 역방향 카운트
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i;
            const ny = y - dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (board[ny][nx] !== color) break;
            count++;
        }

        // 5개 이상이면 승리
        if (count >= 5) {
            return true;
        }
    }

    return false;
}

// ========== 보드 그리기 ==========
function drawBoard() {
    // 캔버스 초기화
    ctx.clearRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

    // 배경 (나무 색상)
    ctx.fillStyle = '#DEB887';
    ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

    // 격자선 그리기
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;

    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        // 세로선
        ctx.beginPath();
        ctx.moveTo(i * CONFIG.TILE_SIZE, 0);
        ctx.lineTo(i * CONFIG.TILE_SIZE, CONFIG.CANVAS_HEIGHT);
        ctx.stroke();

        // 가로선
        ctx.beginPath();
        ctx.moveTo(0, i * CONFIG.TILE_SIZE);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, i * CONFIG.TILE_SIZE);
        ctx.stroke();
    }

    // 화점 (중앙 + 4코너)
    const starPoints = [
        [3, 3], [3, 11], [11, 3], [11, 11], [7, 7]
    ];
    ctx.fillStyle = '#000';
    starPoints.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x * CONFIG.TILE_SIZE, y * CONFIG.TILE_SIZE, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // 돌 그리기
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            const stone = gameState.board[y][x];
            if (stone !== STONE_COLOR.EMPTY) {
                drawStone(x, y, stone, 1.0);
            }
        }
    }

    // Hover 미리보기
    if (gameState.hoverX >= 0 && gameState.hoverY >= 0) {
        drawStone(gameState.hoverX, gameState.hoverY, gameState.myColor, 0.4);
    }
}

// ========== 돌 그리기 ==========
function drawStone(x, y, color, opacity = 1.0) {
    const centerX = x * CONFIG.TILE_SIZE;
    const centerY = y * CONFIG.TILE_SIZE;

    ctx.save();
    ctx.globalAlpha = opacity;

    // 그림자
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    if (color === 'black') {
        // 흑돌 (방사형 그라디언트)
        const gradient = ctx.createRadialGradient(
            centerX - 5, centerY - 5, 2,
            centerX, centerY, CONFIG.STONE_RADIUS
        );
        gradient.addColorStop(0, '#4a4a4a');
        gradient.addColorStop(1, '#000');
        ctx.fillStyle = gradient;
    } else {
        // 백돌 (방사형 그라디언트)
        const gradient = ctx.createRadialGradient(
            centerX - 5, centerY - 5, 2,
            centerX, centerY, CONFIG.STONE_RADIUS
        );
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#d0d0d0');
        ctx.fillStyle = gradient;
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, CONFIG.STONE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// ========== 타이머 ==========
function startTimer() {
    setInterval(() => {
        if (gameState.gameOver) return;

        // 전체 게임 시간
        if (gameState.startTime) {
            const elapsed = Math.floor((Date.now() - gameState.startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // 턴 제한 시간 체크 (60초)
        if (gameState.turnStartTime) {
            const turnElapsed = Math.floor((Date.now() - gameState.turnStartTime) / 1000);
            if (turnElapsed >= CONFIG.TURN_TIME_LIMIT) {
                handleTurnTimeout();
            }
        }
    }, 1000);
}

// ========== 턴 타임아웃 처리 ==========
async function handleTurnTimeout() {
    if (gameState.gameOver) return;
    if (gameState.currentTurn !== gameState.myColor) return;

    // 시간 초과 = 패배
    try {
        await updateDB(gameRef, {
            gameOver: true,
            winner: gameState.opponentId
        });
        showNotification('시간 초과! 패배하셨습니다.', 'error');
    } catch (error) {
        console.error('타임아웃 처리 실패:', error);
    }
}

// ========== 게임 오버 표시 ==========
function showGameOver() {
    gameOverModal.classList.add('show');

    if (gameState.winner === gameState.playerId) {
        gameResultElement.textContent = '🎉 승리!';
        winnerNameElement.textContent = `${gameState.playerName}님이 승리하셨습니다!`;
    } else {
        gameResultElement.textContent = '😢 패배';
        winnerNameElement.textContent = `${gameState.opponentName}님이 승리하셨습니다.`;
    }
}

// ========== 페이지 나가기 전 처리 ==========
function handleBeforeUnload(event) {
    if (!gameState.gameOver) {
        // 게임 진행 중이면 패배 처리
        if (db && gameRef && gameState.opponentId) {
            updateDB(gameRef, {
                gameOver: true,
                winner: gameState.opponentId
            }).catch(err => console.error('패배 처리 실패:', err));
        }
    }

    // 정리
    localStorage.removeItem('game_in_progress');
    localStorage.removeItem('current_room_id');
    localStorage.removeItem('current_game_id');

    if (db && gameRef) {
        off(gameRef);
    }
}

// ========== 정리 및 나가기 ==========
function cleanupAndLeave(page, params = {}) {
    localStorage.removeItem('game_in_progress');
    localStorage.removeItem('current_room_id');
    localStorage.removeItem('current_game_id');

    if (db && gameRef) {
        off(gameRef);
    }

    URLParams.navigate(page, params);
}

// ========== 실행 ==========
init();
