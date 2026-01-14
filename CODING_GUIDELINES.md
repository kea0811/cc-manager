# Coding Guidelines: Compact Function Style

This document defines the "compact function" coding style enforced across the cc-manager codebase, as mandated by NFR-006.

---

## Core Principles

### 1. Single Responsibility
Each function should do **one thing** and do it well.

```typescript
// ✗ Bad: Multiple responsibilities
function processUserData(user: User) {
  // Validates user
  if (!user.email || !user.name) throw new Error('Invalid user');

  // Formats user
  const formatted = { ...user, name: user.name.trim().toLowerCase() };

  // Saves to database
  db.users.insert(formatted);

  // Sends notification
  emailService.send(user.email, 'Welcome!');
}

// ✓ Good: Single responsibility per function
function validateUser(user: User): void {
  if (!user.email || !user.name) throw new Error('Invalid user');
}

function formatUser(user: User): User {
  return { ...user, name: user.name.trim().toLowerCase() };
}

function saveUser(user: User): void {
  db.users.insert(user);
}

function sendWelcomeEmail(email: string): void {
  emailService.send(email, 'Welcome!');
}
```

### 2. Function Size Limits

| Metric | Guideline |
|--------|-----------|
| Lines of code | ≤ 20 lines (excluding type definitions) |
| Cyclomatic complexity | ≤ 5 branches |
| Parameters | ≤ 4 parameters (use object param if more) |
| Nesting depth | ≤ 3 levels |

### 3. Early Returns Over Nesting

```typescript
// ✗ Bad: Deep nesting
function processRequest(req: Request): Response {
  if (req.user) {
    if (req.user.isActive) {
      if (req.body.data) {
        return handleData(req.body.data);
      } else {
        return errorResponse('No data');
      }
    } else {
      return errorResponse('User inactive');
    }
  } else {
    return errorResponse('No user');
  }
}

// ✓ Good: Early returns (guard clauses)
function processRequest(req: Request): Response {
  if (!req.user) return errorResponse('No user');
  if (!req.user.isActive) return errorResponse('User inactive');
  if (!req.body.data) return errorResponse('No data');

  return handleData(req.body.data);
}
```

### 4. Extract Helpers Early

When you notice logic that could be named, extract it immediately.

```typescript
// ✗ Bad: Inline complex logic
function getActiveUsers(users: User[]): User[] {
  return users.filter(u =>
    u.status === 'active' &&
    u.lastLogin > Date.now() - 30 * 24 * 60 * 60 * 1000 &&
    !u.flags.includes('suspended')
  );
}

// ✓ Good: Named helper for clarity
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isRecentlyActive(user: User): boolean {
  return user.lastLogin > Date.now() - THIRTY_DAYS_MS;
}

function isActiveUser(user: User): boolean {
  return user.status === 'active'
    && isRecentlyActive(user)
    && !user.flags.includes('suspended');
}

function getActiveUsers(users: User[]): User[] {
  return users.filter(isActiveUser);
}
```

### 5. Descriptive Names Over Comments

Function names should be self-documenting.

```typescript
// ✗ Bad: Comment explaining what function does
// Check if user can access the resource based on role and ownership
function check(user: User, resource: Resource): boolean {
  return user.role === 'admin' || resource.ownerId === user.id;
}

// ✓ Good: Name is self-explanatory
function canUserAccessResource(user: User, resource: Resource): boolean {
  const isAdmin = user.role === 'admin';
  const isOwner = resource.ownerId === user.id;
  return isAdmin || isOwner;
}
```

---

## API Route Handlers

Route handlers should delegate to service functions.

```typescript
// ✗ Bad: Business logic in handler
app.post('/projects', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(id, name, description, now, now);

  res.json({ id, name, description, createdAt: now });
});

// ✓ Good: Handler delegates to service
app.post('/projects', async (req, res) => {
  const result = projectService.create(req.body);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result.data);
});
```

---

## React Components

### Component Size
- ≤ 50 lines for simple components
- ≤ 100 lines for complex components (split if larger)

### Extract Custom Hooks
Move stateful logic into custom hooks.

```typescript
// ✗ Bad: Complex logic in component
function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ... render logic
}

// ✓ Good: Custom hook extracts logic
function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { projects, loading, error };
}

function ProjectList() {
  const { projects, loading, error } = useProjects();
  // ... render logic only
}
```

### Extract Sub-components
Break large JSX into smaller components.

```typescript
// ✗ Bad: Large render block
function Dashboard() {
  return (
    <div>
      <header>{/* 20 lines of header JSX */}</header>
      <main>{/* 50 lines of main JSX */}</main>
      <footer>{/* 15 lines of footer JSX */}</footer>
    </div>
  );
}

// ✓ Good: Composed from smaller components
function Dashboard() {
  return (
    <div>
      <DashboardHeader />
      <DashboardContent />
      <DashboardFooter />
    </div>
  );
}
```

---

## Testing

Test functions should also follow compact style:
- One assertion focus per test
- Use descriptive test names
- Extract setup into helpers

```typescript
// ✗ Bad: Multiple concerns in one test
test('project CRUD', async () => {
  const created = await createProject({ name: 'Test' });
  expect(created.id).toBeDefined();

  const fetched = await getProject(created.id);
  expect(fetched.name).toBe('Test');

  await updateProject(created.id, { name: 'Updated' });
  const updated = await getProject(created.id);
  expect(updated.name).toBe('Updated');

  await deleteProject(created.id);
  expect(await getProject(created.id)).toBeNull();
});

// ✓ Good: Focused tests
describe('Project CRUD', () => {
  test('creates project with generated id', async () => {
    const project = await createProject({ name: 'Test' });
    expect(project.id).toBeDefined();
  });

  test('fetches project by id', async () => {
    const { id } = await createProject({ name: 'Test' });
    const project = await getProject(id);
    expect(project.name).toBe('Test');
  });

  // ... separate tests for update and delete
});
```

---

## Enforcement

### Code Review Checklist
- [ ] Functions ≤ 20 lines
- [ ] Nesting depth ≤ 3
- [ ] Single responsibility per function
- [ ] Guard clauses instead of nested conditionals
- [ ] Helpers extracted for reusable logic
- [ ] Self-documenting function names

### Exceptions
Document any exceptions with a comment explaining why:

```typescript
// NOTE: Exceeds line limit due to complex regex parsing logic
// that cannot be meaningfully decomposed without loss of readability
function parseComplexFormat(input: string): ParsedResult {
  // ...
}
```

---

## Summary

| Principle | Rule |
|-----------|------|
| Size | ≤ 20 lines per function |
| Complexity | ≤ 5 branches |
| Parameters | ≤ 4 (use object if more) |
| Nesting | ≤ 3 levels deep |
| Responsibility | One thing per function |
| Naming | Self-documenting names |

Following these guidelines ensures consistent, readable, and maintainable code across the cc-manager codebase.
