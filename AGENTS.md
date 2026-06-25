# AGENTS.md — Project Conventions for TACV

This file is read by the Actor at the start of each coding session and updated
automatically by Memory Consolidation after each successful task.

## General Principles
- Follow Clean Architecture: domain → application → infrastructure → presentation
- All public APIs must have corresponding tests before implementation (TDD)
- No `any` types in TypeScript — use `unknown` and narrow
- Constructor injection only (no field injection in Java/@Autowired on fields)

## Testing Conventions
- Unit test files co-located: `MyService.ts` → `MyService.test.ts`
- Use `describe` blocks to group related tests
- AAA pattern: Arrange, Act, Assert — with blank lines between sections
- Mock only at boundaries (repositories, HTTP clients) — not business logic
- Every PR must maintain or improve coverage (minimum 80% line coverage)

## Java / Spring Boot
- Use `ResponseEntity<T>` for controller return types
- `@Transactional` on service methods, not repositories
- `Optional<T>` for nullable return values — never return null
- Use `@Valid` on request body parameters
- Flyway for all schema migrations — no schema.sql in production profiles

## TypeScript / React
- `const` over `let`, never `var`
- Functional components with hooks only
- `useCallback` / `useMemo` only when profiling shows it's needed
- CSS Modules or Tailwind — no inline styles
- `axe-core` for accessibility checks in tests

## Commit Messages
- `feat(scope): description` for new features
- `fix(scope): description` for bug fixes
- `test(scope): description` for test-only changes
- `refactor(scope): description` for non-functional changes
