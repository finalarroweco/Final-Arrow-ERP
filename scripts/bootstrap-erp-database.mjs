import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(1);
}
const raw = process.env.ERP_DATABASE_URL?.trim();
if (!raw) fail('ERP_DATABASE_URL repository secret is missing.');
let connection;
try { connection = new URL(raw); } catch { fail('ERP_DATABASE_URL must be a PostgreSQL connection URI.'); }
if (!['postgres:', 'postgresql:'].includes(connection.protocol)
  || decodeURIComponent(connection.username) !== 'postgres.uqgsvbfmgnorepdydyde'
  || connection.hostname !== 'aws-0-ap-south-1.pooler.supabase.com'
  || connection.port !== '5432'
  || connection.pathname !== '/postgres') {
  fail('Connection must target the Final Arrow ERP session pooler on port 5432.');
}
if (!connection.password || /YOUR.PASSWORD/i.test(decodeURIComponent(connection.password))) {
  fail('Replace the password placeholder in the repository secret.');
}
connection.searchParams.set('sslmode', 'require');
connection.searchParams.set('schema', 'public');
const env = { ...process.env, DATABASE_URL: connection.href, DIRECT_DATABASE_URL: connection.href };
for (const command of ['deploy', 'status']) {
  const result = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', command], {
    env, encoding: 'utf8', timeout: 180000,
  });
  if (result.status !== 0) {
    const code = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/\bP\d{4}\b/)?.[0];
    fail(`Prisma migrate ${command} failed${code ? ` (${code})` : ''}. Connection details are hidden.`);
  }
  console.log(`Prisma migrate ${command} completed successfully.`);
}
