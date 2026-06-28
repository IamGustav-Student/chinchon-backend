# Requisitos de Backend — Juegos de Carta

Este archivo reúne todo lo que el backend necesita implementar o verificar para que el frontend funcione correctamente. Se va actualizando al finalizar cada fase de desarrollo del frontend.

---

## Fase 7 — Truco Argentino

### Descripción general

Juego de cartas argentino en tiempo real. Mesas de **2 jugadores** (mano a mano) o **4 jugadores** (parejas). Usa el mismo mazo español que Chinchón (oro, copa, basto, espada — valores 1-7, 10, 11, 12).

---

### Endpoints REST

```
GET  /api/truco/list
POST /api/truco/create   { buyIn, maxPlayers: 2|4, pointLimit: 15|30 }
POST /api/truco/join/:id
```

**GET /api/truco/list** — devuelve mesas activas:
```json
[{ "id": "uuid", "buyIn": 500, "maxPlayers": 4, "playerCount": 2, "status": "waiting", "pointLimit": 15 }]
```

**POST /api/truco/create** — descuenta buyIn de la billetera, devuelve la mesa creada.

**POST /api/truco/join/:id** — solo si hay lugar y `status === 'waiting'`. Devuelve `{ tableId }`.

---

### Equipos (mesas de 4)

Los jugadores se dividen en dos equipos por orden de llegada:
- `seatIndex 0, 2` → `teamIndex: 0`
- `seatIndex 1, 3` → `teamIndex: 1`

Los compañeros se sientan uno frente al otro.

---

### Reglas del Truco Argentino

#### Mazo
- 40 cartas: palos oro, copa, basto, espada — valores 1-7, 10 (sota), 11 (caballo), 12 (rey)
- Sin 8 ni 9

#### Jerarquía de cartas para el Truco (de mayor a menor)
1. 1 de espada (ancho de espada)
2. 1 de basto
3. 7 de espada
4. 7 de oro
5. 3 (cualquier palo — todos iguales)
6. 2 (cualquier palo)
7. 1 de oro · 1 de copa (iguales entre sí)
8. 12 (rey, cualquier palo)
9. 11 (caballo)
10. 10 (sota)
11. 7 de copa · 7 de basto
12. 6 (cualquier palo)
13. 5
14. 4

#### Puntos de Envido
- Cartas del mismo palo: 20 + suma de los dos valores más altos del palo (10/11/12 valen 0)
- Sin dos cartas del mismo palo: valor de la carta más alta

#### Estructura de una mano
1. Se reparten 3 cartas a cada jugador
2. Fase de envido (antes o durante la primera baza)
3. Fase de truco (durante el juego)
4. 3 bazas — gana quien gana 2 de 3
5. Empate en primera baza → decide la segunda; empate en ambas → gana el "mano"

#### "Mano"
El jugador con la mano actúa primero. Rota al siguiente jugador en sentido horario cada mano.

#### Cantos de Envido
Solo se pueden cantar antes o durante la primera baza.

| Canto | Si quiero | Si no quiero |
|---|---|---|
| Envido | 2 pts | 1 pt al cantador |
| Envido + Envido | 4 pts | 1 pt |
| Real Envido | 3 pts | 1 pt |
| Falta Envido | lo que falta para llegar al límite | 1 pt |

Subidas válidas: Envido → Envido · Real Envido · Falta Envido; Real Envido → Falta Envido

#### Cantos de Truco
| Canto | Si quiero | Si no quiero |
|---|---|---|
| Truco | 2 pts | 1 pt al cantador |
| Retruco | 3 pts | 2 pts al cantador |
| Vale Cuatro | 4 pts | 3 pts al cantador |

#### Irse al mazo
El jugador cede la mano. Si no había truco cantado, el equipo pierde 1 punto. Si había truco, pierde lo que corresponda al rechazo.

#### Puntos al ganar la partida
Si `buyIn > 0`, el equipo ganador recibe `buyIn × 2` (para los 2 de una pareja de 4, `buyIn × 4` total del pozo). El 20% es comisión de plataforma (igual que torneos y Hold'em).

---

### Señas entre compañeros (mesas de 4 — PRIVADAS)

Cuando un jugador envía una seña, el servidor la reenvía ÚNICAMENTE al compañero (mismo `teamIndex`, distinto `id`). Los rivales NO reciben este evento.

**Evento cliente → servidor:** `truco-partner-signal`
```json
{ "event": "truco-partner-signal", "data": { "signal": "tengo-envido" } }
```

**Evento servidor → compañero:** `truco-partner-signal`
```json
{ "event": "truco-partner-signal", "data": { "signal": "tengo-envido" } }
```

Señas válidas: `tengo-envido`, `falta-envido`, `sin-envido`, `buenas`, `malas`, `voy`, `pongo`, `truco`, `quiero`, `no`

---

### Eventos WebSocket — prefijo `truco-`

#### Cliente → servidor

| Evento | Datos |
|---|---|
| `truco-join-table` | `{ tableId }` |
| `truco-play-card` | `{ suit, value }` |
| `truco-envido` | `{}` |
| `truco-envido-envido` | `{}` |
| `truco-real-envido` | `{}` |
| `truco-falta-envido` | `{}` |
| `truco-truco` | `{}` |
| `truco-retruco` | `{}` |
| `truco-vale-cuatro` | `{}` |
| `truco-quiero` | `{}` |
| `truco-no-quiero` | `{}` |
| `truco-irse-al-mazo` | `{}` |
| `truco-partner-signal` | `{ signal }` |

#### Servidor → cliente

**`truco-game-state`** — Estado completo. Se envía al conectarse, al inicio de cada mano, y tras cada acción. Las cartas propias (`myCards`) solo van al jugador dueño.

```json
{
  "event": "truco-game-state",
  "data": {
    "tableId": "uuid",
    "status": "waiting | playing | finished",
    "maxPlayers": 4,
    "buyIn": 500,
    "pointLimit": 15,
    "players": [
      {
        "id": 1,
        "username": "pepe",
        "avatar": "🦊",
        "teamIndex": 0,
        "seatIndex": 0,
        "isMano": true,
        "cardCount": 3,
        "cardPlayed": null,
        "lastAction": null
      }
    ],
    "myCards": [
      { "suit": "espada", "value": 1, "played": false },
      { "suit": "oro",    "value": 7, "played": false },
      { "suit": "copa",   "value": 3, "played": false }
    ],
    "teamScores": [0, 0],
    "currentTurnId": 1,
    "envidoOpen": true,
    "challenge": null,
    "tricks": [],
    "currentTrickPlays": []
  }
}
```

**`challenge`** cuando está activo:
```json
"challenge": {
  "type": "truco",
  "callerId": 2,
  "callerTeam": 1,
  "pointsIfAccepted": 2,
  "pointsIfRejected": 1
}
```

---

**`truco-your-turn`** — notificación simple cuando es el turno del jugador.
```json
{ "event": "truco-your-turn", "data": {} }
```

---

**`truco-challenge`** — broadcast cuando alguien canta.
```json
{ "event": "truco-challenge", "data": { "type": "truco", "callerUsername": "pepe" } }
```

---

**`truco-hand-end`** — fin de una mano.
```json
{
  "event": "truco-hand-end",
  "data": {
    "winnerTeam": 0,
    "trucoPoints": 2,
    "envidoPoints": 3,
    "details": "Truco (2 pts) + Real Envido (3 pts)",
    "teamScores": [5, 2]
  }
}
```

---

**`truco-game-over`** — fin de la partida.
```json
{ "event": "truco-game-over", "data": { "winnerTeam": 0 } }
```

---

**`truco-error`** — error de validación.
```json
{ "event": "truco-error", "data": { "message": "No es tu turno" } }
```

---

### Schema SQL (agregar a schema.sql)

```sql
CREATE TABLE IF NOT EXISTS truco_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status      VARCHAR(20) DEFAULT 'waiting',
  max_players INT NOT NULL CHECK (max_players IN (2,4)),
  buy_in      INT NOT NULL DEFAULT 0,
  point_limit INT NOT NULL DEFAULT 15,
  team0_score INT NOT NULL DEFAULT 0,
  team1_score INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS truco_players (
  id         SERIAL PRIMARY KEY,
  table_id   UUID REFERENCES truco_tables(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id),
  team_index INT NOT NULL CHECK (team_index IN (0,1)),
  seat_index INT NOT NULL,
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Fase Nueva — Cambios de "Juegos de Carta" (Junio 2026)

### 1. Inicialización de Saldo en Nuevos Registros
- **Endpoint:** `POST /api/auth/register`
- **Cambio:** Cuando un nuevo usuario se registra, debe ingresar con exactamente **$0 (cero pesos)** en su saldo inicial en lugar de cualquier monto de prueba anterior.

### 2. Soporte para Mesas Gratis
- **Endpoint:** `POST /api/game/create` (Creación de mesa)
- **Cambio:** Permitir que el parámetro `bet` sea igual a `0` (cero) para admitir mesas de juego gratuitas.

### 3. Registro y Validación de Depósitos
- **Endpoint:** `POST /api/wallet/deposit`
- **Parámetros esperados:** `{ amount, senderName, senderBank, transactionId }`
- **Lógica requerida:**
  - Registrar el intento de depósito con el banco de origen, titular de la cuenta de origen y el identificador de comprobante.
  - El sistema de administración o backend debe validar que el `senderName` (Nombre del titular de origen) coincida exactamente con el nombre de usuario registrado o titular de la cuenta de juego.
  - La acreditación debe realizarse únicamente si se aprueba la coincidencia de titularidad.

### 4. Soporte para Avatares Personalizados (Base64)
- **Endpoint:** `PUT /api/perfil` (y campos de base de datos para `avatar`)
- **Cambio:** Habilitar el guardado de strings largos en la base de datos (campo `avatar` en Postgres / MongoDB) para soportar las imágenes en formato DataURL Base64 subidas desde el frontend. El frontend enviará strings con formato `data:image/jpeg;base64,...`.

---

## Fase 6 — Texas Hold'em (Cash Game)

### Configuración de mesa (actualizado)

| Parámetro | Valor |
|---|---|
| Máximo jugadores | **4** (fijo) |
| Mínimo para iniciar la primera mano | **2** |
| Unirse entre manos | ✅ sí, si hay lugar libre |
| Buy-in | Fijo por nivel (ver tabla abajo) |
| Recompras | Hasta 3 veces el buy-in |

**Niveles de mesa:**

| Buy-in | Blinds | Max jugadores |
|---|---|---|
| $500 | $5/$10 | 4 |
| $1.000 | $10/$20 | 4 |
| $5.000 | $50/$100 | 4 |
| $25.000 | $250/$500 | 4 |

---

### Concepto de buy-in fijo

**Todos las mesas tienen buy-in fijo.** El jugador no elige cuánto llevar — compra exactamente el monto de la mesa. Esto nivela el campo y elimina la ventaja del "whale":

- Al sentarse: se descuenta el buy-in de la billetera → se acreditan fichas a la mesa
- Al salir: las fichas restantes se devuelven a la billetera
- Si el jugador se queda sin fichas (bust): puede recomprar hasta 3 veces el mismo monto

---

### Side pots — Regla cuando los stacks son desiguales (IMPORTANTE)

Este es el escenario clave: un jugador llega a la mesa y otros llevan tiempo jugando, por lo que sus stacks crecieron. **El que tiene menos fichas puede ir all-in y no queda fuera de la acción** — se crea un side pot.

#### Cómo funciona:

**Escenario concreto:**

| Jugador | Stack al apostar |
|---|---|
| A (lleva mucho tiempo, ganó manos) | $3.000 |
| B (lleva mucho tiempo) | $2.000 |
| C (recién llegó) | $1.000 (buy-in fresco) |

A apuesta todo → all-in por $3.000  
B llama → $2.000 (todo lo que tiene)  
C llama → $1.000 (todo lo que tiene)

**Cálculo de pozos:**

```
Pozo principal (todos pueden ganar):
  C aportó $1.000 × 3 jugadores = $3.000
  → C puede ganar hasta $3.000

Side pot 1 (solo A y B):
  B aportó $1.000 extra × 2 jugadores = $2.000
  → Solo A y B compiten por estos $2.000

Side pot 2 (solo A):
  A aportó $1.000 extra que nadie igualó → se devuelve $1.000 a A

Total en juego: $5.000
Devuelto a A: $1.000
```

**Regla general:** El pozo de cada jugador es su aportación × número de jugadores que igualaron o superaron ese monto. Lo que nadie puede igualar se devuelve.

#### Qué debe hacer el backend:

1. Cuando se produce un all-in, calcular los side pots inmediatamente
2. Emitir `holdem-game-state` con el array `sidePots` actualizado:
```json
"sidePots": [
  { "amount": 3000, "eligiblePlayerIds": [1, 2, 3] },
  { "amount": 2000, "eligiblePlayerIds": [1, 2] }
]
```
3. El excedente que nadie puede igualar se devuelve **antes del showdown**, no después
4. En el showdown, evaluar cada pozo por separado:
   - Pozo principal → ganador entre los 3 jugadores
   - Side pot 1 → ganador entre A y B (C no puede ganarlo aunque tenga mejor mano)
5. En `holdem-hand-end`, el array `winners` puede tener múltiples entradas (uno por pozo):
```json
"winners": [
  { "playerId": 3, "amount": 3000, "hand": "Full House" },
  { "playerId": 1, "amount": 2000, "hand": "Color" }
]
```

#### Regla de unirse entre manos

Cuando un jugador nuevo se une mientras otros ya tienen stacks grandes:
- Recibe su buy-in fresco ($1.000 en una mesa de $1.000)
- Puede hacer all-in por $1.000
- Los otros jugadores con $3.000 pueden apostar hasta $1.000 efectivos contra él (el resto va a side pot entre ellos)
- El sistema de side pots lo maneja automáticamente — **no hay restricción de cuánto puede apostar nadie**

---

**Niveles de mesa:**

| Buy-in | Blinds | Max jugadores | Max recompras |
|---|---|---|---|
| $500 | $5/$10 | 2–6 | 3 |
| $1.000 | $10/$20 | 2–6 | 3 |
| $5.000 | $50/$100 | 2–6 | 3 |
| $25.000 | $250/$500 | 2–6 | 3 |

---

### Endpoints REST requeridos

```
GET  /api/holdem/list
```
Lista de mesas activas (waiting o playing).

```json
[
  {
    "id": "table_uuid",
    "buyIn": 1000,
    "blindsSmall": 10,
    "blindsBig": 20,
    "maxPlayers": 6,
    "playerCount": 2,
    "status": "waiting",
    "maxRebuys": 3
  }
]
```

---

```
GET  /api/holdem/:id
```
Detalle de una mesa con lista de jugadores.

```json
{
  ...campos anteriores,
  "players": [
    { "id": 1, "username": "jugador", "avatar": "🦊", "stack": 1000 }
  ]
}
```

---

```
POST /api/holdem/create   { buyIn, maxPlayers }
```
Crea una nueva mesa. Descuenta el buy-in de la billetera del creador. Devuelve el objeto de la mesa.

```
POST /api/holdem/join/:id
```
Se une a la mesa. Descuenta el buy-in. Error si la mesa está llena o ya comenzó.

```
POST /api/holdem/:id/rebuy
```
Recompra fichas. Descuenta buy-in nuevamente. Solo válido si el jugador tiene stack=0 y le quedan recompras.

---

### Lógica del juego Hold'em

El backend maneja el game engine completo de Texas Hold'em:
- Baraja estándar de 52 cartas (sin jokers)
- Cada mano: dealer rota, small blind + big blind postean automáticamente
- Rondas: pre-flop → flop (3 cartas) → turn (1) → river (1)
- En cada ronda de apuestas: acción de izquierda a derecha desde el que sigue al BB (pre-flop) o desde SB (post-flop)
- Acciones disponibles: fold, check, call, raise, all-in
- Side pots cuando hay all-in con stacks desiguales
- Evaluación de manos al showdown (se puede usar la librería `pokersolver` o similar)

**Nueva mano** se inicia automáticamente 4 segundos después de que termina la anterior, siempre que haya ≥ 2 jugadores con fichas.

---

### Eventos WebSocket — Naming: prefijo `holdem-`

#### `holdem-game-state`
Estado completo de la mesa. Se envía al conectarse y cuando hay cambios relevantes. **Las hole cards solo se incluyen para el jugador que las recibe** (envío personalizado).

```json
{
  "id": "table_uuid",
  "status": "waiting | playing | showdown | hand_end | finished",
  "phase": "preflop | flop | turn | river | null",
  "players": [
    {
      "id": 1,
      "username": "jugador",
      "avatar": "🦊",
      "stack": 980,
      "currentBet": 20,
      "folded": false,
      "isAllIn": false,
      "seatIndex": 0,
      "isDealer": false,
      "isSmallBlind": false,
      "isBigBlind": true,
      "holeCards": [
        { "suit": "spades", "value": 1 },
        { "suit": "hearts", "value": 13 }
      ],
      "lastAction": "call"
    }
  ],
  "communityCards": [],
  "pot": 40,
  "sidePots": [],
  "currentTurn": 2,
  "callAmount": 20,
  "minRaise": 40,
  "maxRaise": 980,
  "buyIn": 1000,
  "blindsSmall": 10,
  "blindsBig": 20,
  "maxRebuys": 3,
  "rebuysLeft": 3
}
```

Suits en inglés: `"spades"`, `"hearts"`, `"diamonds"`, `"clubs"`
Values: 1=A, 2–10, 11=J, 12=Q, 13=K

`holeCards` **solo va en el objeto del jugador que es el destinatario del mensaje**. Para los otros jugadores, omitir o enviar `null`.

---

#### `holdem-your-turn`
Emitido al jugador cuyo turno comienza.
```json
{ "tableId": "table_uuid", "timeoutSeconds": 30 }
```

---

#### `holdem-community-cards`
Emitido cuando se reparten cartas comunitarias (flop, turn o river).
```json
{
  "tableId": "table_uuid",
  "phase": "flop | turn | river",
  "cards": [
    { "suit": "diamonds", "value": 7 },
    { "suit": "clubs", "value": 3 },
    { "suit": "hearts", "value": 11 }
  ]
}
```

---

#### `holdem-action`
Emitido a todos cuando un jugador actúa.
```json
{
  "tableId": "table_uuid",
  "playerId": 1,
  "action": "fold | check | call | raise | allin",
  "totalBet": 40,
  "stack": 960,
  "pot": 80,
  "callAmount": 0,
  "nextPlayerId": 2
}
```

---

#### `holdem-showdown`
Emitido cuando todos los que quedan llegan al showdown.
```json
{ "tableId": "table_uuid" }
```

---

#### `holdem-hand-end`
Emitido al finalizar la mano. Incluye las cartas reveladas en el showdown.
```json
{
  "tableId": "table_uuid",
  "winners": [
    { "playerId": 1, "amount": 200, "hand": "Full House, Reyes y Ases" }
  ],
  "showdownCards": [
    {
      "playerId": 1,
      "cards": [{ "suit": "spades", "value": 13 }, { "suit": "hearts", "value": 13 }]
    }
  ],
  "newStacks": { "1": 1200, "2": 800 }
}
```

---

#### `holdem-game-finished`
La mesa se cerró (todos los jugadores se fueron o solo queda uno).
```json
{ "tableId": "table_uuid" }
```
Devolver las fichas de los jugadores a sus billeteras.

---

#### `holdem-player-joined` / `holdem-player-left`
```json
{ "tableId": "table_uuid", "playerId": 3, "username": "nuevo", "avatar": "🐯" }
```

---

#### `holdem-error`
```json
{ "tableId": "table_uuid", "message": "No es tu turno" }
```

---

### Eventos cliente → servidor (Hold'em)

```
holdem-join-table   { tableId }
holdem-fold         { tableId }
holdem-check        { tableId }
holdem-call         { tableId }
holdem-raise        { tableId, amount }
holdem-allin        { tableId }
```

---

### Timeout de turno

Si el jugador no actúa en 30 segundos, el servidor hace fold automático (o check si es posible). Esto evita que la mesa quede trabada.

---

### Tabla de base de datos sugerida

```sql
CREATE TABLE holdem_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_in INTEGER NOT NULL,
  blinds_small INTEGER NOT NULL,
  blinds_big INTEGER NOT NULL,
  max_players INTEGER NOT NULL DEFAULT 6,
  max_rebuys INTEGER NOT NULL DEFAULT 3,
  status VARCHAR(10) DEFAULT 'waiting',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE holdem_seats (
  table_id UUID REFERENCES holdem_tables(id),
  user_id INTEGER REFERENCES users(id),
  seat_index INTEGER NOT NULL,
  stack INTEGER NOT NULL,
  rebuys_used INTEGER DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (table_id, user_id)
);

-- Las manos y estados del juego se pueden manejar en memoria (Redis o variable del proceso)
-- y solo persistir el resultado final para historial.
CREATE TABLE holdem_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID REFERENCES holdem_tables(id),
  winner_id INTEGER REFERENCES users(id),
  pot INTEGER NOT NULL,
  winning_hand VARCHAR(100),
  played_at TIMESTAMPTZ DEFAULT NOW()
);
```

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

---

## Fase 8 — Mejoras UX (Junio 2026)

### 1. Campo `bio` en usuarios

Agregar columna `bio VARCHAR(200) DEFAULT ''` en la tabla `users`.

Incluir `bio` en la respuesta de `GET /api/perfil` y aceptarlo en `PUT /api/perfil`:

```json
// PUT /api/perfil body
{ "avatar": "...", "bio": "Texto libre del usuario" }

// GET /api/perfil response (agregar)
{ ..., "bio": "Texto libre del usuario" }
```

También incluir `bio` en `GET /api/auth/login` y `POST /api/auth/register` (respuesta `user` con `bio`).

---

### 2. Inscriptos en torneo — campo `registeredPlayers`

El endpoint `GET /api/tournament/current` debe incluir la lista de jugadores inscriptos cuando `status === 'registration_open'`:

```json
{
  "id": "...",
  "status": "registration_open",
  "registeredCount": 5,
  "registeredPlayers": [
    { "id": 1, "username": "juan", "avatar": "👨" },
    { "id": 2, "username": "maria", "avatar": "👩" }
  ]
}
```

---

### 3. Sistema de mensajes privados

Tabla SQL:

```sql
CREATE TABLE private_messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INT NOT NULL REFERENCES users(id),
  recipient_id INT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id   INT REFERENCES private_messages(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pm_recipient ON private_messages(recipient_id, read);
```

Endpoints:

```
GET  /api/messages                      → lista mensajes recibidos (ordenados desc por created_at)
GET  /api/messages/unread-count         → { count: N }
POST /api/messages                      → { recipientId, body, parentId? } → crea mensaje
PUT  /api/messages/:id/read             → marca como leído
```

Respuesta de `GET /api/messages`:

```json
[
  {
    "id": 1,
    "senderId": 5,
    "senderUsername": "maria",
    "senderAvatar": "👩",
    "recipientId": 1,
    "body": "Hola! ¿jugamos?",
    "read": false,
    "createdAt": "2026-06-27T15:00:00Z",
    "parentId": null
  }
]
```

El frontend también accede a `GET /api/messages/unread-count` al iniciar la sesión para mostrar el badge en la navbar.

---

### 4. Envío de mensajes desde partidas

Cuando un jugador hace click en el avatar de otro en cualquier mesa y elige "Enviar mensaje", el frontend llama a `POST /api/messages`. Este endpoint ya está en el punto 3.

---

### 5. Agrego `addFriend` (futuro)

El botón "Agregar amigo" en el menú de jugador actualmente muestra un toast informativo. En el futuro se puede implementar:

```
POST /api/friends/request  { targetUserId }
GET  /api/friends
DELETE /api/friends/:userId
```

Por ahora no es prioritario.
