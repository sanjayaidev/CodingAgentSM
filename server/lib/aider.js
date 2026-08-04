// lib/aider.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getModelById, WORKING_MODELS } from './models.js';

const execFileAsync = promisify(execFile);

// Alibaba DashScope configuration
const ALIBABA_BASE = process.env.ALIBABA_BASE_URL ||
  `https://${process.env.ALIBABA_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`;
const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;

export async function runAider({
  workDir,
  modelId,
  task,
  files = [],
  options = {},
}) {
  // Validate model
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}. Choose from ${WORKING_MODELS.map(m => m.id).join(', ')}`);
  }

  if (!fs.existsSync(workDir)) {
    throw new Error(`workDir does not exist: ${workDir}. Clone the repo first via POST /api/repos/clone.`);
  }

  // Aider uses litellm under the hood. To route a custom OPENAI_API_BASE
  // (Alibaba's DashScope compatible-mode endpoint) instead of matching
  // some other provider's preset by name, the model must be passed with
  // an "openai/" prefix — litellm strips that prefix and sends the rest
  // as the `model` field in the request body to OPENAI_API_BASE.
  const litellmModel = modelId.startsWith('openai/') ? modelId : `openai/${modelId}`;

  const aiderEnv = {
    ...process.env,
    OPENAI_API_BASE: ALIBABA_BASE,
    OPENAI_API_KEY: ALIBABA_API_KEY,
  };

  const aiderArgs = [
    // Explicit files to include in context
    ...files,
    // Non-interactive mode
    '--yes-always',
    // Skip updates
    '--no-check-update',
    // Don't touch .gitignore
    '--no-gitignore',
    // Leave changes in the working tree uncommitted — the UI shows them as
    // a diff and the user explicitly applies (commits) or discards them.
    '--no-auto-commits',
    // Model
    '--model', litellmModel,
    // The task
    '--message', task,
    // Keep history outside repo
    '--chat-history-file', path.join(workDir, '..', '.aider-chat.md'),
    '--input-history-file', path.join(workDir, '..', '.aider-input.md'),
    // Code formatting
    '--code-theme', 'dracula',
  ];

  console.log(`[Aider] Running with model: ${modelId}`);
  console.log(`[Aider] Task: ${task.slice(0, 100)}...`);

  try {
    const { stdout, stderr } = await execFileAsync('aider', aiderArgs, {
      cwd: workDir,
      env: aiderEnv,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    return { stdout, stderr, success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        "The 'aider' command was not found on this machine/container. " +
        "aider is a Python CLI (not an npm package), so it isn't installed " +
        "by `npm install`. Install it with: pip install aider-install && aider-install " +
        "— then make sure the directory it installs to (usually ~/.local/bin) is on PATH " +
        "for the process running this server."
      );
    }
    // Aider can exit non-zero even after making changes
    console.log(`[Aider] Exit code: ${error.code}`);
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      success: false,
      error: error.message,
    };
  }
}
