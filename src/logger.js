/**
 * Kleiner, hübscher Konsolen-Logger mit Zeitstempel.
 * Nutzt einfache ANSI-Farben, wenn stdout ein TTY ist.
 */

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const useColor = !!process.stdout.isTTY;

function paint(color, text) {
  return useColor ? `${colors[color]}${text}${colors.reset}` : text;
}

function ts() {
  return new Date().toISOString().slice(11, 19);
}

function log(level, color, args) {
  const prefix = `${paint('gray', ts())} ${paint(color, level.padEnd(5))}`;
  console.log(prefix, ...args);
}

module.exports = {
  info: (...args) => log('INFO', 'green', args),
  warn: (...args) => log('WARN', 'yellow', args),
  error: (...args) => log('ERROR', 'red', args),
  debug: (...args) => log('DEBUG', 'magenta', args),
};
