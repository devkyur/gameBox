/**
 * 물풍선 게임 로직
 */

import { getDatabase, ref, set, update as updateDB, onValue, off, get, remove } from './firebase-config.js';
import { Storage, URLParams, showNotification } from './utils.js';

// 게임 설정
const CONFIG = {
    TILE_SIZE: 50,
    MAP_WIDTH: 13,
    MAP_HEIGHT: 11,
    PLAYER_SPEED: 2.5, // 기본 속도 (픽셀/프레임)
    BOMB_TIMER: 2500, // 폭발까지 시간 (밀리초)
    ITEM_DROP_CHANCE: 0.4, // 아이템 드랍 확률
};

// 타일 타입
const TILE = {
    EMPTY: 0,
    SOLID_WALL: 1,
    BREAKABLE_WALL: 2,
    BOMB: 3,
    EXPLOSION: 4,
};

// 아이템 타입
const ITEM = {
    SPEED_UP: 'speed',
    POWER_UP: 'power',
    BOMB_UP: 'bomb',
};

// 게임 상태
let gameState = {
    roomId: null,
    playerId: null,
    players: {},
    map: [],
    bombs: [],
    explosions: [],
    items: [],
    gameStartTime: Date.now(),
    isHost: false,
    gameOver: false,
};

// Canvas 설정
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// 키보드 입력
const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    space: false,
};

let db = null;
let roomRef = null;
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 50; // 50ms마다 위치 업데이트 (초당 20회)

/**
 * 초기화
 */
async function init() {
    const roomId = URLParams.get('room');
    const playerId = Storage.getPlayerId();
    const gameId = 'crazy-arcade';

    if (!roomId) {
        showNotification('방 정보가 없습니다.', 'error');
        setTimeout(() => URLParams.navigate('lobby.html', { game: gameId }), 1500);
        return;
    }

    // 새로고침 감지: 이미 게임이 진행 중이었는지 확인
    const gameInProgressKey = `game_in_progress_${gameId}_${roomId}_${playerId}`;
    const wasInGame = localStorage.getItem(gameInProgressKey);

    if (wasInGame === 'true') {
        // 새로고침으로 재입장 시도 - 자동 패배 처리
        showNotification('새로고침으로 인해 자동 패배 처리됩니다.', 'error');

        // Firebase 초기화
        db = await getDatabase();
        roomRef = ref(db, `rooms/${gameId}/${roomId}`);

        try {
            const snapshot = await get(roomRef);
            const roomData = snapshot.val();

            if (roomData && roomData.game && roomData.game.players) {
                // 살아있는 플레이어 수 확인 (본인 포함) - 이게 꼴등 순위
                const alivePlayers = Object.values(roomData.game.players).filter(p => p.alive);
                const rank = alivePlayers.length; // 악용자의 순위 (꼴등)

                // 게임에서 사망 처리
                const playerRef = ref(db, `rooms/${gameId}/${roomId}/game/players/${playerId}`);
                await updateDB(playerRef, {
                    alive: false,
                    trapped: false
                });

                // 방 플레이어 목록에서 제거
                const roomPlayerRef = ref(db, `rooms/${gameId}/${roomId}/players/${playerId}`);
                await remove(roomPlayerRef);

                // 남은 생존자 확인 (악용자 제외)
                const remainingAlive = alivePlayers.filter(p => p.id !== playerId);

                // 남은 생존자가 1명 이하면 게임 종료
                if (remainingAlive.length <= 1) {
                    const gameRef = ref(db, `rooms/${gameId}/${roomId}/game`);
                    if (remainingAlive.length === 1) {
                        // 마지막 생존자 승리
                        await updateDB(gameRef, { winner: remainingAlive[0].id });
                    } else {
                        // 모두 탈락 (무승부)
                        await updateDB(gameRef, { winner: 'draw' });
                    }
                }
                // 남은 생존자가 2명 이상이면 게임 계속 진행 (아무 처리 안 함)
            }
        } catch (error) {
            console.error('패배 처리 실패:', error);
        }

        // 플래그 제거 후 로비로 이동
        localStorage.removeItem(gameInProgressKey);
        setTimeout(() => URLParams.navigate('lobby.html', { game: gameId }), 2000);
        return;
    }

    // 게임 진행 중 플래그 설정
    localStorage.setItem(gameInProgressKey, 'true');

    gameState.roomId = roomId;
    gameState.playerId = playerId;
    gameState.gameId = gameId;
    // 게임 시작 시 플레이어 목록 초기화
    gameState.players = {};

    // Firebase 초기화
    db = await getDatabase();
    roomRef = ref(db, `rooms/${gameId}/${roomId}`);

    // 맵 초기화
    initMap();

    // 이벤트 리스너
    setupEventListeners();

    // Firebase 동기화
    setupFirebaseSync();

    // 게임 루프 시작
    gameLoop();
}

/**
 * 맵 초기화
 */
function initMap() {
    gameState.map = [];

    for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
            // 테두리는 단단한 벽
            if (x === 0 || x === CONFIG.MAP_WIDTH - 1 || y === 0 || y === CONFIG.MAP_HEIGHT - 1) {
                row.push(TILE.SOLID_WALL);
            }
            // 네 모서리에만 검은 블럭 배치 (좌상, 우상, 좌하, 우하)
            else if ((x === 2 && y === 2) || (x === 10 && y === 2) || (x === 2 && y === 8) || (x === 10 && y === 8)) {
                row.push(TILE.SOLID_WALL);
            }
            // 플레이어 시작 위치 주변은 비워둠
            else if (isPlayerStartZone(x, y)) {
                row.push(TILE.EMPTY);
            }
            // 나머지는 부서지는 벽 (랜덤)
            else if (Math.random() < 0.7) {
                row.push(TILE.BREAKABLE_WALL);
            }
            else {
                row.push(TILE.EMPTY);
            }
        }
        gameState.map.push(row);
    }
}

/**
 * 플레이어 시작 위치 주변인지 확인
 */
function isPlayerStartZone(x, y) {
    // 좌상단 (1,1)
    if ((x === 1 && y === 1) || (x === 2 && y === 1) || (x === 1 && y === 2)) return true;

    // 우상단 (11,1)
    if ((x === 11 && y === 1) || (x === 10 && y === 1) || (x === 11 && y === 2)) return true;

    // 좌하단 (1,9)
    if ((x === 1 && y === 9) || (x === 2 && y === 9) || (x === 1 && y === 8)) return true;

    // 우하단 (11,9)
    if ((x === 11 && y === 9) || (x === 10 && y === 9) || (x === 11 && y === 8)) return true;

    return false;
}

/**
 * 플레이어 초기 위치 반환
 */
function getPlayerStartPosition(playerIndex) {
    const positions = [
        { x: 1.5, y: 1.5 },   // 좌상단
        { x: 11.5, y: 1.5 },  // 우상단
        { x: 1.5, y: 9.5 },   // 좌하단
        { x: 11.5, y: 9.5 },  // 우하단
    ];
    return positions[playerIndex] || positions[0];
}

/**
 * Firebase 동기화 설정
 */
function setupFirebaseSync() {
    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);

    // 호스트인 경우 게임 상태 초기화
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

            // 게임 시작 시 플레이어가 없을 때만 초기화 (처음 한 번만)
            playersList.forEach((player, index) => {
                if (!gameState.players[player.id]) {
                    const startPos = getPlayerStartPosition(index);
                    gameState.players[player.id] = {
                        id: player.id,
                        name: player.name,
                        color: player.color,
                        x: startPos.x,
                        y: startPos.y,
                        speed: 1,
                        maxBombs: 1,
                        bombPower: 1,
                        activeBombs: 0,
                        alive: true,
                        trapped: false,
                        trappedAt: null,
                    };
                }
            });

            updatePlayerInfoUI();
        }

        // 호스트가 게임 상태를 초기화
        if (gameState.isHost && !roomData.game) {
            initGameState();
        }
    });

    // 게임 상태 동기화
    onValue(gameRef, (snapshot) => {
        const gameData = snapshot.val();
        if (gameData) {
            // 다른 플레이어들의 위치 동기화
            if (gameData.players) {
                Object.keys(gameData.players).forEach(playerId => {
                    const serverPlayer = gameData.players[playerId];

                    // 로컬에 플레이어가 없으면 추가
                    if (!gameState.players[playerId]) {
                        gameState.players[playerId] = { ...serverPlayer };
                    }
                    // 다른 플레이어의 상태 동기화
                    else if (playerId !== gameState.playerId) {
                        gameState.players[playerId].x = serverPlayer.x;
                        gameState.players[playerId].y = serverPlayer.y;
                        gameState.players[playerId].alive = serverPlayer.alive;
                        gameState.players[playerId].trapped = serverPlayer.trapped || false;
                        gameState.players[playerId].trappedAt = serverPlayer.trappedAt || null;
                        gameState.players[playerId].speed = serverPlayer.speed;
                        gameState.players[playerId].maxBombs = serverPlayer.maxBombs;
                        gameState.players[playerId].bombPower = serverPlayer.bombPower;
                    }
                });

                // UI 업데이트
                updatePlayerInfoUI();
            }

            // 폭탄 동기화
            if (gameData.bombs && typeof gameData.bombs === 'object') {
                gameState.bombs = Object.values(gameData.bombs)
                    .filter(b => b !== null)
                    .map(b => ({
                        ...b,
                        escapedPlayers: b.escapedPlayers || [] // escapedPlayers 초기화
                    }));
            } else {
                gameState.bombs = [];
            }

            // 폭발 동기화
            if (gameData.explosions && typeof gameData.explosions === 'object') {
                gameState.explosions = Object.values(gameData.explosions).filter(e => e !== null);
            } else {
                gameState.explosions = [];
            }

            // 맵 상태 동기화
            if (gameData.map) {
                gameState.map = gameData.map;
            }

            // 아이템 동기화
            if (gameData.items) {
                gameState.items = Object.values(gameData.items);
            }

            // 게임 오버 체크
            if (gameData.winner) {
                handleGameOver(gameData.winner);
            }
        }
    });
}

/**
 * 게임 상태 초기화 (호스트만)
 */
async function initGameState() {
    // 플레이어 게임 상태를 완전히 초기화
    const playersWithGameState = {};
    Object.values(gameState.players).forEach(player => {
        playersWithGameState[player.id] = {
            id: player.id,
            name: player.name,
            color: player.color,
            x: player.x,
            y: player.y,
            speed: player.speed,
            maxBombs: player.maxBombs,
            bombPower: player.bombPower,
            activeBombs: player.activeBombs,
            alive: player.alive,
            trapped: player.trapped,
            trappedAt: player.trappedAt,
        };
    });

    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
    await set(gameRef, {
        map: gameState.map,
        players: playersWithGameState,
        bombs: {},
        explosions: {},
        items: {},
        startTime: Date.now(),
        winner: null,
    });
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 키보드 입력
    document.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key in keys) {
            keys[key] = true;
            e.preventDefault();
        }
        if (key === ' ') {
            keys.space = true;
            placeBomb();
            e.preventDefault();
        }
    });

    document.addEventListener('keyup', (e) => {
        const key = e.key;
        if (key in keys) {
            keys[key] = false;
            e.preventDefault();
        }
        if (key === ' ') {
            keys.space = false;
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
    document.getElementById('return-lobby-btn').addEventListener('click', async () => {
        await leaveRoomAndReturnToLobby();
    });

    document.getElementById('restart-game-btn').addEventListener('click', async () => {
        // 게임 상태를 완전히 초기화
        await resetGame();
    });

    // 페이지 나가기 감지 (F5, 창 닫기 등)
    window.addEventListener('beforeunload', async (e) => {
        // 게임 진행 중이고 아직 살아있는 경우 실격 처리
        if (!gameState.gameOver && gameState.players[gameState.playerId]?.alive) {
            try {
                // 살아있는 플레이어 수 확인 (본인 포함) - 이게 꼴등 순위
                const alivePlayers = Object.values(gameState.players).filter(p => p.alive);

                // 게임에서 사망 처리
                const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${gameState.playerId}`);
                await updateDB(playerRef, {
                    alive: false,
                    trapped: false
                });

                // 방 플레이어 목록에서 제거
                const roomPlayerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/players/${gameState.playerId}`);
                await remove(roomPlayerRef);

                // 남은 생존자 확인 (악용자 제외)
                const remainingAlive = alivePlayers.filter(p => p.id !== gameState.playerId);

                // 남은 생존자가 1명 이하면 게임 종료
                if (remainingAlive.length <= 1) {
                    const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
                    if (remainingAlive.length === 1) {
                        // 마지막 생존자 승리
                        await updateDB(gameRef, { winner: remainingAlive[0].id });
                    } else {
                        // 모두 탈락 (무승부)
                        await updateDB(gameRef, { winner: 'draw' });
                    }
                }
                // 남은 생존자가 2명 이상이면 게임 계속 진행
            } catch (error) {
                console.error('페이지 이탈 처리 실패:', error);
            }
        }
    });
}

/**
 * 게임 리셋
 */
async function resetGame() {
    try {
        // Firebase의 게임 데이터 완전히 제거
        const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
        await set(gameRef, null);

        // 방 상태를 waiting으로 변경
        const statusRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/status`);
        await set(statusRef, 'waiting');

        // 모든 플레이어의 ready 상태 초기화
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

        // room 페이지로 이동
        URLParams.navigate('room.html', { game: gameState.gameId, room: gameState.roomId });
    } catch (error) {
        console.error('게임 리셋 실패:', error);
        showNotification('게임 리셋에 실패했습니다.', 'error');
    }
}

/**
 * 방을 나가고 로비로 돌아가기
 */
async function leaveRoomAndReturnToLobby() {
    try {
        // 게임 진행 중 플래그 제거
        const gameInProgressKey = `game_in_progress_${gameState.gameId}_${gameState.roomId}_${gameState.playerId}`;
        localStorage.removeItem(gameInProgressKey);

        // 현재 방 상태 확인
        const snapshot = await get(roomRef);
        const roomData = snapshot.val();

        if (roomData && roomData.players) {
            // 플레이어 제거
            const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/players/${gameState.playerId}`);
            await remove(playerRef);

            // 남은 플레이어 확인
            const remainingPlayers = Object.keys(roomData.players).filter(
                id => id !== gameState.playerId
            );

            if (remainingPlayers.length === 0) {
                // 모든 플레이어가 나간 경우 방 삭제
                await remove(roomRef);
            } else if (roomData.hostId === gameState.playerId) {
                // 방장이 나가는 경우 새로운 방장 지정
                const newHostId = remainingPlayers[0];
                const hostRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/hostId`);
                await set(hostRef, newHostId);

                // 새 방장의 ready 상태 false로
                const newHostReadyRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/players/${newHostId}/ready`);
                await set(newHostReadyRef, false);
            }
        }

        // 로비로 이동
        URLParams.navigate('lobby.html', { game: gameState.gameId });
    } catch (error) {
        console.error('방 나가기 실패:', error);
        // 에러가 나도 로비로 이동
        URLParams.navigate('lobby.html', { game: gameState.gameId });
    }
}

/**
 * 플레이어 이동
 */
function movePlayer() {
    const player = gameState.players[gameState.playerId];
    if (!player || !player.alive || player.trapped) return;

    const speed = CONFIG.PLAYER_SPEED + (player.speed - 1) * 0.8;
    let newX = player.x;
    let newY = player.y;
    let moved = false;

    if (keys.ArrowUp) {
        newY -= speed / CONFIG.TILE_SIZE;
        moved = true;
    }
    if (keys.ArrowDown) {
        newY += speed / CONFIG.TILE_SIZE;
        moved = true;
    }
    if (keys.ArrowLeft) {
        newX -= speed / CONFIG.TILE_SIZE;
        moved = true;
    }
    if (keys.ArrowRight) {
        newX += speed / CONFIG.TILE_SIZE;
        moved = true;
    }

    const oldX = player.x;
    const oldY = player.y;

    // 충돌 체크 - X와 Y를 독립적으로 체크하여 부드러운 슬라이딩 구현
    if (canMoveTo(newX, player.y)) {
        player.x = newX;
    } else if (newX !== player.x) {
        // X 방향 막힘 - Y 방향으로 슬라이딩 시도 (벽에 살짝 비비면 미끄러지듯 이동)
        const slideAmount = 0.1;
        if (keys.ArrowUp || keys.ArrowDown) {
            if (canMoveTo(player.x, newY)) {
                player.y = newY;
            }
        }
    }

    if (canMoveTo(player.x, newY)) {
        player.y = newY;
    } else if (newY !== player.y) {
        // Y 방향 막힘 - X 방향으로 슬라이딩 시도
        const slideAmount = 0.1;
        if (keys.ArrowLeft || keys.ArrowRight) {
            if (canMoveTo(newX, player.y) && player.x === oldX) {
                player.x = newX;
            }
        }
    }

    // 폭탄 탈출 체크
    checkBombEscape(player, oldX, oldY);

    // 아이템 획득 체크
    checkItemPickup(player);

    // 서버에 위치 업데이트 (throttle 적용 - 50ms마다)
    const now = Date.now();
    if (moved && now - lastPositionUpdate >= POSITION_UPDATE_INTERVAL) {
        lastPositionUpdate = now;
        updatePlayerPosition(player);
    }
}

/**
 * 폭탄 탈출 체크
 */
async function checkBombEscape(player, oldX, oldY) {
    const oldCenterTileX = Math.floor(oldX);
    const oldCenterTileY = Math.floor(oldY);
    const newCenterTileX = Math.floor(player.x);
    const newCenterTileY = Math.floor(player.y);

    // 타일이 변경되었는지 확인
    if (oldCenterTileX !== newCenterTileX || oldCenterTileY !== newCenterTileY) {
        // 이전 타일에 폭탄이 있었다면 탈출 처리
        const bomb = gameState.bombs.find(b => b.x === oldCenterTileX && b.y === oldCenterTileY);
        if (bomb && !bomb.escapedPlayers.includes(player.id)) {
            bomb.escapedPlayers.push(player.id);

            // Firebase에 탈출 상태 업데이트
            const bombRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/bombs/${bomb.id}/escapedPlayers`);
            await set(bombRef, bomb.escapedPlayers);
        }
    }
}

/**
 * 이동 가능한지 확인
 */
function canMoveTo(x, y) {
    const margin = 0.45; // 플레이어 크기의 절반 (타일의 90% 차지, 10% 여유로 부드러운 이동)

    const player = gameState.players[gameState.playerId];
    if (!player) return false;

    // 네 모서리 체크
    const corners = [
        { x: x - margin, y: y - margin },
        { x: x + margin, y: y - margin },
        { x: x - margin, y: y + margin },
        { x: x + margin, y: y + margin },
    ];

    for (const corner of corners) {
        const tileX = Math.floor(corner.x);
        const tileY = Math.floor(corner.y);

        if (tileX < 0 || tileX >= CONFIG.MAP_WIDTH || tileY < 0 || tileY >= CONFIG.MAP_HEIGHT) {
            return false;
        }

        const tile = gameState.map[tileY][tileX];

        // 벽 체크
        if (tile === TILE.SOLID_WALL || tile === TILE.BREAKABLE_WALL) {
            return false;
        }

        // 폭탄 체크: 탈출하지 않은 폭탄만 통과 가능
        if (tile === TILE.BOMB) {
            const bomb = gameState.bombs.find(b => b.x === tileX && b.y === tileY);
            if (bomb) {
                // 이미 탈출한 플레이어는 재진입 불가
                if (bomb.escapedPlayers && bomb.escapedPlayers.includes(player.id)) {
                    return false;
                }
                // 탈출하지 않은 경우 통과 가능 (폭탄 설치 직후)
            }
        }
    }

    return true;
}

/**
 * 플레이어 위치 업데이트
 */
async function updatePlayerPosition(player) {
    const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${player.id}`);
    await updateDB(playerRef, {
        x: player.x,
        y: player.y,
    });
}

/**
 * 물풍선 설치
 */
async function placeBomb() {
    const player = gameState.players[gameState.playerId];
    if (!player || !player.alive || player.trapped) return;

    // 최대 폭탄 개수 체크
    if (player.activeBombs >= player.maxBombs) return;

    const tileX = Math.floor(player.x);
    const tileY = Math.floor(player.y);

    // 이미 폭탄이 있는지 체크
    if (gameState.map[tileY][tileX] === TILE.BOMB) return;

    // 폭탄 설치
    const bombId = `bomb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const bomb = {
        id: bombId,
        x: tileX,
        y: tileY,
        playerId: player.id,
        power: player.bombPower,
        placedAt: Date.now(),
        escapedPlayers: [], // 폭탄에서 탈출한 플레이어 목록
    };

    gameState.bombs.push(bomb);
    gameState.map[tileY][tileX] = TILE.BOMB;
    player.activeBombs++;

    // 서버에 업데이트
    const bombRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/bombs/${bombId}`);
    await set(bombRef, bomb);

    const mapRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/map`);
    await set(mapRef, gameState.map);

    // 타이머 설정
    setTimeout(() => explodeBomb(bomb), CONFIG.BOMB_TIMER);
}

/**
 * 폭탄 폭발
 */
async function explodeBomb(bomb) {
    // 폭탄이 이미 터졌는지 확인
    const bombExists = gameState.bombs.find(b => b.id === bomb.id);
    if (!bombExists) return;

    const player = gameState.players[bomb.playerId];
    if (player) {
        player.activeBombs = Math.max(0, player.activeBombs - 1);
    }

    // 폭탄 제거
    gameState.bombs = gameState.bombs.filter(b => b.id !== bomb.id);
    gameState.map[bomb.y][bomb.x] = TILE.EMPTY;

    // Firebase에서 폭탄 제거
    const bombRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/bombs/${bomb.id}`);
    await set(bombRef, null);

    // 폭발 범위 계산
    const explosions = [];
    explosions.push({ x: bomb.x, y: bomb.y });

    // 4방향으로 폭발
    const directions = [
        { dx: 0, dy: -1 }, // 위
        { dx: 0, dy: 1 },  // 아래
        { dx: -1, dy: 0 }, // 왼쪽
        { dx: 1, dy: 0 },  // 오른쪽
    ];

    for (const dir of directions) {
        for (let i = 1; i <= bomb.power; i++) {
            const x = bomb.x + dir.dx * i;
            const y = bomb.y + dir.dy * i;

            if (x < 0 || x >= CONFIG.MAP_WIDTH || y < 0 || y >= CONFIG.MAP_HEIGHT) break;

            const tile = gameState.map[y][x];

            if (tile === TILE.SOLID_WALL) break;

            explosions.push({ x, y });

            if (tile === TILE.BREAKABLE_WALL) {
                // 벽 파괴
                gameState.map[y][x] = TILE.EMPTY;

                // 아이템 드랍 (폭발 이펙트 후 나타나도록 300ms 지연)
                if (Math.random() < CONFIG.ITEM_DROP_CHANCE) {
                    setTimeout(() => {
                        spawnItem(x, y);
                    }, 300);
                }
                break;
            }

            if (tile === TILE.BOMB) {
                // 연쇄 폭발
                const chainBomb = gameState.bombs.find(b => b.x === x && b.y === y);
                if (chainBomb) {
                    setTimeout(() => explodeBomb(chainBomb), 100);
                }
                break;
            }
        }
    }

    // 폭발 이펙트 저장
    const explosionId = `explosion_${Date.now()}`;
    gameState.explosions.push({
        id: explosionId,
        tiles: explosions,
        createdAt: Date.now(),
    });

    // 플레이어 피격 체크
    checkPlayerHit(explosions);

    // 서버에 업데이트
    const mapRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/map`);
    await set(mapRef, gameState.map);

    const explosionRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/explosions/${explosionId}`);
    await set(explosionRef, {
        id: explosionId,
        tiles: explosions,
        createdAt: Date.now(),
    });

    // 폭발 이펙트 제거 (500ms 후)
    setTimeout(async () => {
        gameState.explosions = gameState.explosions.filter(e => e.id !== explosionId);

        // 서버에서도 폭발 제거
        const explosionsRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/explosions/${explosionId}`);
        await set(explosionsRef, null);
    }, 500);
}

/**
 * 플레이어 피격 체크
 */
async function checkPlayerHit(explosionTiles) {
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player.alive || player.trapped) continue;

        const playerTileX = Math.floor(player.x);
        const playerTileY = Math.floor(player.y);

        for (const tile of explosionTiles) {
            if (tile.x === playerTileX && tile.y === playerTileY) {
                // 물풍선에 갇힘
                player.trapped = true;
                player.trappedAt = Date.now();

                // 서버에 업데이트
                const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${playerId}`);
                await updateDB(playerRef, {
                    trapped: true,
                    trappedAt: player.trappedAt
                });

                // 2초 후 터지면서 사망
                setTimeout(() => popTrappedPlayer(playerId), 2000);
                break;
            }
        }
    }
}

/**
 * 갇힌 플레이어 터트리기 (2초 후)
 */
async function popTrappedPlayer(playerId) {
    const player = gameState.players[playerId];
    if (!player || !player.trapped) return;

    // 사망 처리
    player.alive = false;
    player.trapped = false;

    // 서버에 업데이트
    const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${playerId}`);
    await updateDB(playerRef, {
        alive: false,
        trapped: false
    });

    // 승패 체크
    checkGameOver();

    // UI 업데이트
    updatePlayerInfoUI();
}

/**
 * 아이템 생성
 */
async function spawnItem(x, y) {
    const itemTypes = [ITEM.SPEED_UP, ITEM.POWER_UP, ITEM.BOMB_UP];
    const itemType = itemTypes[Math.floor(Math.random() * itemTypes.length)];

    const itemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const item = {
        id: itemId,
        type: itemType,
        x,
        y,
    };

    gameState.items.push(item);

    // 서버에 업데이트
    const itemRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/items/${itemId}`);
    await set(itemRef, item);
}

/**
 * 아이템 획득 체크
 */
async function checkItemPickup(player) {
    const playerTileX = Math.floor(player.x);
    const playerTileY = Math.floor(player.y);

    for (const item of gameState.items) {
        if (item.x === playerTileX && item.y === playerTileY) {
            // 아이템 효과 적용
            applyItemEffect(player, item.type);

            // 아이템 제거
            gameState.items = gameState.items.filter(i => i.id !== item.id);

            // 서버에 업데이트
            const itemRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/items/${item.id}`);
            await set(itemRef, null);

            const playerRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game/players/${player.id}`);
            await set(playerRef, player);

            updatePlayerInfoUI();
            break;
        }
    }
}

/**
 * 아이템 효과 적용
 */
function applyItemEffect(player, itemType) {
    switch (itemType) {
        case ITEM.SPEED_UP:
            player.speed = Math.min(3, player.speed + 1);
            showNotification('🏃 스피드 UP!', 'success');
            break;
        case ITEM.POWER_UP:
            player.bombPower = Math.min(7, player.bombPower + 1);
            showNotification('💥 물줄기 UP!', 'success');
            break;
        case ITEM.BOMB_UP:
            player.maxBombs = Math.min(5, player.maxBombs + 1);
            showNotification('💣 풍선 UP!', 'success');
            break;
    }
}

/**
 * 게임 오버 체크
 */
async function checkGameOver() {
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive);

    if (alivePlayers.length === 1) {
        const winner = alivePlayers[0];
        const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
        await updateDB(gameRef, { winner: winner.id });
    } else if (alivePlayers.length === 0) {
        const gameRef = ref(db, `rooms/${gameState.gameId}/${gameState.roomId}/game`);
        await updateDB(gameRef, { winner: 'draw' });
    }
}

/**
 * 게임 오버 처리
 */
function handleGameOver(winnerId) {
    if (gameState.gameOver) return;

    gameState.gameOver = true;

    // 게임 진행 중 플래그 제거 (정상 종료)
    const gameInProgressKey = `game_in_progress_${gameState.gameId}_${gameState.roomId}_${gameState.playerId}`;
    localStorage.removeItem(gameInProgressKey);

    const modal = document.getElementById('game-over-modal');
    const winnerNameEl = document.getElementById('winner-name');

    if (winnerId === 'draw') {
        winnerNameEl.textContent = '무승부!';
    } else {
        const winner = gameState.players[winnerId];
        winnerNameEl.textContent = `승자: ${winner.name}`;
    }

    modal.classList.add('show');
}

/**
 * 플레이어 정보 UI 업데이트
 */
function updatePlayerInfoUI() {
    const container = document.getElementById('players-info');
    container.innerHTML = '';

    Object.values(gameState.players).forEach(player => {
        const div = document.createElement('div');
        div.className = `player-info ${player.alive ? 'alive' : 'dead'}`;

        let statusText;
        if (!player.alive) {
            statusText = '사망 ❌';
        } else if (player.trapped) {
            statusText = '갇힘 🎈';
        } else {
            statusText = '생존 ✅';
        }

        div.innerHTML = `
            <h3>
                <span class="player-color" style="background: ${player.color}"></span>
                ${player.name}
                ${player.id === gameState.playerId ? '(나)' : ''}
            </h3>
            <div class="player-stats">
                <div class="stat-item">
                    <span>상태:</span>
                    <span>${statusText}</span>
                </div>
                <div class="stat-item">
                    <span>스피드:</span>
                    <span>${player.speed}</span>
                </div>
                <div class="stat-item">
                    <span>물줄기:</span>
                    <span>${player.bombPower}</span>
                </div>
                <div class="stat-item">
                    <span>풍선 개수:</span>
                    <span>${player.maxBombs}</span>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

/**
 * 게임 루프
 */
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

/**
 * 업데이트
 */
function update() {
    movePlayer();
    updateTimer();
}

/**
 * 타이머 업데이트
 */
function updateTimer() {
    const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    document.getElementById('game-timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 렌더링
 */
function render() {
    // 배경 클리어
    ctx.fillStyle = '#F5F5F5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 맵 렌더링
    renderMap();

    // 아이템 렌더링
    renderItems();

    // 폭탄 렌더링
    renderBombs();

    // 폭발 렌더링
    renderExplosions();

    // 플레이어 렌더링
    renderPlayers();
}

/**
 * 맵 렌더링
 */
function renderMap() {
    for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
            const tile = gameState.map[y][x];
            const px = x * CONFIG.TILE_SIZE;
            const py = y * CONFIG.TILE_SIZE;

            if (tile === TILE.SOLID_WALL) {
                ctx.fillStyle = '#2D3436';
                ctx.fillRect(px, py, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // 테두리
                ctx.strokeStyle = '#636E72';
                ctx.lineWidth = 2;
                ctx.strokeRect(px, py, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            } else if (tile === TILE.BREAKABLE_WALL) {
                ctx.fillStyle = '#A29BFE';
                ctx.fillRect(px + 2, py + 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);

                // 무늬
                ctx.fillStyle = '#6C5CE7';
                ctx.fillRect(px + 10, py + 10, 10, 10);
                ctx.fillRect(px + 30, py + 30, 10, 10);
                ctx.fillRect(px + 10, py + 30, 10, 10);
                ctx.fillRect(px + 30, py + 10, 10, 10);
            }
        }
    }
}

/**
 * 플레이어 렌더링
 */
function renderPlayers() {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        const px = player.x * CONFIG.TILE_SIZE;
        const py = player.y * CONFIG.TILE_SIZE;
        const size = CONFIG.TILE_SIZE * 0.90; // 타일의 90% 크기 (10% 여유로 부드러운 이동)

        // 갇힌 플레이어는 물풍선 안에 표시
        if (player.trapped) {
            // 물풍선 (반투명)
            ctx.fillStyle = 'rgba(100, 200, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(px, py, size * 0.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 작은 플레이어
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(px, py, size * 0.3, 0, Math.PI * 2);
            ctx.fill();

            // 작은 눈
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(px - 5, py - 3, 3, 0, Math.PI * 2);
            ctx.arc(px + 5, py - 3, 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#2D3436';
            ctx.beginPath();
            ctx.arc(px - 5, py - 3, 2, 0, Math.PI * 2);
            ctx.arc(px + 5, py - 3, 2, 0, Math.PI * 2);
            ctx.fill();

            // 타이머 표시
            if (player.trappedAt) {
                const elapsed = Date.now() - player.trappedAt;
                const remaining = Math.max(0, 2000 - elapsed);
                const remainingSeconds = (remaining / 1000).toFixed(1);

                ctx.fillStyle = '#e74c3c';
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(remainingSeconds + 's', px, py + size * 0.7);
            }
        } else {
            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.ellipse(px, py + size * 0.4, size * 0.4, size * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();

            // 플레이어
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(px, py, size * 0.4, 0, Math.PI * 2);
            ctx.fill();

            // 테두리
            ctx.strokeStyle = '#2D3436';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 눈
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(px - 8, py - 5, 5, 0, Math.PI * 2);
            ctx.arc(px + 8, py - 5, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#2D3436';
            ctx.beginPath();
            ctx.arc(px - 8, py - 5, 3, 0, Math.PI * 2);
            ctx.arc(px + 8, py - 5, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // 이름
        ctx.fillStyle = '#2D3436';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, px, py - size * 0.6);
    });
}

/**
 * 폭탄 렌더링
 */
function renderBombs() {
    const now = Date.now();

    gameState.bombs.forEach(bomb => {
        const px = (bomb.x + 0.5) * CONFIG.TILE_SIZE;
        const py = (bomb.y + 0.5) * CONFIG.TILE_SIZE;
        const elapsed = now - bomb.placedAt;
        const progress = elapsed / CONFIG.BOMB_TIMER;

        // 깜빡임 효과
        const pulse = Math.sin(elapsed / 100) * 0.1 + 0.9;
        const size = CONFIG.TILE_SIZE * 0.35 * pulse;

        // 폭탄
        ctx.fillStyle = progress > 0.7 ? '#D63031' : '#2D3436';
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();

        // 심지
        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py - size);
        ctx.lineTo(px + Math.sin(elapsed / 100) * 5, py - size - 10);
        ctx.stroke();

        // 불꽃
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(px + Math.sin(elapsed / 100) * 5, py - size - 10, 4, 0, Math.PI * 2);
        ctx.fill();
    });
}

/**
 * 폭발 렌더링
 */
function renderExplosions() {
    gameState.explosions.forEach(explosion => {
        explosion.tiles.forEach(tile => {
            const px = tile.x * CONFIG.TILE_SIZE;
            const py = tile.y * CONFIG.TILE_SIZE;

            // 폭발 이펙트
            ctx.fillStyle = 'rgba(255, 200, 0, 0.7)';
            ctx.fillRect(px + 5, py + 5, CONFIG.TILE_SIZE - 10, CONFIG.TILE_SIZE - 10);

            ctx.fillStyle = 'rgba(255, 100, 0, 0.5)';
            ctx.fillRect(px + 10, py + 10, CONFIG.TILE_SIZE - 20, CONFIG.TILE_SIZE - 20);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(px + 15, py + 15, CONFIG.TILE_SIZE - 30, CONFIG.TILE_SIZE - 30);
        });
    });
}

/**
 * 아이템 렌더링
 */
function renderItems() {
    gameState.items.forEach(item => {
        const px = (item.x + 0.5) * CONFIG.TILE_SIZE;
        const py = (item.y + 0.5) * CONFIG.TILE_SIZE;
        const size = CONFIG.TILE_SIZE * 0.4;

        // 배경
        ctx.fillStyle = 'white';
        ctx.fillRect(px - size / 2, py - size / 2, size, size);

        // 아이템 타입별 색상
        let color;
        let emoji;
        switch (item.type) {
            case ITEM.SPEED_UP:
                color = '#74B9FF';
                emoji = '🏃';
                break;
            case ITEM.POWER_UP:
                color = '#FF7675';
                emoji = '💥';
                break;
            case ITEM.BOMB_UP:
                color = '#FD79A8';
                emoji = '💣';
                break;
        }

        ctx.fillStyle = color;
        ctx.fillRect(px - size / 2 + 2, py - size / 2 + 2, size - 4, size - 4);

        // 이모지
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, px, py);
    });
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
