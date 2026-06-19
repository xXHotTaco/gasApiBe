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
DELETE /api/vehicles/:id
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

Filtros opcionales:

- `GET /api/gas-records?vehicle_id=veh_123`
- `GET /api/stats?vehicle_id=veh_123`

Si mandas `vehicle_id`, la respuesta se limita a ese carro.

`DELETE /api/vehicles/:id` borra el carro del usuario autenticado y tambien elimina sus registros de carga.

Respuesta esperada de `GET /api/stats`:

```json
{
  "ok": true,
  "filter": {
    "vehicle_id": null,
    "vehicle_name": null
  },
  "overall": {
    "summary": {
      "total_records": 8,
      "total_liters": 312.5,
      "total_spent": 7420.3,
      "avg_price_per_liter": 23.74
    },
    "monthly": [
      {
        "month": "2026-06",
        "liters": 92.1,
        "spent": 2190.4,
        "records": 2
      }
    ],
    "efficiency": [
      {
        "vehicle_id": "veh_123",
        "vehicle_name": "Sentra",
        "from_date": "2026-05-01",
        "to_date": "2026-05-15",
        "km_driven": 420,
        "liters": 35,
        "km_per_liter": 12,
        "cost_per_km": 1.97
      }
    ]
  },
  "vehicles": [
    {
      "vehicle_id": "veh_123",
      "vehicle_name": "Sentra",
      "summary": {
        "total_records": 5,
        "total_liters": 180,
        "total_spent": 4250,
        "avg_price_per_liter": 23.61
      },
      "monthly": [
        {
          "month": "2026-06",
          "liters": 45,
          "spent": 1080,
          "records": 1
        }
      ],
      "efficiency": [
        {
          "from_date": "2026-05-01",
          "to_date": "2026-05-15",
          "km_driven": 420,
          "liters": 35,
          "km_per_liter": 12,
          "cost_per_km": 1.97
        }
      ]
    }
  ]
}
```

`filter` indica si la consulta viene filtrada por carro.

`overall` trae el acumulado de la consulta actual:

- sin `vehicle_id`: trae el acumulado de todo el usuario
- con `vehicle_id`: trae el acumulado solo de ese carro

`vehicles` trae la informacion separada por carro:

- sin `vehicle_id`: trae todos los carros con registros
- con `vehicle_id`: trae solo el carro seleccionado

## Scripts

```powershell
npm run dev
npm run deploy
npm test
```
