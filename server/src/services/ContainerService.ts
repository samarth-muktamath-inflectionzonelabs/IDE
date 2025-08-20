import { DockerManager } from '../Docker/DockerManager.js';
import { Readable } from 'stream';

export class ContainerService {
  public dockerManager: DockerManager = new DockerManager();

  async initialize(): Promise<void> {
    await this.dockerManager.buildUserImage();
  }

  async createUserSession(userId: string): Promise<void> {
    await this.dockerManager.createUserContainer(userId);
  }

  async handleFileChange(userId: string, filePath: string, content: string): Promise<void> {
    console.log(`🔧 [DEBUG] ContainerService.handleFileChange START - User: ${userId}, File: ${filePath}, Content length: ${content.length}`);
    
    try {
      await this.dockerManager.writeFileToContainer(userId, filePath, content);
      console.log(`✅ [DEBUG] ContainerService.handleFileChange - Successfully wrote file for user: ${userId}, path: ${filePath}`);
    } catch (error) {
      console.error(`❌ [ERROR] ContainerService.handleFileChange - Failed to write file for user: ${userId}, path: ${filePath}`, error);
      throw error;
    }
    
    console.log(`🎯 [DEBUG] ContainerService.handleFileChange COMPLETE - User: ${userId}, File: ${filePath}`);
  }

  async handleTerminalCommand(userId: string, command: string, callback: (data: string) => void): Promise<void> {
    try {
      const stream = await this.dockerManager.executeCommand(userId, command);
      if (!stream) {
        callback('No active container found');
        return;
      }
      stream.on('data', (chunk: Buffer) => {
        callback(chunk.toString());
      });
      stream.on('error', (error: Error) => {
        callback(`Stream error: ${error.message}`);
      });
    } catch (err: unknown) {
      callback(`Error: ${(err as Error).message}\n`);
    }
  }

  async sendTerminalData(userId: string, data: string): Promise<void> {
    await this.dockerManager.sendToShell(userId, data);
  }

  public async executeCommand(userId: string, command: string): Promise<Readable | null> {
    return this.dockerManager.executeCommand(userId, command);
  }

  async getFiles(userId: string): Promise<string[]> {
    return await this.dockerManager.listFiles(userId);
  }

  async readFileFromContainer(userId: string, filePath: string): Promise<string> {
    return await this.dockerManager.readFileFromContainer(userId, filePath);
  }

  async cleanupUserSession(userId: string): Promise<void> {
    await this.dockerManager.cleanupContainer(userId);
  }
}
