// Local operator tool. No public admin endpoint or embedded admin password.
require('./env.cjs').loadEnvironment();
const { configuration } = require('./config.cjs');
const { openDatabase } = require('./database.cjs');
async function main() {
const config = configuration();
const db = await openDatabase(config);
try {
  const [command = 'list', reference] = process.argv.slice(2);
  if (command === 'list') {
    console.table(await db.prepare('SELECT reference,program_name,currency,amount,status,payment_mode,created_at,paid_at FROM orders ORDER BY created_at DESC LIMIT 100').all());
  } else if (command === 'show' && /^dera-[a-f0-9]{36}$/.test(reference || '')) {
    const row = await db.prepare('SELECT reference,program_name,currency,amount,status,payment_mode,created_at,paid_at,customer,policy_version,consent_at FROM orders WHERE reference=?').get(reference);
    if (!row) throw new Error('Enrollment not found.');
    row.customer = JSON.parse(row.customer);
    console.log(JSON.stringify(row, null, 2));
  } else throw new Error('Usage: node --env-file-if-exists=.env server/orders.cjs list | show REFERENCE');
} finally { await db.close(); }

}
main().catch(() => { console.error("Unable to read orders. Check configuration, database access and command arguments."); process.exitCode = 1; });
