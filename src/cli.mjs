#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, writeDefaultConfig, defaultConfigPath } from './config.mjs';
import { startServer } from './server.mjs';
import { checkHermes } from './proxy.mjs';

const program = new Command();

program
  .name('hermes-router')
  .description('CLI-only local gateway/router for Hermes-compatible AI endpoints')
  .version('0.1.0');

program
  .command('init')
  .description('Create ~/.hermes-router/config.json')
  .option('-c, --config <path>', 'custom config path')
  .option('-f, --force', 'overwrite existing config', false)
  .action((options) => {
    const result = writeDefaultConfig(options.config || defaultConfigPath(), { force: options.force });
    if (result.created) {
      console.log(`Created config: ${result.path}`);
      console.log('Edit HERMES_BASE_URL / hermes.baseUrl before starting if your Hermes runs on a different port.');
    } else {
      console.log(`Config already exists: ${result.path}`);
      console.log('Use --force to overwrite.');
    }
  });

program
  .command('config-path')
  .description('Print default config path')
  .action(() => {
    console.log(defaultConfigPath());
  });

program
  .command('doctor')
  .description('Check Hermes upstream connectivity')
  .option('-c, --config <path>', 'custom config path')
  .action(async (options) => {
    const config = loadConfig(options.config);
    const results = await checkHermes(config);
    console.table(results);
    const ok = results.some((item) => item.ok);
    process.exitCode = ok ? 0 : 1;
  });

program
  .command('start')
  .description('Start local Hermes router')
  .option('-c, --config <path>', 'custom config path')
  .option('--host <host>', 'server host override')
  .option('-p, --port <port>', 'server port override')
  .option('--hermes-url <url>', 'Hermes base URL override')
  .option('--no-api-key', 'disable local router API key guard')
  .action(async (options) => {
    const config = loadConfig(options.config);

    if (options.host) config.server.host = options.host;
    if (options.port) config.server.port = Number(options.port);
    if (options.hermesUrl) config.hermes.baseUrl = options.hermesUrl;
    if (options.apiKey === false) config.server.requireApiKey = false;

    const { host, port } = await startServer(config);
    console.log(`Hermes Router running: http://${host}:${port}`);
    console.log(`OpenAI-compatible endpoint: http://${host}:${port}/v1`);
    console.log(`Hermes upstream: ${config.hermes.baseUrl}`);

    if (config.server.requireApiKey) {
      console.log('Local API key guard: ON. Use Authorization: Bearer <server.apiKey>.');
    } else {
      console.log('Local API key guard: OFF. Keep host bound to 127.0.0.1 for private use.');
    }
  });

if (!process.argv.slice(2).length) {
  program.help();
}

program.parseAsync(process.argv);
