#!/usr/bin/env node

import { parseArgs } from "node:util";
import { enableAllIdes, init } from "../src/init.js";
import { update } from "../src/update.js";
import { skillsCli } from "../src/skills-cli.js";
import { agentsCli } from "../src/agents-cli.js";
import { listRuns, printRuns } from "../src/runs.js";
import {
  initState,
  readSquadMeta,
  resolveSquadDir,
  updateStep,
  writeHandoff,
  markCompleted,
} from "../src/state.js";

const { positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

if (command === "init") {
  await init(process.cwd());
} else if (command === "enable-all-ides") {
  await enableAllIdes(process.cwd());
} else if (command === "install") {
  // npx opensquad install <name>
  const result = await skillsCli(
    "install",
    positionals.slice(1),
    process.cwd(),
  );
  if (!result.success) process.exitCode = 1;
} else if (command === "uninstall") {
  // npx opensquad uninstall <name>
  const result = await skillsCli("remove", positionals.slice(1), process.cwd());
  if (!result.success) process.exitCode = 1;
} else if (command === "update") {
  const target = positionals[1];
  if (target) {
    // npx opensquad update <name> → update specific skill
    const result = await skillsCli("update-one", [target], process.cwd());
    if (!result.success) process.exitCode = 1;
  } else {
    // npx opensquad update → update core
    const result = await update(process.cwd());
    if (!result.success) process.exitCode = 1;
  }
} else if (command === "skills") {
  // Backward compat: npx opensquad skills list|install|remove|update
  const subcommand = positionals[1];
  const args = positionals.slice(2);
  const result = await skillsCli(subcommand, args, process.cwd());
  if (!result.success) process.exitCode = 1;
} else if (command === "agents") {
  const subcommand = positionals[1];
  const args = positionals.slice(2);
  const result = await agentsCli(subcommand, args, process.cwd());
  if (!result.success) process.exitCode = 1;
} else if (command === "runs") {
  const squadName = positionals[1] || null;
  const runs = await listRuns(squadName, process.cwd());
  printRuns(runs);
} else if (command === "state-init") {
  // opensquad state-init <squad-name>  — write initial state.json (useful for testing)
  const squadName = positionals[1];
  if (!squadName) {
    console.error("  Usage: opensquad state-init <squad-name>");
    process.exitCode = 1;
  } else {
    const squadDir = resolveSquadDir(squadName, process.cwd());
    const meta = await readSquadMeta(squadDir);
    await initState(squadDir, meta.code, meta.totalSteps);
    console.log(
      `  ✓ state.json initialized for squad "${meta.name}" (${meta.totalSteps} steps)`,
    );
  }
} else if (command === "state-demo") {
  // opensquad state-demo <squad-name>  — animate a fake run through all steps
  const squadName = positionals[1];
  if (!squadName) {
    console.error("  Usage: opensquad state-demo <squad-name>");
    process.exitCode = 1;
  } else {
    const STEP_MS = 2000;
    const squadDir = resolveSquadDir(squadName, process.cwd());
    const meta = await readSquadMeta(squadDir);
    const state = await initState(squadDir, meta.code, meta.totalSteps);
    const agents = state.agents;

    console.log(
      `  🎬 Demo run for "${meta.name}" — ${meta.totalSteps} steps × ${STEP_MS}ms`,
    );

    for (let i = 0; i < meta.totalSteps; i++) {
      const agent = agents[i % agents.length];
      await updateStep(squadDir, meta.code, i + 1, `Step ${i + 1}`, agent.id);
      process.stdout.write(
        `  Step ${i + 1}/${meta.totalSteps} — ${agent.icon} ${agent.name}\r`,
      );
      await new Promise((r) => setTimeout(r, STEP_MS));

      // Handoff to next agent if not last step
      if (i < meta.totalSteps - 1) {
        const next = agents[(i + 1) % agents.length];
        await writeHandoff(
          squadDir,
          meta.code,
          agent.id,
          next.id,
          `Entregando resultado do passo ${i + 1}`,
        );
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const runId = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14)
      .replace(/^(\d{8})(\d{6})/, "$1-$2");
    await markCompleted(squadDir, meta.code, runId, 3000);
    console.log(`\n  ✓ Demo complete. Run archived as ${runId}`);
  }
} else {
  console.log(`
  opensquad — Multi-agent orchestration for Claude Code

  Usage:
    npx opensquad init                    Initialize Opensquad
    npx opensquad enable-all-ides         Enable templates for all supported IDE/LLM stacks
    npx opensquad update                  Update Opensquad core
    npx opensquad install <name>          Install a skill
    npx opensquad uninstall <name>        Remove a skill
    npx opensquad update <name>           Update a specific skill
    npx opensquad skills                  List installed skills
    npx opensquad agents                  List installed agents
    npx opensquad agents install <name>   Install a predefined agent
    npx opensquad agents remove <name>    Remove an agent
    npx opensquad agents update           Update all agents
    npx opensquad runs [squad-name]       View execution history
    npx opensquad state-init <squad>      Write initial state.json for a squad
    npx opensquad state-demo <squad>      Animate a fake run (for dashboard testing)

  Learn more: https://github.com/renatoasse/opensquad
  `);
  if (command) process.exitCode = 1;
}
