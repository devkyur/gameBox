# CLAUDE.md - AI Assistant Guide for GameBox

## Project Overview

**GameBox** is a multiplayer online arcade game platform built with vanilla JavaScript and Firebase Realtime Database. The primary implemented game is "Crazy Arcade" (물풍선 게임), a water balloon battle game with real-time multiplayer support.

### Key Facts
- **Language**: Vanilla JavaScript (ES6+ modules)
- **UI Language**: Korean (닉네임, 로비, etc.)
- **Database**: Firebase Realtime Database (with LocalStorage fallback)
- **Hosting**: GitHub Pages (static site)
- **Current Status**: Actively developed with 4 merged PRs
- **Total Lines**: ~3,000 lines across 11 source files

---

## Codebase Structure

```
gameBox/
├── index.html              # Landing page - game selection
├── lobby.html              # Room list and creation
├── room.html               # Waiting room before game starts
├── game.html               # Main game canvas and UI
│
├── css/
│   └── style.css           # Global styling (481 lines)
│
├── js/
│   ├── main.js             # Index page logic (111 lines)
│   ├── lobby.js            # Lobby management (255 lines)
│   ├── room.js             # Room/player coordination (364 lines)
│   ├── game.js             # Core game engine (1024 lines) ⭐
│   ├── utils.js            # Utility functions (202 lines)
│   └── firebase-config.js  # Firebase + LocalDB fallback (286 lines)
│
├── .gitignore
├── README.md
└── CLAUDE.md              # This file
```

### File Responsibilities

| File | Purpose | Key Functions |
|------|---------|---------------|
| **game.js** | Core game engine | Physics, collision detection, bomb logic, rendering, player movement |
| **firebase-config.js** | Database layer | Firebase initialization, LocalDatabase fallback class |
| **room.js** | Room management | Player list, ready state, host switching, game start flow |
| **lobby.js** | Lobby system | Room creation, room listing, Firebase sync |
| **utils.js** | Shared utilities | GAMES data, Storage, URLParams, validation, helpers |
| **style.css** | UI styling | CSS variables, dark theme, cards, buttons, animations |

---

## Technology Stack

### Core Technologies
- **Frontend**: Vanilla JavaScript (ES6 modules with import/export)
- **Rendering**: HTML5 Canvas API (2D context)
- **Real-time Sync**: Firebase Realtime Database (JSON structure)
- **Storage**: Browser LocalStorage (player info, backup)
- **Styling**: CSS3 (CSS variables, flexbox, gradients)

### No Build System
- No webpack, no npm scripts, no transpilation
- Direct ES6 module imports in browser
- Firebase SDK loaded via CDN in HTML

### Firebase Structure
```
rooms/
  └── crazy-arcade/
      └── {roomId}/
          ├── title: string
          ├── hostId: string
          ├── status: "waiting" | "playing" | "finished"
          ├── maxPlayers: number
          ├── createdAt: timestamp
          ├── game/
          │   ├── map: number[][]
          │   ├── players: {playerId: PlayerState}
          │   ├── bombs: {bombId: BombState}
          │   └── items: {itemId: ItemState}
          └── players/
              └── {playerId}:
                  ├── name: string
                  ├── color: string
                  ├── ready: boolean
                  └── joinedAt: timestamp
```

---

## Key Conventions

### Code Style

1. **Naming Conventions**
   - Variables: `camelCase` (e.g., `playerId`, `roomRef`)
   - Constants: `UPPER_SNAKE_CASE` (e.g., `TILE_SIZE`, `BOMB_TIMER`)
   - Functions: `camelCase` (e.g., `initMap`, `setupEventListeners`)
   - Objects: `PascalCase` for utilities (e.g., `Storage`, `URLParams`)

2. **Module Pattern**
   - Use ES6 `import`/`export` statements
   - Export named functions and constants
   - Keep modules focused on single responsibility

3. **Comments**
   - Korean comments for complex logic: `// 폭발 범위 계산`
   - JSDoc-style function headers: `/** * 초기화 */`
   - Inline comments explain "why" not "what"

4. **File Organization**
   - Config constants at top of file
   - State objects after configs
   - Functions grouped logically
   - Event listeners near bottom
   - Init/main functions last

### HTML/CSS

1. **HTML Structure**
   - Semantic HTML5 tags
   - BEM-like class naming (e.g., `game-card`, `player-list-item`)
   - Korean text in UI elements
   - Script tags use `type="module"`

2. **CSS Variables** (style.css:1-10)
   ```css
   --primary-color: #6C5CE7
   --success-color: #00B894
   --danger-color: #FF7675
   --dark-bg: #2D3436
   ```

3. **Responsive Design**
   - Flexbox for layouts
   - Max-width containers (1200px)
   - Mobile-friendly spacing

### JavaScript Patterns

1. **State Management**
   - Single `gameState` object per page
   - LocalStorage for persistence
   - Firebase for real-time sync
   - Avoid global pollution

2. **Error Handling**
   - Try-catch blocks for async operations
   - `showNotification()` for user-facing errors
   - Console.error for debug info
   - Graceful fallbacks (LocalDatabase)

3. **Security**
   - HTML escaping: Create text nodes instead of innerHTML
   - Input validation: `validatePlayerName()`, `validateRoomTitle()`
   - No eval() or dangerous patterns
   - Firebase rules should be configured server-side

4. **Performance**
   - `requestAnimationFrame` for game loop (60 FPS)
   - Debounced Firebase updates
   - Efficient collision detection (corner-based)
   - Canvas clearing and redrawing optimized

---

## Game Mechanics (Crazy Arcade)

### Map System
- **Grid**: 13×11 tiles (650×550 px canvas)
- **Tile Size**: 50px per tile
- **Tile Types**:
  - `EMPTY` (0): Walkable space
  - `SOLID_WALL` (1): Permanent barriers (map borders + interior)
  - `BREAKABLE_WALL` (2): Destructible purple blocks (75% coverage)
  - `BOMB` (3): Active water balloon
  - `EXPLOSION` (4): Blast effect

### Player System
- **Controls**: Arrow keys (movement) + Spacebar (place bomb)
- **Spawn Points**: 4 corners of map
- **Speed**: 2.5 px/frame (modified by speed items)
- **States**: Normal → Trapped (2s) → Eliminated
- **Attributes**:
  - Position (x, y)
  - Speed (base + items)
  - Power (explosion radius)
  - Max bombs (simultaneous)
  - Alive status
  - Trapped status

### Bomb System
- **Placement**: Spacebar key
- **Timer**: 2500ms (2.5 seconds)
- **Explosion Pattern**: 4-directional (up, down, left, right)
- **Trap Mechanic**: Players hit by explosion are trapped in balloon for 2 seconds, then eliminated
- **Chain Reactions**: Bombs can trigger other bombs

### Item System (40% drop chance)
- **Speed UP** (blue 🏃): +1 to movement speed
- **Power UP** (red 💥): +1 to explosion radius
- **Bomb UP** (pink 💣): +1 to max simultaneous bombs

### Win Condition
- Last player alive wins
- Draw if all players die simultaneously
- Game Over modal displays winner

---

## Development Workflow

### Navigation Flow
```
index.html → lobby.html → room.html → game.html
   ↓             ↓            ↓            ↓
main.js      lobby.js     room.js     game.js
```

### Page Initialization Pattern
Each page follows this pattern:
1. Get URL parameters (`URLParams.get()`)
2. Get player info from LocalStorage (`Storage.getPlayerId()`)
3. Initialize Firebase connection (`getDatabase()`)
4. Setup event listeners
5. Setup Firebase real-time listeners (`onValue()`)
6. Cleanup on page unload (`off()`)

### Typical User Flow
1. **Index Page**: Enter nickname → Save to LocalStorage → Select game
2. **Lobby Page**: View room list → Create/join room
3. **Room Page**: Wait for players → Ready up → Host starts game
4. **Game Page**: Play game → Winner announced → Return to lobby

### Git Workflow
- **Branch Naming**: `claude/<description>-<session-id>`
- **Commits**: Clear, descriptive messages
- **Example**: "Fix game controls and JavaScript errors"
- **PRs**: Merged to main branch after review

---

## Common Tasks

### Adding a New Game

1. **Update utils.js** - Add game to `GAMES` object:
   ```javascript
   'new-game': {
       id: 'new-game',
       name: '게임 이름',
       description: '게임 설명',
       color: 'linear-gradient(135deg, #COLOR1, #COLOR2)'
   }
   ```

2. **Create game HTML** - Copy `game.html` as template
3. **Create game JS** - Copy `game.js` structure, implement new logic
4. **Update lobby** - Ensure Firebase path includes new game ID

### Modifying Game Mechanics

**Location**: `js/game.js`

- **Movement Speed**: Change `CONFIG.PLAYER_SPEED` (line 12)
- **Bomb Timer**: Change `CONFIG.BOMB_TIMER` (line 13)
- **Item Drop Rate**: Change `CONFIG.ITEM_DROP_CHANCE` (line 14)
- **Map Size**: Modify `CONFIG.MAP_WIDTH/HEIGHT` (lines 10-11)

### Adding New Items

1. Add to `ITEM` constant (game.js:26-31)
2. Implement in `createItem()` function
3. Update `handleItemPickup()` logic
4. Add rendering in `drawItems()` function

### Debugging Real-time Sync Issues

1. **Check Firebase Console**: View database structure in real-time
2. **LocalStorage Fallback**: Test without Firebase connection
3. **Console Logs**: Add `console.log('Firebase update:', data)` in `onValue()` callbacks
4. **Host vs Client**: Verify host initializes data correctly

### Testing Multiplayer

1. Open multiple browser windows/tabs
2. Use different browser profiles (Chrome, Firefox) for separate LocalStorage
3. Use incognito mode for additional players
4. Test host leaving → verify host transfer logic

---

## Important Notes for AI Assistants

### Do's ✅

1. **Read Before Modifying**: Always read the full file before making changes
2. **Maintain Korean UI**: Keep Korean text for user-facing strings
3. **Test Real-time Sync**: Consider Firebase synchronization in changes
4. **Preserve Game Balance**: Don't make arbitrary changes to game constants
5. **Use Existing Patterns**: Follow established code structure
6. **Validate Input**: Use existing validation functions
7. **Handle Errors Gracefully**: Use try-catch and showNotification()
8. **Clean Up Listeners**: Remove Firebase listeners on page unload

### Don'ts ❌

1. **Don't Break Modules**: Maintain ES6 import/export structure
2. **Don't Add Build Tools**: Keep as vanilla JS
3. **Don't Bypass Security**: Always validate and escape user input
4. **Don't Commit Firebase Keys**: Keep `.env` files in `.gitignore`
5. **Don't Remove Fallbacks**: Keep LocalDatabase for offline testing
6. **Don't Change Working Features**: If it works, refactor carefully
7. **Don't Overcomplicate**: Maintain vanilla JS simplicity
8. **Don't Skip Comments**: Especially for complex game logic

### Security Considerations

1. **XSS Prevention**: Use `textContent` or `createTextNode()` instead of `innerHTML` for user input
2. **Input Validation**: Always validate before storing or displaying
3. **Firebase Rules**: Configure security rules in Firebase Console (not in code)
4. **No Sensitive Data**: Don't store passwords or personal info in LocalStorage

### Performance Tips

1. **Canvas Optimization**: Clear and redraw only changed areas if possible
2. **Debounce Firebase Updates**: Use `debounce()` utility for frequent updates
3. **Minimize Re-renders**: Batch DOM updates
4. **Efficient Loops**: Avoid nested loops in game loop (60 FPS target)

### Known Issues / Quirks

1. **Firebase Async**: Database operations are async, always use `await`
2. **Host Responsibility**: Host initializes game state, clients sync
3. **LocalStorage Limits**: ~5-10MB per origin
4. **CORS Issues**: Test with local server, not file:// protocol
5. **Canvas Resolution**: Set canvas width/height in JS, not CSS

---

## Quick Reference

### Utility Functions (utils.js)

| Function | Purpose | Example |
|----------|---------|---------|
| `Storage.getPlayerName()` | Get saved player name | `const name = Storage.getPlayerName()` |
| `Storage.setPlayerName(name)` | Save player name | `Storage.setPlayerName('Player1')` |
| `Storage.getPlayerId()` | Get/generate player ID | `const id = Storage.getPlayerId()` |
| `URLParams.get(key)` | Get URL parameter | `const room = URLParams.get('room')` |
| `URLParams.navigate(page, params)` | Navigate with params | `URLParams.navigate('lobby.html', {game: 'crazy-arcade'})` |
| `showNotification(msg, type)` | Show toast notification | `showNotification('Success!', 'success')` |
| `validatePlayerName(name)` | Validate player name | `const {valid, message} = validatePlayerName(name)` |

### Firebase Operations

```javascript
// Get database instance
const db = await getDatabase();

// Create reference
const roomRef = ref(db, `rooms/${gameId}/${roomId}`);

// Write data
await set(roomRef, data);

// Update data
await updateDB(roomRef, {status: 'playing'});

// Listen to changes
onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    // Handle data
});

// Stop listening
off(roomRef);
```

### Canvas Drawing Pattern (game.js)

```javascript
function gameLoop() {
    // 1. Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2. Update game state
    updatePlayers();
    updateBombs();
    updateExplosions();

    // 3. Draw everything
    drawMap();
    drawItems();
    drawBombs();
    drawExplosions();
    drawPlayers();

    // 4. Continue loop
    if (!gameState.gameOver) {
        requestAnimationFrame(gameLoop);
    }
}
```

---

## Testing Checklist

When making changes, verify:

- [ ] Game loads without console errors
- [ ] Player can move in all 4 directions
- [ ] Bombs place and explode correctly
- [ ] Collision detection works (walls, players, bombs)
- [ ] Items spawn and can be picked up
- [ ] Multiplayer sync works (test with 2+ windows)
- [ ] Win condition triggers correctly
- [ ] Return to lobby works after game over
- [ ] Firebase and LocalStorage fallback both work
- [ ] No XSS vulnerabilities in user input
- [ ] Mobile/tablet layout is acceptable
- [ ] Korean text displays correctly

---

## Troubleshooting

### "Cannot read property of null" errors
- Check Firebase database initialization (`await getDatabase()`)
- Verify DOM elements exist before accessing
- Ensure Firebase path exists in database

### Players not syncing
- Check Firebase console for data updates
- Verify `onValue()` listeners are attached
- Check if host properly initializes game state

### Canvas not drawing
- Verify canvas dimensions set in JS: `canvas.width = 650`
- Check if game loop is running: `requestAnimationFrame(gameLoop)`
- Ensure `ctx.clearRect()` is called each frame

### Game performance issues
- Check for infinite loops in game logic
- Verify `requestAnimationFrame` is used (not `setInterval`)
- Profile with browser DevTools Performance tab

---

## Resources

- **Firebase Console**: https://console.firebase.google.com/project/gamebox-43200
- **Repository**: Check git remote for current repo URL
- **README**: See README.md for Korean documentation

---

## Version History

- **2025-11**: Initial implementation with Crazy Arcade game
- **Recent PRs**:
  - #4: Fix balloon trap mechanics
  - #3: Fix game controls and JavaScript errors
  - #2: Implement multiplayer water balloon game
  - #1: Fix Firebase null error and async initialization

---

*This document is intended for AI assistants (like Claude) to understand and work with the GameBox codebase effectively. Keep it updated as the project evolves.*
