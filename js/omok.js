/**
 * 오목 게임 로직
 * 15×15 바둑판, 1v1 대전
 */

import { getDatabase, ref, set, update, onValue, off, get } from './firebase-config.js';
import { URLParams, Storage, showNotification } from './utils.js';

// update를 updateDB로 별칭
const updateDB = update;

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
    isHost: false,          // 호스트 여부
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
    lastMove: null,         // 마지막 수 { x, y }
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

        // F5 방지 (게임 진행 중 표시)
        localStorage.setItem('game_in_progress', 'true');
        localStorage.setItem('current_room_id', gameState.roomId);
        localStorage.setItem('current_game_id', 'omok');

        // Firebase 동기화 설정
        setupFirebaseSync();

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

// ========== 보드 인코딩 (Firebase 저장용 - 희소 객체) ==========
// Firebase 배열/문자열 순환 참조 문제 완전 해결
// 빈 칸은 저장하지 않고, 돌이 놓인 위치만 객체로 저장
// 형식: { "0_0": 1, "7_7": 1, "8_7": 2 } (1=흑돌, 2=백돌)
function encodeBoard(board) {
    const sparse = {};
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            const cell = board[y][x];
            if (cell === 'black') {
                sparse[`${x}_${y}`] = 1;
            } else if (cell === 'white') {
                sparse[`${x}_${y}`] = 2;
            }
            // 빈 칸(0)은 저장하지 않음
        }
    }
    return sparse;
}

// ========== 보드 디코딩 (Firebase에서 읽기 - 희소 객체) ==========
function decodeBoard(sparse) {
    // 빈 보드 생성
    const board = [];
    for (let y = 0; y < CONFIG.BOARD_SIZE; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.BOARD_SIZE; x++) {
            row.push(STONE_COLOR.EMPTY);
        }
        board.push(row);
    }

    // 저장된 돌만 복원
    if (sparse && typeof sparse === 'object') {
        for (const key in sparse) {
            const [x, y] = key.split('_').map(Number);
            const value = sparse[key];
            if (value === 1) {
                board[y][x] = 'black';
            } else if (value === 2) {
                board[y][x] = 'white';
            }
        }
    }

    return board;
}

// ========== Firebase 동기화 설정 ==========
let roomListenerAttached = false;
let gameListenerAttached = false;

function setupFirebaseSync() {
    console.log('[Omok] Firebase 동기화 설정 시작');

    // room 리스너 (Crazy Arcade 방식) - 중복 방지
    if (!roomListenerAttached) {
        roomListenerAttached = true;
        onValue(roomRef, (snapshot) => {
            const roomData = snapshot.val();
            if (!roomData) {
                console.error('[Omok] 방이 존재하지 않습니다.');
                showNotification('방이 존재하지 않습니다.', 'error');
                setTimeout(() => URLParams.navigate('lobby.html', { game: 'omok' }), 2000);
                return;
            }

            // 호스트 확인
            gameState.isHost = roomData.hostId === gameState.playerId;
            console.log('[Omok] 호스트 여부:', gameState.isHost);

            // 호스트가 game 데이터 없으면 초기화 (Crazy Arcade 패턴!)
            // 중요: async 함수이지만 Fire-and-forget 방식으로 호출
            if (gameState.isHost && !roomData.game && !isInitializing) {
                console.log('[Omok] 호스트가 게임을 초기화합니다.');
                initializeGame().catch(err => {
                    console.error('[Omok] initializeGame 오류:', err);
                });
            }
        });
    }

    // game 리스너 (별도) - 실제 게임 데이터 동기화
    if (!gameListenerAttached) {
        gameListenerAttached = true;
        onValue(gameRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                console.log('[Omok] 게임 데이터가 아직 없습니다.');
                return;
            }

            console.log('[Omok] 게임 데이터 동기화:', data);

            // 게임 시작 시간 저장
            if (data.startTime && !gameState.startTime) {
                gameState.startTime = data.startTime;
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

            // 보드 상태 동기화
            if (data.board !== undefined) {
                try {
                    gameState.board = decodeBoard(data.board);
                    gameState.stoneCount = countStones();
                    stoneCountElement.textContent = gameState.stoneCount;
                    remainingMovesElement.textContent = CONFIG.BOARD_SIZE * CONFIG.BOARD_SIZE - gameState.stoneCount;
                } catch (error) {
                    console.error('[Omok] 보드 디코딩 실패:', error);
                }
            }

            // 마지막 수 동기화
            if (data.lastMove !== undefined) {
                gameState.lastMove = data.lastMove;
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
            try {
                drawBoard();
            } catch (error) {
                console.error('[Omok] 보드 그리기 실패:', error);
            }
        });
    }

    console.log('[Omok] Firebase 동기화 설정 완료');
}

// ========== 게임 초기화 (호스트만 실행) ==========
// Crazy Arcade 패턴 완전 적용: 간단하고 직접적인 초기화
let isInitializing = false; // 중복 초기화 방지 플래그

async function initializeGame() {
    // 중복 초기화 방지
    if (isInitializing) {
        console.log('[Omok] 이미 초기화 중입니다.');
        return;
    }

    isInitializing = true;
    console.log('[Omok] 게임 초기화 시작');

    try {
        // 필수 변수 검증
        if (!roomRef || !gameRef) {
            console.error('[Omok] roomRef 또는 gameRef가 없습니다.');
            return;
        }

        if (!gameState.roomId) {
            console.error('[Omok] roomId가 없습니다.');
            return;
        }

        // roomRef에서 플레이어 정보 읽기 (get() 사용 - 한 번만 읽기)
        console.log('[Omok] 플레이어 정보 읽는 중...');
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();

        if (!roomData) {
            console.error('[Omok] 방 데이터가 없습니다.');
            return;
        }

        if (!roomData.players) {
            console.error('[Omok] 플레이어 데이터가 없습니다.');
            return;
        }

        const playerIds = Object.keys(roomData.players);
        console.log('[Omok] 플레이어 수:', playerIds.length, '명');

        if (playerIds.length !== 2) {
            console.log('[Omok] 플레이어가 2명이 아닙니다:', playerIds.length);
            return;
        }

        // 랜덤으로 흑/백 배정
        const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
        console.log('[Omok] 플레이어 순서:', shuffled);

        // 명시적으로 플레이어 객체 생성 (순환 참조 방지)
        const player1 = roomData.players[shuffled[0]];
        const player2 = roomData.players[shuffled[1]];

        if (!player1 || !player2) {
            console.error('[Omok] 플레이어 데이터를 찾을 수 없습니다.');
            return;
        }

        // 깔끔하게 새 객체로 생성 (순환 참조 완전 제거)
        const players = {};
        players[shuffled[0]] = {
            id: shuffled[0],
            name: String(player1.name || 'Player 1'),
            color: 'black'
        };
        players[shuffled[1]] = {
            id: shuffled[1],
            name: String(player2.name || 'Player 2'),
            color: 'white'
        };

        console.log('[Omok] 플레이어 데이터 생성 완료:', players);

        // 게임 상태 초기화 (빈 보드는 빈 객체로 저장)
        const gameData = {
            players: players,
            board: {},  // 희소 객체 방식: 빈 보드는 빈 객체
            currentTurn: 'black',
            turnStartTime: Date.now(),
            gameOver: false,
            winner: null,
            startTime: Date.now(),
            lastMove: null  // 마지막 수
        };

        console.log('[Omok] Firebase에 게임 데이터 저장 중...');
        await set(gameRef, gameData);
        console.log('[Omok] 게임 초기화 완료!');

    } catch (error) {
        console.error('[Omok] 게임 초기화 실패:', error);
        console.error('[Omok] 에러 스택:', error.stack);
        showNotification('게임 초기화에 실패했습니다.', 'error');
    } finally {
        // 초기화 완료 후 플래그 해제
        isInitializing = false;
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
        // 게임 다시 시작 (방 유지) - 호스트만 가능
        if (gameState.isHost && db && gameRef) {
            try {
                // 보드 초기화
                initBoard();
                gameState.gameOver = false;
                gameState.winner = null;
                gameState.stoneCount = 0;
                gameState.hoverX = -1;
                gameState.hoverY = -1;
                gameState.lastMove = null;

                // 게임 재초기화
                await initializeGame();

                // 모달 닫기
                gameOverModal.classList.remove('show');

                showNotification('게임이 다시 시작되었습니다.', 'success');
            } catch (error) {
                console.error('게임 재시작 실패:', error);
                showNotification('게임 재시작에 실패했습니다.', 'error');
            }
        } else if (!gameState.isHost) {
            showNotification('호스트만 게임을 재시작할 수 있습니다.', 'warning');
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
            board: encodeBoard(newBoard),  // 문자열로 인코딩해서 저장
            currentTurn: nextTurn,
            turnStartTime: Date.now(),
            lastMove: { x, y }  // 마지막 수 위치 저장
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

    // 마지막 수 표시
    if (gameState.lastMove) {
        const { x, y } = gameState.lastMove;
        const centerX = x * CONFIG.TILE_SIZE;
        const centerY = y * CONFIG.TILE_SIZE;

        ctx.save();

        // 돌 색상에 따라 마커 색상 반전
        const stoneColor = gameState.board[y][x];
        ctx.strokeStyle = stoneColor === 'black' ? '#FFFFFF' : '#FF0000';
        ctx.fillStyle = stoneColor === 'black' ? '#FFFFFF' : '#FF0000';
        ctx.lineWidth = 2;

        // 작은 원 그리기
        ctx.beginPath();
        ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
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
    console.log('[Omok] 페이지 나가기 전 정리');

    if (!gameState.gameOver) {
        // 게임 진행 중이면 패배 처리
        if (db && gameRef && gameState.opponentId) {
            updateDB(gameRef, {
                gameOver: true,
                winner: gameState.opponentId
            }).catch(err => console.error('[Omok] 패배 처리 실패:', err));
        }
    }

    // 정리
    localStorage.removeItem('game_in_progress');
    localStorage.removeItem('current_room_id');
    localStorage.removeItem('current_game_id');

    // Firebase 리스너 제거
    if (db && roomRef) {
        off(roomRef);
        roomListenerAttached = false;
    }

    if (db && gameRef) {
        off(gameRef);
        gameListenerAttached = false;
    }

    // 초기화 플래그 리셋
    isInitializing = false;
}

// ========== 정리 및 나가기 ==========
function cleanupAndLeave(page, params = {}) {
    console.log('[Omok] 정리 및 나가기');

    localStorage.removeItem('game_in_progress');
    localStorage.removeItem('current_room_id');
    localStorage.removeItem('current_game_id');

    // Firebase 리스너 제거
    if (db && roomRef) {
        off(roomRef);
        roomListenerAttached = false;
    }

    if (db && gameRef) {
        off(gameRef);
        gameListenerAttached = false;
    }

    // 초기화 플래그 리셋
    isInitializing = false;

    URLParams.navigate(page, params);
}

// ========== 실행 ==========
init();
