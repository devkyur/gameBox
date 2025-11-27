/**
 * 유틸리티 함수 모음
 */

// 게임 정보 데이터
export const GAMES = {
    'crazy-arcade': {
        id: 'crazy-arcade',
        name: '크레이지 아케이드',
        description: '물풍선으로 상대를 잡아라!',
        color: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)'
    },
    'tetris': {
        id: 'tetris',
        name: '테트리스',
        description: '블록을 쌓아 라인을 완성하세요',
        color: 'linear-gradient(135deg, #F093FB 0%, #F5576C 100%)'
    },
    'fighting': {
        id: 'fighting',
        name: '철권',
        description: '격투 게임',
        color: 'linear-gradient(135deg, #4FACFE 0%, #00F2FE 100%)',
        disabled: true
    },
    'mini-games': {
        id: 'mini-games',
        name: '미니게임',
        description: '다양한 미니게임 모음',
        color: 'linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)',
        disabled: true
    }
};

// 로컬 스토리지 관리
export const Storage = {
    getPlayerName() {
        return localStorage.getItem('playerName') || '';
    },

    setPlayerName(name) {
        localStorage.setItem('playerName', name);
    },

    getPlayerId() {
        let playerId = localStorage.getItem('playerId');
        if (!playerId) {
            playerId = this.generateId();
            localStorage.setItem('playerId', playerId);
        }
        return playerId;
    },

    generateId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
};

// URL 파라미터 관리
export const URLParams = {
    get(key) {
        const params = new URLSearchParams(window.location.search);
        return params.get(key);
    },

    set(key, value) {
        const params = new URLSearchParams(window.location.search);
        params.set(key, value);
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.pushState({}, '', newUrl);
    },

    navigate(page, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${page}?${queryString}` : page;
        window.location.href = url;
    }
};

// 알림 표시
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// CSS 애니메이션 추가 (slideOut)
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// 플레이어 이름 검증
export function validatePlayerName(name) {
    if (!name || name.trim().length === 0) {
        return { valid: false, message: '닉네임을 입력해주세요.' };
    }
    if (name.length < 2) {
        return { valid: false, message: '닉네임은 2글자 이상이어야 합니다.' };
    }
    if (name.length > 12) {
        return { valid: false, message: '닉네임은 12글자 이하여야 합니다.' };
    }
    return { valid: true };
}

// 방 제목 검증
export function validateRoomTitle(title) {
    if (!title || title.trim().length === 0) {
        return { valid: false, message: '방 제목을 입력해주세요.' };
    }
    if (title.length > 20) {
        return { valid: false, message: '방 제목은 20글자 이하여야 합니다.' };
    }
    return { valid: true };
}

// 시간 포맷팅
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    return date.toLocaleDateString('ko-KR');
}

// 랜덤 색상 생성
export function getRandomColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
        '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// 디바운스
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 방 ID 생성
export function generateRoomId() {
    return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 플레이어 데이터 생성
export function createPlayerData(name, playerId) {
    return {
        id: playerId,
        name: name,
        ready: false,
        color: getRandomColor(),
        joinedAt: Date.now()
    };
}

// 방 데이터 생성
export function createRoomData(title, maxPlayers, gameId, hostId, hostName) {
    const roomId = generateRoomId();
    return {
        id: roomId,
        title: title,
        gameId: gameId,
        maxPlayers: parseInt(maxPlayers),
        hostId: hostId,
        status: 'waiting', // waiting, playing, finished
        createdAt: Date.now(),
        players: {
            [hostId]: createPlayerData(hostName, hostId)
        }
    };
}
