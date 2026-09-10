import { Global, Module } from '@nestjs/common';
import { UserModel } from './models/user.model';

@Global()
@Module({
  providers: [UserModel],
  exports: [UserModel],
})
export class DbModule {}
