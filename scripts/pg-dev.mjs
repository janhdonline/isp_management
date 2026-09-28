/**
 * Local PostgreSQL for development — real PostgreSQL, nothing to install.
 *
 * `embedded-postgres` ships official PostgreSQL binaries per platform and runs
 * them as the current user, so no root and no system packages are needed. The
 * app connects through the ordinary `pg` driver and `@prisma/adapter-pg` — the
 * exact code path a hosted server uses. Data lives in `.pgdata/`.
 *
 *   npm run db:pg        # leave running in one terminal
 *   npm run setup        # in another
 *   npm run dev
 *
 * Already have a PostgreSQL of your own (a local install, Supabase, RDS,
 * Neon…)? Skip this script and just point DATABASE_URL at it.
 */
import EmbeddedPostgres from "embedded-postgres";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

const PORT = Number(process.env.PG_PORT ?? 5432);
const USER = process.env.PG_USER ?? "postgres";
const PASSWORD = process.env.PG_PASSWORD ?? "postgres";
const DB = process.env.PG_DATABASE ?? "isp";
const DATA_DIR = path.join(process.cwd(), ".pgdata");

/**
 * The bundled Linux binaries ship their own libpq/libicu, and npm's script gate
 * can skip the step that creates the SONAME symlinks they need. Repair both
 * here so a clean clone works without the caller exporting anything.
 */
function prepareLinuxLibs() {
  if (process.platform !== "linux") return;

  const pkg = path.join(process.cwd(), "node_modules", "@embedded-postgres", "linux-x64");
  if (!fs.existsSync(pkg)) return;

  const manifest = path.join(pkg, "native", "pg-symlinks.json");
  if (fs.existsSync(manifest)) {
    for (const { source, target } of JSON.parse(fs.readFileSync(manifest, "utf8"))) {
      const from = path.join(pkg, source);
      const to = path.join(pkg, target);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.symlinkSync(path.basename(from), to);
      }
    }
  }

  // postgres and initdb are child processes, so they inherit this.
  const libDir = path.join(pkg, "native", "lib");
  const current = process.env.LD_LIBRARY_PATH ?? "";
  if (!current.split(":").includes(libDir)) {
    process.env.LD_LIBRARY_PATH = current ? `${libDir}:${current}` : libDir;
  }
}

const fresh = process.argv.includes("--fresh");
if (fresh && fs.existsSync(DATA_DIR)) {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DATA_DIR, { recursive: true });
prepareLinuxLibs();

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (message) => {
    const text = message instanceof Error ? message.message : String(message ?? "");
    if (text.trim()) process.stderr.write(`${text}\n`);
  },
});

/** An initialised cluster is identified by its data files, not by a flag file. */
function isInitialised() {
  return fs.existsSync(path.join(DATA_DIR, "PG_VERSION")) &&
    fs.existsSync(path.join(DATA_DIR, "postgresql.conf"));
}

/**
 * Whether something is already serving the port. A previous run that was killed
 * rather than stopped leaves the cluster intact but orphaned, so the data
 * directory existing is not proof that a server is listening.
 */
function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: PORT });
    socket.setTimeout(1500);
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

try {
  if (await portInUse()) {
    console.log(`\n  PostgreSQL is already listening on 127.0.0.1:${PORT}.`);
    console.log(`  Nothing to start — carry on with npm run setup / npm run dev.\n`);
    process.exit(0);
  }

  if (!isInitialised()) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.stdout.write("  initialising cluster (first run only)...\n");
    await pg.initialise();
  }

  await pg.start();
  await pg.createDatabase(DB).catch(() => {
    /* already exists — createDatabase is not idempotent */
  });

  const client = pg.getPgClient(DB);
  await client.connect();
  const { rows } = await client.query("select version()");
  await client.end();

  console.log(`\n  ${rows[0].version.split(" on ")[0]}`);
  console.log(`  listening  127.0.0.1:${PORT}`);
  console.log(`  database   ${DB}`);
  console.log(`  data dir   ${DATA_DIR}`);
  console.log(`\n  DATABASE_URL="postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=public"`);
  console.log(`\n  Next:  npm run setup   then   npm run dev\n`);
} catch (e) {
  console.error("\n  Could not start PostgreSQL.");
  console.error(`  ${e instanceof Error ? (e.message || e.stack) : String(e)}`);
  console.error(`\n  Data dir: ${DATA_DIR}`);
  console.error(`  If the cluster is half-initialised, clear it and retry:`);
  console.error(`\n    npm run db:pg:fresh\n`);
  process.exit(1);
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
