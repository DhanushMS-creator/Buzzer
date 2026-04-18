# Buzzer - Vigyaanrang Live Arena

Two-page full-stack app:

- Page 1: Team login
- Page 2: Live buzzer arena (after login)

The buzzer system is database-backed and first-come-first-serve per round.

## Stack

- Frontend: Vite + Vanilla JS + CSS
- Backend: Node.js + Express + Zod
- Database: SQLite (`better-sqlite3`)

## How to Start

### Prerequisites
- Node.js v18+ installed
- npm installed

### Installation & Running

1. **From the root directory**, install all dependencies:
   ```bash
   npm install
   ```

2. **Start both backend and frontend servers**:
   ```bash
   npm run dev
   ```

The application will start in development mode with live reloading:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3002

Database file is created automatically at `data/buzzer.sqlite`.

### Access the Application

**For Players:**
- Open http://localhost:5173 in your browser
- Enter Team No (01-10) and Team Name
- Click "Login" to access the buzzer arena

**For Host/Admin:**
- Open http://localhost:5173/host-login.html
- Default credentials: `username: host`, `password: admin123`
- Login to access the host control dashboard with round controls and leaderboard

## Flow

1. Team logs in from `/`.
2. Login creates/updates team session in DB and returns a token.
3. Frontend stores the token and redirects to `/arena.html`.
4. Arena polls live state.
5. On prompt open, teams can hit buzzer.
6. First hit in round gets position `#1` and +500 score.

## Team APIs

### `POST /api/auth/login`

Body:

```json
{
  "teamNo": "01,02,03",
  "teamName": "Victory warriors"
}
```

### `GET /api/buzzer/state`

Header:

```text
Authorization: Bearer <team-token>
```

Returns current round, prompt status, team score, and team position if already hit in current round.

### `POST /api/buzzer/hit`

Header:

```text
Authorization: Bearer <team-token>
```

Registers buzzer response with strict first-come order in DB.

## Host APIs

Set host key (optional):

```bash
HOST_KEY=your-secret-key npm run dev
```

Default host key: `buzzer-host`

### Open prompt for a round

```bash
curl -X POST http://localhost:3002/api/host/prompt/open \
  -H 'Content-Type: application/json' \
  -H 'x-host-key: buzzer-host' \
  -d '{"roundNo": 1}'
```

### Close prompt

```bash
curl -X POST http://localhost:3002/api/host/prompt/close \
  -H 'x-host-key: buzzer-host'
```

### Round leaderboard

```bash
curl 'http://localhost:3002/api/host/leaderboard?roundNo=1' \
  -H 'x-host-key: buzzer-host'
```
