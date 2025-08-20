// src/lib/socket.ts
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('http://localhost:9000');

export default socket;
