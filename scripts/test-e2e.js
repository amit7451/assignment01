/**
 * End-to-End Automated Verification Test Suite
 * Tests full flow: API Gateway -> User Service -> NATS JetStream -> Notification Service
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ${colors.green}PASS${colors.reset} ${message}`);
    passedCount++;
  } else {
    console.error(`  ${colors.red}FAIL${colors.reset} ${message}`);
    failedCount++;
  }
}

async function request(endpoint, options = {}) {
  const url = `${GATEWAY_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, headers: res.headers, data };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runE2ETests() {
  console.log(`\n${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  MICROSERVICES END-TO-END VERIFICATION TEST SUITE${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  Gateway URL: ${GATEWAY_URL}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}========================================================================${colors.reset}\n`);

  const uniqueId = Date.now();
  const testEmail = `testuser_${uniqueId}@example.com`;
  const initialPassword = 'SecurePassword123!';
  const updatedPassword = 'NewSecurePassword456!';
  let authToken = '';
  let userId = '';

  // ---------------------------------------------------------------------------
  // 1. Health Checks
  // ---------------------------------------------------------------------------
  console.log(`${colors.bold}[1/6] Testing Health Probes & Cluster Status${colors.reset}`);
  try {
    const liveRes = await request('/health/live');
    assert(liveRes.status === 200, `Gateway liveness probe responded with HTTP 200 (status=${liveRes.status})`);

    const healthRes = await request('/health');
    assert(healthRes.status === 200 || healthRes.status === 207, `Aggregated health check responded (status=${healthRes.status})`);
    assert(healthRes.data && healthRes.data.gateway, 'Health response includes gateway status');
  } catch (err) {
    assert(false, `Gateway health check failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 2. Correlation ID & Distributed Tracing
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}[2/6] Testing Distributed Tracing (Correlation ID)${colors.reset}`);
  try {
    const customCorrelationId = `cid-test-${uniqueId}`;
    const traceRes = await request('/health/live', {
      headers: { 'x-correlation-id': customCorrelationId },
    });
    const returnedCid = traceRes.headers.get('x-correlation-id');
    assert(returnedCid === customCorrelationId, `Correlation ID propagated through gateway: "${returnedCid}"`);
  } catch (err) {
    assert(false, `Correlation ID test failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 3. User Registration & Asynchronous Event Emitting
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}[3/6] Testing User Registration & NATS Event Trigger${colors.reset}`);
  try {
    const regRes = await request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: testEmail,
        password: initialPassword,
        name: 'Alice Distributed',
        role: 'user',
      },
    });

    assert(regRes.status === 201, `User registration succeeded with HTTP 201 (status=${regRes.status})`);
    assert(regRes.data && regRes.data.success === true, 'Response marked success: true');
    assert(regRes.data?.data?.tokens?.accessToken, 'JWT access token returned');
    assert(regRes.data?.data?.user?.email === testEmail, `Returned user matches email: ${testEmail}`);

    userId = regRes.data?.data?.user?.id;
    authToken = regRes.data?.data?.tokens?.accessToken;

    // Duplicate registration rejection
    const dupRes = await request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: testEmail,
        password: initialPassword,
        name: 'Alice Duplicate',
      },
    });
    assert(dupRes.status === 409, `Duplicate email registration rejected with HTTP 409 Conflict (status=${dupRes.status})`);
  } catch (err) {
    assert(false, `Registration test failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 4. Authentication (Login) & Security Guard
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}[4/6] Testing Authentication, Security Guards & JWT Validation${colors.reset}`);
  try {
    // Bad password
    const badLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: 'WrongPassword!' },
    });
    assert(badLoginRes.status === 401, `Invalid credentials rejected with HTTP 401 (status=${badLoginRes.status})`);

    // Good password
    const goodLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: initialPassword },
    });
    assert(goodLoginRes.status === 200, `Valid credentials accepted with HTTP 200 (status=${goodLoginRes.status})`);
    assert(goodLoginRes.data?.data?.tokens?.accessToken, 'Valid JWT received on login');

    // Unauthenticated access to protected route
    const unauthRes = await request('/api/v1/users/me');
    assert(unauthRes.status === 401, `Protected route rejected request without token with HTTP 401 (status=${unauthRes.status})`);

    // Authenticated access
    const meRes = await request('/api/v1/users/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(meRes.status === 200, `Protected route accessible with valid Bearer token (status=${meRes.status})`);
    assert(meRes.data?.data?.id === userId, `Returned user profile matches registered ID: ${userId}`);
  } catch (err) {
    assert(false, `Authentication test failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 5. User Profile Update & Password Change (Security Alert Event)
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}[5/6] Testing Profile Update & Security Alert Event Dispatch${colors.reset}`);
  try {
    // Profile Update
    const updateRes = await request('/api/v1/users/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}` },
      body: { name: 'Alice Systems Engineer' },
    });
    assert(updateRes.status === 200, `Profile update responded with HTTP 200 (status=${updateRes.status})`);
    assert(updateRes.data?.data?.name === 'Alice Systems Engineer', 'Profile name successfully updated in database');

    // Password Change
    const pwdRes = await request('/api/v1/users/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        currentPassword: initialPassword,
        newPassword: updatedPassword,
      },
    });
    assert(pwdRes.status === 200, `Password changed successfully (status=${pwdRes.status})`);

    // Verify old password fails
    const oldLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: initialPassword },
    });
    assert(oldLoginRes.status === 401, 'Old password rejected after change (HTTP 401)');

    // Verify new password succeeds
    const newLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: updatedPassword },
    });
    assert(newLoginRes.status === 200, 'New password accepted for login (HTTP 200)');
    authToken = newLoginRes.data?.data?.tokens?.accessToken;
  } catch (err) {
    assert(false, `Profile update & password change test failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 6. Asynchronous Notification Verification (NATS JetStream Consumption)
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}[6/6] Verifying Asynchronous Notifications via NATS JetStream${colors.reset}`);
  console.log('  Waiting 3 seconds for NATS JetStream asynchronous message processing...');
  await sleep(3000);

  try {
    const notifRes = await request(`/api/v1/notifications?userId=${userId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    assert(notifRes.status === 200, `Notification audit query returned HTTP 200 (status=${notifRes.status})`);
    const notifications = notifRes.data?.data?.items || [];
    console.log(`  Found ${notifications.length} notification(s) for user ${userId}`);

    const welcomeNotif = notifications.find((n) => n.type === 'WELCOME_EMAIL');
    assert(!!welcomeNotif, 'WELCOME_EMAIL notification was received and processed from NATS JetStream');
    if (welcomeNotif) {
      assert(welcomeNotif.status === 'SENT', `Welcome notification status is SENT (status=${welcomeNotif.status})`);
      assert(welcomeNotif.recipient === testEmail, `Welcome notification recipient is ${testEmail}`);
    }

    const securityNotif = notifications.find((n) => n.type === 'SECURITY_ALERT');
    assert(!!securityNotif, 'SECURITY_ALERT notification was triggered by password change and processed');
    if (securityNotif) {
      assert(securityNotif.status === 'SENT', `Security alert notification status is SENT (status=${securityNotif.status})`);
    }

    const profileNotif = notifications.find((n) => n.type === 'PROFILE_UPDATED');
    assert(!!profileNotif, 'PROFILE_UPDATED notification was triggered and processed');
  } catch (err) {
    assert(false, `Notification verification test failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // Test Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}========================================================================${colors.reset}`);
  console.log(`${colors.bold}TEST SUMMARY:${colors.reset}`);
  console.log(`  ${colors.green}Total Passed: ${passedCount}${colors.reset}`);
  if (failedCount > 0) {
    console.log(`  ${colors.red}Total Failed: ${failedCount}${colors.reset}`);
  } else {
    console.log(`  ${colors.green}${colors.bold}ALL TESTS PASSED! System is fully operational and reliable.${colors.reset}`);
  }
  console.log(`${colors.bold}========================================================================${colors.reset}\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error(`${colors.red}Fatal test runner error: ${err.message}${colors.reset}`);
  process.exit(1);
});
