import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../utils/authStorage';
import { getSocketOrigin } from '../config/api';

let socket = null;

function connectSocket() {
  const token = getToken();
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket = io(getSocketOrigin(), {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    autoConnect: !!token,
  });
  return socket;
}

export function useSocket(onEvent) {
  const handlers = useRef(onEvent);
  handlers.current = onEvent;

  useEffect(() => {
    if (!getToken()) return undefined;
    const s = connectSocket();
    if (!s) return undefined;
    const handler = (event, data) => handlers.current?.(event, data);
    const events = ['cart:updated', 'cart:validated', 'stock:updated', 'dashboard:refresh', 'client:updated', 'cash:closed'];
    events.forEach((e) => s.on(e, (data) => handler(e, data)));
    return () => events.forEach((e) => s.off(e));
  }, []);
}

export function getSocket() {
  return socket;
}
