import { Hono } from "hono";
import { cors } from "hono/cors";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSummary(summary) {
  return {
    total_records: Number(summary?.total_records ?? 0),
    total_liters: toNumber(summary?.total_liters) ?? 0,
    total_spent: toNumber(summary?.total_spent) ?? 0,
    avg_price_per_liter: toNumber(summary?.avg_price_per_liter) ?? 0,
  };
}

function normalizeMonthlyRows(rows) {
  return (rows ?? []).map((row) => ({
    month: row.month,
    liters: toNumber(row.liters) ?? 0,
    spent: toNumber(row.spent) ?? 0,
    records: Number(row.records ?? 0),
  }));
}

function getVehicleName(record) {
  if (record.vehicle_name) {
    return record.vehicle_name;
  }

  return record.vehicle_id ? "Vehiculo eliminado" : "Sin vehiculo";
}

function buildVehicleStats(summaryRows, monthlyRows, efficiencyRows) {
  const vehicles = new Map();

  function getVehicleBucket(record) {
    const key = record.vehicle_id ?? "__no_vehicle__";

    if (!vehicles.has(key)) {
      vehicles.set(key, {
        vehicle_id: record.vehicle_id ?? null,
        vehicle_name: getVehicleName(record),
        summary: normalizeSummary(),
        monthly: [],
        efficiency: [],
      });
    }

    return vehicles.get(key);
  }

  for (const row of summaryRows ?? []) {
    const bucket = getVehicleBucket(row);
    bucket.summary = normalizeSummary(row);
  }

  for (const row of monthlyRows ?? []) {
    const bucket = getVehicleBucket(row);
    bucket.monthly.push({
      month: row.month,
      liters: toNumber(row.liters) ?? 0,
      spent: toNumber(row.spent) ?? 0,
      records: Number(row.records ?? 0),
    });
  }

  let currentVehicleKey = null;
  let previousRecord = null;

  for (const row of efficiencyRows ?? []) {
    const vehicleKey = row.vehicle_id ?? "__no_vehicle__";
    const bucket = getVehicleBucket(row);
    const currentRecord = {
      id: row.id,
      fill_date: row.fill_date,
      odometer_km: toNumber(row.odometer_km),
      liters: toNumber(row.liters) ?? 0,
      total_cost: toNumber(row.total_cost) ?? 0,
    };

    if (vehicleKey !== currentVehicleKey) {
      currentVehicleKey = vehicleKey;
      previousRecord = null;
    }

    if (previousRecord) {
      const kmDriven = currentRecord.odometer_km - previousRecord.odometer_km;

      if (kmDriven > 0 && currentRecord.liters > 0) {
        bucket.efficiency.push({
          from_date: previousRecord.fill_date,
          to_date: currentRecord.fill_date,
          km_driven: kmDriven,
          liters: currentRecord.liters,
          km_per_liter: kmDriven / currentRecord.liters,
          cost_per_km: currentRecord.total_cost / kmDriven,
        });
      }
    }

    previousRecord = currentRecord;
  }

  return Array.from(vehicles.values());
}

function createVehicleStats(vehicleId, vehicleName) {
  return {
    vehicle_id: vehicleId ?? null,
    vehicle_name: vehicleName ?? (vehicleId ? "Vehiculo eliminado" : "Sin vehiculo"),
    summary: normalizeSummary(),
    monthly: [],
    efficiency: [],
  };
}

function getVehicleFilterClause(vehicleId, columnName) {
  return vehicleId ? ` AND ${columnName} = ?` : "";
}

function bindUserScope(statement, userId, vehicleId) {
  if (vehicleId) {
    return statement.bind(userId, vehicleId);
  }

  return statement.bind(userId);
}

async function getVehicleFilter(c, userId) {
  const vehicleId = c.req.query("vehicle_id")?.trim();

  if (!vehicleId) {
    return {
      vehicleId: null,
      vehicleName: null,
    };
  }

  const vehicle = await c.env.DB.prepare(
    `
    SELECT id, name
    FROM vehicles
    WHERE id = ? AND user_id = ?
    `
  )
    .bind(vehicleId, userId)
    .first();

  if (!vehicle) {
    return {
      error: jsonError("Vehiculo no encontrado", 404),
    };
  }

  return {
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
  };
}

async function createToken(userId, secret) {
  const encodedSecret = new TextEncoder().encode(secret);

  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(encodedSecret);
}

async function getUserIdFromRequest(c) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const encodedSecret = new TextEncoder().encode(c.env.JWT_SECRET);

  try {
    const { payload } = await jwtVerify(token, encodedSecret);
    return payload.userId;
  } catch {
    return null;
  }
}

app.use("/api/*", async (c, next) => {
  const userId = await getUserIdFromRequest(c);

  if (!userId) {
    return jsonError("No autorizado", 401);
  }

  c.set("userId", userId);
  await next();
});

app.get("/", (c) => {
  return c.json({
    ok: true,
    name: "Gas API",
    status: "running",
  });
});

app.post("/auth/register", async (c) => {
  const body = await c.req.json();

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!name || !email || !password) {
    return jsonError("Nombre, email y password son obligatorios");
  }

  if (password.length < 6) {
    return jsonError("El password debe tener mínimo 6 caracteres");
  }

  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (existing) {
    return jsonError("Ese email ya está registrado", 409);
  }

  const id = createId("usr");
  const passwordHash = await bcrypt.hash(password, 10);

  await c.env.DB.prepare(
    `
    INSERT INTO users (id, name, email, password_hash)
    VALUES (?, ?, ?, ?)
    `
  )
    .bind(id, name, email, passwordHash)
    .run();

  const token = await createToken(id, c.env.JWT_SECRET);

  return c.json({
    ok: true,
    token,
    user: {
      id,
      name,
      email,
    },
  });
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json();

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return jsonError("Email y password son obligatorios");
  }

  const user = await c.env.DB.prepare(
    `
    SELECT id, name, email, password_hash
    FROM users
    WHERE email = ?
    `
  )
    .bind(email)
    .first();

  if (!user) {
    return jsonError("Credenciales incorrectas", 401);
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    return jsonError("Credenciales incorrectas", 401);
  }

  const token = await createToken(user.id, c.env.JWT_SECRET);

  return c.json({
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
});

app.get("/api/me", async (c) => {
  const userId = c.get("userId");

  const user = await c.env.DB.prepare(
    `
    SELECT id, name, email, created_at
    FROM users
    WHERE id = ?
    `
  )
    .bind(userId)
    .first();

  return c.json({
    ok: true,
    user,
  });
});

app.post("/api/vehicles", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const name = body.name?.trim();

  if (!name) {
    return jsonError("El nombre del vehículo es obligatorio");
  }

  const id = createId("veh");

  await c.env.DB.prepare(
    `
    INSERT INTO vehicles (id, user_id, name, tank_capacity_liters)
    VALUES (?, ?, ?, ?)
    `
  )
    .bind(id, userId, name, body.tank_capacity_liters ?? null)
    .run();

  return c.json({
    ok: true,
    vehicle: {
      id,
      name,
      tank_capacity_liters: body.tank_capacity_liters ?? null,
    },
  });
});

app.get("/api/vehicles", async (c) => {
  const userId = c.get("userId");

  const vehicles = await c.env.DB.prepare(
    `
    SELECT id, name, tank_capacity_liters, created_at
    FROM vehicles
    WHERE user_id = ?
    ORDER BY created_at DESC
    `
  )
    .bind(userId)
    .all();

  return c.json({
    ok: true,
    vehicles: vehicles.results,
  });
});

app.post("/api/gas-records", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  if (!body.fill_date || !body.liters || !body.price_per_liter) {
    return jsonError("Fecha, litros y precio por litro son obligatorios");
  }

  const id = createId("gas");
  const totalCost = Number(body.liters) * Number(body.price_per_liter);

  await c.env.DB.prepare(
    `
    INSERT INTO gas_records (
      id,
      user_id,
      vehicle_id,
      fill_date,
      odometer_km,
      liters,
      price_per_liter,
      total_cost,
      is_full_tank,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      userId,
      body.vehicle_id ?? null,
      body.fill_date,
      body.odometer_km ?? null,
      body.liters,
      body.price_per_liter,
      totalCost,
      body.is_full_tank === false ? 0 : 1,
      body.notes ?? null
    )
    .run();

  return c.json({
    ok: true,
    record: {
      id,
      vehicle_id: body.vehicle_id ?? null,
      fill_date: body.fill_date,
      odometer_km: body.odometer_km ?? null,
      liters: body.liters,
      price_per_liter: body.price_per_liter,
      total_cost: totalCost,
      is_full_tank: body.is_full_tank ?? true,
      notes: body.notes ?? null,
    },
  });
});

app.get("/api/gas-records", async (c) => {
  const userId = c.get("userId");
  const vehicleFilter = await getVehicleFilter(c, userId);

  if (vehicleFilter.error) {
    return vehicleFilter.error;
  }

  const records = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      gr.id,
      gr.vehicle_id,
      v.name AS vehicle_name,
      gr.fill_date,
      gr.odometer_km,
      gr.liters,
      gr.price_per_liter,
      gr.total_cost,
      gr.is_full_tank,
      gr.notes,
      gr.created_at
    FROM gas_records gr
    LEFT JOIN vehicles v ON v.id = gr.vehicle_id AND v.user_id = gr.user_id
    WHERE gr.user_id = ?
    ${getVehicleFilterClause(vehicleFilter.vehicleId, "gr.vehicle_id")}
    ORDER BY gr.fill_date DESC, gr.created_at DESC
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .all();

  return c.json({
    ok: true,
    filter: {
      vehicle_id: vehicleFilter.vehicleId,
      vehicle_name: vehicleFilter.vehicleName,
    },
    records: records.results,
  });
});

app.get("/api/stats", async (c) => {
  const userId = c.get("userId");
  const vehicleFilter = await getVehicleFilter(c, userId);

  if (vehicleFilter.error) {
    return vehicleFilter.error;
  }

  const overallSummary = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_records,
      SUM(liters) AS total_liters,
      SUM(total_cost) AS total_spent,
      AVG(price_per_liter) AS avg_price_per_liter
    FROM gas_records
    WHERE user_id = ?
    ${getVehicleFilterClause(vehicleFilter.vehicleId, "vehicle_id")}
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .first();

  const overallMonthly = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      substr(fill_date, 1, 7) AS month,
      SUM(liters) AS liters,
      SUM(total_cost) AS spent,
      COUNT(*) AS records
    FROM gas_records
    WHERE user_id = ?
    ${getVehicleFilterClause(vehicleFilter.vehicleId, "vehicle_id")}
    GROUP BY substr(fill_date, 1, 7)
    ORDER BY month DESC
    LIMIT 12
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .all();

  const vehicleSummary = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      gr.vehicle_id,
      v.name AS vehicle_name,
      COUNT(*) AS total_records,
      SUM(gr.liters) AS total_liters,
      SUM(gr.total_cost) AS total_spent,
      AVG(gr.price_per_liter) AS avg_price_per_liter,
      MAX(gr.fill_date) AS last_fill_date
    FROM gas_records gr
    LEFT JOIN vehicles v ON v.id = gr.vehicle_id AND v.user_id = gr.user_id
    WHERE gr.user_id = ?
    ${getVehicleFilterClause(vehicleFilter.vehicleId, "gr.vehicle_id")}
    GROUP BY gr.vehicle_id, v.name
    ORDER BY last_fill_date DESC, vehicle_name ASC
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .all();

  const vehicleMonthly = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      gr.vehicle_id,
      v.name AS vehicle_name,
      substr(gr.fill_date, 1, 7) AS month,
      SUM(gr.liters) AS liters,
      SUM(gr.total_cost) AS spent,
      COUNT(*) AS records
    FROM gas_records gr
    LEFT JOIN vehicles v ON v.id = gr.vehicle_id AND v.user_id = gr.user_id
    WHERE gr.user_id = ?
    ${getVehicleFilterClause(vehicleFilter.vehicleId, "gr.vehicle_id")}
    GROUP BY gr.vehicle_id, v.name, substr(gr.fill_date, 1, 7)
    ORDER BY month DESC
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .all();

  const vehicleEfficiency = await bindUserScope(
    c.env.DB.prepare(
    `
    SELECT
      gr.vehicle_id,
      v.name AS vehicle_name,
      gr.id,
      gr.fill_date,
      gr.odometer_km,
      gr.liters,
      gr.total_cost,
      gr.created_at
    FROM gas_records gr
    LEFT JOIN vehicles v ON v.id = gr.vehicle_id AND v.user_id = gr.user_id
    WHERE gr.user_id = ?
      ${getVehicleFilterClause(vehicleFilter.vehicleId, "gr.vehicle_id")}
      AND gr.odometer_km IS NOT NULL
    ORDER BY COALESCE(gr.vehicle_id, ''), gr.fill_date ASC, gr.created_at ASC
    `
    ),
    userId,
    vehicleFilter.vehicleId
  )
    .all();

  const vehicles = buildVehicleStats(
    vehicleSummary.results,
    vehicleMonthly.results,
    vehicleEfficiency.results
  );

  if (vehicleFilter.vehicleId && vehicles.length === 0) {
    vehicles.push(
      createVehicleStats(vehicleFilter.vehicleId, vehicleFilter.vehicleName)
    );
  }

  const overallEfficiency = vehicles.flatMap((vehicle) =>
    vehicle.efficiency.map((efficiency) => ({
      vehicle_id: vehicle.vehicle_id,
      vehicle_name: vehicle.vehicle_name,
      ...efficiency,
    }))
  );

  return c.json({
    ok: true,
    filter: {
      vehicle_id: vehicleFilter.vehicleId,
      vehicle_name: vehicleFilter.vehicleName,
    },
    overall: {
      summary: normalizeSummary(overallSummary),
      monthly: normalizeMonthlyRows(overallMonthly.results),
      efficiency: overallEfficiency,
    },
    vehicles,
  });
});

app.delete("/api/gas-records/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  await c.env.DB.prepare(
    `
    DELETE FROM gas_records
    WHERE id = ? AND user_id = ?
    `
  )
    .bind(id, userId)
    .run();

  return c.json({
    ok: true,
  });
});

export default app;
