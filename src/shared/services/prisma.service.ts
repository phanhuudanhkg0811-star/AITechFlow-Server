/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import envConfig from '../config';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const connectionString = envConfig.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable must be set');
    }

    // use postgresql adapter
    const adapter = new PrismaPg({
      connectionString,
    });
    super({ adapter, log: ['info', 'warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
