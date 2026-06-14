# GitHub Integration Guide for GitLane

> Extracted from the SpectraGuard project. This document describes the complete GitHub OAuth + API integration as a set of logical steps and data structures so it can be re-implemented in any environment without the original backend.

---

## 1. OAuth Flow (Login)

### 1.1 Initiating the Login

**Trigger:** User clicks "Continue with GitHub" in the sign-in UI.

**Step-by-step:**

1. The client redirects the browser to the backend's auth entry point:
   ```
   GET <BACKEND_URL>/auth/github
   ```
2. The backend constructs the GitHub OAuth authorization URL and redirects the browser:
   ```
   https://github.com/login/oauth/authorize
     ?client_id=<GITHUB_CLIENT_ID>
     &redirect_uri=<BACKEND_URL>/auth/callback
     &scope=repo user:read
   ```
   - **Scopes requested:** `repo` (full access to private/public repos), `user:read` (read user profile).
3. GitHub shows the consent screen. On approval, GitHub redirects the browser to:
   ```
   GET <BACKEND_URL>/auth/callback?code=<TEMPORARY_CODE>
   ```

### 1.2 Exchanging the Code for an Access Token

**Handled entirely server-side (the callback route):**

1. Extract the `code` query parameter.
2. POST to GitHub's token endpoint:
   ```
   POST https://github.com/login/oauth/access_token
   ```
   **Request body (JSON):**
   ```json
   {
     "client_id": "<GITHUB_CLIENT_ID>",
     "client_secret": "<GITHUB_CLIENT_SECRET>",
     "code": "<TEMPORARY_CODE>"
   }
   ```
   **Request header:**
   ```
   Accept: application/json
   ```
3. GitHub responds with:
   ```json
   {
     "access_token": "gho_xxxxxxxxxxxx",
     "token_type": "bearer",
     "scope": "repo,user:read"
   }
   ```

### 1.3 Storing the Access Token

The access token is stored in an **HTTP-only cookie** named `github_token`:

| Cookie Property | Value |
|---|---|
| **Name** | `github_token` |
| **httpOnly** | `true` (not accessible to client JS) |
| **secure** | `true` in production, `false` in dev |
| **sameSite** | `"none"` in production (cross-site), `"lax"` in dev |
| **maxAge** | 24 hours (`86400000` ms) |

After setting the cookie, the backend redirects the browser to the frontend dashboard:
```
302 → <CLIENT_URL>/dashboard
```

**Key takeaway:** The frontend never directly handles or sees the raw access token. All authenticated API calls pass through the backend, which reads the token from the cookie.

### 1.4 Checking Authentication Status

On every page load, the frontend calls:

```
GET <BACKEND_URL>/api/auth/status
   (with cookies — credentials: 'include')
```

**Backend logic:**
1. Read `github_token` from the cookie.
2. If missing → respond `{ isAuthenticated: false, user: null }`.
3. If present → validate by calling `GET https://api.github.com/user` with the token.
   - Valid → respond `{ isAuthenticated: true, user: { username, name, avatar_url } }`.
   - Invalid (401 from GitHub) → clear the cookie, respond `{ isAuthenticated: false, user: null }`.

**Frontend state (AuthContext):**

```
State shape:
  isAuthenticated: boolean
  isLoading: boolean
  user: { username: string, name: string, avatar_url: string } | null
```

Exposed via React Context / `useAuth()` hook. States are updated by `checkAuthStatus()` on mount and by `refreshAuthStatus()` after login events.

### 1.5 Logout

1. Frontend calls:
   ```
   POST <BACKEND_URL>/api/auth/logout
       (with cookies — credentials: 'include')
   ```
2. Backend clears the `github_token` cookie.
3. Frontend resets local state: `isAuthenticated = false`, `user = null`, and navigates to `/`.

---

## 2. Data Fetching

### 2.1 Fetching the User's Repositories

**Frontend call:**
```
GET <BACKEND_URL>/api/repos
    (with cookies — credentials: 'include')
```

**Backend logic:**
1. Read `github_token` from cookie. If absent → 401.
2. Paginate through all of the user's repos:
   ```
   GET https://api.github.com/user/repos
       ?sort=updated&per_page=100&page=<N>
   ```
   Repeat with incrementing `page` until an empty response is returned.
3. Concatenate all pages and return the full array to the frontend.

**Response data shape (per repo object — subset of GitHub's response):**
```json
{
  "id": 123456789,
  "name": "my-repo",
  "full_name": "owner/my-repo",
  "private": true,
  "description": "A cool project",
  "owner": {
    "login": "owner"
  }
}
```

### 2.2 Fetching Repository Root Contents

**Frontend call:**
```
GET <BACKEND_URL>/api/repos/:owner/:repo/contents
    (with cookies — credentials: 'include')
```

**Backend logic:**
1. Read `github_token` from cookie. If absent → 401.
2. Call GitHub:
   ```
   GET https://api.github.com/repos/:owner/:repo/contents
   ```
3. Return the response array directly.

**Response data shape (per item):**
```json
{
  "name": "README.md",
  "sha": "abc123...",
  "size": 1024,
  "type": "file"       // or "dir"
}
```

### 2.3 Fetching the Full Repository File Tree (Recursive)

**Frontend call:**
```
GET <BACKEND_URL>/api/repos/:owner/:repo/tree
    (with cookies — credentials: 'include')
```

**Backend logic:**
1. Get the repo's default branch name:
   ```
   GET https://api.github.com/repos/:owner/:repo
   ```
   → extract `data.default_branch` (e.g. `"main"`).

2. Fetch the entire tree recursively:
   ```
   GET https://api.github.com/repos/:owner/:repo/git/trees/:default_branch?recursive=1
   ```
3. Transform the flat list of paths into a nested object:
   ```json
   {
     "src": {
       "index.js": null,
       "utils": {
         "helper.js": null
       }
     },
     "README.md": null
   }
   ```
   - Directories = nested objects.
   - Files = `null` leaf values.
   - Only `blob` entries (files) are processed; `tree` entries from the flat list are skipped since directories are inferred from path separators.

### 2.4 Fetching User Profile

**Frontend call:**
```
GET <BACKEND_URL>/api/user/profile
    (with cookies — credentials: 'include')
```

**Backend logic:**
1. Call `GET https://api.github.com/user` with the token.
2. Return a curated subset:
   ```json
   {
     "login": "octocat",
     "name": "The Octocat",
     "avatar_url": "https://...",
     "bio": "...",
     "company": "...",
     "location": "...",
     "email": "...",
     "public_repos": 42,
     "followers": 100,
     "following": 10,
     "created_at": "2008-01-14T04:33:35Z",
     "updated_at": "2026-01-01T00:00:00Z"
   }
   ```

### 2.5 Fetching Repository Details by ID

**Frontend call:**
```
GET <BACKEND_URL>/api/repo/:repoId
    (with cookies — credentials: 'include')
```

**Backend logic:**
1. Call GitHub's repositories-by-ID endpoint:
   ```
   GET https://api.github.com/repositories/:repoId
   ```
2. Return the full GitHub response object.

---

## 3. GitHub REST API Endpoints Used

| # | GitHub API Endpoint | HTTP Method | Purpose |
|---|---|---|---|
| 1 | `https://github.com/login/oauth/authorize` | GET (redirect) | Start OAuth consent flow |
| 2 | `https://github.com/login/oauth/access_token` | POST | Exchange temp code for access token |
| 3 | `https://api.github.com/user` | GET | Validate token / fetch authenticated user profile |
| 4 | `https://api.github.com/user/repos` | GET | List the authenticated user's repositories (paginated) |
| 5 | `https://api.github.com/repos/:owner/:repo/contents` | GET | Get root-level directory listing of a repo |
| 6 | `https://api.github.com/repos/:owner/:repo` | GET | Get repo metadata (used to find default branch) |
| 7 | `https://api.github.com/repos/:owner/:repo/git/trees/:branch?recursive=1` | GET | Get full recursive file tree of a repo |
| 8 | `https://api.github.com/repositories/:id` | GET | Get repo details by GitHub-internal numeric ID |

---

## 4. Authentication Headers

Every authenticated request from the backend to GitHub uses the same header pattern:

```
Authorization: Bearer <access_token>
Accept: application/vnd.github.v3+json
```

- `Authorization: Bearer <token>` — the OAuth access token obtained in the login flow.
- `Accept: application/vnd.github.v3+json` — requests the stable v3 REST API response format.

The frontend **never sends** the token directly. Instead, it sends requests to the backend with `credentials: 'include'`, which attaches the `github_token` HTTP-only cookie. The backend reads the cookie and injects the token into outgoing GitHub API requests.

---

## 5. Required Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `GITHUB_CLIENT_ID` | Backend | Your GitHub OAuth App's client ID |
| `GITHUB_CLIENT_SECRET` | Backend | Your GitHub OAuth App's client secret |
| `BACKEND_URL` | Backend | The public URL of your backend (used as OAuth `redirect_uri`) |
| `CLIENT_URL` | Backend | The public URL of your frontend (post-login redirect target) |
| `VITE_BACKEND_URL` | Frontend | Backend URL used by the frontend to call APIs |

---

## 6. Summary: Re-implementation Checklist

To replicate this integration in GitLane (or any new project):

1. **Register a GitHub OAuth App** at `https://github.com/settings/developers`.
   - Set the callback URL to `<YOUR_BACKEND>/auth/callback`.
   - Note the `client_id` and `client_secret`.

2. **Implement the OAuth redirect flow:**
   - Route that redirects to `https://github.com/login/oauth/authorize` with your `client_id`, `redirect_uri`, and `scope=repo user:read`.
   - Callback route that receives the `code`, exchanges it via POST to `https://github.com/login/oauth/access_token`, and stores the token securely (cookie, secure storage, etc.).

3. **Implement an auth-status endpoint** that validates the stored token by calling `GET https://api.github.com/user`.

4. **Implement data-fetching proxy endpoints** (or call GitHub directly if client-only):
   - Repos: `GET https://api.github.com/user/repos?sort=updated&per_page=100&page=N`
   - Contents: `GET https://api.github.com/repos/:owner/:repo/contents`
   - Full tree: `GET https://api.github.com/repos/:owner/:repo/git/trees/:branch?recursive=1`
   - User profile: `GET https://api.github.com/user`
   - Repo by ID: `GET https://api.github.com/repositories/:id`

5. **Always include these headers** on every GitHub API call:
   ```
   Authorization: Bearer <access_token>
   Accept: application/vnd.github.v3+json
   ```

6. **Handle token invalidation:** If GitHub returns 401 on any API call, clear the stored token and prompt re-authentication.
