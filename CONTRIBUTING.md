# Contributing to ClaudeBench

First off, thank you for considering contributing to ClaudeBench! It's people like you that make ClaudeBench such a great tool. 🎉

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How Can I Contribute?](#how-can-i-contribute)
- [Style Guidelines](#style-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing Guidelines](#testing-guidelines)
- [Architecture Principles](#architecture-principles)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

ClaudeBench is a Redis-first event-driven framework. Before contributing, familiarize yourself with:

- The [README](README.md) for project overview
- The [Architecture Documentation](CLAUDEBENCH.md) for system design
- The event-driven pattern using `domain.action` naming

## Development Setup

### Prerequisites

Ensure you have the following installed:
- **Bun** >= 1.2.0 - [Install Guide](https://bun.sh/)
- **Redis** >= 6.0 - Running locally or via Docker
- **PostgreSQL** >= 14 - Running locally or via Docker
- **Git** - For version control

### Local Development

1. **Fork and Clone the Repository**
   ```bash
   git clone https://github.com/your-username/claudebench.git
   cd claudebench
   ```

2. **Install Dependencies**
   ```bash
   bun install
   ```

3. **Setup Environment Variables**
   ```bash
   cp .env.example .env
   cp apps/server/.env.example apps/server/.env
   cp apps/web/.env.example apps/web/.env
   ```
   
   Edit the `.env` files with your local configuration.

4. **Start Required Services**
   ```bash
   # Start PostgreSQL (via Docker)
   bun db:start
   
   # Run database migrations
   bun db:push
   
   # Start Redis (if not running)
   redis-server
   ```

5. **Run the Development Server**
   ```bash
   # Start all services
   bun dev
   
   # Or run individually:
   bun dev:server  # Backend only
   bun dev:web     # Frontend only
   ```

6. **Run the Event Relay (Optional)**
   ```bash
   bun relay
   ```
   This provides real-time monitoring of system events during development.

### Verifying Your Setup

Run the test suite to ensure everything is working:
```bash
bun test
```

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Environment details (OS, Bun version, etc.)
- Relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- A clear and descriptive title
- Detailed description of the proposed feature
- Use cases and examples
- Why this enhancement would be useful
- Possible implementation approach

### Your First Code Contribution

Unsure where to begin? Look for issues labeled:
- `good first issue` - Simple issues great for beginners
- `help wanted` - Issues where we need community help
- `documentation` - Help improve our docs

### Pull Requests

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Write clean, readable code
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed

3. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```
   
   Follow conventional commits:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Test additions/changes
   - `refactor:` - Code refactoring
   - `chore:` - Maintenance tasks

4. **Run Tests and Linting**
   ```bash
   bun test
   bun check
   bun check-types
   ```

5. **Push Your Branch**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request**
   - Use a clear, descriptive title
   - Link related issues
   - Describe what changed and why
   - Include screenshots for UI changes

## Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow the existing code style (enforced by Biome)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Avoid `any` types - be explicit with types

### File Organization

```
apps/
├── server/       # Backend code
│   ├── src/
│   │   ├── handlers/   # Event handlers
│   │   ├── schemas/    # Zod schemas
│   │   └── services/   # Business logic
│   └── tests/
├── web/          # Frontend code
│   └── src/
│       ├── components/ # React components
│       ├── hooks/      # Custom hooks
│       └── routes/     # Page components
```

### Event Naming

Follow the `domain.action` pattern:
- ✅ `task.create`, `task.complete`
- ❌ `createTask`, `TASK_CREATED`

### Git Commit Messages

- Use present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- Limit first line to 72 characters
- Reference issues and pull requests

## Testing Guidelines

### Test Structure

```typescript
describe("Feature/Component", () => {
  it("should do something specific", async () => {
    // Arrange
    const input = { /* test data */ };
    
    // Act
    const result = await performAction(input);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

### Test Coverage

- Write tests for all new features
- Maintain or improve existing coverage
- Focus on behavior, not implementation
- Test edge cases and error conditions

### Running Tests

```bash
# Run all tests
bun test

# Run specific test suites
bun test:contract     # Contract tests
bun test:integration  # Integration tests
bun test:web         # Frontend tests

# Watch mode
bun test:watch
```

## Architecture Principles

When contributing, keep these principles in mind:

1. **Redis-First**: Use Redis primitives directly, avoid abstractions
2. **Event-Driven**: All communication via events (`domain.action`)
3. **Explicit Persistence**: Handlers explicitly choose when to persist
4. **Forward-Only Evolution**: Replace events instead of versioning
5. **Simplicity**: Aim for clarity over cleverness

### Handler Pattern

```typescript
@EventHandler({
  event: 'domain.action',
  inputSchema: z.object({ /* ... */ }),
  outputSchema: z.object({ /* ... */ }),
  persist: false // Explicit persistence flag
})
export class DomainActionHandler {
  async handle(input: Input, context: EventContext) {
    // Direct Redis/Prisma calls
    // Return validated output
  }
}
```

## Questions?

Feel free to:
- Open an issue for questions
- Join discussions in existing issues/PRs
- Reach out to maintainers

## Recognition

Contributors are recognized in:
- The repository's contributors list
- Release notes for significant contributions
- Special mentions for exceptional work

Thank you for contributing to ClaudeBench! 🚀