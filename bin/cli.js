#!/usr/bin/env node

const { Command } = require('commander');
const InstagramMemeBot = require('../src/index');
const packageJson = require('../package.json');

const program = new Command();
const bot = new InstagramMemeBot();

program
  .name('instagram-meme-bot')
  .description(
    'Production-ready Instagram meme bot with GUI dashboard, smart scheduling, and account safety'
  )
  .version(packageJson.version);

/* ---- start (recommended) ---- */
program
  .command('start')
  .description(
    'Start the bot with GUI dashboard, scheduler, and keep-alive (production mode)'
  )
  .action(async () => {
    try {
      console.log('Starting Instagram Meme Bot (production mode)...\n');
      await bot.start();
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/* ---- run (legacy continuous) ---- */
program
  .command('run')
  .description('Run the bot continuously without GUI (legacy mode)')
  .option('--once', 'Run only once instead of continuously')
  .action(async (options) => {
    try {
      if (options.once) {
        console.log('Running single cycle...');
        await bot.runOnce();
        console.log('Done!');
      } else {
        console.log('Running continuously... (Ctrl+C to stop)');
        await bot.run();
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/* ---- dashboard ---- */
program
  .command('dashboard')
  .description('Start only the GUI dashboard (no posting)')
  .action(async () => {
    try {
      console.log('Starting dashboard...');
      await bot.startDashboard();
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/* ---- config ---- */
program
  .command('config')
  .description('Setup Instagram credentials and bot configuration interactively')
  .action(async () => {
    try {
      await bot.setupConfig();
    } catch (error) {
      console.error('Configuration error:', error.message);
      process.exit(1);
    }
  });

/* ---- version ---- */
program
  .command('version')
  .description('Display version information')
  .action(() => {
    console.log(`Instagram Meme Bot v${packageJson.version}`);
    console.log(
      'Production-ready bot with GUI, scheduler, rate-limiter, and account safety'
    );
  });

/* ---- unknown commands ---- */
program.on('command:*', () => {
  console.error(
    'Invalid command: %s\nSee --help for available commands.',
    program.args.join(' ')
  );
  process.exit(1);
});

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse(process.argv);
