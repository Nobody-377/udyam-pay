import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../common/response';
import type { AuthService } from './auth.service';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  legalName: z.string().min(2),
  tradeName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    const body = registerSchema.parse(req.body);
    const result = await authService.registerMerchantOwner(body);
    sendSuccess(
      res,
      {
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        merchantId: result.merchantId,
      },
      { status: 201 },
    );
  });

  router.post('/login', async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const result = await authService.login({
      email: body.email,
      password: body.password,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    sendSuccess(res, {
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        merchantId: result.user.merchantId,
      },
      tokens: result.tokens,
    });
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const body = refreshSchema.parse(req.body);
    const tokens = await authService.refreshTokens(
      body.refreshToken,
      req.headers['user-agent'] as string | undefined,
    );
    sendSuccess(res, { tokens });
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const body = refreshSchema.safeParse(req.body);
    if (body.success) {
      await authService.logout(body.data.refreshToken);
    }
    sendSuccess(res, { message: 'Logged out successfully' });
  });

  router.get('/me', (req: Request, res: Response) => {
    sendSuccess(res, { user: req.user });
  });

  return router;
}

