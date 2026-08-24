import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Queue } from "../db/queue.js";
import { EnqueueInputSchema, JobStateSchema } from "../types.js";

const IdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const ListQuerySchema = z.object({
  state: JobStateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * The four verbs of SPEC feature 7 — enqueue, inspect, cancel, requeue — plus
 * the list they are browsed from. Validation errors, duplicate dedupe keys and
 * unknown parents are all turned into status codes by the app's error handler.
 */
export function registerJobRoutes(app: FastifyInstance, queue: Queue): void {
  app.post("/jobs", async (request, reply) => {
    const job = queue.enqueue(EnqueueInputSchema.parse(request.body));
    return reply.code(201).send({ job });
  });

  app.get("/jobs", async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const jobs = queue.listJobs(query.state, query.limit, query.offset);
    return reply.send({ jobs, stats: queue.getStats() });
  });

  app.get("/jobs/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const job = queue.getById(id);
    if (!job) return reply.code(404).send({ error: `job ${id} not found` });
    return reply.send({ job, children: queue.listChildren(id) });
  });

  app.post("/jobs/:id/cancel", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!queue.getById(id)) {
      return reply.code(404).send({ error: `job ${id} not found` });
    }
    const result = await queue.cancelJob(id);
    return reply.send({ result, job: queue.getById(id) });
  });

  app.post("/jobs/:id/requeue", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const existing = queue.getById(id);
    if (!existing) return reply.code(404).send({ error: `job ${id} not found` });

    const job = queue.requeueDeadLetter(id);
    if (!job) {
      return reply
        .code(409)
        .send({ error: `job ${id} is ${existing.state}, not DEAD_LETTER` });
    }
    return reply.send({ job });
  });
}
