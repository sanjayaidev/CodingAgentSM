// routes/agent.js
import express from 'express';
import { runAider } from '../lib/aider.js';
import { WORKING_MODELS, getModelById, getRecommendedModel } from '../lib/models.js';
import { getDiff } from '../lib/git.js';

const router = express.Router();

// Get all available models
router.get('/models', (req, res) => {
  res.json({
    models: WORKING_MODELS,
    total: WORKING_MODELS.length,
  });
});

// Run the agent
router.post('/run', async (req, res) => {
  const { repoPath, task, modelId, files = [] } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }
  if (!task) {
    return res.status(400).json({ error: 'task is required' });
  }

  // If no model specified, use recommended
  let model = modelId;
  if (!model) {
    const recommended = getRecommendedModel(task);
    model = recommended.id;
  }

  // Validate model exists
  if (!getModelById(model)) {
    return res.status(400).json({
      error: `Model "${model}" not found. Available: ${WORKING_MODELS.map(m => m.id).join(', ')}`,
    });
  }

  try {
    const result = await runAider({
      workDir: repoPath,
      modelId: model,
      task,
      files,
    });

    let diff = { diff: '', files: [] };
    try {
      diff = await getDiff(repoPath);
    } catch (diffError) {
      console.error('[Agent] Diff read failed:', diffError);
    }

    res.json({
      success: result.success,
      model,
      output: result.stdout,
      error: result.stderr || result.error,
      diff: diff.diff,
      changedFiles: diff.files,
    });
  } catch (error) {
    console.error('[Agent] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stream version for real-time updates
router.post('/run/stream', async (req, res) => {
  const { repoPath, task, modelId, files = [] } = req.body;

  if (!repoPath || !task) {
    return res.status(400).json({ error: 'repoPath and task are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'start', message: 'Starting aider...' });

  try {
    const result = await runAider({
      workDir: repoPath,
      modelId: modelId || getRecommendedModel(task).id,
      task,
      files,
    });

    if (result.success) {
      send({ type: 'done', ...result });
    } else {
      send({ type: 'error', error: result.error });
    }
  } catch (error) {
    send({ type: 'error', error: error.message });
  }

  res.end();
});

export default router;
