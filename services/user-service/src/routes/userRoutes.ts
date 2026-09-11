import { Router } from 'express';
import { UserController } from '../controllers/userController';

export function createUserRoutes(userController: UserController): Router {
  const router = Router();

  // Auth routes
  router.post('/auth/register', userController.register);
  router.post('/auth/login', userController.login);

  // User profile routes
  router.get('/users/me', userController.getProfile);
  router.get('/users/:id', userController.getProfile);
  router.put('/users/profile', userController.updateProfile);
  router.post('/users/change-password', userController.changePassword);
  router.delete('/users/me', userController.deleteAccount);

  return router;
}
