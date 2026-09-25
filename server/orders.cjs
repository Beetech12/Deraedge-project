// Local operator tool. No public admin endpoint or embedded admin password.
const { configuration } = require('./config.cjs');
const { openStore } = require('./store.cjs');
const config = configuration();
const db = openStore(config.database);
try {
  const [command = 'list', reference] = process.argv.slice(2);
  if (command === 'list') {
    console.table(db.prepare('SELECT reference,program_name,currency,amount,status,created_at,paid_at FROM orders ORDER BY created_at DESC LIMIT 100').all());
  } else if (command === 'show' && /^dera-[a-f0-9]{36}$/.test(reference || '')) {
    const row = db.prepare('SELECT reference,program_name,currency,amount,status,created_at,paid_at,customer,policy_version,consent_at FROM orders WHERE reference=?').get(reference);
    if (!row) throw new Error('Enrollment not found.');
    row.customer = JSON.parse(row.customer);
    console.log(JSON.stringify(row, null, 2));
  } else throw new Error('Usage: node --env-file-if-exists=.env server/orders.cjs list | show REFERENCE');
} finally { db.close(); }
