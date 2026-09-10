import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

// Minimal fake UserModel that forwards to the same fake `prisma.user` /
// `prisma.userBaseline` mocks buildService() below already defines — keeps
// every existing prisma.user.* expectation in this file working unchanged.
type Mock = jest.Mock<unknown, any[]>;
function fakeUserModel(prisma: {
  user: { findUnique: Mock; update: Mock };
  userBaseline?: { findUnique?: Mock; upsert?: Mock; update?: Mock };
}) {
  return {
    findById: (id: string) => prisma.user.findUnique({ where: { id } }),
    findByIdOrThrow: async (id: string) => {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('User not found.');
      return user;
    },
    findByEmail: (email: string) =>
      prisma.user.findUnique({ where: { email } }),
    findByUsername: (username: string) =>
      prisma.user.findUnique({ where: { username } }),
    findByGoogleSubjectId: (googleSubjectId: string) =>
      prisma.user.findUnique({ where: { googleSubjectId } }),
    // UsersService never calls create() — only auth.service.ts does.
    create: () => {
      throw new Error('UserModel.create is not used by UsersService');
    },
    update: (id: string, data: Record<string, unknown>) =>
      prisma.user.update({ where: { id }, data }),
    findBaselineByUserId: (userId: string) =>
      prisma.userBaseline?.findUnique?.({ where: { userId } }),
    findBaselineWithTimezone: (userId: string) =>
      prisma.userBaseline?.findUnique?.({
        where: { userId },
        include: { user: { select: { timezone: true } } },
      }),
    upsertBaseline: (userId: string, data: Record<string, unknown>) =>
      prisma.userBaseline?.upsert?.({
        where: { userId },
        create: { userId, ...data },
        update: data,
      }),
    updateBaseline: (userId: string, data: Record<string, unknown>) =>
      prisma.userBaseline?.update?.({ where: { userId }, data }),
  };
}

// Covers specs/008-sidebar-profile-account: display name, avatar
// upload/remove, password change/set, and Google link/unlink — the ownership
// and recompute/validation logic each guards.
function buildService(
  overrides: {
    findUniqueUser?: (args: unknown) => unknown;
    updateUser?: jest.Mock;
    verifyUpload?: jest.Mock;
    destroyAsset?: jest.Mock;
    verifyGoogleIdToken?: jest.Mock;
  } = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn(overrides.findUniqueUser ?? (() => null)),
      update: overrides.updateUser ?? jest.fn((args: unknown) => args),
    },
    refreshToken: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  };
  const cloudinaryService = {
    createUploadSignature: jest.fn(() => ({
      cloudName: 'c',
      apiKey: 'k',
      timestamp: 1,
      signature: 's',
      folder: 'avatars/u_x',
      uploadUrl: 'https://api.cloudinary.com/v1_1/c/image/upload',
    })),
    verifyUpload:
      overrides.verifyUpload ??
      jest.fn(() =>
        Promise.resolve(
          'https://res.cloudinary.com/c/image/upload/v1/avatars/u_x/default.jpg',
        ),
      ),
    destroyAsset: overrides.destroyAsset ?? jest.fn(() => Promise.resolve()),
  };
  const authService = {
    verifyGoogleIdToken:
      overrides.verifyGoogleIdToken ??
      jest.fn(() =>
        Promise.resolve({ email: 'a@example.com', subjectId: 'google-sub' }),
      ),
  };

  const service = new UsersService(
    prisma as unknown as ConstructorParameters<typeof UsersService>[0],
    fakeUserModel(prisma) as unknown as ConstructorParameters<
      typeof UsersService
    >[1],
    cloudinaryService as unknown as ConstructorParameters<
      typeof UsersService
    >[2],
    authService as unknown as ConstructorParameters<typeof UsersService>[3],
  );

  return { service, prisma, cloudinaryService, authService };
}

describe('UsersService.updateDisplayName / getAccount', () => {
  it('persists the trimmed display name and reflects it in getAccount', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => ({
        id: 'u1',
        username: 'jamie',
        email: 'jamie@example.com',
        passwordHash: 'hash',
        googleSubjectId: null,
        displayName: 'Jamie Rivera',
        avatarUrl: null,
        unitsPreference: 'KG',
        languagePreference: 'en',
        appearancePreference: null,
      }),
    });

    const result = await service.updateDisplayName('u1', {
      displayName: 'Jamie Rivera',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { displayName: 'Jamie Rivera' },
    });
    expect(result.displayName).toBe('Jamie Rivera');
    expect(result.hasPassword).toBe(true);
    expect(result.googleLinked).toBe(false);
  });
});

describe('UsersService avatar upload/remove', () => {
  it("confirmAvatarUpload persists Cloudinary's own verified URL, destroys the previous asset, and ignores whatever url the client submitted", async () => {
    const destroyAsset = jest.fn(() => Promise.resolve());
    const verifyUpload = jest.fn(() =>
      Promise.resolve(
        'https://res.cloudinary.com/c/image/upload/v1/avatars/u_u1/verified.jpg',
      ),
    );
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ avatarPublicId: 'avatars/u_u1/old' }),
      destroyAsset,
      verifyUpload,
    });

    const result = await service.confirmAvatarUpload('u1', {
      // Deliberately different from what verifyUpload resolves with — a
      // malicious or buggy client shouldn't be able to make this the
      // persisted avatarUrl.
      url: 'https://attacker.example.com/unrelated.jpg',
      publicId: 'avatars/u_u1/new',
    });

    expect(verifyUpload).toHaveBeenCalledWith('u1', 'avatars/u_u1/new');
    expect(destroyAsset).toHaveBeenCalledWith('avatars/u_u1/old');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        avatarUrl:
          'https://res.cloudinary.com/c/image/upload/v1/avatars/u_u1/verified.jpg',
        avatarPublicId: 'avatars/u_u1/new',
      },
    });
    expect(result.avatarUrl).toBe(
      'https://res.cloudinary.com/c/image/upload/v1/avatars/u_u1/verified.jpg',
    );
  });

  it('removeAvatar destroys the stored asset and clears both fields', async () => {
    const destroyAsset = jest.fn(() => Promise.resolve());
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ avatarPublicId: 'avatars/u_u1/old' }),
      destroyAsset,
    });

    const result = await service.removeAvatar('u1');

    expect(destroyAsset).toHaveBeenCalledWith('avatars/u_u1/old');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarUrl: null, avatarPublicId: null },
    });
    expect(result).toEqual({ avatarUrl: null });
  });

  it('removeAvatar is a no-op when there is nothing to remove', async () => {
    const destroyAsset = jest.fn();
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ avatarPublicId: null }),
      destroyAsset,
    });

    const result = await service.removeAvatar('u1');

    expect(destroyAsset).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result).toEqual({ avatarUrl: null });
  });
});

describe('UsersService.changePassword / setPassword', () => {
  it('changes the password when the current one matches', async () => {
    const currentHash = await bcrypt.hash('CorrectHorse123', 10);
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ passwordHash: currentHash }),
    });

    await service.changePassword('u1', {
      currentPassword: 'CorrectHorse123',
      newPassword: 'NewPassword456',
    });

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const [[args]] = prisma.user.update.mock.calls as [
      [{ where: { id: string }; data: { passwordHash: string } }],
    ];
    expect(args.where).toEqual({ id: 'u1' });
    expect(await bcrypt.compare('NewPassword456', args.data.passwordHash)).toBe(
      true,
    );
  });

  it('rejects an incorrect current password without changing anything', async () => {
    const currentHash = await bcrypt.hash('CorrectHorse123', 10);
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ passwordHash: currentHash }),
    });

    await expect(
      service.changePassword('u1', {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPassword456',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects changePassword for an account with no password set', async () => {
    const { service } = buildService({
      findUniqueUser: () => ({ passwordHash: null }),
    });

    await expect(
      service.changePassword('u1', {
        currentPassword: 'anything',
        newPassword: 'NewPassword456',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('setPassword sets an initial password when none exists', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ passwordHash: null }),
    });

    await service.setPassword('u1', { newPassword: 'NewPassword456' });

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('setPassword rejects when a password already exists', async () => {
    const { service } = buildService({
      findUniqueUser: () => ({ passwordHash: 'already-set' }),
    });

    await expect(
      service.setPassword('u1', { newPassword: 'NewPassword456' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('UsersService.linkGoogleAccount / unlinkGoogleAccount', () => {
  it('links a Google identity not already claimed by anyone', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => null, // no existing owner of that googleSubjectId
    });

    const result = await service.linkGoogleAccount('u1', 'fake-id-token');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { googleSubjectId: 'google-sub' },
    });
    expect(result).toEqual({ googleLinked: true });
  });

  it('rejects linking a Google identity already claimed by a different user', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ id: 'someone-else' }),
    });

    await expect(
      service.linkGoogleAccount('u1', 'fake-id-token'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('unlinks Google when the account still has a password', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ passwordHash: 'has-one' }),
    });

    const result = await service.unlinkGoogleAccount('u1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { googleSubjectId: null },
    });
    expect(result).toEqual({ googleLinked: false });
  });

  it('blocks unlinking Google when it is the only sign-in method', async () => {
    const { service, prisma } = buildService({
      findUniqueUser: () => ({ passwordHash: null }),
    });

    await expect(service.unlinkGoogleAccount('u1')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when the user cannot be found', async () => {
    const { service } = buildService({ findUniqueUser: () => null });

    await expect(service.unlinkGoogleAccount('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
