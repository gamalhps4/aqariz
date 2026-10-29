# Lease Expiry Notification Tests

This directory documents testing for the lease expiry notification system.

## Test Files

### 1. `../../scripts/verify-lease-expiry-implementation.ts`
Static verification script that checks the implementation without requiring a
database connection.

**What it verifies:**
- Email service methods for both tenants and landlords exist
- Notification automation and notification service files are present
- All notification intervals (90, 60, 30, 14, 7 days) are configured
- Edge cases and error handling code paths

Run it with:

```bash
npx tsx src/scripts/verify-lease-expiry-implementation.ts
```

### 2. Cron route: `GET /api/cron/check-leases`
The lease expiration pass itself runs through a `CRON_SECRET`-protected route
(`src/app/api/cron/check-leases/route.ts`). It enumerates organizations and runs
the expiration check per org inside that org's row-level-security context. You
can exercise it end-to-end against a dev database:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-leases
```

## Running Unit Tests (Jest)

**Note:** Jest is not currently configured in this project. To write and run Jest
tests, you need to:

1. Install Jest and required dependencies:
```bash
pnpm add -D jest @types/jest ts-jest @testing-library/jest-dom
```

2. Create `jest.config.js` in the project root:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
};
```

3. Add test script to `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

4. Run the tests:
```bash
pnpm test
```

## Environment Setup

Make sure your `.env` file is configured with database and email credentials:

```env
DATABASE_URL=postgresql://propertypro_app:propertypro_dev@localhost:5432/propertypro_saas
APP_URL=http://localhost:3000
CRON_SECRET=replace-with-a-long-random-secret
EMAIL_SERVER_HOST=smtp.gmail.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=your-email@gmail.com
EMAIL_SERVER_PASSWORD=your-app-password
EMAIL_FROM=your-email@gmail.com
```

## Test Coverage

The verification covers:

### ✅ Email Service
- [x] Tenant email template generation
- [x] Landlord email template generation
- [x] Property name inclusion
- [x] Tenant name inclusion (landlord emails)
- [x] Urgent styling for leases ≤30 days
- [x] Action items for landlords
- [x] Lease ID links

### ✅ Notification Service
- [x] Email routing based on recipient type
- [x] Tenant vs landlord template selection
- [x] Data structure validation

### ✅ Notification Automation
- [x] Finding leases expiring at specific intervals
- [x] Sending to multiple recipients (tenant, owner, manager)
- [x] Avoiding duplicate notifications
- [x] Handling missing manager
- [x] Proper Prisma relation loading (`include`/`select` on lease → property, tenant, owner, manager)
- [x] All 5 notification intervals (90, 60, 30, 14, 7 days)

### ✅ Edge Cases
- [x] Missing tenant information
- [x] Missing property information
- [x] Multiple leases expiring same day
- [x] Active lease filtering
- [x] Soft-deleted lease exclusion
- [x] Owner and manager being the same person

### ✅ Priority Levels
- [x] Normal priority for 90 and 60 days
- [x] High priority for 30, 14, and 7 days

## Expected Behavior

When a lease is approaching expiry, the system should:

1. **Find the lease** based on the expiry date matching one of the intervals (90, 60, 30, 14, or 7 days)
2. **Send notification to tenant** with:
   - Property name
   - Expiry date
   - Days remaining
   - Renewal information
   - Link to tenant portal

3. **Send notification to property owner** with:
   - Property name
   - Tenant name
   - Expiry date
   - Days remaining
   - Action items checklist
   - Link to lease management

4. **Send notification to property manager** (if assigned and different from owner) with:
   - Same information as owner
   - Action items checklist
   - Link to lease management

## Troubleshooting

### Tests fail with "Cannot find module"
Make sure all dependencies are installed:
```bash
pnpm install
```

### Database connection errors
1. Ensure PostgreSQL is running (`brew services list | grep postgresql`)
2. Check your `.env` file has a correct `DATABASE_URL`
3. Verify the `propertypro_app` role can connect: `psql "$DATABASE_URL" -c "SELECT 1;"`
4. Make sure migrations are applied: `pnpm db:migrate`

### Email sending errors
The verification script doesn't actually send emails - it only verifies the
implementation. To test actual email sending, you would need to:
1. Configure valid SMTP credentials (`EMAIL_SERVER_*`) in `.env`
2. Trigger the cron route against a database with expiring leases
3. Check your email inbox

## Next Steps

After running the verification successfully:

1. ✅ Verify all checks pass
2. ✅ Ensure an external scheduler is hitting `GET /api/cron/check-leases` with the `CRON_SECRET` bearer token
3. ✅ Monitor logs for any errors
4. ✅ Test with real lease data in staging environment
5. ✅ Verify emails are being sent to correct recipients

## Support

If you encounter any issues with the tests, please check:
- Database connection (`DATABASE_URL`)
- Environment variables
- Prisma client generation (`pnpm db:generate`)
- TypeScript compilation errors
