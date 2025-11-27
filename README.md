# 🎮 GameBox - 멀티플레이어 아케이드 게임 플랫폼

온라인 멀티플레이어 아케이드 게임 플랫폼입니다.

## 🚀 기술 스택

- **Frontend**: 바닐라 JavaScript (ES6+)
- **Hosting**: GitHub Pages
- **Real-time**: Firebase Realtime Database
- **Styling**: CSS3

## 📂 프로젝트 구조

```
/
├── index.html          # 메인 페이지 (게임 카테고리)
├── lobby.html          # 로비 (방 리스트)
├── room.html           # 방 (플레이어 대기실)
├── css/
│   └── style.css      # 전역 스타일
├── js/
│   ├── firebase-config.js  # Firebase 설정
│   ├── main.js            # 메인 페이지 로직
│   ├── lobby.js           # 로비 로직
│   ├── room.js            # 방 로직
│   └── utils.js           # 유틸리티 함수
└── README.md
```

## 🎯 구현 단계

### Phase 1: 기본 구조 (현재)
- [x] 메인 페이지 (게임 카테고리 목록)
- [x] 로비 페이지 (방 리스트, 방 만들기)
- [x] 방 페이지 (플레이어 목록, Ready/Start)

### Phase 2: 게임 구현 (예정)
- [ ] 크레이지 아케이드 게임 로직
- [ ] 다른 게임 추가

## 🔧 Firebase 설정

`js/firebase-config.js` 파일에 Firebase 프로젝트 정보를 입력하세요:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## 🎮 게임 목록

- **크레이지 아케이드**: 물풍선 배틀 게임
- **테트리스**: (예정)
- **철권**: (예정)
- **기타 미니게임**: (예정)

## 📱 사용 방법

1. 메인 페이지에서 게임 선택
2. 로비에서 방 생성 또는 입장
3. 방에서 준비 완료 후 게임 시작

## 🌐 배포

GitHub Pages를 통해 자동 배포됩니다.
