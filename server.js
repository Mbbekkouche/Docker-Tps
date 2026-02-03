const express = require('express');
const redis = require('redis');
const app = express();
const PORT = 8080;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Redis client configuration (REDIS_URL pour Render, sinon défaut docker-compose)
const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'redis-db'}:6379`;
const redisClient = redis.createClient({
  url: redisUrl
});

// Redis connection handling
redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis database');
});

// Connect to Redis
(async () => {
  await redisClient.connect();
})();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'ok', message: 'Server and Redis are running', redis: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Redis connection failed', redis: 'disconnected' });
  }
});

// Get all survey responses
app.get('/api/responses', async (req, res) => {
  try {
    console.log('📊 Fetching all responses from Redis...');
    const keys = await redisClient.keys('response:*');
    
    if (keys.length === 0) {
      return res.json({ total: 0, responses: [] });
    }

    const responses = [];
    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        responses.push(JSON.parse(data));
      }
    }

    // Sort by timestamp (newest first)
    responses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      total: responses.length,
      responses
    });
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({ error: 'Failed to fetch responses' });
  }
});

// Submit a new survey response
app.post('/api/submit', async (req, res) => {
  const { name, rating, comment } = req.body;

  if (!name || !rating) {
    return res.status(400).json({ error: 'Name and rating are required' });
  }

  const response = {
    id: Date.now(),
    name,
    rating: parseInt(rating),
    comment: comment || '',
    timestamp: new Date().toISOString()
  };

  try {
    // Store in Redis with key pattern: response:{id}
    await redisClient.set(
      `response:${response.id}`,
      JSON.stringify(response)
    );

    console.log('✅ New survey response saved to Redis:');
    console.log(`   Name: ${name}`);
    console.log(`   Rating: ${rating}/5`);
    console.log(`   Comment: ${comment || 'No comment'}`);
    console.log('---');

    res.json({
      success: true,
      message: 'Survey response recorded in Redis',
      response
    });
  } catch (error) {
    console.error('Error saving response:', error);
    res.status(500).json({ error: 'Failed to save response' });
  }
});

// Get survey statistics
app.get('/api/stats', async (req, res) => {
  try {
    const keys = await redisClient.keys('response:*');

    if (keys.length === 0) {
      return res.json({
        total: 0,
        averageRating: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      });
    }

    const responses = [];
    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        responses.push(JSON.parse(data));
      }
    }

    const totalRating = responses.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = (totalRating / responses.length).toFixed(2);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    responses.forEach(r => {
      distribution[r.rating]++;
    });

    res.json({
      total: responses.length,
      averageRating: parseFloat(averageRating),
      distribution
    });
  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({ error: 'Failed to calculate statistics' });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await redisClient.quit();
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log('🚀 Course Satisfaction Survey Application');
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log('💾 Using Redis for persistent storage');
  console.log('---');
});
