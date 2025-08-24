import { DataSource } from 'typeorm';
import { User } from '../entities/User.entity.js';
import { Project } from '../entities/Project.entity.js';
import { ProjectFile } from '../entities/ProjectFile.entity.js';

/**
 * WHAT THIS DOES:
 * - Creates PostgreSQL database connection
 * - Configures TypeORM to automatically create tables from entity classes
 * - Sets up connection pooling and error handling
 * - Uses environment variables for secure configuration
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'playground_db',
  synchronize: true, // Auto-create tables (development only)
  logging: false,
  entities: [User, Project, ProjectFile],
  migrations: ['src/migrations/*.ts'],
});
