# Requisitos de Backend — Chinchón Online

Este archivo reúne todo lo que el backend necesita implementar o verificar para que el frontend funcione correctamente. Se va actualizando al finalizar cada fase de desarrollo del frontend.

---

## Fase 5 — Sistema de torneos semanales

Torneos automáticos todos los **sábados a las 18:00 hs (ART = UTC-3)**.

### Reglas del negocio

| Parámetro | Valor |
|---|---|
| Frecuencia | Todos los sábados a las 18:00 ART |
| Inscripción | $1.000 virtuales por persona |
| Mínimo de inscriptos | 8 (si no se alcanza, el torneo se cancela y se devuelve la inscripción) |
| Tamaño de mesas | 3 o 4 jugadores (ver algoritmo de distribución) |
| Eliminación | Continua — 1 ganador por mesa, avanza al siguiente round |
| Reconexión | 50 segundos para reconectarse; si no vuelve, pierde por forfeit |
| Premio campeón | 70% del pozo |
| Premio finalista | 10% del pozo |
| Comisión plataforma | 20% del pozo |
| Inscripción cierra | 5 minutos antes de comenzar (17:55 ART) |
| Inscripción abre | 24 horas antes (viernes 18:00 ART) |

### Algoritmo de distribución de mesas (importante)

Para evitar que jugadores en mesas de 2–3 tengan ventaja injusta, usar **exclusivamente mesas de 3 o 4** con esta fórmula:

- `N % 4 == 0` → todo mesas de 4
- `N % 4 == 1` → 3 mesas de 3 + el resto mesas de 4 (ej: 9 = 3×3)
- `N % 4 == 2` → 2 mesas de 3 + el resto mesas de 4 (ej: 10 = 2×3 + 1×4)
- `N % 4 == 3` → 1 mesa de 3 + el resto mesas de 4 (ej: 11 = 1×3 + 2×4)

El número de ganadores del round 1 puede no ser múltiplo de 4; aplicar el mismo algoritmo recursivamente en cada round siguiente.

**Ejemplo completo para 14 jugadores:**
- Round 1: 2 mesas de 4 + 2 mesas de 3 → 4 ganadores
- Round 2: 1 mesa de 4 → 1 campeón

---

### Endpoints REST requeridos

```
GET  /api/tournament/current
```
Devuelve el torneo próximo o en curso. Si no hay ninguno, devuelve `404`.

```json
{
  "id": "t_uuid",
  "status": "upcoming | registration_open | in_progress | finished | cancelled",
  "startsAt": "2026-06-27T21:00:00.000Z",
  "registrationDeadline": "2026-06-27T20:55:00.000Z",
  "entryFee": 1000,
  "registeredCount": 14,
  "minPlayers": 8,
  "isRegistered": true,
  "prizePool": 14000,
  "winnerPrize": 9800,
  "finalistPrize": 1400
}
```

`isRegistered` debe ser `true/false` según el usuario autenticado que hace el request.

---

```
POST /api/tournament/register
```
Inscribe al usuario en el torneo actual (status `registration_open`). Descuenta $1.000 de la billetera. Devuelve error si:
- El torneo no está en estado `registration_open`
- El usuario ya está inscripto
- El usuario no tiene saldo suficiente

Respuesta: `{ "ok": true }`

---

```
DELETE /api/tournament/register
```
Cancela la inscripción y devuelve los $1.000 a la billetera. Solo válido mientras el torneo esté en `registration_open`.

Respuesta: `{ "ok": true }`

---

```
GET /api/tournament/:id/bracket
```
Devuelve el bracket completo del torneo. `myMatchId` es el ID del match del usuario autenticado en el round actual (`null` si fue eliminado o si el torneo no comenzó).

```json
{
  "tournamentId": "t_uuid",
  "currentRound": 1,
  "totalRounds": 2,
  "myMatchId": "match_uuid_o_null",
  "matches": [
    {
      "matchId": "match_uuid",
      "round": 1,
      "tableId": "table_uuid_o_null",
      "players": [
        { "id": 1, "username": "jugador1", "avatar": "🐯" },
        { "id": 2, "username": "jugador2", "avatar": "🦁" }
      ],
      "winnerId": null,
      "status": "pending | playing | finished"
    }
  ]
}
```

---

```
GET /api/tournament/:id/result
```
Solo disponible cuando el torneo está en estado `finished`.

```json
{
  "tournamentId": "t_uuid",
  "winnerId": 7,
  "winnerUsername": "campeón",
  "finalistId": 12,
  "finalistUsername": "finalista",
  "prizePool": 14000,
  "winnerPrize": 9800,
  "finalistPrize": 1400,
  "totalPlayers": 14
}
```

---

### Eventos WebSocket del torneo

Todos los eventos del torneo deben enviarse **solo a los jugadores que están inscriptos** en ese torneo.

#### `tournament-start`
Se emite exactamente a las 18:00 cuando el torneo comienza. Si no se alcanzó el mínimo de 8 jugadores, emitir `tournament-cancelled` en su lugar.

```json
{ "tournamentId": "t_uuid", "totalPlayers": 14 }
```

#### `tournament-match-assigned`
Se emite a cada jugador cuando se le asigna su mesa en el round actual.

```json
{
  "tournamentId": "t_uuid",
  "round": 1,
  "matchId": "match_uuid",
  "tableId": "table_uuid"
}
```

El frontend navega automáticamente al juego cuando recibe este evento y el jugador toca "Ir a mi mesa".

#### `tournament-round-end`
Se emite cuando todas las mesas del round actual terminaron.

```json
{ "tournamentId": "t_uuid", "round": 1, "survivors": 4 }
```

Después de emitir este evento, crear las nuevas mesas del siguiente round y emitir `tournament-match-assigned` a los sobrevivientes.

#### `tournament-finished`
Se emite cuando el torneo termina (queda 1 ganador de la final).

```json
{
  "tournamentId": "t_uuid",
  "winnerId": 7,
  "finalistId": 12
}
```

Acreditar los premios automáticamente:
- Ganador: +70% del pozo
- Finalista: +10% del pozo
- Los $1.000 × 20% quedan como comisión (no se devuelven)

#### `tournament-cancelled`
Se emite cuando no se alcanzó el mínimo y el torneo se cancela.

```json
{ "tournamentId": "t_uuid", "reason": "min_players_not_reached" }
```

Devolver los $1.000 a cada inscripto automáticamente.

#### `tournament-disconnect-warning`
Se emite **solo al jugador desconectado** cuando se detecta una desconexión durante su partida de torneo. El jugador tiene 50 segundos para reconectarse.

```json
{ "tournamentId": "t_uuid", "matchId": "match_uuid", "seconds": 50 }
```

Si no reconecta en 50 segundos, el servidor lo marca como perdedor del match y continúa el torneo.

---

### Cron job

Usar `node-cron` o similar:

```javascript
// Todos los sábados a las 18:00 ART (UTC-3 = 21:00 UTC)
cron.schedule('0 21 * * 6', () => {
  startTournament();
}, { timezone: 'America/Argentina/Buenos_Aires' });

// Abrir inscripciones: viernes a las 18:00 ART
cron.schedule('0 21 * * 5', () => {
  openTournamentRegistration();
}, { timezone: 'America/Argentina/Buenos_Aires' });

// Cerrar inscripciones: sábado a las 17:55 ART (20:55 UTC)
cron.schedule('55 20 * * 6', () => {
  closeTournamentRegistration();
}, { timezone: 'America/Argentina/Buenos_Aires' });
```

---

### Tabla de base de datos sugerida

```sql
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(20) DEFAULT 'upcoming',
  starts_at TIMESTAMPTZ NOT NULL,
  registration_deadline TIMESTAMPTZ NOT NULL,
  entry_fee INTEGER DEFAULT 1000,
  prize_pool INTEGER DEFAULT 0,
  winner_id INTEGER REFERENCES users(id),
  finalist_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tournament_registrations (
  tournament_id UUID REFERENCES tournaments(id),
  user_id INTEGER REFERENCES users(id),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  eliminated_round INTEGER,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id),
  round INTEGER NOT NULL,
  table_id UUID REFERENCES game_tables(id),
  winner_id INTEGER REFERENCES users(id),
  status VARCHAR(10) DEFAULT 'pending'
);

CREATE TABLE tournament_match_players (
  match_id UUID REFERENCES tournament_matches(id),
  user_id INTEGER REFERENCES users(id),
  PRIMARY KEY (match_id, user_id)
);
```

---

## Fase 3 — Infraestructura y despliegue

El frontend ya está configurado para producción. Para que todo funcione end-to-end necesitamos lo siguiente del backend:

---

### 1. URL del backend en producción

Cuando despliegues el backend, avisanos la URL final para actualizar `environment.production.ts` en el frontend si fuera necesario.

El frontend está configurado así por defecto:
- `apiUrl: '/api'` — asume que backend y frontend comparten el mismo dominio (Nginx/Cloudflare proxea `/api` hacia el backend en el puerto 3000)
- `wsUrl: 'wss://<dominio>/ws'` — WebSocket en el mismo dominio con TLS

Si el backend va en un **subdominio separado** (ej: `api.chinchononline.com`), avisanos para cambiar esas dos líneas.

---

### 2. Configuración de CORS

En producción el backend debe aceptar requests únicamente desde el dominio del frontend. Actualizar la variable de entorno:

```env
CORS_ORIGIN=https://chinchononline.com
```

Si hay múltiples dominios (www + raíz), configurar el middleware de CORS para aceptar ambos:

```javascript
// cors.middleware.js o directamente en app.js
const allowedOrigins = [
  'https://chinchononline.com',
  'https://www.chinchononline.com',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('No permitido por CORS'));
  },
  credentials: true,
}));
```

---

### 3. WebSocket detrás de Cloudflare / Nginx

Cloudflare soporta WebSocket en todos los planes sin configuración adicional. Solo asegurarse de:

- Usar `wss://` (con TLS) en producción — el frontend ya lo hace.
- Si se usa **Nginx como reverse proxy**, agregar los headers necesarios:

```nginx
location /ws {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}

location /api {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

### 4. Variables de entorno requeridas en producción

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=<mínimo 64 caracteres aleatorios — usar openssl rand -base64 48>
DB_URL=postgresql://user:pass@host:5432/chinchon
CORS_ORIGIN=https://chinchononline.com
```

---

### 5. Process manager (PM2)

Para que el servidor sobreviva reinicios y crasheos, usar PM2:

```bash
npm install -g pm2
pm2 start src/app.js --name chinchon-backend
pm2 save
pm2 startup   # configura el arranque automático con el sistema operativo
```

---

### 6. Google Tag Manager

Cuando tengamos el ID de contenedor de GTM (formato `GTM-XXXXXXX`), avisanos para descomentar el snippet en el `index.html` del frontend. Actualmente está comentado como placeholder.

---

## Fase 4 — Sonidos, toasts y animaciones (solo frontend, sin cambios en backend)

La Fase 4 fue 100% frontend. No requiere cambios en el backend. Sin embargo, hay un ítem de assets que necesita coordinación:

### Archivos de audio requeridos

El `AudioService` carga archivos desde `/assets/sounds/`. Hay que agregar estos clips en `chinchon-frontend/public/assets/sounds/`:

| Archivo | Cuándo suena |
|---|---|
| `draw.mp3` | Jugador roba una carta |
| `discard.mp3` | Jugador descarta una carta |
| `your-turn.mp3` | Empieza el turno del jugador local |
| `chinchon.mp3` | Alguien declara Chinchón |
| `win.mp3` | El jugador local ganó |
| `lose.mp3` | El jugador local perdió |
| `join.mp3` | Un jugador se unió a la sala de espera |

Clips cortos en MP3, < 1 segundo para acciones de juego, 2–3 segundos para win/lose/chinchon. Fuentes gratuitas recomendadas: freesound.org, mixkit.co, zapsplat.com.

---

## Fase 2 — Página del juego en tiempo real

### 1. WebSocket — Eventos que el servidor debe emitir

El cliente espera estos eventos con exactamente esta estructura:

#### `game-start`
Se emite cuando la mesa se llena y la partida comienza. **Debe enviarse de forma personalizada a cada jugador** (el campo `hand` cambia por persona).

```json
{
  "event": "game-start",
  "data": {
    "id": "uuid-de-la-mesa",
    "status": "playing",
    "players": [
      { "id": 1, "username": "juan", "cardCount": 7, "score": 0 },
      { "id": 2, "username": "pedro", "cardCount": 7, "score": 0 }
    ],
    "currentTurn": 1,
    "discardTop": { "suit": "oro", "value": 3, "points": 3 },
    "deckCount": 40,
    "round": 1,
    "bet": 1000,
    "pointLimit": 100,
    "hand": [
      { "suit": "copa", "value": 5, "points": 5 },
      { "suit": "espada", "value": 1, "points": 1 }
    ]
  }
}
```

> ⚠️ El campo `hand` debe ser **personalizado por jugador** — cada uno recibe solo sus propias cartas, nunca las del rival.

---

#### `card-drawn`
Se emite cuando el jugador activo roba una carta. El mensaje es diferente según el destinatario:

- **Al jugador que robó** (incluye la carta real):
```json
{
  "event": "card-drawn",
  "data": {
    "card": { "suit": "basto", "value": 7, "points": 7 },
    "playerId": 1
  }
}
```

- **Al resto de jugadores** (sin revelar la carta):
```json
{
  "event": "card-drawn",
  "data": {
    "playerId": 1,
    "source": "deck"
  }
}
```

---

#### `card-discarded`
Se emite a todos los jugadores cuando alguien descarta.
```json
{
  "event": "card-discarded",
  "data": {
    "playerId": 1,
    "card": { "suit": "copa", "value": 5, "points": 5 }
  }
}
```

---

#### `round-end`
Se emite al terminar una ronda (por corte o chinchón).
```json
{
  "event": "round-end",
  "data": {
    "type": "chinchon",
    "winnerId": 1,
    "scores": { "1": -10, "2": 25 },
    "eliminated": []
  }
}
```
- `type`: `"chinchon"` o `"cut"`
- `eliminated`: array de IDs de jugadores que superaron el límite de puntos y quedan fuera

---

#### `new-round`
Se emite al comenzar una nueva ronda (después del overlay de fin de ronda). Mismo formato que `game-start`, con nuevas cartas para cada jugador.
```json
{
  "event": "new-round",
  "data": {
    "id": "uuid-de-la-mesa",
    "status": "playing",
    "players": [...],
    "currentTurn": 2,
    "discardTop": { "suit": "espada", "value": 10, "points": 8 },
    "deckCount": 41,
    "round": 2,
    "bet": 1000,
    "pointLimit": 100,
    "hand": [ /* nueva mano del jugador */ ]
  }
}
```

---

#### `game-over`
Se emite cuando la partida termina (queda un solo jugador).
```json
{
  "event": "game-over",
  "data": {
    "winner": 1,
    "scores": { "1": 45, "2": 103 }
  }
}
```

---

#### `your-turn`
Se emite únicamente al jugador cuyo turno comienza.
```json
{
  "event": "your-turn",
  "data": { "tableId": "uuid-de-la-mesa" }
}
```

---

#### `player-joined`
Se emite a todos cuando alguien se une a la mesa en sala de espera.
```json
{
  "event": "player-joined",
  "data": { "userId": 2, "username": "pedro" }
}
```

---

#### `player-disconnected`
Se emite a todos cuando un jugador pierde la conexión.
```json
{
  "event": "player-disconnected",
  "data": { "userId": 2 }
}
```

---

#### `error`
Se emite al jugador que intentó una acción inválida (no es su turno, mano inválida, etc).
```json
{
  "event": "error",
  "data": { "message": "No es tu turno" }
}
```

---

### 2. WebSocket — Eventos que el cliente envía

El servidor ya tiene estos implementados. Verificar que acepten exactamente estos payloads:

| Evento | Payload |
|---|---|
| `join-table` | `{ tableId: string }` |
| `draw-card` | `{ tableId: string, source: "deck" \| "discard" }` |
| `discard-card` | `{ tableId: string, cardIndex: number }` — índice 0-based en la mano |
| `declare-chinchon` | `{ tableId: string }` |
| `cut` | `{ tableId: string }` |

---

### 3. IDs de jugador — Importante

El frontend usa `user.id` (número entero, el mismo que devuelve `POST /api/auth/login`) para identificar al jugador local y determinar:
- Si es su turno (`currentTurn === user.id`)
- Qué cartas son suyas
- Si ganó la partida (`winner === user.id`)

El campo `currentTurn` en todos los eventos debe ser el **ID numérico del usuario en la base de datos**, no el username ni ningún ID de socket.

---

### 4. Pendiente para Fase 3

Los siguientes items de lógica de negocio los vamos a pedir en la próxima fase:

- Descontar la apuesta del saldo del jugador al unirse a la mesa
- Acreditar el premio al ganador al finalizar la partida (`bet * cantidad_de_jugadores`)
- Registrar el movimiento en `wallet_history` con type `"game-win"` / `"game-loss"`
- Actualizar `games_played`, `games_won`, `games_lost` en la tabla `users`
- Hacer upsert en `weekly_ranking` con los puntos y ganancias del ganador
- Gestión de reconexión: si un jugador se desconecta y reconecta durante la partida, restaurarle su mano y el estado actual de la mesa
