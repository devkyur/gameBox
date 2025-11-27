/**
 * 방 페이지 로직
 */

import {
    GAMES,
    Storage,
    URLParams,
    showNotification,
    createPlayerData
} from './utils.js';
import { getDatabase, ref, set, update, remove, onValue, off, get } from './firebase-config.js';

// DOM 요소
const roomTitleEl = document.getElementById('room-title');
const roomInfoEl = document.getElementById('room-info');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const readyBtn = document.getElementById('ready-btn');
const startBtn = document.getElementById('start-btn');
const playerListEl = document.getElementById('player-list');
const infoRoomTitle = document.getElementById('info-room-title');
const infoHost = document.getElementById('info-host');
const infoPlayers = document.getElementById('info-players');
const infoGame = document.getElementById('info-game');

// 전역 변수
let currentGameId = '';
let currentRoomId = '';
let currentPlayerId = '';
let currentPlayerName = '';
let roomRef = null;
let roomListener = null;
let isHost = false;
let isReady = false;

// 초기화
async function init() {
    // URL 파라미터 가져오기
    currentGameId = URLParams.get('game');
    currentRoomId = URLParams.get('room');

    if (!currentGameId || !currentRoomId) {
        showNotification('잘못된 접근입니다.', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }

    // 플레이어 정보 가져오기
    currentPlayerName = Storage.getPlayerName();
    currentPlayerId = Storage.getPlayerId();

    if (!currentPlayerName) {
        showNotification('먼저 닉네임을 설정해주세요.', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }

    // 방 존재 여부 확인 및 입장
    await joinRoomIfNeeded();

    setupEventListeners();
    loadRoom();
}

// 방 입장 처리
async function joinRoomIfNeeded() {
    const db = await getDatabase();
    roomRef = ref(db, `rooms/${currentGameId}/${currentRoomId}`);

    try {
        const snapshot = await get(roomRef);
        const roomData = snapshot.val();

        if (!roomData) {
            showNotification('존재하지 않는 방입니다.', 'error');
            setTimeout(() => {
                URLParams.navigate('lobby.html', { game: currentGameId });
            }, 1500);
            return;
        }

        // 이미 방에 있는지 확인
        if (roomData.players && roomData.players[currentPlayerId]) {
            console.log('이미 방에 입장한 플레이어입니다.');
            isHost = roomData.hostId === currentPlayerId;
            return;
        }

        // 방이 가득 찼는지 확인
        const playerCount = roomData.players ? Object.keys(roomData.players).length : 0;
        if (playerCount >= roomData.maxPlayers) {
            showNotification('방이 가득 찼습니다.', 'error');
            setTimeout(() => {
                URLParams.navigate('lobby.html', { game: currentGameId });
            }, 1500);
            return;
        }

        // 게임이 진행 중인지 확인
        if (roomData.status === 'playing') {
            showNotification('게임이 진행 중입니다.', 'error');
            setTimeout(() => {
                URLParams.navigate('lobby.html', { game: currentGameId });
            }, 1500);
            return;
        }

        // 방에 플레이어 추가
        const playerData = createPlayerData(currentPlayerName, currentPlayerId);
        const playerRef = ref(db, `rooms/${currentGameId}/${currentRoomId}/players/${currentPlayerId}`);
        await set(playerRef, playerData);

        isHost = roomData.hostId === currentPlayerId;
        showNotification('방에 입장했습니다!', 'success');
    } catch (error) {
        console.error('방 입장 실패:', error);
        showNotification('방 입장에 실패했습니다.', 'error');
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    leaveRoomBtn.addEventListener('click', leaveRoom);
    readyBtn.addEventListener('click', toggleReady);
    startBtn.addEventListener('click', startGame);

    // 페이지 나가기 전 정리
    window.addEventListener('beforeunload', cleanup);
}

// 방 데이터 실시간 로딩
function loadRoom() {
    roomListener = (snapshot) => {
        const roomData = snapshot.val();

        if (!roomData) {
            showNotification('방이 삭제되었습니다.', 'error');
            setTimeout(() => {
                URLParams.navigate('lobby.html', { game: currentGameId });
            }, 1500);
            return;
        }

        updateUI(roomData);
    };

    onValue(roomRef, roomListener);
}

// UI 업데이트
function updateUI(roomData) {
    // 게임 시작 상태 확인 - 모든 플레이어를 게임 화면으로 이동
    if (roomData.status === 'playing') {
        showNotification('게임이 시작되었습니다!', 'success');
        setTimeout(() => {
            // 게임 종류에 따라 올바른 HTML 파일로 이동
            const gameHtmlMap = {
                'crazy-arcade': 'game.html',
                'tetris': 'tetris.html',
            };
            const gameHtml = gameHtmlMap[currentGameId] || 'game.html';
            URLParams.navigate(gameHtml, { room: currentRoomId });
        }, 500);
        return;
    }

    // 헤더 정보
    roomTitleEl.textContent = `🎮 ${roomData.title}`;

    const playerCount = roomData.players ? Object.keys(roomData.players).length : 0;
    roomInfoEl.textContent = `플레이어: ${playerCount}/${roomData.maxPlayers}`;

    // 방 정보
    infoRoomTitle.textContent = roomData.title;
    infoHost.textContent = roomData.players[roomData.hostId]?.name || '알 수 없음';
    infoPlayers.textContent = `${playerCount}/${roomData.maxPlayers}`;
    infoGame.textContent = GAMES[currentGameId]?.name || '알 수 없음';

    // 플레이어 목록
    renderPlayerList(roomData);

    // 버튼 상태 업데이트
    updateButtons(roomData);
}

// 플레이어 목록 렌더링
function renderPlayerList(roomData) {
    if (!roomData.players) {
        playerListEl.innerHTML = '<p class="text-center">플레이어가 없습니다.</p>';
        return;
    }

    const players = Object.values(roomData.players);

    playerListEl.innerHTML = players.map(player => {
        const isCurrentPlayer = player.id === currentPlayerId;
        const isPlayerHost = player.id === roomData.hostId;

        let statusHTML = '';
        if (isPlayerHost) {
            statusHTML = '<span class="player-status host">방장</span>';
        } else if (player.ready) {
            statusHTML = '<span class="player-status ready">준비완료</span>';
        } else {
            statusHTML = '<span class="player-status waiting">대기중</span>';
        }

        return `
            <li class="player-item" style="border-left: 4px solid ${player.color}">
                <div>
                    <span class="player-name">${escapeHtml(player.name)}</span>
                    ${isCurrentPlayer ? ' <strong>(나)</strong>' : ''}
                </div>
                ${statusHTML}
            </li>
        `;
    }).join('');
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 버튼 상태 업데이트
function updateButtons(roomData) {
    const currentPlayer = roomData.players[currentPlayerId];
    isReady = currentPlayer?.ready || false;
    isHost = roomData.hostId === currentPlayerId;

    // Ready 버튼
    if (isHost) {
        readyBtn.style.display = 'none';
    } else {
        readyBtn.style.display = 'inline-block';
        if (isReady) {
            readyBtn.textContent = '준비 취소';
            readyBtn.className = 'btn btn-secondary';
        } else {
            readyBtn.textContent = '준비';
            readyBtn.className = 'btn btn-success';
        }
    }

    // Start 버튼
    if (isHost) {
        startBtn.style.display = 'inline-block';

        // 모든 플레이어가 준비되었는지 확인
        const players = Object.values(roomData.players);
        const allReady = players.every(p => p.id === roomData.hostId || p.ready);
        const hasEnoughPlayers = players.length >= 2;

        if (allReady && hasEnoughPlayers) {
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
        } else {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';
        }
    } else {
        startBtn.style.display = 'none';
    }
}

// 준비 토글
async function toggleReady() {
    try {
        const db = await getDatabase();
        const playerRef = ref(
            db,
            `rooms/${currentGameId}/${currentRoomId}/players/${currentPlayerId}/ready`
        );
        await set(playerRef, !isReady);
    } catch (error) {
        console.error('준비 상태 변경 실패:', error);
        showNotification('준비 상태 변경에 실패했습니다.', 'error');
    }
}

// 게임 시작
async function startGame() {
    if (!isHost) return;

    try {
        const db = await getDatabase();
        const statusRef = ref(
            db,
            `rooms/${currentGameId}/${currentRoomId}/status`
        );
        await set(statusRef, 'playing');

        showNotification('게임을 시작합니다!', 'success');

        // 게임 페이지로 이동
        setTimeout(() => {
            // 게임 종류에 따라 올바른 HTML 파일로 이동
            const gameHtmlMap = {
                'crazy-arcade': 'game.html',
                'tetris': 'tetris.html',
            };
            const gameHtml = gameHtmlMap[currentGameId] || 'game.html';
            URLParams.navigate(gameHtml, { room: currentRoomId });
        }, 500);
    } catch (error) {
        console.error('게임 시작 실패:', error);
        showNotification('게임 시작에 실패했습니다.', 'error');
    }
}

// 방 나가기
async function leaveRoom() {
    try {
        const db = await getDatabase();
        // 플레이어 제거
        const playerRef = ref(
            db,
            `rooms/${currentGameId}/${currentRoomId}/players/${currentPlayerId}`
        );
        await remove(playerRef);

        // 방장이 나가는 경우
        if (isHost) {
            const snapshot = await get(roomRef);
            const roomData = snapshot.val();

            if (roomData && roomData.players) {
                const remainingPlayers = Object.keys(roomData.players);

                if (remainingPlayers.length === 0) {
                    // 모든 플레이어가 나간 경우 방 삭제
                    await remove(roomRef);
                } else {
                    // 새로운 방장 지정
                    const newHostId = remainingPlayers[0];
                    const hostRef = ref(
                        db,
                        `rooms/${currentGameId}/${currentRoomId}/hostId`
                    );
                    await set(hostRef, newHostId);

                    // 새 방장의 ready 상태 false로
                    const newHostReadyRef = ref(
                        db,
                        `rooms/${currentGameId}/${currentRoomId}/players/${newHostId}/ready`
                    );
                    await set(newHostReadyRef, false);

                    showNotification('방장이 변경되었습니다.', 'info');
                }
            }
        }

        cleanup();
        URLParams.navigate('lobby.html', { game: currentGameId });
    } catch (error) {
        console.error('방 나가기 실패:', error);
        showNotification('방 나가기에 실패했습니다.', 'error');
    }
}

// 정리
function cleanup() {
    if (roomRef && roomListener) {
        off(roomRef, 'value', roomListener);
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
