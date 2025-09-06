const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSION_FILE = path.join(process.cwd(), '.session');

function promptHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    process.stdout.write(question);
    let input = '';
    const onData = (char) => {
      char = char + '';
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdout.write('\n');
        process.stdin.removeListener('data', onData);
        rl.close();
        resolve(input.trim());
      } else {
        process.stdout.write('*');
        input += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

function readSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (data && typeof data.privateKey === 'string' && data.privateKey.length > 0) {
        return data.privateKey;
      }
    }
  } catch {}
  return '';
}

function writeSession(privateKey) {
  const data = { privateKey };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data), { encoding: 'utf8' });
}

async function getPrivateKeyInteractive() {
  let key = readSession();
  if (key) return key;
  key = await promptHidden('Введите приватный ключ (сохраню на время сеанса): ');
  if (!key) throw new Error('Пустой приватный ключ');
  writeSession(key);
  return key;
}

function clearSession() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

module.exports = {
  getPrivateKeyInteractive,
  clearSession,
};



