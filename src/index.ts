import { createApp } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const { app, pool } = createApp();
const server = app.listen(port, () => console.log(`Tenant portal listening on port ${port}`));

function shutdown() {
  server.close(() => void pool.end());
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
