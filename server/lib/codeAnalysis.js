// server/lib/codeAnalysis.js
import { createLogger } from '../utils/logger.js';

const logger = createLogger('codeAnalysis');

/**
 * Code complexity analysis
 */
export const analyzeComplexity = (code, language = 'javascript') => {
  const metrics = {
    linesOfCode: code.split('\n').length,
    cognitiveComplexity: 0,
    cyclomaticComplexity: 1,
    nestingDepth: 0,
    functionCount: 0,
    classCount: 0,
    commentRatio: 0,
  };

  // Count functions
  metrics.functionCount = (code.match(/\b(function|=>|async\s+function)\b/g) || []).length;
  
  // Count classes
  metrics.classCount = (code.match(/\bclass\s+\w+/g) || []).length;
  
  // Count comments
  const commentLines = code.split('\n').filter(line => 
    line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')
  ).length;
  metrics.commentRatio = commentLines / metrics.linesOfCode;
  
  // Cyclomatic complexity (simplified)
  const decisionPoints = code.match(/\b(if|else|for|while|switch|case|catch|&&|\|\?|ternary)\b/g) || [];
  metrics.cyclomaticComplexity += decisionPoints.length;
  
  // Nesting depth analysis
  let maxNesting = 0;
  let currentNesting = 0;
  for (const char of code) {
    if (char === '{') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    } else if (char === '}') {
      currentNesting--;
    }
  }
  metrics.nestingDepth = maxNesting;
  
  // Cognitive complexity estimation
  let cognitiveScore = 0;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Increment for control flow statements
    if (/\b(if|else|for|while|switch|try|catch)\b/.test(line)) {
      cognitiveScore++;
    }
    
    // Increment for nested structures
    const nestingLevel = (line.match(/^\s*/) || [''])[0].length / 2;
    cognitiveScore += Math.floor(nestingLevel / 2);
  }
  metrics.cognitiveComplexity = cognitiveScore;
  
  // Quality assessment
  metrics.quality = assessQuality(metrics);
  
  return metrics;
};

/**
 * Assess code quality based on metrics
 */
const assessQuality = (metrics) => {
  const issues = [];
  const suggestions = [];
  
  if (metrics.linesOfCode > 500) {
    issues.push('File is too large (>500 lines). Consider splitting into smaller modules.');
  }
  
  if (metrics.cyclomaticComplexity > 10) {
    issues.push('High cyclomatic complexity. Consider refactoring complex functions.');
    suggestions.push('Break down complex conditional logic into smaller functions.');
  }
  
  if (metrics.nestingDepth > 4) {
    issues.push('Deep nesting detected. Consider using early returns or guard clauses.');
    suggestions.push('Use early returns to reduce nesting levels.');
  }
  
  if (metrics.functionCount === 0 && metrics.linesOfCode > 50) {
    suggestions.push('Consider organizing code into reusable functions.');
  }
  
  if (metrics.commentRatio < 0.1 && metrics.linesOfCode > 100) {
    suggestions.push('Add more documentation and comments to improve maintainability.');
  }
  
  return {
    score: calculateScore(metrics),
    issues,
    suggestions,
  };
};

/**
 * Calculate overall quality score (0-100)
 */
const calculateScore = (metrics) => {
  let score = 100;
  
  // Penalize for high complexity
  score -= Math.min(30, metrics.cyclomaticComplexity * 3);
  
  // Penalize for deep nesting
  score -= Math.min(20, metrics.nestingDepth * 5);
  
  // Penalize for very large files
  if (metrics.linesOfCode > 500) {
    score -= Math.min(20, (metrics.linesOfCode - 500) / 50);
  }
  
  // Bonus for good comment ratio
  if (metrics.commentRatio > 0.15) {
    score += 5;
  }
  
  return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * Detect potential bugs and code smells
 */
export const detectBugs = (code, language = 'javascript') => {
  const bugs = [];
  
  // Common JavaScript/TypeScript issues
  const patterns = [
    {
      pattern: /\b(var)\s+\w+/g,
      message: "Using 'var' instead of 'let' or 'const'",
      severity: 'warning',
      suggestion: 'Replace var with let or const for block scoping.',
    },
    {
      pattern: /==\s*['""][^'"']*['""]/g,
      message: 'Using loose equality (==)',
      severity: 'warning',
      suggestion: 'Use strict equality (===) for type-safe comparisons.',
    },
    {
      pattern: /!\s*=/g,
      message: 'Using loose inequality (!=)',
      severity: 'warning',
      suggestion: 'Use strict inequality (!==) for type-safe comparisons.',
    },
    {
      pattern: /console\.log\s*\(/g,
      message: 'Console.log statement found',
      severity: 'info',
      suggestion: 'Remove console.log before production deployment.',
    },
    {
      pattern: /setTimeout\s*\(\s*\(\)/g,
      message: 'Arrow function in setTimeout',
      severity: 'info',
      suggestion: 'Consider passing the function directly instead of wrapping in arrow function.',
    },
    {
      pattern: /new\s+Promise\s*\(\s*async/g,
      message: 'Promise constructor with async executor',
      severity: 'error',
      suggestion: 'Async Promise executors are anti-patterns. Refactor to use async/await properly.',
    },
    {
      pattern: /eval\s*\(/g,
      message: 'Use of eval() detected',
      severity: 'error',
      suggestion: 'Avoid eval() due to security risks. Use safer alternatives.',
    },
    {
      pattern: /innerHTML\s*=/g,
      message: 'Direct innerHTML assignment',
      severity: 'warning',
      suggestion: 'Use textContent or sanitize HTML to prevent XSS attacks.',
    },
    {
      pattern: /\bdocument\.write\s*\(/g,
      message: 'document.write() usage',
      severity: 'warning',
      suggestion: 'Avoid document.write() as it can overwrite the entire document.',
    },
  ];
  
  for (const { pattern, message, severity, suggestion } of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      bugs.push({
        type: 'code-smell',
        message,
        severity,
        suggestion,
        occurrences: matches.length,
      });
    }
  }
  
  // Check for missing error handling
  if (/\.then\s*\(/.test(code) && !/\.catch\s*\(/.test(code) && !/try\s*{/.test(code)) {
    bugs.push({
      type: 'potential-bug',
      message: 'Promise without error handling',
      severity: 'warning',
      suggestion: 'Add .catch() or wrap in try-catch to handle potential errors.',
    });
  }
  
  return bugs;
};

/**
 * Performance optimization suggestions
 */
export const suggestOptimizations = (code, language = 'javascript') => {
  const suggestions = [];
  
  // Loop optimizations
  if (/\bfor\s*\([^)]*i\s*<\s*\w+\.length/.test(code)) {
    suggestions.push({
      type: 'performance',
      message: 'Cache array length in loop condition',
      suggestion: 'Store array.length in a variable before the loop to avoid repeated property access.',
      example: 'for (let i = 0, len = arr.length; i < len; i++) { ... }',
    });
  }
  
  // DOM manipulation (if applicable)
  if (/document\.getElementById|querySelector/.test(code)) {
    suggestions.push({
      type: 'performance',
      message: 'Cache DOM element references',
      suggestion: 'Store DOM element references in variables instead of querying repeatedly.',
    });
  }
  
  // String concatenation in loops
  if (/for\s*\([^)]*\)[^{]*{[^}]*\+=\s*['"`]/.test(code)) {
    suggestions.push({
      type: 'performance',
      message: 'Use Array.join() for string concatenation in loops',
      suggestion: 'Build strings using an array and join() for better performance.',
      example: 'const parts = []; for (...) { parts.push(str); } return parts.join("");',
    });
  }
  
  // Memory leaks prevention
  if (/addEventListener/.test(code) && !/removeEventListener/.test(code)) {
    suggestions.push({
      type: 'memory',
      message: 'Event listeners added without removal',
      suggestion: 'Ensure event listeners are removed when components unmount to prevent memory leaks.',
    });
  }
  
  return suggestions;
};

/**
 * Multi-language support detection
 */
export const detectLanguage = (filename, content = '') => {
  const ext = filename.split('.').pop().toLowerCase();
  
  const languageMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    sql: 'sql',
    sh: 'bash',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    vue: 'vue',
    svelte: 'svelte',
  };
  
  return languageMap[ext] || 'plaintext';
};
