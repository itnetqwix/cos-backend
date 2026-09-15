import Fastify from 'fastify';
import dotenv from 'dotenv';

dotenv.config();

const server = Fastify({ logger: true });

// Simple Hello World Route
server.get('/', async (request, reply) => {
  return { message: 'Hello World from Contest Operating System API!' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 5000;
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
