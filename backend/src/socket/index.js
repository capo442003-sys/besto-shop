import jwt from 'jsonwebtoken';
import config from '../config/index.js';

let io = null;

function extractToken(socket) {
  const auth = socket.handshake.auth?.token;
  if (auth) return auth;
  const q = socket.handshake.query?.token;
  if (typeof q === 'string') return q;
  return null;
}

export function initSocket(socketServer) {
  io = socketServer;

  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      if (config.nodeEnv !== 'production') {
        socket.user = { id: null, username: 'dev-anonymous' };
        return next();
      }
      return next(new Error('Authentification socket requise'));
    }
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      socket.user = payload;
      if (!socket.user.roles) socket.user.roles = [socket.user.role];
      next();
    } catch {
      return next(new Error('Session socket expirée ou invalide'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('bmb-store');
    if (config.nodeEnv !== 'production') {
      console.log(`Socket connecté: ${socket.id} (${socket.user?.username || '?'})`);
    }
  });
  return io;
}

export function getIO() {
  return io;
}

export function emitEvent(event, data) {
  if (io) io.to('bmb-store').emit(event, data);
}

export const EVENTS = {
  CART_UPDATED: 'cart:updated',
  CART_VALIDATED: 'cart:validated',
  CLIENT_UPDATED: 'client:updated',
  STOCK_UPDATED: 'stock:updated',
  DASHBOARD_REFRESH: 'dashboard:refresh',
  PRODUCT_UPDATED: 'product:updated',
  CASH_CLOSED: 'cash:closed',
};
