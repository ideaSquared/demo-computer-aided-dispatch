import { describe, expect, it } from 'vitest';
import {
  AuthLoginFailedSchema,
  AuthLoginSuccessSchema,
  AuthLogoutSchema,
  AuthSessionRevokedSchema,
} from '../auth/schemas.js';

const envelope = {
  eventId: '5f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  occurredAt: '2026-06-02T07:42:00.000Z',
  idempotencyKey: 'auth:login:abc',
};
const operatorId = '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d';
const sessionId = '3e2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d';

describe('AuthLoginSuccessSchema', () => {
  it('accepts a well-formed success event', () => {
    expect(() =>
      AuthLoginSuccessSchema.parse({
        ...envelope,
        operatorId,
        email: 'op@cad.local',
        sessionId,
        tier: 'police',
        roles: ['dispatcher'],
      }),
    ).not.toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      AuthLoginSuccessSchema.parse({
        ...envelope,
        operatorId,
        email: 'op@cad.local',
        sessionId,
        tier: 'cyber',
        roles: ['dispatcher'],
      }),
    ).toThrow();
  });
});

describe('AuthLoginFailedSchema', () => {
  it('accepts unknown_email without operatorId', () => {
    expect(() =>
      AuthLoginFailedSchema.parse({
        ...envelope,
        email: 'ghost@cad.local',
        reason: 'unknown_email',
      }),
    ).not.toThrow();
  });

  it('accepts bad_password with operatorId', () => {
    expect(() =>
      AuthLoginFailedSchema.parse({
        ...envelope,
        email: 'op@cad.local',
        operatorId,
        reason: 'bad_password',
      }),
    ).not.toThrow();
  });

  it('rejects a free-form reason', () => {
    expect(() =>
      AuthLoginFailedSchema.parse({ ...envelope, email: 'x', reason: 'because' }),
    ).toThrow();
  });
});

describe('AuthLogoutSchema / AuthSessionRevokedSchema', () => {
  it('accepts a logout event', () => {
    expect(() => AuthLogoutSchema.parse({ ...envelope, operatorId, sessionId })).not.toThrow();
  });

  it('accepts a session-revoked event with attribution', () => {
    expect(() =>
      AuthSessionRevokedSchema.parse({
        ...envelope,
        operatorId,
        sessionId,
        revokedBy: 'sup-1',
        reason: 'manual',
      }),
    ).not.toThrow();
  });

  it('rejects sessionRevoked without revokedBy', () => {
    expect(() => AuthSessionRevokedSchema.parse({ ...envelope, operatorId, sessionId })).toThrow();
  });
});
