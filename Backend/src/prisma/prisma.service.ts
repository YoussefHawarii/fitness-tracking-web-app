import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { connectWithRetry } from './connect-with-retry';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await connectWithRetry(() => this.$connect());
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
