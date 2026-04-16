import fs from 'fs';
import pkg from 'pg';

const { Client } = pkg;

function readSecret(path) {
  return fs.readFileSync(path, 'utf8').trim();
}

async function main() {
  const connectionString = readSecret(process.env.SUPABASE_DB_URL_PATH);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query('SELECT NOW() AS now');
  console.log(result.rows[0]);

  await client.end();
}

main().catch((err) => {
  console.error('Connection test failed:', err);
  process.exit(1);
});