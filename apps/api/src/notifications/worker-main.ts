import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationsService } from './notifications.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const notifications = app.get(NotificationsService);
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  while (!stopped) {
    await notifications.runDue();
    await new Promise(resolve => setTimeout(resolve, 30_000));
  }
  await app.close();
}

void main();
