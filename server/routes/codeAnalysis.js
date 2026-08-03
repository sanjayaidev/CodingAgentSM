// server/routes/codeAnalysis.js
import express from 'express';
import { 
  analyzeComplexity, 
  detectBugs, 
  suggestOptimizations,
  detectLanguage 
} from '../lib/codeAnalysis.js';
import { detectSensitiveData } from '../middleware/security.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('code-analysis-routes');

/**
 * Analyze code complexity and quality
 * POST /api/analysis/complexity
 */
router.post('/complexity', async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const analysis = analyzeComplexity(code, language);
    
    res.json({ 
      success: true, 
      analysis: {
        metrics: {
          linesOfCode: analysis.linesOfCode,
          cognitiveComplexity: analysis.cognitiveComplexity,
          cyclomaticComplexity: analysis.cyclomaticComplexity,
          nestingDepth: analysis.nestingDepth,
          functionCount: analysis.functionCount,
          classCount: analysis.classCount,
          commentRatio: analysis.commentRatio,
        },
        quality: analysis.quality,
      } 
    });
  } catch (error) {
    logger.error('Failed to analyze complexity', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Detect bugs and code smells
 * POST /api/analysis/bugs
 */
router.post('/bugs', async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const bugs = detectBugs(code, language);
    
    res.json({ 
      success: true, 
      bugs,
      summary: {
        total: bugs.length,
        errors: bugs.filter(b => b.severity === 'error').length,
        warnings: bugs.filter(b => b.severity === 'warning').length,
        info: bugs.filter(b => b.severity === 'info').length,
      }
    });
  } catch (error) {
    logger.error('Failed to detect bugs', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get performance optimization suggestions
 * POST /api/analysis/optimize
 */
router.post('/optimize', async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const suggestions = suggestOptimizations(code, language);
    
    res.json({ 
      success: true, 
      suggestions,
      count: suggestions.length 
    });
  } catch (error) {
    logger.error('Failed to get optimization suggestions', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Full code review (complexity + bugs + optimizations)
 * POST /api/analysis/review
 */
router.post('/review', async (req, res) => {
  try {
    const { code, language = 'javascript', filename } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const detectedLanguage = filename ? detectLanguage(filename, code) : language;
    const complexity = analyzeComplexity(code, detectedLanguage);
    const bugs = detectBugs(code, detectedLanguage);
    const optimizations = suggestOptimizations(code, detectedLanguage);
    
    // Calculate overall score
    const bugPenalty = bugs.filter(b => b.severity === 'error').length * 10 +
                       bugs.filter(b => b.severity === 'warning').length * 5;
    const overallScore = Math.max(0, Math.min(100, complexity.quality.score - bugPenalty));
    
    res.json({
      success: true,
      review: {
        language: detectedLanguage,
        metrics: {
          linesOfCode: complexity.linesOfCode,
          cognitiveComplexity: complexity.cognitiveComplexity,
          cyclomaticComplexity: complexity.cyclomaticComplexity,
          nestingDepth: complexity.nestingDepth,
          functionCount: complexity.functionCount,
          classCount: complexity.classCount,
          commentRatio: complexity.commentRatio,
        },
        quality: {
          ...complexity.quality,
          overallScore,
          grade: getGrade(overallScore),
        },
        bugs: {
          items: bugs,
          summary: {
            total: bugs.length,
            errors: bugs.filter(b => b.severity === 'error').length,
            warnings: bugs.filter(b => b.severity === 'warning').length,
            info: bugs.filter(b => b.severity === 'info').length,
          }
        },
        optimizations,
        recommendations: generateRecommendations(complexity, bugs, optimizations),
      }
    });
  } catch (error) {
    logger.error('Failed to perform code review', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Security scan for sensitive data
 * POST /api/analysis/security
 */
router.post('/security', async (req, res) => {
  try {
    const { code, filename } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const findings = detectSensitiveData(code);
    
    res.json({
      success: true,
      security: {
        findings,
        riskLevel: findings.length > 0 ? 'high' : 'low',
        recommendations: findings.length > 0 
          ? ['Remove sensitive data from code', 'Use environment variables for secrets', 'Add files to .gitignore']
          : ['No sensitive data detected'],
      }
    });
  } catch (error) {
    logger.error('Failed to perform security scan', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Detect programming language
 * POST /api/analysis/language
 */
router.post('/language', async (req, res) => {
  try {
    const { filename, content } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    
    const language = detectLanguage(filename, content);
    
    res.json({
      success: true,
      language,
      confidence: 'high',
    });
  } catch (error) {
    logger.error('Failed to detect language', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper function to get letter grade from score
 */
function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(complexity, bugs, optimizations) {
  const recommendations = [];
  
  if (complexity.cyclomaticComplexity > 10) {
    recommendations.push({
      priority: 'high',
      category: 'complexity',
      message: 'Refactor complex functions to reduce cyclomatic complexity.',
    });
  }
  
  if (complexity.nestingDepth > 4) {
    recommendations.push({
      priority: 'high',
      category: 'complexity',
      message: 'Reduce nesting depth using early returns or guard clauses.',
    });
  }
  
  const errorBugs = bugs.filter(b => b.severity === 'error');
  if (errorBugs.length > 0) {
    recommendations.push({
      priority: 'critical',
      category: 'bugs',
      message: `Fix ${errorBugs.length} critical issue(s) immediately.`,
    });
  }
  
  if (optimizations.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'performance',
      message: `Apply ${optimizations.length} performance optimization(s).`,
    });
  }
  
  if (complexity.commentRatio < 0.1 && complexity.linesOfCode > 100) {
    recommendations.push({
      priority: 'low',
      category: 'documentation',
      message: 'Improve code documentation with more comments.',
    });
  }
  
  return recommendations.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export default router;
