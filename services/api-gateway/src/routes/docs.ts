import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import fs from 'fs';

export function createDocsRoutes(): Router {
  const router = Router();

  const openApiPath = path.resolve(__dirname, '../../../../docs/openapi.yaml');
  let swaggerDocument: any;

  if (fs.existsSync(openApiPath)) {
    swaggerDocument = YAML.load(openApiPath);
  } else {
    // Fallback minimal swagger doc if yaml is relocated
    swaggerDocument = {
      openapi: '3.0.0',
      info: {
        title: 'Microservices API Gateway',
        version: '1.0.0',
        description: 'Interactive API Documentation for User Service, Notification Service, and API Gateway',
      },
      paths: {},
    };
  }

  router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customSiteTitle: 'Microservices API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
  }));

  router.get('/openapi.json', (_req, res) => {
    res.json(swaggerDocument);
  });

  return router;
}
