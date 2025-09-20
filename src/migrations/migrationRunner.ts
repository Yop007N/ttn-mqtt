import { Sequelize, QueryInterface } from 'sequelize';
import { logger } from '../utils/logger';
import { sequelize } from '../config/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Advanced Database Migration System
 * Handles schema versioning and database evolution with rollback support
 */

interface Migration {
  name: string;
  version: string;
  up: (queryInterface: QueryInterface) => Promise<void>;
  down: (queryInterface: QueryInterface) => Promise<void>;
}

interface MigrationRecord {
  id: string;
  name: string;
  version: string;
  executed_at: Date;
  checksum: string;
}

class MigrationRunner {
  private sequelize: Sequelize;
  private migrations: Migration[] = [];

  constructor(sequelizeInstance: Sequelize) {
    this.sequelize = sequelizeInstance;
  }

  // Initialize migration system
  async initialize(): Promise<void> {
    try {
      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();

      // Load migration files
      await this.loadMigrations();

      logger.info('Migration system initialized', {
        migrationsCount: this.migrations.length
      });
    } catch (error) {
      logger.error('Failed to initialize migration system:', error);
      throw error;
    }
  }

  // Create migrations tracking table
  private async createMigrationsTable(): Promise<void> {
    const queryInterface = this.sequelize.getQueryInterface();

    const tableExists = await queryInterface.showAllTables()
      .then(tables => tables.includes('schema_migrations'));

    if (!tableExists) {
      await queryInterface.createTable('schema_migrations', {
        id: {
          type: 'UUID',
          defaultValue: 'gen_random_uuid()',
          primaryKey: true,
        },
        name: {
          type: 'VARCHAR(255)',
          allowNull: false,
          unique: true,
        },
        version: {
          type: 'VARCHAR(50)',
          allowNull: false,
        },
        executed_at: {
          type: 'TIMESTAMP',
          allowNull: false,
          defaultValue: 'CURRENT_TIMESTAMP',
        },
        checksum: {
          type: 'VARCHAR(64)',
          allowNull: false,
        },
      });

      await queryInterface.addIndex('schema_migrations', ['name'], {
        unique: true,
        name: 'idx_migrations_name',
      });

      await queryInterface.addIndex('schema_migrations', ['version'], {
        name: 'idx_migrations_version',
      });

      logger.info('Schema migrations table created');
    }
  }

  // Load migration files from directory
  private async loadMigrations(): Promise<void> {
    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.ts') && file !== 'migrationRunner.ts')
      .sort();

    for (const file of files) {
      try {
        const migrationPath = path.join(migrationsDir, file);
        const migration = await import(migrationPath);

        if (migration.up && migration.down) {
          const name = file.replace('.ts', '');
          const version = this.extractVersionFromName(name);

          this.migrations.push({
            name,
            version,
            up: migration.up,
            down: migration.down,
          });

          logger.debug('Migration loaded', { name, version });
        } else {
          logger.warn('Invalid migration file (missing up/down functions)', { file });
        }
      } catch (error) {
        logger.error('Failed to load migration file:', error, { file });
      }
    }
  }

  // Extract version from migration file name
  private extractVersionFromName(name: string): string {
    const match = name.match(/^(\d+)/);
    return match ? match[1] : '0';
  }

  // Run pending migrations
  async migrate(): Promise<void> {
    try {
      logger.info('Starting database migration...');

      const executedMigrations = await this.getExecutedMigrations();
      const pendingMigrations = this.migrations.filter(
        migration => !executedMigrations.some(executed => executed.name === migration.name)
      );

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations');
        return;
      }

      logger.info('Pending migrations found', {
        count: pendingMigrations.length,
        migrations: pendingMigrations.map(m => m.name)
      });

      // Execute migrations in transaction
      await this.sequelize.transaction(async (transaction) => {
        for (const migration of pendingMigrations) {
          await this.executeMigration(migration, transaction);
        }
      });

      logger.info('Database migration completed successfully', {
        executedCount: pendingMigrations.length
      });

    } catch (error) {
      logger.error('Database migration failed:', error);
      throw error;
    }
  }

  // Execute a single migration
  private async executeMigration(migration: Migration, transaction?: any): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('Executing migration', { name: migration.name });

      const queryInterface = this.sequelize.getQueryInterface();

      // Execute migration
      await migration.up(queryInterface);

      // Record migration execution
      const checksum = this.calculateChecksum(migration);
      await this.recordMigration(migration, checksum, transaction);

      const duration = Date.now() - startTime;
      logger.info('Migration executed successfully', {
        name: migration.name,
        duration: `${duration}ms`
      });

    } catch (error) {
      logger.error('Migration execution failed:', error, {
        name: migration.name
      });
      throw error;
    }
  }

  // Rollback migrations
  async rollback(steps: number = 1): Promise<void> {
    try {
      logger.info('Starting migration rollback', { steps });

      const executedMigrations = await this.getExecutedMigrations();
      const migrationsToRollback = executedMigrations
        .slice(-steps)
        .reverse();

      if (migrationsToRollback.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }

      // Execute rollbacks in transaction
      await this.sequelize.transaction(async (transaction) => {
        for (const migrationRecord of migrationsToRollback) {
          await this.rollbackMigration(migrationRecord, transaction);
        }
      });

      logger.info('Migration rollback completed successfully', {
        rolledBackCount: migrationsToRollback.length
      });

    } catch (error) {
      logger.error('Migration rollback failed:', error);
      throw error;
    }
  }

  // Rollback a single migration
  private async rollbackMigration(migrationRecord: MigrationRecord, transaction?: any): Promise<void> {
    const migration = this.migrations.find(m => m.name === migrationRecord.name);

    if (!migration) {
      throw new Error(`Migration not found: ${migrationRecord.name}`);
    }

    try {
      logger.info('Rolling back migration', { name: migration.name });

      const queryInterface = this.sequelize.getQueryInterface();

      // Execute rollback
      await migration.down(queryInterface);

      // Remove migration record
      await this.removeMigrationRecord(migrationRecord.name, transaction);

      logger.info('Migration rolled back successfully', { name: migration.name });

    } catch (error) {
      logger.error('Migration rollback failed:', error, {
        name: migration.name
      });
      throw error;
    }
  }

  // Get list of executed migrations
  private async getExecutedMigrations(): Promise<MigrationRecord[]> {
    const [results] = await this.sequelize.query(`
      SELECT id, name, version, executed_at, checksum
      FROM schema_migrations
      ORDER BY executed_at ASC
    `);

    return results as MigrationRecord[];
  }

  // Record migration execution
  private async recordMigration(migration: Migration, checksum: string, transaction?: any): Promise<void> {
    await this.sequelize.query(`
      INSERT INTO schema_migrations (name, version, checksum)
      VALUES (:name, :version, :checksum)
    `, {
      replacements: {
        name: migration.name,
        version: migration.version,
        checksum
      },
      transaction
    });
  }

  // Remove migration record
  private async removeMigrationRecord(name: string, transaction?: any): Promise<void> {
    await this.sequelize.query(`
      DELETE FROM schema_migrations WHERE name = :name
    `, {
      replacements: { name },
      transaction
    });
  }

  // Calculate migration checksum
  private calculateChecksum(migration: Migration): string {
    const crypto = require('crypto');
    const content = migration.up.toString() + migration.down.toString();
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Get migration status
  async getStatus(): Promise<any> {
    const executedMigrations = await this.getExecutedMigrations();
    const pendingMigrations = this.migrations.filter(
      migration => !executedMigrations.some(executed => executed.name === migration.name)
    );

    return {
      totalMigrations: this.migrations.length,
      executedMigrations: executedMigrations.length,
      pendingMigrations: pendingMigrations.length,
      lastExecuted: executedMigrations.length > 0
        ? executedMigrations[executedMigrations.length - 1]
        : null,
      pending: pendingMigrations.map(m => ({
        name: m.name,
        version: m.version
      }))
    };
  }

  // Validate migration integrity
  async validateIntegrity(): Promise<boolean> {
    try {
      const executedMigrations = await this.getExecutedMigrations();

      for (const executedMigration of executedMigrations) {
        const migration = this.migrations.find(m => m.name === executedMigration.name);

        if (!migration) {
          logger.error('Executed migration not found in files', {
            name: executedMigration.name
          });
          return false;
        }

        const currentChecksum = this.calculateChecksum(migration);
        if (currentChecksum !== executedMigration.checksum) {
          logger.error('Migration checksum mismatch', {
            name: migration.name,
            expectedChecksum: executedMigration.checksum,
            actualChecksum: currentChecksum
          });
          return false;
        }
      }

      logger.info('Migration integrity validation passed');
      return true;

    } catch (error) {
      logger.error('Migration integrity validation failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const migrationRunner = new MigrationRunner(sequelize);

// CLI interface for migrations
export const runMigrations = async (): Promise<void> => {
  await migrationRunner.initialize();
  await migrationRunner.migrate();
};

export const rollbackMigrations = async (steps: number = 1): Promise<void> => {
  await migrationRunner.initialize();
  await migrationRunner.rollback(steps);
};

export const getMigrationStatus = async (): Promise<any> => {
  await migrationRunner.initialize();
  return await migrationRunner.getStatus();
};

export default migrationRunner;