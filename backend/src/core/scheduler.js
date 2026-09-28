import mongoose from "mongoose";
import { config } from "../config/env.js";

// Minimal cron-style scheduler that is safe with many app instances:
// each job runs at most once per interval across ALL instances (atomic claim in MongoDB),
// and a crashed run's lock expires so another instance can take over.
const runSchema = new mongoose.Schema(
  {
    _id: String,
    lastRunAt: Date,
    lockedUntil: Date,
    lastDurationMs: Number,
    lastResult: mongoose.Schema.Types.Mixed,
    lastError: String
  },
  { versionKey: false }
);
const JobRun = mongoose.model("JobRun", runSchema);

const jobs = [];
let timer;
let stopped = true;

export function registerJob({ name, everyMs, run, lockMs = 15 * 60_000 }) {
  jobs.push({ name, everyMs, run, lockMs, running: false });
}

async function claim(job) {
  const now = new Date();
  await JobRun.updateOne({ _id: job.name }, { $setOnInsert: { lastRunAt: new Date(0) } }, { upsert: true }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
  return JobRun.findOneAndUpdate(
    {
      _id: job.name,
      lastRunAt: { $lte: new Date(now.getTime() - job.everyMs) },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
    },
    { $set: { lockedUntil: new Date(now.getTime() + job.lockMs), lastRunAt: now } },
    { new: true }
  );
}

async function runJob(job, { force = false } = {}) {
  if (job.running) return null;
  job.running = true;
  const started = Date.now();
  try {
    if (!force && !(await claim(job))) return null;
    const result = await job.run();
    await JobRun.updateOne({ _id: job.name }, { $set: { lastRunAt: new Date(started), lockedUntil: null, lastDurationMs: Date.now() - started, lastResult: result ?? null, lastError: null } }, { upsert: true });
    if (result) console.log(`Job ${job.name}:`, JSON.stringify(result));
    return result;
  } catch (error) {
    console.error(`Job ${job.name} failed:`, error.message);
    await JobRun.updateOne({ _id: job.name }, { $set: { lockedUntil: null, lastError: String(error.message).slice(0, 500) } }, { upsert: true }).catch(() => {});
    if (force) throw error;
    return null;
  } finally {
    job.running = false;
  }
}

function tick() {
  if (stopped) return;
  for (const job of jobs) runJob(job).catch(() => {});
}

export function startScheduler() {
  if (!config.jobs.enabled || !jobs.length) return;
  stopped = false;
  timer = setInterval(tick, 30_000);
  timer.unref();
  setTimeout(tick, 5_000).unref(); // first check shortly after boot
}

export function stopScheduler() {
  stopped = true;
  clearInterval(timer);
}

// Runs a job right now (admin "run now" button / tests), still respecting the in-process guard.
export function runJobNow(name) {
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  return runJob(job, { force: true });
}

export async function jobStatus() {
  const runs = await JobRun.find().lean();
  return jobs.map((job) => {
    const run = runs.find((r) => r._id === job.name) || {};
    const lastRunAt = run.lastRunAt && run.lastRunAt.getTime() > 0 ? run.lastRunAt : null;
    return {
      name: job.name,
      everyMinutes: Math.round(job.everyMs / 60_000),
      lastRunAt,
      nextRunAt: lastRunAt ? new Date(lastRunAt.getTime() + job.everyMs) : null,
      lastDurationMs: run.lastDurationMs ?? null,
      lastResult: run.lastResult ?? null,
      lastError: run.lastError ?? null
    };
  });
}
