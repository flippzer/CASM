import chalk from 'chalk';

let verboseEnabled = false;

export function setVerbose(v: boolean): void {
  verboseEnabled = v;
}

export const logger = {
  info(msg: string): void {
    console.log(`${chalk.cyan('[INFO]')} ${msg}`);
  },

  success(msg: string): void {
    console.log(`${chalk.green('[✓]')} ${msg}`);
  },

  warn(msg: string): void {
    console.log(`${chalk.yellow('[WARN]')} ${msg}`);
  },

  error(msg: string): void {
    console.error(`${chalk.red('[ERROR]')} ${msg}`);
  },

  session(sessionId: string, msg: string): void {
    console.log(`${chalk.blue(`[${sessionId}]`)} ${msg}`);
  },

  verbose(msg: string): void {
    if (verboseEnabled) {
      console.log(`${chalk.grey('[VERBOSE]')} ${msg}`);
    }
  },
};
