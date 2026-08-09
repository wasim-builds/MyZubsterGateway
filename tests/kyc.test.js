const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

const MOCK_DB = 'mongodb://localhost:27017/kyc_test';

describe('KYC Routes', () => {
  beforeAll(async () => {
    await mongoose.connect(MOCK_DB);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  it('should register a new KYC verification', async () => {
    const res = await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('verification');
    expect(res.body.verification.userId).toBe('user1');
  });

  it('should reject duplicate registration', async () => {
    await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    const res = await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    expect(res.statusCode).toEqual(409);
  });

  it('should approve verification to verified level', async () => {
    const reg = await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    const res = await request(app)
      .post('/api/kyc/verify/user1')
      .send({ level: 'verified' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.verification.level).toBe('verified');
    expect(res.body.verification.status).toBe('approved');
  });

  it('should return verification status', async () => {
    await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    const res = await request(app)
      .get('/api/kyc/status/user1');

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('level', 'base');
    expect(res.body).toHaveProperty('capabilities');
  });

  it('should list pending verifications for admin', async () => {
    await request(app)
      .post('/api/kyc/register')
      .send({ userId: 'user1', walletAddress: '0x123' });

    const res = await request(app)
      .get('/api/kyc/admin/pending');

    expect(res.statusCode).toEqual(200);
    expect(res.body.count).toBe(1);
  });
});
