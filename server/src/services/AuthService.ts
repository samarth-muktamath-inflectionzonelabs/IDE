import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../database/data-source.js';
import { User } from '../entities/User.entity.js';

/**
 * WHAT THIS DOES:
 * - Handles user registration and login
 * - Hashes passwords securely with bcrypt
 * - Generates JWT tokens for authenticated sessions
 * - Validates user credentials
 * - Manages user data retrieval
 */
export class AuthService {
  private userRepository = AppDataSource.getRepository(User);

  /**
   * Register a new user
   * - Checks if username/email already exists
   * - Hashes password with bcrypt (10 salt rounds)
   * - Creates MinIO bucket name for user storage
   * - Generates JWT token for immediate login
   */
  async register(username: string, email: string, password: string): Promise<{ user: User; token: string }> {
    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ username }, { email }]
    });

    if (existingUser) {
      throw new Error('User already exists');
    }

    // Hash password securely
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user record
    const user = this.userRepository.create({
      username,
      email,
      password: hashedPassword,
      minioBucket: `user-${username}` // Each user gets their own MinIO bucket
    });

    await this.userRepository.save(user);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' } // Token expires in 7 days
    );

    return { user, token };
  }

  /**
   * Login existing user
   * - Accepts username or email
   * - Verifies password with bcrypt
   * - Generates new JWT token
   */
  async login(usernameOrEmail: string, password: string): Promise<{ user: User; token: string }> {
    const user = await this.userRepository.findOne({
      where: [
        { username: usernameOrEmail },
        { email: usernameOrEmail }
      ]
    });

    if (!user || !await bcrypt.compare(password, user.password)) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return { user, token };
  }

  /**
   * Get user by ID with their projects
   */
  async getUserById(userId: string): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { id: userId },
      relations: ['projects']
    });
  }

  /**
   * Verify JWT token and extract user data
   */
  verifyToken(token: string): { userId: string; username: string } {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: string; username: string };
  }
}
