/**
 * Firebase 설정 파일
 *
 * 사용 방법:
 * 1. Firebase 콘솔(https://console.firebase.google.com/)에서 프로젝트 생성
 * 2. Realtime Database 활성화
 * 3. 아래 설정값을 Firebase 프로젝트 정보로 교체
 */

// Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyASVasoNQhJIAqxVkhXYURaS5ZIQj3xFRY",
    authDomain: "gamebox-43200.firebaseapp.com",
    databaseURL: "https://gamebox-43200-default-rtdb.firebaseio.com",
    projectId: "gamebox-43200",
    storageBucket: "gamebox-43200.firebasestorage.app",
    messagingSenderId: "409666250076",
    appId: "1:409666250076:web:e9e896d094e1d7dda08d99",
    measurementId: "G-12W2TE9D1H"
};

// Firebase가 설정되었는지 확인
const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

// Firebase를 사용하지 않고 로컬 모드로 실행할지 여부
let USE_LOCAL_MODE = !isFirebaseConfigured;

// Firebase 초기화 및 내보내기
let db = null;
let app = null;
let firebaseSDK = null;

// Firebase 초기화 함수
async function initFirebase() {
    if (USE_LOCAL_MODE) {
        console.log('⚠️ Firebase가 설정되지 않았습니다.');
        console.log('📝 로컬 모드로 실행됩니다. (새로고침 시 데이터 초기화됨)');
        console.log('🔧 Firebase를 설정하려면 js/firebase-config.js 파일을 수정하세요.');
        db = new LocalDatabase();
        return;
    }

    try {
        // Firebase SDK 동적 로드
        const firebaseApp = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const firebaseDatabase = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

        firebaseSDK = { firebaseApp, firebaseDatabase };
        app = firebaseApp.initializeApp(firebaseConfig);
        db = firebaseDatabase.getDatabase(app);

        console.log('✅ Firebase 연결 성공');
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        console.log('⚠️ 로컬 모드로 전환합니다.');
        USE_LOCAL_MODE = true;
        db = new LocalDatabase();
    }
}

// 초기화 Promise
let initPromise = null;

// 로컬 스토리지 기반 데이터베이스 모킹
class LocalDatabase {
    constructor() {
        this.data = JSON.parse(localStorage.getItem('gameBoxData') || '{}');
        this.listeners = new Map();
    }

    ref(path) {
        return new LocalRef(path, this);
    }

    save() {
        localStorage.setItem('gameBoxData', JSON.stringify(this.data));
    }

    get(path) {
        const keys = path.split('/').filter(k => k);
        let current = this.data;
        for (const key of keys) {
            if (!current || typeof current !== 'object') return undefined;
            current = current[key];
        }
        return current;
    }

    set(path, value) {
        const keys = path.split('/').filter(k => k);
        let current = this.data;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        const lastKey = keys[keys.length - 1];
        current[lastKey] = value;
        this.save();
        this.notifyListeners(path);
    }

    update(path, updates) {
        const current = this.get(path) || {};
        const updated = { ...current, ...updates };
        this.set(path, updated);
    }

    remove(path) {
        const keys = path.split('/').filter(k => k);
        let current = this.data;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key]) return;
            current = current[key];
        }

        const lastKey = keys[keys.length - 1];
        delete current[lastKey];
        this.save();
        this.notifyListeners(path);
    }

    addListener(path, callback) {
        if (!this.listeners.has(path)) {
            this.listeners.set(path, new Set());
        }
        this.listeners.get(path).add(callback);
    }

    removeListener(path, callback) {
        if (this.listeners.has(path)) {
            this.listeners.get(path).delete(callback);
        }
    }

    notifyListeners(path) {
        // 해당 경로와 상위 경로의 리스너들에게 알림
        for (const [listenerPath, callbacks] of this.listeners.entries()) {
            if (path.startsWith(listenerPath) || listenerPath.startsWith(path)) {
                const data = this.get(listenerPath);
                callbacks.forEach(callback => callback({ val: () => data }));
            }
        }
    }
}

class LocalRef {
    constructor(path, db) {
        this.path = path;
        this.db = db;
    }

    child(childPath) {
        return new LocalRef(`${this.path}/${childPath}`, this.db);
    }

    push() {
        const id = 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        return new LocalRef(`${this.path}/${id}`, this.db);
    }

    set(value) {
        this.db.set(this.path, value);
        return Promise.resolve();
    }

    update(updates) {
        this.db.update(this.path, updates);
        return Promise.resolve();
    }

    remove() {
        this.db.remove(this.path);
        return Promise.resolve();
    }

    get() {
        return Promise.resolve({
            val: () => this.db.get(this.path),
            exists: () => this.db.get(this.path) !== undefined
        });
    }

    on(eventType, callback) {
        this.db.addListener(this.path, callback);
        // 즉시 현재 데이터로 콜백 호출
        const data = this.db.get(this.path);
        callback({ val: () => data });
    }

    off(eventType, callback) {
        if (callback) {
            this.db.removeListener(this.path, callback);
        } else {
            this.db.listeners.delete(this.path);
        }
    }

    once(eventType) {
        return this.get();
    }
}

// 데이터베이스 헬퍼 함수
export async function getDatabase() {
    if (!initPromise) {
        initPromise = initFirebase();
    }
    await initPromise;
    return db;
}

export function ref(database, path) {
    if (USE_LOCAL_MODE) {
        return database.ref(path);
    } else {
        // Firebase SDK가 이미 로드되어 있음
        const { ref: firebaseRef } = firebaseSDK.firebaseDatabase;
        return firebaseRef(database, path);
    }
}

export function set(reference, value) {
    if (USE_LOCAL_MODE) {
        return reference.set(value);
    } else {
        const { set: firebaseSet } = firebaseSDK.firebaseDatabase;
        return firebaseSet(reference, value);
    }
}

export function update(reference, updates) {
    if (USE_LOCAL_MODE) {
        return reference.update(updates);
    } else {
        const { update: firebaseUpdate } = firebaseSDK.firebaseDatabase;
        return firebaseUpdate(reference, updates);
    }
}

export function remove(reference) {
    if (USE_LOCAL_MODE) {
        return reference.remove();
    } else {
        const { remove: firebaseRemove } = firebaseSDK.firebaseDatabase;
        return firebaseRemove(reference);
    }
}

export function get(reference) {
    if (USE_LOCAL_MODE) {
        return reference.get();
    } else {
        const { get: firebaseGet } = firebaseSDK.firebaseDatabase;
        return firebaseGet(reference);
    }
}

export function onValue(reference, callback) {
    if (USE_LOCAL_MODE) {
        reference.on('value', callback);
    } else {
        const { onValue: firebaseOnValue } = firebaseSDK.firebaseDatabase;
        firebaseOnValue(reference, callback);
    }
}

export function off(reference, eventType, callback) {
    if (USE_LOCAL_MODE) {
        reference.off(eventType, callback);
    } else {
        const { off: firebaseOff } = firebaseSDK.firebaseDatabase;
        firebaseOff(reference, eventType, callback);
    }
}

export { USE_LOCAL_MODE };
