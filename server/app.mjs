// Deployment entry: managed hosts may import this file through their own loader.
// Always start here; app construction stays in application.mjs for tests/reuse.
import { startServer } from './application.mjs';
export { app, startServer } from './application.mjs';

startServer();
