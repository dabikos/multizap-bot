const { clearSession } = require('./util-session');

try {
  clearSession();
  console.log('Сеанс очищен. В следующий раз потребуется ввести приватный ключ.');
} catch (e) {
  console.error(e);
  process.exit(1);
}













