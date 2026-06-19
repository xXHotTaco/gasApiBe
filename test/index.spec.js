import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import worker from "../src";

const VEHICLES = [
  { id: "veh_a", user_id: "usr_1", name: "Sentra" },
  { id: "veh_b", user_id: "usr_1", name: "Versa" },
  { id: "veh_empty", user_id: "usr_1", name: "Tsuru" },
];

const GAS_RECORDS = [
  {
    id: "gas_1",
    user_id: "usr_1",
    vehicle_id: "veh_a",
    fill_date: "2026-05-01",
    odometer_km: 1000,
    liters: 35,
    price_per_liter: 20,
    total_cost: 700,
    is_full_tank: 1,
    notes: null,
    created_at: "2026-05-01T08:00:00Z",
  },
  {
    id: "gas_2",
    user_id: "usr_1",
    vehicle_id: "veh_a",
    fill_date: "2026-06-01",
    odometer_km: 1400,
    liters: 35,
    price_per_liter: 20,
    total_cost: 700,
    is_full_tank: 1,
    notes: null,
    created_at: "2026-06-01T08:00:00Z",
  },
  {
    id: "gas_3",
    user_id: "usr_1",
    vehicle_id: "veh_b",
    fill_date: "2026-05-03",
    odometer_km: 5000,
    liters: 40,
    price_per_liter: 22.5,
    total_cost: 900,
    is_full_tank: 1,
    notes: null,
    created_at: "2026-05-03T08:00:00Z",
  },
  {
    id: "gas_4",
    user_id: "usr_1",
    vehicle_id: "veh_b",
    fill_date: "2026-06-05",
    odometer_km: 5480,
    liters: 30,
    price_per_liter: 23.3333333333,
    total_cost: 700,
    is_full_tank: 1,
    notes: null,
    created_at: "2026-06-05T08:00:00Z",
  },
];

function getVehicleById(vehicleId, userId) {
  return (
    VEHICLES.find(
      (vehicle) => vehicle.id === vehicleId && vehicle.user_id === userId
    ) ?? null
  );
}

function getScopedRecords(userId, vehicleId = null) {
  return GAS_RECORDS.filter(
    (record) =>
      record.user_id === userId &&
      (vehicleId ? record.vehicle_id === vehicleId : true)
  );
}

function getVehicleName(vehicleId) {
  return VEHICLES.find((vehicle) => vehicle.id === vehicleId)?.name ?? null;
}

function buildSummary(records) {
  if (records.length === 0) {
    return {
      total_records: 0,
      total_liters: 0,
      total_spent: 0,
      avg_price_per_liter: 0,
    };
  }

  const totalLiters = records.reduce((sum, record) => sum + record.liters, 0);
  const totalSpent = records.reduce((sum, record) => sum + record.total_cost, 0);
  const totalPrice = records.reduce(
    (sum, record) => sum + record.price_per_liter,
    0
  );

  return {
    total_records: records.length,
    total_liters: totalLiters,
    total_spent: totalSpent,
    avg_price_per_liter: totalPrice / records.length,
  };
}

function buildMonthly(records) {
  const monthlyMap = new Map();

  for (const record of records) {
    const month = record.fill_date.slice(0, 7);
    const current = monthlyMap.get(month) ?? {
      month,
      liters: 0,
      spent: 0,
      records: 0,
    };

    current.liters += record.liters;
    current.spent += record.total_cost;
    current.records += 1;
    monthlyMap.set(month, current);
  }

  return Array.from(monthlyMap.values()).sort((a, b) =>
    b.month.localeCompare(a.month)
  );
}

function buildVehicleSummary(records) {
  const vehicleMap = new Map();

  for (const record of records) {
    const current = vehicleMap.get(record.vehicle_id) ?? {
      vehicle_id: record.vehicle_id,
      vehicle_name: getVehicleName(record.vehicle_id),
      total_records: 0,
      total_liters: 0,
      total_spent: 0,
      total_price_per_liter: 0,
      last_fill_date: record.fill_date,
    };

    current.total_records += 1;
    current.total_liters += record.liters;
    current.total_spent += record.total_cost;
    current.total_price_per_liter += record.price_per_liter;
    if (record.fill_date > current.last_fill_date) {
      current.last_fill_date = record.fill_date;
    }

    vehicleMap.set(record.vehicle_id, current);
  }

  return Array.from(vehicleMap.values())
    .map((vehicle) => ({
      vehicle_id: vehicle.vehicle_id,
      vehicle_name: vehicle.vehicle_name,
      total_records: vehicle.total_records,
      total_liters: vehicle.total_liters,
      total_spent: vehicle.total_spent,
      avg_price_per_liter:
        vehicle.total_price_per_liter / vehicle.total_records,
      last_fill_date: vehicle.last_fill_date,
    }))
    .sort((a, b) => {
      if (a.last_fill_date !== b.last_fill_date) {
        return b.last_fill_date.localeCompare(a.last_fill_date);
      }

      return a.vehicle_name.localeCompare(b.vehicle_name);
    });
}

function buildVehicleMonthly(records) {
  const monthlyMap = new Map();

  for (const record of records) {
    const month = record.fill_date.slice(0, 7);
    const key = `${record.vehicle_id}:${month}`;
    const current = monthlyMap.get(key) ?? {
      vehicle_id: record.vehicle_id,
      vehicle_name: getVehicleName(record.vehicle_id),
      month,
      liters: 0,
      spent: 0,
      records: 0,
    };

    current.liters += record.liters;
    current.spent += record.total_cost;
    current.records += 1;
    monthlyMap.set(key, current);
  }

  return Array.from(monthlyMap.values()).sort((a, b) => {
    if (a.month !== b.month) {
      return b.month.localeCompare(a.month);
    }

    return a.vehicle_id.localeCompare(b.vehicle_id);
  });
}

function buildVehicleEfficiency(records) {
  return [...records]
    .filter((record) => record.odometer_km !== null)
    .sort((a, b) => {
      if (a.vehicle_id !== b.vehicle_id) {
        return a.vehicle_id.localeCompare(b.vehicle_id);
      }

      if (a.fill_date !== b.fill_date) {
        return a.fill_date.localeCompare(b.fill_date);
      }

      return a.created_at.localeCompare(b.created_at);
    })
    .map((record) => ({
      vehicle_id: record.vehicle_id,
      vehicle_name: getVehicleName(record.vehicle_id),
      id: record.id,
      fill_date: record.fill_date,
      odometer_km: record.odometer_km,
      liters: record.liters,
      total_cost: record.total_cost,
      created_at: record.created_at,
    }));
}

function buildGasRecordsResponse(records) {
  return [...records]
    .sort((a, b) => {
      if (a.fill_date !== b.fill_date) {
        return b.fill_date.localeCompare(a.fill_date);
      }

      return b.created_at.localeCompare(a.created_at);
    })
    .map((record) => ({
      id: record.id,
      vehicle_id: record.vehicle_id,
      vehicle_name: getVehicleName(record.vehicle_id),
      fill_date: record.fill_date,
      odometer_km: record.odometer_km,
      liters: record.liters,
      price_per_liter: record.price_per_liter,
      total_cost: record.total_cost,
      is_full_tank: record.is_full_tank,
      notes: record.notes,
      created_at: record.created_at,
    }));
}

function createMockDb() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => {
              if (sql.includes("FROM vehicles") && sql.includes("WHERE id = ? AND user_id = ?")) {
                const [vehicleId, userId] = args;
                return getVehicleById(vehicleId, userId);
              }

              if (
                sql.includes("FROM gas_records") &&
                sql.includes("AVG(price_per_liter)") &&
                !sql.includes("gr.vehicle_id")
              ) {
                const [userId, vehicleId = null] = args;
                return buildSummary(getScopedRecords(userId, vehicleId));
              }

              throw new Error(`Unexpected first() query: ${sql}`);
            },
            all: async () => {
              if (
                sql.includes("SELECT") &&
                sql.includes("FROM gas_records gr") &&
                sql.includes("ORDER BY gr.fill_date DESC, gr.created_at DESC")
              ) {
                const [userId, vehicleId = null] = args;
                return {
                  results: buildGasRecordsResponse(getScopedRecords(userId, vehicleId)),
                };
              }

              if (
                sql.includes("GROUP BY substr(fill_date, 1, 7)") &&
                !sql.includes("gr.vehicle_id")
              ) {
                const [userId, vehicleId = null] = args;
                return {
                  results: buildMonthly(getScopedRecords(userId, vehicleId)),
                };
              }

              if (sql.includes("GROUP BY gr.vehicle_id, v.name, substr(gr.fill_date, 1, 7)")) {
                const [userId, vehicleId = null] = args;
                return {
                  results: buildVehicleMonthly(getScopedRecords(userId, vehicleId)),
                };
              }

              if (sql.includes("GROUP BY gr.vehicle_id, v.name")) {
                const [userId, vehicleId = null] = args;
                return {
                  results: buildVehicleSummary(getScopedRecords(userId, vehicleId)),
                };
              }

              if (sql.includes("ORDER BY COALESCE(gr.vehicle_id, ''), gr.fill_date ASC")) {
                const [userId, vehicleId = null] = args;
                return {
                  results: buildVehicleEfficiency(getScopedRecords(userId, vehicleId)),
                };
              }

              throw new Error(`Unexpected all() query: ${sql}`);
            },
          };
        },
      };
    },
  };
}

async function createAuthToken(userId, secret) {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
}

describe("Gas API worker", () => {
  it("returns the API status on root", async () => {
    const response = await worker.fetch(new Request("http://example.com/"), {}, {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      name: "Gas API",
      status: "running",
    });
  });

  it("returns stats grouped by vehicle without mixing efficiency between cars", async () => {
    const token = await createAuthToken("usr_1", "test-secret");
    const response = await worker.fetch(
      new Request("http://example.com/api/stats", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      {
        JWT_SECRET: "test-secret",
        DB: createMockDb(),
      },
      {}
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    const sentra = body.vehicles.find((vehicle) => vehicle.vehicle_id === "veh_a");
    const versa = body.vehicles.find((vehicle) => vehicle.vehicle_id === "veh_b");

    expect(body.filter).toEqual({
      vehicle_id: null,
      vehicle_name: null,
    });
    expect(body.overall.summary).toEqual({
      total_records: 4,
      total_liters: 140,
      total_spent: 3000,
      avg_price_per_liter: 21.458333333325,
    });
    expect(body.overall.monthly).toEqual([
      {
        month: "2026-06",
        liters: 65,
        spent: 1400,
        records: 2,
      },
      {
        month: "2026-05",
        liters: 75,
        spent: 1600,
        records: 2,
      },
    ]);
    expect(body.overall.efficiency).toEqual([
      {
        vehicle_id: "veh_b",
        vehicle_name: "Versa",
        from_date: "2026-05-03",
        to_date: "2026-06-05",
        km_driven: 480,
        liters: 30,
        km_per_liter: 16,
        cost_per_km: 700 / 480,
      },
      {
        vehicle_id: "veh_a",
        vehicle_name: "Sentra",
        from_date: "2026-05-01",
        to_date: "2026-06-01",
        km_driven: 400,
        liters: 35,
        km_per_liter: 400 / 35,
        cost_per_km: 1.75,
      },
    ]);
    expect(sentra).toEqual({
      vehicle_id: "veh_a",
      vehicle_name: "Sentra",
      summary: {
        total_records: 2,
        total_liters: 70,
        total_spent: 1400,
        avg_price_per_liter: 20,
      },
      monthly: [
        {
          month: "2026-06",
          liters: 35,
          spent: 700,
          records: 1,
        },
        {
          month: "2026-05",
          liters: 35,
          spent: 700,
          records: 1,
        },
      ],
      efficiency: [
        {
          from_date: "2026-05-01",
          to_date: "2026-06-01",
          km_driven: 400,
          liters: 35,
          km_per_liter: 400 / 35,
          cost_per_km: 1.75,
        },
      ],
    });
    expect(versa).toEqual({
      vehicle_id: "veh_b",
      vehicle_name: "Versa",
      summary: {
        total_records: 2,
        total_liters: 70,
        total_spent: 1600,
        avg_price_per_liter: 22.91666666665,
      },
      monthly: [
        {
          month: "2026-06",
          liters: 30,
          spent: 700,
          records: 1,
        },
        {
          month: "2026-05",
          liters: 40,
          spent: 900,
          records: 1,
        },
      ],
      efficiency: [
        {
          from_date: "2026-05-03",
          to_date: "2026-06-05",
          km_driven: 480,
          liters: 30,
          km_per_liter: 16,
          cost_per_km: 700 / 480,
        },
      ],
    });
  });

  it("filters stats and records by vehicle_id", async () => {
    const token = await createAuthToken("usr_1", "test-secret");
    const env = {
      JWT_SECRET: "test-secret",
      DB: createMockDb(),
    };

    const statsResponse = await worker.fetch(
      new Request("http://example.com/api/stats?vehicle_id=veh_a", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env,
      {}
    );

    expect(statsResponse.status).toBe(200);

    const statsBody = await statsResponse.json();
    expect(statsBody.filter).toEqual({
      vehicle_id: "veh_a",
      vehicle_name: "Sentra",
    });
    expect(statsBody.overall.summary).toEqual({
      total_records: 2,
      total_liters: 70,
      total_spent: 1400,
      avg_price_per_liter: 20,
    });
    expect(statsBody.vehicles).toEqual([
      {
        vehicle_id: "veh_a",
        vehicle_name: "Sentra",
        summary: {
          total_records: 2,
          total_liters: 70,
          total_spent: 1400,
          avg_price_per_liter: 20,
        },
        monthly: [
          {
            month: "2026-06",
            liters: 35,
            spent: 700,
            records: 1,
          },
          {
            month: "2026-05",
            liters: 35,
            spent: 700,
            records: 1,
          },
        ],
        efficiency: [
          {
            from_date: "2026-05-01",
            to_date: "2026-06-01",
            km_driven: 400,
            liters: 35,
            km_per_liter: 400 / 35,
            cost_per_km: 1.75,
          },
        ],
      },
    ]);

    const recordsResponse = await worker.fetch(
      new Request("http://example.com/api/gas-records?vehicle_id=veh_a", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env,
      {}
    );

    expect(recordsResponse.status).toBe(200);

    const recordsBody = await recordsResponse.json();
    expect(recordsBody.filter).toEqual({
      vehicle_id: "veh_a",
      vehicle_name: "Sentra",
    });
    expect(recordsBody.records).toEqual([
      {
        id: "gas_2",
        vehicle_id: "veh_a",
        vehicle_name: "Sentra",
        fill_date: "2026-06-01",
        odometer_km: 1400,
        liters: 35,
        price_per_liter: 20,
        total_cost: 700,
        is_full_tank: 1,
        notes: null,
        created_at: "2026-06-01T08:00:00Z",
      },
      {
        id: "gas_1",
        vehicle_id: "veh_a",
        vehicle_name: "Sentra",
        fill_date: "2026-05-01",
        odometer_km: 1000,
        liters: 35,
        price_per_liter: 20,
        total_cost: 700,
        is_full_tank: 1,
        notes: null,
        created_at: "2026-05-01T08:00:00Z",
      },
    ]);
  });

  it("returns zeroed stats for a selected vehicle without records", async () => {
    const token = await createAuthToken("usr_1", "test-secret");
    const response = await worker.fetch(
      new Request("http://example.com/api/stats?vehicle_id=veh_empty", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      {
        JWT_SECRET: "test-secret",
        DB: createMockDb(),
      },
      {}
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.filter).toEqual({
      vehicle_id: "veh_empty",
      vehicle_name: "Tsuru",
    });
    expect(body.overall.summary).toEqual({
      total_records: 0,
      total_liters: 0,
      total_spent: 0,
      avg_price_per_liter: 0,
    });
    expect(body.overall.monthly).toEqual([]);
    expect(body.overall.efficiency).toEqual([]);
    expect(body.vehicles).toEqual([
      {
        vehicle_id: "veh_empty",
        vehicle_name: "Tsuru",
        summary: {
          total_records: 0,
          total_liters: 0,
          total_spent: 0,
          avg_price_per_liter: 0,
        },
        monthly: [],
        efficiency: [],
      },
    ]);
  });
});
