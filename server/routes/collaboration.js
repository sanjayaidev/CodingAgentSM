// server/routes/collaboration.js
import express from 'express';
import { 
  CollaborationManager, 
  WorkspaceManager, 
  ROLES, 
  hasPermission 
} from '../lib/collaboration.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('collaboration-routes');

// Initialize managers (will be attached to app in index.js)
let collaborationManager = null;
let workspaceManager = null;

export const initCollaboration = (server) => {
  collaborationManager = new CollaborationManager(server);
  workspaceManager = new WorkspaceManager();
  return { collaborationManager, workspaceManager };
};

export const getManagers = () => ({ collaborationManager, workspaceManager });

/**
 * Create a new collaboration session
 * POST /api/collab/session
 */
router.post('/session', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { options } = req.body;
    const session = collaborationManager.createSession(req.session.userId, options);
    
    logger.info('Session created via API', { 
      sessionId: session.id, 
      userId: req.session.userId 
    });
    
    res.json({ success: true, session });
  } catch (error) {
    logger.error('Failed to create session', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get session details
 * GET /api/collab/session/:sessionId
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const session = collaborationManager.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check if user is a participant
    if (!session.participants.has(req.session.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ session });
  } catch (error) {
    logger.error('Failed to get session', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Join a session
 * POST /api/collab/session/:sessionId/join
 */
router.post('/session/:sessionId/join', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const session = collaborationManager.joinSession(
      req.params.sessionId, 
      req.session.userId
    );
    
    logger.info('User joined session via API', { 
      sessionId: req.params.sessionId, 
      userId: req.session.userId 
    });
    
    res.json({ success: true, session });
  } catch (error) {
    logger.error('Failed to join session', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Leave a session
 * POST /api/collab/session/:sessionId/leave
 */
router.post('/session/:sessionId/leave', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    collaborationManager.leaveSession(req.params.sessionId, req.session.userId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to leave session', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get user's active sessions
 * GET /api/collab/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const sessions = collaborationManager.getUserSessions(req.session.userId);
    res.json({ sessions });
  } catch (error) {
    logger.error('Failed to get user sessions', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create a new workspace
 * POST /api/collab/workspace
 */
router.post('/workspace', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }
    
    const workspace = workspaceManager.createWorkspace(
      req.session.userId, 
      name, 
      description
    );
    
    logger.info('Workspace created via API', { 
      workspaceId: workspace.id, 
      userId: req.session.userId 
    });
    
    res.json({ success: true, workspace });
  } catch (error) {
    logger.error('Failed to create workspace', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get workspace details
 * GET /api/collab/workspace/:workspaceId
 */
router.get('/workspace/:workspaceId', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const workspace = workspaceManager.getWorkspace(req.params.workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    
    // Check access
    const role = workspaceManager.getUserRole(req.params.workspaceId, req.session.userId);
    if (!role) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const members = workspaceManager.getWorkspaceMembers(req.params.workspaceId);
    
    res.json({ workspace, members, userRole: role });
  } catch (error) {
    logger.error('Failed to get workspace', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get user's workspaces
 * GET /api/collab/workspaces
 */
router.get('/workspaces', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const workspaces = workspaceManager.getUserWorkspaces(req.session.userId);
    res.json({ workspaces });
  } catch (error) {
    logger.error('Failed to get user workspaces', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add member to workspace
 * POST /api/collab/workspace/:workspaceId/members
 */
router.post('/workspace/:workspaceId/members', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { userId, role = ROLES.VIEWER } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Check permissions
    const actorRole = workspaceManager.getUserRole(req.params.workspaceId, req.session.userId);
    if (!actorRole || !hasPermission(actorRole, 'manage-users')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    workspaceManager.addMember(req.params.workspaceId, userId, role);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to add member', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove member from workspace
 * DELETE /api/collab/workspace/:workspaceId/members/:userId
 */
router.delete('/workspace/:workspaceId/members/:userId', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Check permissions
    const actorRole = workspaceManager.getUserRole(req.params.workspaceId, req.session.userId);
    if (!actorRole || !hasPermission(actorRole, 'manage-users')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    workspaceManager.removeMember(req.params.workspaceId, req.params.userId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to remove member', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update member role
 * PUT /api/collab/workspace/:workspaceId/members/:userId/role
 */
router.put('/workspace/:workspaceId/members/:userId/role', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { role } = req.body;
    if (!role || !Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    workspaceManager.updateMemberRole(
      req.params.workspaceId, 
      req.params.userId, 
      role, 
      req.session.userId
    );
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update member role', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
