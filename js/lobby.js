/**
 * 로비 페이지 로직
 */

import {
    GAMES,
    Storage,
    URLParams,
    showNotification,
    validateRoomTitle,
    createRoomData
} from './utils.js';
import { getDatabase, ref, set, onValue, off, get } from './firebase-config.js';

// DOM 요소
const gameTitle = document.getElementById('game-title');
const gameSubtitle = document.getElementById('game-subtitle');
const backBtn = document.getElementById('back-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const roomList = document.getElementById('room-list');
const createRoomModal = document.getElementById('create-room-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelBtn = document.getElementById('cancel-btn');
const createRoomForm = document.getElementById('create-room-form');
const roomTitleInput = document.getElementById('room-title');
const maxPlayersSelect = document.getElementById('max-players');

// 전역 변수
let currentGameId = '';
let roomsRef = null;
let roomsListener = null;

// 초기화
function init() {
    // URL 파라미터에서 게임 ID 가져오기
    currentGameId = URLParams.get('game');

    if (!currentGameId || !GAMES[currentGameId]) {
        showNotification('잘못된 게임입니다.', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }

    // 플레이어 이름 확인
    const playerName = Storage.getPlayerName();
    if (!playerName) {
        showNotification('먼저 닉네임을 설정해주세요.', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }

    setupUI();
    setupEventListeners();
    loadRooms();
}

// UI 설정
function setupUI() {
    const game = GAMES[currentGameId];
    gameTitle.textContent = `🎮 ${game.name} 로비`;
    gameSubtitle.textContent = '방을 선택하거나 새로운 방을 만드세요';
}

// 이벤트 리스너 설정
function setupEventListeners() {
    backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    createRoomBtn.addEventListener('click', openCreateRoomModal);
    closeModalBtn.addEventListener('click', closeCreateRoomModal);
    cancelBtn.addEventListener('click', closeCreateRoomModal);
    createRoomForm.addEventListener('submit', handleCreateRoom);

    // 모달 외부 클릭 시 닫기
    createRoomModal.addEventListener('click', (e) => {
        if (e.target === createRoomModal) {
            closeCreateRoomModal();
        }
    });

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && createRoomModal.classList.contains('active')) {
            closeCreateRoomModal();
        }
    });
}

// 방 목록 불러오기
async function loadRooms() {
    const db = await getDatabase();
    roomsRef = ref(db, `rooms/${currentGameId}`);

    // 실시간 리스너 설정
    roomsListener = (snapshot) => {
        const rooms = snapshot.val();
        renderRooms(rooms);
    };

    onValue(roomsRef, roomsListener);
}

// 방 목록 렌더링
function renderRooms(rooms) {
    if (!rooms || Object.keys(rooms).length === 0) {
        roomList.innerHTML = `
            <p class="text-center" style="color: #636E72; padding: 40px 0;">
                생성된 방이 없습니다. 새로운 방을 만들어보세요!
            </p>
        `;
        return;
    }

    const roomArray = Object.values(rooms)
        .sort((a, b) => b.createdAt - a.createdAt); // 최신순 정렬

    roomList.innerHTML = roomArray.map(room => {
        const playerCount = room.players ? Object.keys(room.players).length : 0;
        const isFull = playerCount >= room.maxPlayers;
        const isPlaying = room.status === 'playing';

        let statusClass = 'waiting';
        let statusText = '대기중';

        if (isPlaying) {
            statusClass = 'playing';
            statusText = '게임중';
        } else if (isFull) {
            statusClass = 'full';
            statusText = '만석';
        }

        return `
            <div class="room-item" data-room-id="${room.id}" ${(isFull || isPlaying) ? 'style="cursor: not-allowed; opacity: 0.7;"' : ''}>
                <div class="room-header">
                    <div class="room-title">${escapeHtml(room.title)}</div>
                    <div class="room-status ${statusClass}">${statusText}</div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 8px;">
                    <span class="room-players">👥 ${playerCount}/${room.maxPlayers}</span>
                    <span style="color: #636E72;">방장: ${escapeHtml(room.players[room.hostId]?.name || '알 수 없음')}</span>
                </div>
            </div>
        `;
    }).join('');

    // 방 클릭 이벤트 추가
    document.querySelectorAll('.room-item').forEach(item => {
        item.addEventListener('click', () => {
            const roomId = item.dataset.roomId;
            const room = rooms[roomId];

            if (!room) return;

            const playerCount = room.players ? Object.keys(room.players).length : 0;
            const isFull = playerCount >= room.maxPlayers;
            const isPlaying = room.status === 'playing';

            if (isFull) {
                showNotification('방이 가득 찼습니다.', 'error');
                return;
            }

            if (isPlaying) {
                showNotification('게임이 진행 중입니다.', 'error');
                return;
            }

            joinRoom(roomId);
        });
    });
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 방 만들기 모달 열기
function openCreateRoomModal() {
    createRoomModal.classList.add('active');
    roomTitleInput.focus();
}

// 방 만들기 모달 닫기
function closeCreateRoomModal() {
    createRoomModal.classList.remove('active');
    createRoomForm.reset();
}

// 방 만들기
async function handleCreateRoom(e) {
    e.preventDefault();

    const title = roomTitleInput.value.trim();
    const maxPlayers = maxPlayersSelect.value;

    // 검증
    const validation = validateRoomTitle(title);
    if (!validation.valid) {
        showNotification(validation.message, 'error');
        return;
    }

    const playerName = Storage.getPlayerName();
    const playerId = Storage.getPlayerId();

    // 방 데이터 생성
    const roomData = createRoomData(title, maxPlayers, currentGameId, playerId, playerName);

    try {
        const db = await getDatabase();
        const newRoomRef = ref(db, `rooms/${currentGameId}/${roomData.id}`);
        await set(newRoomRef, roomData);

        showNotification('방이 생성되었습니다!', 'success');
        closeCreateRoomModal();

        // 방으로 이동
        setTimeout(() => {
            URLParams.navigate('room.html', {
                game: currentGameId,
                room: roomData.id
            });
        }, 500);
    } catch (error) {
        console.error('방 생성 실패:', error);
        showNotification('방 생성에 실패했습니다.', 'error');
    }
}

// 방 입장
function joinRoom(roomId) {
    URLParams.navigate('room.html', {
        game: currentGameId,
        room: roomId
    });
}

// 페이지 언로드 시 리스너 정리
window.addEventListener('beforeunload', () => {
    if (roomsRef && roomsListener) {
        off(roomsRef, 'value', roomsListener);
    }
});

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
