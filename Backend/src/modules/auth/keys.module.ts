import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthKeys } from './keys';

// Split out from AuthModule so JwtModule.registerAsync (also declared in
// AuthModule) can import this and inject AuthKeys — a module's own async
// `imports` factories can only see providers reached via `imports`, not
// providers declared in the enclosing module's own `providers` array.
@Module({
  imports: [ConfigModule],
  providers: [AuthKeys],
  exports: [AuthKeys],
})
export class KeysModule {}
