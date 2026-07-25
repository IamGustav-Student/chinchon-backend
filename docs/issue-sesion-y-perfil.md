# Bug Report — Sesión expirada y datos de perfil incompletos

**Fecha:** 2026-07-25  
**Reportado por:** Frontend (Barby)  
**Estado:** Frontend parcialmente corregido — requiere cambios en backend

---

## Resumen del problema

Los usuarios que llevan más de 7 días sin hacer login no pueden guardar la bio ni la foto de perfil. El sistema los deja navegar la app con normalidad (ven su nombre, saldo, etc.) pero todas las llamadas a la API fallan con **HTTP 401 Unauthorized**.

---

## Causa raíz

### 1. El token JWT vence pero la app no lo sabe

El token se genera con `expiresIn: '7d'`. Cuando vence:

- El backend devuelve **401** en cualquier endpoint protegido. ✅ Correcto.
- El frontend guardaba el token en `localStorage` pero **nunca chequeaba si estaba vencido**.
- `isLoggedIn()` solo hacía `!!localStorage.getItem('token')` → devolvía `true` aunque el token estuviera muerto.
- El usuario podía seguir navegando páginas protegidas (vía `authGuard`) y ver su nombre/saldo en el navbar (cargados desde `localStorage`, sin llamada a la API).
- Al intentar guardar bio o foto → `PUT /api/perfil` → **401** → error en pantalla.
- Las llamadas GET que también fallaban (historial, stats) se silenciaban sin mostrar nada.

**Fix aplicado en el frontend:** El `authInterceptor` ahora intercepta cualquier respuesta 401, llama a `auth.logout()` y redirige a `/login`. Así, la próxima vez que el token venza, la app manda al usuario al login automáticamente.

---

### 2. El login no devuelve el campo `bio`

En `auth.controller.js`, la respuesta del login arma el objeto `user` manualmente y **omite `bio`**:

```js
// auth.controller.js — función login() — línea 62 aprox.
res.json({
  token,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance,
    avatar: user.avatar,
    role: user.is_admin ? 'admin' : 'user'
    // ← bio no está acá
  }
});
```

Consecuencia: cuando el usuario inicia sesión, `currentUser().bio` es `undefined`. La bio que guardó en sesiones anteriores no se carga hasta que visita `/perfil` (donde se hace `GET /api/perfil` que sí incluye `bio`). En la navbar y en el estado global, la bio aparece vacía después de cada login.

---

## Qué necesita hacer el backend

### Fix 1 — Agregar `bio` a la respuesta del login (crítico)

En `src/controllers/auth.controller.js`, función `login()`, agregar `bio` al objeto que se devuelve:

```js
res.json({
  token,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance,
    avatar: user.avatar,
    bio: user.bio ?? '',          // ← agregar esta línea
    role: user.is_admin ? 'admin' : 'user'
  }
});
```

La columna `bio` ya existe en la tabla `users` (fue migrada). La query del login hace `SELECT * FROM users` así que `user.bio` ya está disponible.

---

### Fix 2 — Considerar Token Refresh (recomendado a futuro)

Con tokens de 7 días, los usuarios activos serán deslogueados cada semana. Para una mejor experiencia se puede implementar un sistema de refresh tokens:

- Token de acceso: `expiresIn: '15m'` o `'1h'`
- Refresh token: `expiresIn: '30d'`, guardado en cookie `httpOnly`
- Endpoint: `POST /api/auth/refresh` → devuelve nuevo access token

**Esto no es urgente** — el fix del interceptor ya maneja la expiración sacando al usuario al login. Pero es una mejora de UX importante a mediano plazo.

---

### Fix 3 — Loguear errores en el catch de `updateProfile` (recomendado)

En `src/controllers/profile.controller.js`, el catch no loguea el error real, lo que hace imposible debuguear problemas en Railway:

```js
// actual
} catch {
  res.status(500).json({ error: 'Error interno del servidor' });
}

// mejorado
} catch (err) {
  console.error('[updateProfile]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
}
```

Hacer esto en todos los catchs del proyecto ayuda mucho a detectar bugs en producción.

---

## Resumen de cambios requeridos

| # | Archivo | Cambio | Urgencia |
|---|---------|--------|----------|
| 1 | `src/controllers/auth.controller.js` | Agregar `bio: user.bio ?? ''` a la respuesta de `login()` | 🔴 Alta |
| 2 | `src/controllers/profile.controller.js` | Agregar `console.error(err.message)` en el catch de `updateProfile` | 🟡 Media |
| 3 | Sistema de refresh tokens | Nuevo endpoint + lógica de refresh | 🟢 Baja (futuro) |
