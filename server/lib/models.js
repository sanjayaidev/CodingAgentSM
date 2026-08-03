// lib/models.js
// From your test results — 68 working Alibaba models
export const WORKING_MODELS = [
  // ── Best Coding Models ──────────────────────────────────────────
  { id: 'qwen3-coder-next', label: 'Qwen3 Coder Next', category: 'coding', speed: 'fast' },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', category: 'coding', speed: 'medium' },
  { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash', category: 'coding', speed: 'fast' },
  { id: 'qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B', category: 'coding', speed: 'slow' },

  // ── Best Reasoning Models ──────────────────────────────────────
  { id: 'qwen3.5-122b-a10b', label: 'Qwen3.5 122B', category: 'reasoning', speed: 'slow' },
  { id: 'qwen3-235b-a22b-thinking-2507', label: 'Qwen3 235B Thinking', category: 'reasoning', speed: 'slow' },
  { id: 'qwq-plus', label: 'QWQ Plus', category: 'reasoning', speed: 'medium' },

  // ── Best General Chat ──────────────────────────────────────────
  { id: 'qwen3-max', label: 'Qwen3 Max', category: 'general', speed: 'medium' },
  { id: 'qwen3.7-max', label: 'Qwen3.7 Max', category: 'general', speed: 'medium' },
  { id: 'qwen-plus-2025-07-28', label: 'Qwen Plus (latest)', category: 'general', speed: 'fast' },
  { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', category: 'general', speed: 'fast' },
  { id: 'qwen-flash', label: 'Qwen Flash', category: 'general', speed: 'fast' },

  // ── Vision Models ──────────────────────────────────────────────
  { id: 'qwen-vl-plus', label: 'Qwen VL Plus', category: 'vision', speed: 'medium' },
  { id: 'qwen-vl-max', label: 'Qwen VL Max', category: 'vision', speed: 'medium' },
  { id: 'qwen3-vl-plus', label: 'Qwen3 VL Plus', category: 'vision', speed: 'medium' },

  // ── DeepSeek Models ────────────────────────────────────────────
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', category: 'general', speed: 'medium' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', category: 'general', speed: 'fast' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', category: 'general', speed: 'medium' },

  // ── GLM Models ──────────────────────────────────────────────────
  { id: 'glm-5.1', label: 'GLM 5.1', category: 'general', speed: 'medium' },

  // ── All other working models ──────────────────────────────────
  { id: 'qwen3.5-122b-a10b', label: 'Qwen3.5 122B', category: 'general', speed: 'slow' },
  { id: 'qwen-plus-2025-07-28', label: 'Qwen Plus 2025-07-28', category: 'general', speed: 'fast' },
  { id: 'qwen3-max', label: 'Qwen3 Max', category: 'general', speed: 'medium' },
  { id: 'qwen-max', label: 'Qwen Max', category: 'general', speed: 'medium' },
  { id: 'qwen-mt-flash', label: 'Qwen MT Flash', category: 'general', speed: 'fast' },
  { id: 'qwen3-vl-30b-a3b-thinking', label: 'Qwen3 VL 30B Thinking', category: 'vision', speed: 'medium' },
  { id: 'qwen3-235b-a22b-thinking-2507', label: 'Qwen3 235B Thinking', category: 'reasoning', speed: 'slow' },
  { id: 'glm-5.1', label: 'GLM 5.1', category: 'general', speed: 'medium' },
  { id: 'qwen3.7-max-preview', label: 'Qwen3.7 Max Preview', category: 'general', speed: 'medium' },
  { id: 'qwen3.6-max-preview', label: 'Qwen3.6 Max Preview', category: 'general', speed: 'medium' },
  { id: 'qwen3-32b', label: 'Qwen3 32B', category: 'general', speed: 'medium' },
  { id: 'qwen3-vl-plus-2025-09-23', label: 'Qwen3 VL Plus 2025-09-23', category: 'vision', speed: 'medium' },
  { id: 'qwen3.6-flash', label: 'Qwen3.6 Flash', category: 'general', speed: 'fast' },
  { id: 'qwen-vl-plus', label: 'Qwen VL Plus', category: 'vision', speed: 'medium' },
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', category: 'general', speed: 'medium' },
  { id: 'qwen3-coder-next', label: 'Qwen3 Coder Next', category: 'coding', speed: 'fast' },
  { id: 'qwen3.5-flash', label: 'Qwen3.5 Flash', category: 'general', speed: 'fast' },
  { id: 'qwen3.5-35b-a3b', label: 'Qwen3.5 35B A3B', category: 'general', speed: 'medium' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', category: 'general', speed: 'fast' },
  { id: 'qwen3-30b-a3b-thinking-2507', label: 'Qwen3 30B Thinking', category: 'reasoning', speed: 'medium' },
  { id: 'qwen3-coder-plus-2025-09-23', label: 'Qwen3 Coder Plus 2025-09-23', category: 'coding', speed: 'medium' },
  { id: 'qwen-plus-latest', label: 'Qwen Plus Latest', category: 'general', speed: 'fast' },
  { id: 'qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B', category: 'coding', speed: 'slow' },
  { id: 'qwen3-max-2026-01-23', label: 'Qwen3 Max 2026-01-23', category: 'general', speed: 'medium' },
  { id: 'qwen3-vl-8b-thinking', label: 'Qwen3 VL 8B Thinking', category: 'vision', speed: 'fast' },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', category: 'coding', speed: 'medium' },
  { id: 'qwen-plus-2025-09-11', label: 'Qwen Plus 2025-09-11', category: 'general', speed: 'fast' },
  { id: 'qwen3-vl-flash-2026-01-22', label: 'Qwen3 VL Flash 2026-01-22', category: 'vision', speed: 'fast' },
  { id: 'qwen3-max-preview', label: 'Qwen3 Max Preview', category: 'general', speed: 'medium' },
  { id: 'qwen3.5-flash-2026-02-23', label: 'Qwen3.5 Flash 2026-02-23', category: 'general', speed: 'fast' },
  { id: 'qwen3-vl-flash-2025-10-15', label: 'Qwen3 VL Flash 2025-10-15', category: 'vision', speed: 'fast' },
  { id: 'qwen-vl-max', label: 'Qwen VL Max', category: 'vision', speed: 'medium' },
  { id: 'qwen3.7-max-2026-05-20', label: 'Qwen3.7 Max 2026-05-20', category: 'general', speed: 'medium' },
  { id: 'qwen3-vl-30b-a3b-instruct', label: 'Qwen3 VL 30B Instruct', category: 'vision', speed: 'medium' },
  { id: 'qwen3-coder-30b-a3b-instruct', label: 'Qwen3 Coder 30B', category: 'coding', speed: 'medium' },
  { id: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen3 VL 235B', category: 'vision', speed: 'slow' },
  { id: 'qwen3-8b', label: 'Qwen3 8B', category: 'general', speed: 'fast' },
  { id: 'qwen3.6-27b', label: 'Qwen3.6 27B', category: 'general', speed: 'medium' },
  { id: 'qwen3-235b-a22b', label: 'Qwen3 235B', category: 'general', speed: 'slow' },
  { id: 'qwen-mt-lite', label: 'Qwen MT Lite', category: 'general', speed: 'fast' },
  { id: 'qwen3.6-flash-2026-04-16', label: 'Qwen3.6 Flash 2026-04-16', category: 'general', speed: 'fast' },
  { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash', category: 'coding', speed: 'fast' },
  { id: 'qwen3-vl-plus', label: 'Qwen3 VL Plus', category: 'vision', speed: 'medium' },
  { id: 'qwen3-next-80b-a3b-thinking', label: 'Qwen3 Next 80B Thinking', category: 'reasoning', speed: 'slow' },
  { id: 'qwen3.7-max-2026-05-17', label: 'Qwen3.7 Max 2026-05-17', category: 'general', speed: 'medium' },
  { id: 'qwen3-30b-a3b', label: 'Qwen3 30B A3B', category: 'general', speed: 'medium' },
  { id: 'qwen-mt-plus', label: 'Qwen MT Plus', category: 'general', speed: 'medium' },
  { id: 'qwen3-vl-flash', label: 'Qwen3 VL Flash', category: 'vision', speed: 'fast' },
  { id: 'qwen3-vl-8b-instruct', label: 'Qwen3 VL 8B Instruct', category: 'vision', speed: 'fast' },
  { id: 'qwen3-max-2025-09-23', label: 'Qwen3 Max 2025-09-23', category: 'general', speed: 'medium' },
  { id: 'qwen-plus-character', label: 'Qwen Plus Character', category: 'general', speed: 'fast' },
  { id: 'qwen3-coder-flash-2025-07-28', label: 'Qwen3 Coder Flash 2025-07-28', category: 'coding', speed: 'fast' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', category: 'general', speed: 'medium' },
  { id: 'qwen-flash-character', label: 'Qwen Flash Character', category: 'general', speed: 'fast' },
  { id: 'qwen3-vl-plus-2025-12-19', label: 'Qwen3 VL Plus 2025-12-19', category: 'vision', speed: 'medium' },
  { id: 'qwen-plus-2025-04-28', label: 'Qwen Plus 2025-04-28', category: 'general', speed: 'fast' },
  { id: 'qwen-mt-turbo', label: 'Qwen MT Turbo', category: 'general', speed: 'fast' },
  { id: 'qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B Instruct', category: 'general', speed: 'medium' },
  { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', category: 'general', speed: 'fast' },
  { id: 'qwen-flash', label: 'Qwen Flash', category: 'general', speed: 'fast' },
  { id: 'qwen-flash-2025-07-28', label: 'Qwen Flash 2025-07-28', category: 'general', speed: 'fast' },
  { id: 'qwen3.6-35b-a3b', label: 'Qwen3.6 35B A3B', category: 'general', speed: 'medium' },
  { id: 'qwen3-235b-a22b-instruct-2507', label: 'Qwen3 235B Instruct', category: 'general', speed: 'slow' },
  { id: 'qwq-plus', label: 'QWQ Plus', category: 'reasoning', speed: 'medium' },
  { id: 'qwen3-coder-plus-2025-07-22', label: 'Qwen3 Coder Plus 2025-07-22', category: 'coding', speed: 'medium' },
  { id: 'qwen3.7-max', label: 'Qwen3.7 Max', category: 'general', speed: 'medium' },
  { id: 'qwen3-next-80b-a3b-instruct', label: 'Qwen3 Next 80B Instruct', category: 'general', speed: 'slow' },
  { id: 'qwen3-14b', label: 'Qwen3 14B', category: 'general', speed: 'fast' },
];

// Model categories for UI filtering
export const CATEGORIES = {
  coding: { label: '💻 Coding', description: 'Best for code generation and editing' },
  reasoning: { label: '🧠 Reasoning', description: 'Best for complex problem solving' },
  general: { label: '💬 General', description: 'All-purpose chat and assistance' },
  vision: { label: '🖼️ Vision', description: 'Can process and understand images' },
};

// Model speed tiers for UI
export const SPEED_TIERS = {
  fast: { label: '⚡ Fast', emoji: '⚡' },
  medium: { label: '🔸 Medium', emoji: '🔸' },
  slow: { label: '🐢 Slow', emoji: '🐢' },
};

// Get the best model for a specific task
export function getRecommendedModel(task, category = 'coding') {
  // Prioritize coding models for coding tasks
  if (category === 'coding' || task.includes('code') || task.includes('function')) {
    const codingModels = WORKING_MODELS.filter(m => m.category === 'coding');
    return codingModels[0] || WORKING_MODELS[0];
  }

  // For reasoning tasks
  if (task.includes('explain') || task.includes('analyze') || task.includes('think')) {
    const reasoningModels = WORKING_MODELS.filter(m => m.category === 'reasoning');
    return reasoningModels[0] || WORKING_MODELS[0];
  }

  // Default: general
  const generalModels = WORKING_MODELS.filter(m => m.category === 'general');
  return generalModels[0] || WORKING_MODELS[0];
}

// Get all models by category
export function getModelsByCategory(category) {
  return WORKING_MODELS.filter(m => m.category === category);
}

export function getModelById(id) {
  return WORKING_MODELS.find(m => m.id === id);
}
