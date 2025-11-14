# Testing Guide for Comparr

This document provides comprehensive information about the testing infrastructure and practices for the Comparr project.

## Table of Contents

- [Overview](#overview)
- [Testing Infrastructure](#testing-infrastructure)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing Tests](#writing-tests)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)

---

## Overview

Comparr uses a dual testing approach:

- **Backend (Deno)**: Native Deno testing framework
- **Frontend (Vitest)**: Modern, fast JavaScript testing with happy-dom

### Current Test Coverage

The project has comprehensive test coverage for critical business logic:

- ✅ Session matching algorithm
- ✅ Plex API integration
- ✅ Movie enrichment pipeline (TMDb, OMDb)
- ✅ WebSocket communication (ComparrAPI)
- ⚠️ Frontend components (partial)
- ⚠️ Cache management (partial)

---

## Testing Infrastructure

### Backend Testing (Deno)

**Framework**: Deno's built-in test runner
**Location**: `src/**/__tests__/**/*.test.ts` or `src/**/*.test.ts`
**Configuration**: `deno.json`

**Key Features**:
- Zero external dependencies
- Built-in assertions
- Coverage reporting
- Fast execution

### Frontend Testing (Vitest)

**Framework**: Vitest with happy-dom
**Location**: `public/js/**/__tests__/**/*.test.js`
**Configuration**: `vitest.config.js`

**Key Features**:
- DOM testing with happy-dom
- Fast watch mode
- Coverage with v8
- Modern ESM support

---

## Running Tests

### Run All Tests

```bash
npm test
```

This runs both backend and frontend tests in parallel.

### Backend Tests Only

```bash
npm run test:backend
```

Or directly with Deno:

```bash
deno test --allow-all --coverage=coverage/
```

### Frontend Tests Only

```bash
npm run test:frontend
```

### Watch Mode (Frontend)

```bash
npm run test:watch
```

Automatically re-runs tests when files change.

### Generate Coverage Reports

```bash
# All coverage
npm run coverage

# Backend only
npm run coverage:backend

# Frontend only
npm run coverage:frontend
```

Coverage reports are generated in the `coverage/` directory.

---

## Test Coverage

### Coverage Goals

| Module | Target Coverage | Current Status |
|--------|----------------|----------------|
| `src/features/session/` | 90% | ✅ High |
| `src/features/catalog/` | 80% | ✅ High |
| `src/api/` | 70% | ✅ High |
| `public/js/ComparrAPI.js` | 70% | ✅ High |
| `public/js/CardView.js` | 60% | ⚠️ Partial |
| `public/js/main.js` | 50% | ⚠️ Partial |

### Viewing Coverage

After running tests with coverage:

```bash
# Backend coverage (LCOV format)
open coverage/backend-lcov.info

# Frontend coverage (HTML)
open coverage/index.html
```

---

## Writing Tests

### Backend Test Structure (Deno)

```typescript
// src/api/__tests__/example.test.ts
import { assertEquals, assertExists } from 'std/testing/asserts.ts'
import { mockEnv, createMockFetch } from '../../__tests__/utils/test-helpers.ts'

Deno.test({
  name: 'Feature - should do something',
  async fn() {
    // Arrange
    const cleanup = mockEnv({ ENV_VAR: 'value' })
    globalThis.fetch = createMockFetch(new Map([
      ['api.example.com', { status: 200, body: { data: 'mock' } }]
    ]))

    // Act
    const result = await myFunction()

    // Assert
    assertEquals(result, expectedValue)

    // Cleanup
    cleanup()
  },
  sanitizeResources: false,
  sanitizeOps: false,
})
```

### Frontend Test Structure (Vitest)

```javascript
// public/js/__tests__/example.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MyClass } from '../MyClass.js'

describe('MyClass', () => {
  let instance

  beforeEach(() => {
    instance = new MyClass()
  })

  it('should do something', () => {
    // Arrange
    const input = 'test'

    // Act
    const result = instance.doSomething(input)

    // Assert
    expect(result).toBe('expected')
  })

  it('should handle async operations', async () => {
    const result = await instance.asyncMethod()
    expect(result).toBeDefined()
  })
})
```

### Test Utilities

#### Backend Test Helpers

Located in `src/__tests__/utils/test-helpers.ts`:

```typescript
// Create mock fetch responses
const mockFetch = createMockFetch(new Map([
  ['plex.example.com', { status: 200, body: mockData }]
]))

// Mock environment variables
const cleanup = mockEnv({ PLEX_URL: 'http://test', PLEX_TOKEN: 'token' })

// Mock WebSocket
const ws = new MockWebSocket()
ws.simulateMessage({ type: 'batch', payload: [] })
```

#### Mock Data

Pre-built mock data available in `src/__tests__/mocks/`:

- `plex-mocks.ts` - Plex API responses
- `tmdb-mocks.ts` - TMDb API responses
- `omdb-mocks.ts` - OMDb API responses

---

## CI/CD Integration

### GitHub Actions Workflows

#### Tests & Coverage (`test.yml`)

Runs on:
- Push to `main` or `claude/**` branches
- All pull requests

**Steps**:
1. Run backend tests (Deno)
2. Run frontend tests (Vitest)
3. Generate coverage reports
4. Upload to Codecov
5. Comment results on PRs

#### Docker Build (`docker.yml`)

Runs on:
- Push to `main` (after tests pass)
- Successful completion of test workflow

**Quality Gates**:
- ✅ All tests must pass
- ✅ Linting must pass
- ⚠️ Coverage thresholds enforced

### Required Checks

Before merging PRs:
- [ ] All tests passing
- [ ] Linting passing
- [ ] No decrease in coverage

---

## Best Practices

### General Testing Principles

1. **Test Behavior, Not Implementation**
   - Focus on what the code does, not how it does it
   - This allows refactoring without breaking tests

2. **Use Descriptive Test Names**
   ```javascript
   // ✅ Good
   it('should return user matches when multiple users like the same movie')

   // ❌ Bad
   it('test matching')
   ```

3. **Follow AAA Pattern**
   - **Arrange**: Set up test data and conditions
   - **Act**: Execute the code under test
   - **Assert**: Verify the results

4. **One Assertion Per Test (When Possible)**
   - Makes failures easier to diagnose
   - More granular test reporting

5. **Use Mocks for External Dependencies**
   - Mock API calls, databases, WebSockets
   - Keeps tests fast and reliable

### Mocking Guidelines

#### When to Mock

- ✅ External API calls (Plex, TMDb, OMDb)
- ✅ Network requests (fetch, WebSocket)
- ✅ File I/O operations
- ✅ Date/time for consistent tests
- ✅ Environment variables

#### When NOT to Mock

- ❌ Simple utility functions
- ❌ Pure functions without side effects
- ❌ Internal business logic
- ❌ Data transformations

### Test Organization

```
src/
├── api/
│   ├── plex.ts
│   └── __tests__/
│       └── plex.test.ts
├── features/
│   └── session/
│       ├── session.ts
│       └── __tests__/
│           └── session-matching.test.ts
└── __tests__/
    ├── utils/
    │   └── test-helpers.ts
    └── mocks/
        ├── plex-mocks.ts
        └── tmdb-mocks.ts
```

### Coverage Best Practices

1. **Aim for High Coverage on Critical Paths**
   - Session matching: 90%+
   - API integrations: 70%+
   - Business logic: 80%+

2. **Don't Chase 100% Coverage**
   - Focus on meaningful tests
   - Some code (error handling, edge cases) may not need coverage

3. **Use Coverage to Find Gaps**
   - Review coverage reports regularly
   - Identify untested code paths
   - Prioritize based on risk

---

## Testing Checklist

Before submitting a PR:

- [ ] All existing tests pass
- [ ] New features have corresponding tests
- [ ] Critical bug fixes have regression tests
- [ ] Coverage hasn't decreased
- [ ] Tests are well-named and documented
- [ ] Mocks are used appropriately
- [ ] No console errors or warnings in tests

---

## Troubleshooting

### Tests Failing Locally But Passing in CI

1. Check environment variables
2. Clear coverage directory: `rm -rf coverage/`
3. Reinstall dependencies: `npm ci`
4. Check Deno version: `deno --version`

### Coverage Not Generating

**Backend**:
```bash
rm -rf coverage/
deno test --allow-all --coverage=coverage/
deno coverage coverage/ --lcov --output=coverage/backend-lcov.info
```

**Frontend**:
```bash
rm -rf coverage/
npm run test:frontend -- --coverage
```

### Flaky Tests

If tests fail intermittently:

1. Check for timing issues (add proper waits)
2. Ensure proper cleanup between tests
3. Check for shared state
4. Use `beforeEach`/`afterEach` properly

---

## Resources

- [Deno Testing Documentation](https://deno.land/manual/testing)
- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Mock Service Worker](https://mswjs.io/) (for advanced API mocking)

---

## Getting Help

- **Issue Tracker**: Report bugs or request features
- **Discussions**: Ask questions about testing
- **Code Reviews**: Learn from existing test examples

---

*Last Updated: 2025*
