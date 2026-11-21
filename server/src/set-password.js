/**
 * Set a new password for an account from the server's command line (no web access needed).
 * Run on the server:  npm run set-password --prefix server -- <login or email>
 * The password is typed without echo (or piped on stdin). All sessions of that account are signed out.
 */
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { weakPassword } from './security.js';

const who = String(process.argv[2] || '').trim().toLowerCase();
if (!who) { console.error('Usage: npm run set-password --prefix server -- <login or email>'); process.exit(1); }

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; }
    rl.question(q, (a) => { rl.close(); if (process.stdin.isTTY) process.stdout.write('\n'); resolve(a); });
  });
}

const u = await db.one('SELECT id, login, name, role FROM users WHERE lower(login) = ? OR lower(email) = ?', [who, who]);
if (!u) { console.error(`No account "${who}"`); process.exit(1); }
const pw = await ask(`New password for ${u.login} (${u.role}): `);
const weak = weakPassword(pw, { name: u.name });
if (weak) { console.error(weak); process.exit(1); }
if (process.stdin.isTTY && (await ask('Repeat it: ')) !== pw) { console.error('The two passwords differ'); process.exit(1); }
await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [bcrypt.hashSync(pw, 12), u.id]);
console.log(`Password changed for ${u.login}. Every session of this account is signed out.`);
process.exit(0);
