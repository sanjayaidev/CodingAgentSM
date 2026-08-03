// server/lib/collaboration.js
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('collaboration');

/**
 * Session management for collaborative editing
 */
export class CollaborationManager {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
      },
    });
    
    // Active sessions: Map<sessionId, SessionData>
    this.sessions = new Map();
    
    // User connections: Map<userId, Set<socketId>>
    this.userConnections = new Map();
    
    // Document states: Map<documentId, DocumentState>
    this.documents = new Map();
    
    this.setupSocketHandlers();
  }
  
  setupSocketHandlers() {
    this.io.use((socket, next) => {
      // Validate session/authorization here
      const sessionId = socket.handshake.auth.sessionId;
      const userId = socket.handshake.auth.userId;
      
      if (!sessionId) {
        return next(new Error('Session ID required'));
      }
      
      socket.sessionId = sessionId;
      socket.userId = userId;
      next();
    });
    
    this.io.on('connection', (socket) => {
      logger.info('Client connected', { 
        socketId: socket.id, 
        sessionId: socket.sessionId,
        userId: socket.userId 
      });
      
      // Join session room
      socket.join(socket.sessionId);
      
      // Handle document join
      socket.on('document:join', ({ documentId }) => {
        socket.join(documentId);
        this.handleDocumentJoin(socket, documentId);
      });
      
      // Handle operational transformation / CRDT operations
      socket.on('operation:transform', (data) => {
        this.broadcastOperation(socket.sessionId, socket.userId, data);
      });
      
      // Handle cursor position updates
      socket.on('cursor:update', (data) => {
        socket.to(socket.sessionId).emit('cursor:update', {
          userId: socket.userId,
          ...data,
        });
      });
      
      // Handle chat messages in session
      socket.on('session:message', (data) => {
        this.broadcastMessage(socket.sessionId, {
          userId: socket.userId,
          timestamp: Date.now(),
          ...data,
        });
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }
  
  /**
   * Create a new collaboration session
   */
  createSession(userId, options = {}) {
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      ownerId: userId,
      createdAt: Date.now(),
      participants: new Set([userId]),
      documents: [],
      settings: {
        allowAnonymous: false,
        maxParticipants: 10,
        ...options,
      },
    };
    
    this.sessions.set(sessionId, session);
    
    // Track user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    
    logger.info('Session created', { sessionId, userId });
    return session;
  }
  
  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  /**
   * Join an existing session
   */
  joinSession(sessionId, userId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.participants.size >= session.settings.maxParticipants) {
      throw new Error('Session is full');
    }
    
    session.participants.add(userId);
    
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    
    logger.info('User joined session', { sessionId, userId });
    return session;
  }
  
  /**
   * Leave a session
   */
  leaveSession(sessionId, userId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.participants.delete(userId);
      
      // Clean up empty sessions
      if (session.participants.size === 0 && userId === session.ownerId) {
        this.sessions.delete(sessionId);
        logger.info('Session deleted (empty)', { sessionId });
      } else {
        logger.info('User left session', { sessionId, userId });
      }
    }
  }
  
  handleDocumentJoin(socket, documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) {
      // Initialize document state
      this.documents.set(documentId, {
        id: documentId,
        content: '',
        version: 0,
        lastModified: Date.now(),
        history: [],
      });
    }
    
    // Send current document state to the joining user
    socket.emit('document:state', this.documents.get(documentId));
    
    // Notify others
    socket.to(socket.sessionId).to(documentId).emit('document:user-joined', {
      userId: socket.userId,
      documentId,
    });
    
    logger.info('User joined document', { 
      socketId: socket.id, 
      documentId,
      userId: socket.userId 
    });
  }
  
  broadcastOperation(sessionId, userId, operation) {
    this.io.to(sessionId).emit('operation:transform', {
      userId,
      timestamp: Date.now(),
      ...operation,
    });
  }
  
  broadcastMessage(sessionId, message) {
    this.io.to(sessionId).emit('session:message', message);
  }
  
  handleDisconnect(socket) {
    logger.info('Client disconnected', { 
      socketId: socket.id, 
      sessionId: socket.sessionId,
      userId: socket.userId 
    });
    
    // Notify session participants
    socket.to(socket.sessionId).emit('session:user-left', {
      userId: socket.userId,
    });
    
    // Clean up user connections
    if (socket.userId) {
      const connections = this.userConnections.get(socket.userId);
      if (connections) {
        connections.delete(socket.id);
        if (connections.size === 0) {
          this.userConnections.delete(socket.userId);
        }
      }
    }
  }
  
  /**
   * Get active sessions for a user
   */
  getUserSessions(userId) {
    const userSessions = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.participants.has(userId)) {
        userSessions.push({
          id: sessionId,
          ownerId: session.ownerId,
          createdAt: session.createdAt,
          participantCount: session.participants.size,
        });
      }
    }
    return userSessions;
  }
  
  /**
   * Get session participants
   */
  getSessionParticipants(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.participants);
  }
}

/**
 * Role-based access control for team workspaces
 */
export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
};

export const PERMISSIONS = {
  [ROLES.OWNER]: ['read', 'write', 'delete', 'manage-users', 'manage-settings'],
  [ROLES.ADMIN]: ['read', 'write', 'delete', 'manage-users'],
  [ROLES.EDITOR]: ['read', 'write'],
  [ROLES.VIEWER]: ['read'],
};

/**
 * Check if a role has a specific permission
 */
export const hasPermission = (role, permission) => {
  return PERMISSIONS[role]?.includes(permission) || false;
};

/**
 * Team workspace manager
 */
export class WorkspaceManager {
  constructor() {
    // Workspaces: Map<workspaceId, WorkspaceData>
    this.workspaces = new Map();
    
    // Memberships: Map<workspaceId, Map<userId, Role>>
    this.memberships = new Map();
  }
  
  /**
   * Create a new workspace
   */
  createWorkspace(ownerId, name, description = '') {
    const workspaceId = uuidv4();
    const workspace = {
      id: workspaceId,
      name,
      description,
      ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        visibility: 'private',
        allowInvites: true,
      },
    };
    
    this.workspaces.set(workspaceId, workspace);
    
    // Add owner as member with OWNER role
    if (!this.memberships.has(workspaceId)) {
      this.memberships.set(workspaceId, new Map());
    }
    this.memberships.get(workspaceId).set(ownerId, ROLES.OWNER);
    
    logger.info('Workspace created', { workspaceId, ownerId, name });
    return workspace;
  }
  
  /**
   * Get workspace by ID
   */
  getWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId);
  }
  
  /**
   * Get user's role in a workspace
   */
  getUserRole(workspaceId, userId) {
    const membership = this.memberships.get(workspaceId);
    return membership?.get(userId) || null;
  }
  
  /**
   * Add member to workspace
   */
  addMember(workspaceId, userId, role = ROLES.VIEWER) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    if (!this.memberships.has(workspaceId)) {
      this.memberships.set(workspaceId, new Map());
    }
    
    this.memberships.get(workspaceId).set(userId, role);
    workspace.updatedAt = Date.now();
    
    logger.info('Member added to workspace', { workspaceId, userId, role });
    return true;
  }
  
  /**
   * Remove member from workspace
   */
  removeMember(workspaceId, userId) {
    const membership = this.memberships.get(workspaceId);
    if (membership) {
      membership.delete(userId);
      logger.info('Member removed from workspace', { workspaceId, userId });
      return true;
    }
    return false;
  }
  
  /**
   * Update member role
   */
  updateMemberRole(workspaceId, userId, newRole, actorUserId) {
    const actorRole = this.getUserRole(workspaceId, actorUserId);
    if (!actorRole || !hasPermission(actorRole, 'manage-users')) {
      throw new Error('Insufficient permissions');
    }
    
    const membership = this.memberships.get(workspaceId);
    if (membership && membership.has(userId)) {
      membership.set(userId, newRole);
      logger.info('Member role updated', { workspaceId, userId, newRole });
      return true;
    }
    return false;
  }
  
  /**
   * Get all members of a workspace
   */
  getWorkspaceMembers(workspaceId) {
    const membership = this.memberships.get(workspaceId);
    if (!membership) return [];
    
    return Array.from(membership.entries()).map(([userId, role]) => ({
      userId,
      role,
    }));
  }
  
  /**
   * Get all workspaces for a user
   */
  getUserWorkspaces(userId) {
    const workspaces = [];
    for (const [workspaceId, membership] of this.memberships.entries()) {
      if (membership.has(userId)) {
        const workspace = this.workspaces.get(workspaceId);
        if (workspace) {
          workspaces.push({
            ...workspace,
            role: membership.get(userId),
          });
        }
      }
    }
    return workspaces;
  }
}
