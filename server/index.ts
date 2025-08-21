import * as http from 'http';
import express from 'express';
import { promises as fs } from 'fs';
import { Server as SocketServer } from 'socket.io';
import * as path from 'path';
import cors from 'cors';
import chokidar from 'chokidar';
import { ContainerService } from './src/services/ContainerService.js';
import { randomBytes } from 'crypto';
import Docker from 'dockerode';

const containerService = new ContainerService();

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let refreshTimeout: NodeJS.Timeout | undefined;

chokidar.watch('./user').on('all', (event: string, thePath: string) => {
  clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => {
    io.emit('file:refresh', thePath);
  }, 100);
});

function generateCleanUserId(): string {
  return 'user' + Date.now().toString() + randomBytes(3).toString('hex');
}

const socketUserMap = new Map<string, string>();
const userSocketMap = new Map<string, string>();

io.on('connection', (socket) => {
  const userId: string = generateCleanUserId();
  socketUserMap.set(socket.id, userId);
  userSocketMap.set(userId, socket.id);
  
  console.log('=== NEW CONNECTION ===');
  console.log(`SocketId: ${socket.id}`);
  console.log(`UserId: ${userId}`);

  let containerReady: boolean = false;

  containerService.createUserSession(userId)
    .then(() => {
      containerReady = true;
      socket.emit('terminal:ready');
      console.log(`Container ready for user: ${userId}`);
      
      const shell = containerService.dockerManager.getUserShellStream(userId);
      if (shell) {
        shell.on('data', (chunk: Buffer) => {
          socket.emit('terminal:data', chunk.toString());
        });
      }
    })
    .catch((error: Error) => {
      console.error(`Failed to create user session for ${userId}:`, error);
    });

  socket.emit('file:refresh');

  socket.on('file:change', async ({ path, content }: { path: string; content: string }) => {
    console.log(`📁 [DEBUG] file:change START - User: ${userId}, Path: ${path}, Content length: ${content ? content.length : 0}`);
    
    // Fix incomplete file extensions
    let fixedPath = path;
    if (path.endsWith('.j') && !path.endsWith('.js') && !path.endsWith('.json')) {
      console.log(`🔧 [DEBUG] Fixing incomplete extension: ${path} -> ${path}s`);
      fixedPath = path + 's'; // Convert .j to .js
    }
    
    try {
      // Save the file
      await containerService.handleFileChange(userId, fixedPath, content);
      console.log(`✅ [DEBUG] file:change - File saved successfully`);
      
      // Clean up any duplicate or incomplete files
      await containerService.dockerManager.cleanupDuplicateFiles(userId);
      console.log(`🧹 [DEBUG] file:change - Cleaned up duplicates`);
      
      // FORCE IMMEDIATE FILE SYSTEM SYNC
      try {
        const container = containerService.dockerManager.getContainer(userId);
        if (container) {
          // First sync
          const syncExec = await container.exec({
            Cmd: ['sync'],
            AttachStdout: false,
            AttachStderr: false,
            Tty: false
          });
          await syncExec.start({ hijack: false });
          
          // Wait and sync again
          await new Promise(resolve => setTimeout(resolve, 50));
          
          const syncExec2 = await container.exec({
            Cmd: ['sync'],
            AttachStdout: false,
            AttachStderr: false,
            Tty: false
          });
          await syncExec2.start({ hijack: false });
          
          console.log(`🔄 [DEBUG] file:change - Double sync completed`);
        }
      } catch (syncError) {
        console.warn('Sync failed:', syncError);
      }
      
      // Wait then emit refresh
      setTimeout(() => {
        socket.emit('file:refresh');
        console.log(`🔄 [DEBUG] file:change - Refresh emitted`);
      }, 100);
      
    } catch (error) {
      console.error(`❌ [ERROR] file:change failed:`, error);
      socket.emit('file:error', { 
        path: fixedPath, 
        error: (error as Error).message 
      });
    }
    
    console.log(`🎯 [DEBUG] file:change COMPLETE - User: ${userId}`);
  });

  socket.on('terminal:data', async (data: string) => {
    if (!containerReady) return;
    await containerService.sendTerminalData(userId, data);
  });

  socket.on('terminal:write', async (data: string) => {
    if (!containerReady) {
      socket.emit('terminal:data', 'Container not ready yet, please wait...\r\n$ ');
      return;
    }
    await containerService.sendTerminalData(userId, data + '\n');
  });

  socket.on('terminal:paste', async (text: string) => {
    if (!containerReady) return;
    await containerService.sendTerminalData(userId, text);
  });

  // MANUAL SAVE HANDLER
  socket.on('file:save', async ({ path, content }: { path: string; content: string }) => {
    console.log(`💾 [DEBUG] Manual save requested - User: ${userId}, Path: ${path}`);
    
    // Fix file extension if needed
    let fixedPath = path;
    if (path.endsWith('.j') && !path.endsWith('.js') && !path.endsWith('.json')) {
      fixedPath = path + 's';
    }
    
    try {
      await containerService.handleFileChange(userId, fixedPath, content);
      console.log(`✅ [DEBUG] Manual save completed`);
      
      // Clean duplicates
      await containerService.dockerManager.cleanupDuplicateFiles(userId);
      
      // Force sync
      const container = containerService.dockerManager.getContainer(userId);
      if (container) {
        const syncExec = await container.exec({
          Cmd: ['sync'],
          AttachStdout: false,
          AttachStderr: false,
          Tty: false
        });
        await syncExec.start({ hijack: false });
      }
      
      socket.emit('file:saved', { path: fixedPath, success: true });
      socket.emit('file:refresh');
      
    } catch (error) {
      console.error(`❌ [ERROR] Manual save failed:`, error);
      socket.emit('file:saved', { path: fixedPath, success: false, error: (error as Error).message });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`=== DISCONNECTION ===`);
    console.log(`SocketId: ${socket.id}, UserId: ${userId}`);
    socketUserMap.delete(socket.id);
    userSocketMap.delete(userId);
    await containerService.cleanupUserSession(userId);
  });
});

function toTree(items: string[]): Record<string, any> {
  const tree: Record<string, any> = {};
  const uniqueItems: string[] = Array.from(new Set(items));
  
  console.log(`🌳 [DEBUG] toTree input items:`, uniqueItems);

  for (const item of uniqueItems) {
    if (!item) continue;
    
    const [name, type] = item.split('|');
    if (!name || !type) continue;

    // REMOVED AGGRESSIVE FILTERING - Let all valid files through
    console.log(`➕ [DEBUG] Adding to tree: ${name} (${type})`);
    tree[name] = type === 'd' ? {} : null;
  }
  
  console.log(`🌳 [DEBUG] Final tree structure:`, tree);
  return tree;
}

app.get('/files', async (req, res) => {
  const socketId: string = req.query.userId as string;
  const userId: string | undefined = socketUserMap.get(socketId);
  
  console.log('=== GET /files ===');
  console.log('SocketId:', socketId);
  console.log('UserId:', userId);
  
  if (!userId) return res.status(400).json({ error: 'User session not found' });
  
  try {
    // Clean up duplicates before listing
    await containerService.dockerManager.cleanupDuplicateFiles(userId);
    
    const items: string[] = await containerService.getFiles(userId);
    const tree: Record<string, any> = toTree(items);
    console.log('File tree items:', items);
    console.log('Converted tree:', tree);
    
    // ADD CACHE HEADERS TO PREVENT CACHING
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.json({ tree });
  } catch (error: unknown) {
    console.error('Error in /files:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/files/content', async (req, res) => {
  console.log('=== GET /files/content ===');
  console.log('Query params:', req.query);
  
  try {
    const socketId: string = req.query.userId as string;
    const rawPath: string = req.query.path as string;
    
    console.log(`📖 [DEBUG] File content request - socketId: ${socketId}, rawPath: ${rawPath}`);
    
    if (!socketId || !rawPath) {
      console.error('❌ [ERROR] Missing parameters');
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const userId: string | undefined = socketUserMap.get(socketId);
    if (!userId) {
      console.error('❌ [ERROR] User session not found');
      return res.status(400).json({ error: 'User session not found' });
    }
    
    let decodedPath: string = '';
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch (decodeError) {
      console.error('❌ [ERROR] URI decode failed:', decodeError);
      return res.status(400).json({ error: 'Invalid URI encoding' });
    }
    
    // Clean path but preserve file structure
    decodedPath = decodedPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    decodedPath = decodedPath.replace(/^\/+/, '');
    
    // **ADDED: Fix truncated extension for file loading**
    if (decodedPath.endsWith('.j') && !decodedPath.endsWith('.js') && !decodedPath.endsWith('.json')) {
      console.log(`🔧 [DEBUG] Fixing incomplete extension for reading: ${decodedPath} -> ${decodedPath}s`);
      decodedPath = decodedPath + 's';
    }
    
    if (!decodedPath || decodedPath.length === 0) {
      console.error('❌ [ERROR] Invalid file path');
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    console.log(`📖 [DEBUG] Reading file content for: ${decodedPath}`);
    
    try {
      const content: string = await containerService.readFileFromContainer(userId, decodedPath);
      
      console.log(`📖 [DEBUG] File content read successfully, length: ${content.length}`);
      
      // Set proper headers
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Type': 'application/json'
      });
      
      res.json({ content });
      
    } catch (fileError) {
      console.error(`❌ [ERROR] File read failed for ${decodedPath}:`, fileError);
      res.status(404).json({ error: `File not found: ${decodedPath}` });
    }
    
  } catch (error: unknown) {
    console.error('=== ERROR IN FILE CONTENT ===');
    console.error('Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/files/create', async (req, res) => {
  console.log('========================================');
  console.log('=== POST /files/create ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('========================================');
  
  try {
    const socketId: string = req.body.userId;
    let requestPath: string = req.body.path;
    const requestType: string = req.body.type;
    const requestContent: string = req.body.content;
    const parentPath: string = req.body.parentPath || '';
    
    // Fix file extension if incomplete
    if (requestType === 'file' && requestPath.endsWith('.j') && !requestPath.endsWith('.js') && !requestPath.endsWith('.json')) {
      requestPath = requestPath + 's';
      console.log(`🔧 [DEBUG] Fixed file extension: ${req.body.path} -> ${requestPath}`);
    }
    
    console.log('🔍 PARSED VALUES:');
    console.log('  - socketId:', socketId);
    console.log('  - requestPath (fixed):', `"${requestPath}"`);
    console.log('  - requestType:', requestType);
    console.log('  - parentPath:', `"${parentPath}"`);
    console.log('  - requestContent:', requestContent ? 'has content' : 'empty');
    
    const userId: string | undefined = socketUserMap.get(socketId);
    console.log('  - mapped userId:', userId);
    
    if (!userId) {
      console.error('❌ User session not found for socketId:', socketId);
      return res.status(400).json({ error: 'User session not found' });
    }
    
    let fullPath: string = requestPath;
    if (parentPath && parentPath.trim() !== '') {
      const cleanParentPath = parentPath.replace(/^\/+|\/+$/g, '');
      const cleanRequestPath = requestPath.replace(/^\/+|\/+$/g, '');
      fullPath = cleanParentPath ? `${cleanParentPath}/${cleanRequestPath}` : cleanRequestPath;
      
      console.log('🛠️  PATH CONSTRUCTION:');
      console.log('    - Final fullPath:', `"${fullPath}"`);
    }
    
    console.log('📁 CREATING:', `${requestType.toUpperCase()} at path: "${fullPath}"`);
    
    if (requestType === 'file' || requestType === 'directory') {
      if (requestType === 'file') {
        console.log('📄 Creating FILE...');
        
        // Clean content before creating file
        let cleanContent = requestContent || '';
        cleanContent = cleanContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        cleanContent = cleanContent.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
        console.log('🧹 Cleaned content length:', cleanContent.length);
        
        await containerService.handleFileChange(userId, fullPath, cleanContent);
        console.log('✅ File created successfully');
      } else {
        console.log('📂 Creating DIRECTORY...');
        await containerService.dockerManager.createDirectory(userId, fullPath);
        console.log('✅ Directory created successfully');
      }
      
      // Clean up duplicates
      await containerService.dockerManager.cleanupDuplicateFiles(userId);
      
      // FORCE REFRESH AFTER CREATION
      const socketToEmit = userSocketMap.get(userId);
      if (socketToEmit) {
        const socket = io.sockets.sockets.get(socketToEmit);
        if (socket) {
          socket.emit('file:refresh');
        }
      }
      
      console.log('🎉 SUCCESS! Created:', `"${fullPath}"`);
      res.json({ success: true, path: fullPath, type: requestType });
    } else {
      console.error('❌ Invalid type:', requestType);
      res.status(400).json({ error: 'Invalid type. Must be "file" or "directory"' });
    }
  } catch (error: unknown) {
    console.error('💥 ERROR in file creation:', error);
    res.status(500).json({ error: (error as Error).message });
  }
  
  console.log('========================================');
});

app.post('/files/rename', async (req, res) => {
  console.log('=== POST /files/rename ===');
  console.log('Request body:', req.body);
  
  try {
    const socketId: string = req.body.userId;
    const oldPath: string = req.body.oldPath;
    const newPath: string = req.body.newPath;
    
    console.log('Renaming:', oldPath, '->', newPath);
    
    const userId: string | undefined = socketUserMap.get(socketId);
    if (!userId) return res.status(400).json({ error: 'User session not found' });
    
    await containerService.dockerManager.renamePath(userId, oldPath, newPath);
    console.log('✅ Rename successful');
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in rename:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/files/delete', async (req, res) => {
  console.log('=== DELETE /files/delete ===');
  console.log('Query params:', req.query);
  
  try {
    const socketId: string = req.query.userId as string;
    const path: string = req.query.path as string;
    
    console.log('Deleting path:', path);
    
    const userId: string | undefined = socketUserMap.get(socketId);
    if (!userId) return res.status(400).json({ error: 'User session not found' });
    
    await containerService.dockerManager.deletePath(userId, path);
    console.log('✅ Delete successful');
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in delete:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/files/directory', async (req, res) => {
  console.log('=== GET /files/directory ===');
  console.log('Query params:', req.query);
  
  try {
    const socketId: string = req.query.userId as string;
    const directoryPath: string = req.query.path as string;
    
    console.log('Loading directory:', directoryPath);
    
    const userId: string | undefined = socketUserMap.get(socketId);
    if (!userId) return res.status(400).json({ error: 'User session not found' });
    
    const items: string[] = await containerService.dockerManager.listDirectory(userId, directoryPath);
    console.log('Directory items:', items);
    res.json({ items });
  } catch (error: unknown) {
    console.error('Error in directory listing:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

async function cleanupOldContainers(): Promise<void> {
  const docker = new Docker();
  
  try {
    const containers = await docker.listContainers({ all: true });
    for (const containerInfo of containers) {
      if (containerInfo.Names.some((name: string) => name.startsWith('/user-'))) {
        const container = docker.getContainer(containerInfo.Id);
        try {
          await container.stop();
          await container.remove();
        } catch (err) {
          // Silently handle errors
        }
      }
    }
  } catch (err) {
    // Silently handle errors
  }
}

containerService.initialize().then(async () => {
  await cleanupOldContainers();
  server.listen(9000, () => console.log('🐳 Docker-enabled Replit clone running on port 9000'));
}).catch((error) => {
  console.error('Failed to initialize container service:', error);
  process.exit(1);
});
