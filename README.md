# Gas API

API para registrar cargas de gasolina, vehiculos y estadisticas de consumo.

Construida con:

- Cloudflare Workers
- Hono
- Cloudflare D1
- JWT para autenticacion

## Requisitos

- Node.js
- npm
- Cuenta de Cloudflare
- Wrangler autenticado

```powershell
npm install
npx wrangler login
```

## Variables locales

Crea un archivo `.dev.vars` en la raiz del proyecto:

```env
JWT_SECRET=pon_aqui_un_secret_largo_y_random
```

Para generar un secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El archivo `.dev.vars` no se sube al repo.

## Base de datos

La base D1 esta configurada en `wrangler.jsonc` con el binding `DB`:

```jsonc
{
  "binding": "DB",
  "database_name": "gas_app_db",
  "database_id": "1cefe3dc-970f-437d-ad13-9a2ba23255aa"
}
```

Aplicar migraciones en la base real:

```powershell
npx wrangler d1 migrations apply gas_app_db --remote
```

Consultar la base real:

```powershell
npx wrangler d1 execute gas_app_db --remote --command "SELECT id, email, created_at FROM users LIMIT 5;"
```

## Desarrollo local

Levantar el Worker local:

```powershell
npm run dev
```

Por default, Wrangler usa recursos locales para desarrollo. Si quieres que el Worker local use la D1 real, agrega temporalmente `remote: true` al binding en `wrangler.jsonc`:

```jsonc
{
  "binding": "DB",
  "database_name": "gas_app_db",
  "database_id": "1cefe3dc-970f-437d-ad13-9a2ba23255aa",
  "remote": true
}
```

Cuidado: con `remote: true`, los `POST`, `PUT` y `DELETE` desde local afectan la base real.

## Deploy

Desde local:

```powershell
npm run deploy
```

En Cloudflare, si conectas el repo, usa:

```txt
Build command: dejar vacio
Deploy command: npm run deploy
Production branch: main
```

Tambien configura el secret `JWT_SECRET` en Cloudflare:

```powershell
npx wrangler secret put JWT_SECRET
```

## Endpoints

### Healthcheck

```http
GET /
```

### Auth

```http
POST /auth/register
POST /auth/login
```

Ejemplo de login:

```powershell
$r = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"correo@demo.com","password":"password123"}'

$token = $r.token
```

### Rutas protegidas

Estas rutas requieren header:

```http
Authorization: Bearer TU_TOKEN
```

```http
GET /api/me
GET /api/vehicles
POST /api/vehicles
GET /api/gas-records
POST /api/gas-records
DELETE /api/gas-records/:id
GET /api/stats
```

Ejemplo:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/api/stats" `
  -Headers @{ Authorization = "Bearer $token" }
```

## Scripts

```powershell
npm run dev
npm run deploy
npm test
```
