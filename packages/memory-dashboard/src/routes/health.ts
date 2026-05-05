/**
 * routes/health.ts — GET /health
 *
 * Minimal liveness probe. Returns { ok: true, pid }.
 *
 * Layer: handlers — no domain logic, no I/O.
 *
 * precondition:  none.
 * postcondition: returns { ok: true, pid: number, version: "0.1.0" }.
 */

import type { FastifyInstance } from "fastify";

/**
 * Register GET /health.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: one route registered.
 */
export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async (_req, reply) => {
    return reply.send({ ok: true, pid: process.pid, version: "0.1.0" });
  });
}
