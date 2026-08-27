import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser { userId: string; openId: string; }

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): RequestUser => context.switchToHttp().getRequest().user,
);

