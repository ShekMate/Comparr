# Test Coverage Summary

This document provides a quick overview of the test coverage implementation for Comparr.

## Quick Stats

- **Total Test Files**: 7+
- **Test Framework (Backend)**: Deno Native Test Runner
- **Test Framework (Frontend)**: Vitest + happy-dom
- **Coverage Tool**: Deno Coverage + Vitest Coverage (v8)

## What We Test

### ✅ Backend (Highly Covered)

#### 1. **Plex API Integration** (`src/api/__tests__/plex.test.ts`)
- ✅ Successful library fetching
- ✅ Authentication error handling (401)
- ✅ Server error handling (500, network timeouts)
- ✅ Library filtering
- ✅ Random movie selection (no duplicates)
- **Coverage Target**: 70%

#### 2. **Movie Enrichment Pipeline** (`src/features/catalog/__tests__/enrich.test.ts`)
- ✅ OMDb + TMDb data merging
- ✅ Fallback to TMDb when OMDb fails
- ✅ Rating aggregation (IMDb, Rotten Tomatoes, TMDb)
- ✅ Genre extraction
- ✅ Streaming service detection
- ✅ Graceful error handling when all APIs fail
- **Coverage Target**: 80%

#### 3. **Session Matching Logic** (`src/features/session/__tests__/session-matching.test.ts`)
- ✅ 2-user matching
- ✅ N-user matching (3+)
- ✅ Multiple movie matches
- ✅ Pass/dislike handling (wantsToWatch: false)
- ✅ Seen movie handling (wantsToWatch: null)
- ✅ User changing mind after initial response
- ✅ Complex multi-user scenarios
- ✅ `getExistingMatches` filtering
- **Coverage Target**: 90% (Most Critical Feature)

### ✅ Frontend (Well Covered)

#### 4. **WebSocket Communication** (`public/js/__tests__/ComparrAPI.test.js`)
- ✅ WebSocket connection initialization
- ✅ Login flow (success/failure)
- ✅ Message handling (batch, match, error, loginResponse)
- ✅ Response sending (like, dislike, seen)
- ✅ Batch requests (with/without filters)
- ✅ Movie lookup by GUID
- ✅ User decision fetching
- ✅ WebSocket reconnection
- ✅ Event emitting
- **Coverage Target**: 70%

### ⚠️ Partial Coverage (Expandable)

#### 5. **Cache Management** (Not Yet Implemented)
- ⚠️ Plex availability cache
- ⚠️ Poster cache with size limits
- ⚠️ Cache invalidation logic
- **Coverage Target**: 60%

#### 6. **Frontend CardView Component** (Not Yet Implemented)
- ⚠️ Swipe gesture detection
- ⚠️ Card animations
- ⚠️ Rating submission
- **Coverage Target**: 60%

#### 7. **Frontend Main App Logic** (Not Yet Implemented)
- ⚠️ Movie queue buffering
- ⚠️ Filter state management
- ⚠️ Watch list operations
- **Coverage Target**: 50%

---

## Test Infrastructure

### Backend (Deno)

**Configuration**: `deno.json`

```json
{
  "test": {
    "files": {
      "include": ["src/**/*.test.ts", "src/**/__tests__/**/*.ts"]
    }
  }
}
```

**Test Utilities**:
- `src/__tests__/utils/test-helpers.ts` - Mock helpers, assertions, async utilities
- `src/__tests__/mocks/plex-mocks.ts` - Plex API mock data
- `src/__tests__/mocks/tmdb-mocks.ts` - TMDb API mock data
- `src/__tests__/mocks/omdb-mocks.ts` - OMDb API mock data

### Frontend (Vitest)

**Configuration**: `vitest.config.js`

```javascript
{
  test: {
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      lines: 60,
      functions: 60,
      branches: 60,
      statements: 60,
    }
  }
}
```

**Test Setup**: `test-setup.js`
- Global WebSocket mock
- Console method mocking (reduce noise)

---

## Running Tests

### Quick Commands

```bash
# Run all tests
npm test

# Run only backend tests
npm run test:backend

# Run only frontend tests
npm run test:frontend

# Watch mode (frontend)
npm run test:watch

# Generate coverage reports
npm run coverage
```

### Direct Commands

```bash
# Deno tests with coverage
deno test --allow-all --coverage=coverage/

# Generate Deno coverage report
deno coverage coverage/ --lcov --output=coverage/backend-lcov.info

# Vitest with coverage
vitest run --coverage
```

---

## CI/CD Integration

### GitHub Actions

**Workflow**: `.github/workflows/test.yml`

**Triggers**:
- Push to `main` or `claude/**` branches
- All pull requests to `main`

**Steps**:
1. Setup Deno & Node.js
2. Install dependencies
3. Run backend tests
4. Run frontend tests
5. Generate coverage reports
6. Upload to Codecov
7. Comment results on PR

**Quality Gates**:
- ✅ All tests must pass before merging
- ✅ Linting must pass
- ✅ Coverage uploaded to Codecov

### Docker Build Integration

The Docker build workflow (`.github/workflows/docker.yml`) now:
- Only runs after tests pass
- Prevents broken builds from being published

---

## Test Examples

### Backend Test Example

```typescript
Deno.test({
  name: 'Plex API - getSections - successful response',
  async fn() {
    // Arrange
    globalThis.fetch = createMockFetch(
      new Map([['library/sections', { status: 200, body: mockPlexSections }]])
    )

    // Act
    const { getSections } = await import('../plex.ts')
    const sections = await getSections()

    // Assert
    assertEquals(sections.MediaContainer.size, 3)
    assertEquals(sections.MediaContainer.Directory[0].title, 'Movies')
  },
  sanitizeResources: false,
  sanitizeOps: false,
})
```

### Frontend Test Example

```javascript
describe('ComparrAPI', () => {
  it('should send login message and resolve on success', async () => {
    const api = new ComparrAPI()
    const mockWebSocket = api.socket

    const loginPromise = api.login('Alice', 'ROOM123', 'password')

    // Simulate server response
    mockWebSocket.simulateMessage({
      type: 'loginResponse',
      payload: { success: true, userName: 'Alice' },
    })

    const result = await loginPromise
    expect(result.success).toBe(true)
  })
})
```

---

## Coverage Reports

### Where to Find Reports

After running tests with coverage:

- **Backend**: `coverage/backend-lcov.info` (LCOV format)
- **Frontend**: `coverage/index.html` (HTML report - open in browser)

### Codecov Integration

Once set up (requires `CODECOV_TOKEN` secret):
- Automatic coverage tracking
- PR comments with coverage diff
- Historical coverage graphs
- Per-file coverage breakdown

---

## Next Steps

### High Priority

1. ✅ ~~Set up Deno testing infrastructure~~
2. ✅ ~~Set up Vitest testing infrastructure~~
3. ✅ ~~Write tests for session matching logic~~
4. ✅ ~~Write tests for API integrations~~
5. ✅ ~~Write tests for movie enrichment~~
6. ✅ ~~Write tests for WebSocket communication~~
7. ✅ ~~Update CI/CD pipeline~~

### Medium Priority

8. ⚠️ Write tests for cache management
9. ⚠️ Write tests for frontend CardView component
10. ⚠️ Write tests for main app logic (critical paths)

### Low Priority

11. Add E2E tests with Playwright/Cypress
12. Add performance benchmarks
13. Add visual regression testing

---

## Maintenance

### Adding New Tests

1. Create test file in appropriate `__tests__/` directory
2. Import necessary utilities from `test-helpers.ts`
3. Use existing mock data or create new mocks
4. Follow AAA pattern (Arrange, Act, Assert)
5. Run tests locally before committing
6. Ensure coverage doesn't decrease

### Updating Mocks

When APIs change:
1. Update mock data in `src/__tests__/mocks/`
2. Run tests to ensure compatibility
3. Update test assertions if needed

---

## Resources

- **Full Guide**: See `TESTING.md`
- **Deno Docs**: https://deno.land/manual/testing
- **Vitest Docs**: https://vitest.dev/

---

*Generated: 2025*
