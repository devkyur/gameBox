/**
 * 메인 페이지 로직
 */

import { GAMES, Storage, URLParams, showNotification, validatePlayerName } from './utils.js';

// DOM 요소
const gameList = document.getElementById('game-list');
const playerNameInput = document.getElementById('player-name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const currentPlayerDisplay = document.getElementById('current-player');

// 초기화
function init() {
    loadPlayerName();
    renderGameCards();
    setupEventListeners();
}

// 저장된 플레이어 이름 불러오기
function loadPlayerName() {
    const playerName = Storage.getPlayerName();
    if (playerName) {
        playerNameInput.value = playerName;
        currentPlayerDisplay.textContent = `현재 플레이어: ${playerName}`;
        currentPlayerDisplay.style.color = '#00B894';
        currentPlayerDisplay.style.fontWeight = '600';
    } else {
        currentPlayerDisplay.textContent = '닉네임을 설정해주세요';
        currentPlayerDisplay.style.color = '#636E72';
    }
}

// 게임 카드 렌더링
function renderGameCards() {
    gameList.innerHTML = '';

    Object.values(GAMES).forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card card';
        card.style.background = game.color;

        if (game.disabled) {
            card.style.opacity = '0.6';
            card.style.cursor = 'not-allowed';
        }

        card.innerHTML = `
            <h2>${game.name}</h2>
            <p>${game.description}</p>
            ${game.disabled ? '<p style="margin-top: 12px; font-weight: 600;">🚧 준비 중...</p>' : ''}
        `;

        if (!game.disabled) {
            card.addEventListener('click', () => selectGame(game.id));
        }

        gameList.appendChild(card);
    });
}

// 게임 선택
function selectGame(gameId) {
    const playerName = Storage.getPlayerName();

    if (!playerName) {
        showNotification('먼저 닉네임을 설정해주세요!', 'error');
        playerNameInput.focus();
        return;
    }

    // 로비 페이지로 이동
    URLParams.navigate('lobby.html', { game: gameId });
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 닉네임 저장
    saveNameBtn.addEventListener('click', savePlayerName);

    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            savePlayerName();
        }
    });

    // Enter 키로 포커스된 게임 카드 선택
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && document.activeElement.classList.contains('game-card')) {
            document.activeElement.click();
        }
    });
}

// 플레이어 이름 저장
function savePlayerName() {
    const name = playerNameInput.value.trim();
    const validation = validatePlayerName(name);

    if (!validation.valid) {
        showNotification(validation.message, 'error');
        return;
    }

    Storage.setPlayerName(name);
    loadPlayerName();
    showNotification('닉네임이 저장되었습니다!', 'success');
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
