#!/usr/bin/env node

import { Command } from 'commander';
import { getConfig } from '../config/config';
import { getDatabase } from '../db/database';
import { getOllamaClient } from '../agents/ollama-client';
import { AgentOrchestrator } from '../gateway/orchestrator';

const program = new Command();

program
  .name('localclaw')
  .description('Local AI agent framework powered by Ollama')
  .version('0.1.0');

// ---- ONBOARD ----
program
  .command('onboard')
  .description('Setup LocalClaw for first-time use')
  .action(async () => {
    console.log('ðŸ¦ž Welcome to LocalClaw!\n');
    const config = getConfig();
    config.ensureDirectories();
    config.saveConfig();
    console.log('âœ“ Created configuration directories');
    console.log(`  Config:    ${config.getConfigDir()}`);
    console.log(`  Workspace: ${config.getWorkspacePath()}`);
    getDatabase();
    console.log('âœ“ Initialized job database\n');

    console.log('Testing Ollama connection...');
    const ollama = getOllamaClient();
    const connected = await ollama.testConnection();
    if (!connected) {
      console.log('âœ— Cannot connect to Ollama');
      console.log('  Start Ollama first: open a terminal and run "ollama serve"');
      process.exit(1);
    }
    console.log('âœ“ Connected to Ollama');
    const models = await ollama.listModels();
    const primary = config.getConfig().models.primary;
    if (models.includes(primary)) {
      console.log(`âœ“ Model "${primary}" is ready`);
    } else {
      console.log(`âœ— Model "${primary}" not found`);
      console.log(`  Run: ollama pull ${primary}`);
    }
    console.log('\nâœ¨ LocalClaw is ready!');
    console.log('\nNext steps:');
    console.log('  1. Make sure Ollama is running: ollama serve');
    console.log('  2. Start the gateway: localclaw gateway start');
    console.log('  3. Open browser: http://localhost:18789');
  });

// ---- GATEWAY ----
const gateway = program.command('gateway').description('Control the gateway server');

gateway
  .command('start')
  .description('Start the gateway + web UI server')
  .action(async () => {
    // Check Ollama first
    const ollama = getOllamaClient();
    const connected = await ollama.testConnection();
    if (!connected) {
      console.log('');
      console.log('âš ï¸  Ollama is not running!');
      console.log('   Open a NEW terminal window and run: ollama serve');
      console.log('   Then come back and run: localclaw gateway start');
      console.log('');
      process.exit(1);
    }

    console.log('âœ“ Ollama is online');
    console.log('Starting gateway...\n');

    // Dynamically require the v2 server (runs it)
    require('../gateway/server-v2');
  });

gateway
  .command('status')
  .description('Check gateway status')
  .action(async () => {
    try {
      const res = await fetch('http://localhost:18789/api/status');
      const data = await res.json() as any;
      console.log('Gateway: Online');
      console.log(`Ollama: ${data.ollama ? 'Online' : 'Offline'}`);
      console.log(`Model: ${data.currentModel}`);
    } catch {
      console.log('Gateway: Offline (run: localclaw gateway start)');
    }
  });

// ---- AGENT ----
program
  .command('agent <mission>')
  .description('Execute a mission directly from CLI')
  .option('-p, --priority <number>', 'Job priority', '0')
  .action(async (mission: string, options: any) => {
    const ollama = getOllamaClient();
    const connected = await ollama.testConnection();
    if (!connected) {
      console.log('\nâš ï¸  Ollama is not running!');
      console.log('   Open a terminal and run: ollama serve\n');
      process.exit(1);
    }

    console.log('ðŸ¦ž LocalClaw Agent');
    console.log(`Mission: ${mission}\n`);

    const orchestrator = new AgentOrchestrator();
    const jobId = await orchestrator.executeJob(mission, {
      priority: parseInt(options.priority)
    });

    console.log(`Job ID: ${jobId}`);
    console.log('Running... (Ctrl+C to stop monitoring, job continues in background)\n');

    let lastStatus = '';
    const interval = setInterval(() => {
      const job = orchestrator.getJobStatus(jobId);
      if (!job) return;

      if (job.status !== lastStatus) {
        lastStatus = job.status;
        const icons: Record<string,string> = {
          planning: 'ðŸ“‹', executing: 'âš™ï¸', verifying: 'ðŸ”',
          completed: 'âœ…', failed: 'âŒ', needs_approval: 'âš ï¸'
        };
        console.log(`${icons[job.status] || 'â†’'} Status: ${job.status}`);
      }

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(interval);
        const tasks = orchestrator.getJobTasks(jobId);
        const done = tasks.filter(t => t.status === 'completed').length;
        console.log(`\nFinished: ${done}/${tasks.length} tasks completed`);
        if (job.status === 'completed') {
          console.log(`\nWorkspace: ${getConfig().getWorkspacePath()}`);
        }
        process.exit(job.status === 'completed' ? 0 : 1);
      }
    }, 1500);
  });

// ---- JOBS ----
const jobs = program.command('jobs').description('Manage jobs');

jobs
  .command('list')
  .description('List all jobs')
  .action(() => {
    const db = getDatabase();
    const list = db.listJobs();
    if (list.length === 0) { console.log('No jobs found'); return; }
    list.forEach(j => {
      console.log(`[${j.status.padEnd(12)}] ${j.id.slice(0,8)}  ${j.title}`);
    });
  });

jobs
  .command('show <id>')
  .description('Show job details')
  .action((id: string) => {
    const db = getDatabase();
    const job = db.getJob(id);
    if (!job) { console.log('Job not found'); return; }
    console.log(`ID:     ${job.id}`);
    console.log(`Title:  ${job.title}`);
    console.log(`Status: ${job.status}`);
    const tasks = db.listTasksForJob(id);
    console.log(`\nTasks (${tasks.length}):`);
    tasks.forEach(t => console.log(`  [${t.status}] ${t.title}`));
  });

// ---- MODEL ----
const model = program.command('model').description('Manage models');

model.command('list').action(async () => {
  const models = await getOllamaClient().listModels();
  console.log('Available models:');
  models.forEach(m => console.log(`  - ${m}`));
});

model.command('set <name>').action((name: string) => {
  const cfg = getConfig();
  const c = cfg.getConfig();
  cfg.updateConfig({ ...c, models: { ...c.models, primary: name, roles: { manager: name, executor: name, verifier: name } } });
  console.log(`âœ“ Model set to: ${name}`);
});

// ---- DOCTOR ----
program.command('doctor').action(async () => {
  console.log('ðŸ©º LocalClaw Health Check\n');
  const cfg = getConfig().getConfig();
  const ollama = getOllamaClient();
  const connected = await ollama.testConnection();
  console.log(`Ollama:    ${connected ? 'âœ“ Online' : 'âœ— Offline - run: ollama serve'}`);
  if (connected) {
    const models = await ollama.listModels();
    console.log(`Models:    ${models.length} available`);
    console.log(`Primary:   ${models.includes(cfg.models.primary) ? 'âœ“' : 'âœ—'} ${cfg.models.primary}`);
  }
  const db = getDatabase();
  const jobCount = db.listJobs().length;
  console.log(`Database:  âœ“ ${jobCount} jobs stored`);
  console.log(`Workspace: ${getConfig().getWorkspacePath()}`);
  try {
    const r = await fetch('http://localhost:18789/api/status');
    console.log(`Gateway:   âœ“ Online â†’ http://localhost:18789`);
  } catch {
    console.log(`Gateway:   âœ— Offline (run: localclaw gateway start)`);
  }
});

program.parse();


