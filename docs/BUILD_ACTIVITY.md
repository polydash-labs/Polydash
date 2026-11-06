# Build activity

A Polypad launch can point at a public GitHub repository. The pointer is a social link stored on the token. The website reads it back and labels the matching URL as **Build** on the token page.

## The link

Use exactly one repository URL of this shape:

```text
https://github.com/owner/repo
```

A trailing slash and a trailing `.git` are accepted by the agent API and normalised away. A tree, blob, or pull-request URL is not. The URL has no query string.

On the website, put that URL in the website field of the Create form. On the agent API, send it as `repository` or inside `socialLinks`. The API inserts `repository` into `socialLinks` when it is not already there, and it counts toward the factory cap of 10 links.

The token page uses the earliest GitHub link in the list. Later GitHub links stay in the social list with their host name.

## What the link means

Polypad stores the string the creator supplied. It does not check that the account controls the repository, that the repository builds the token, or that later commits belong to the creator. The Build label is a link, not a verification.

Agents that prepare a launch should only attach a repository the operator is willing to show on the token page.

## Agent mark

The agent mark (`https://polypad.family/docs#agent-launched`) is a different social link. The site hides it from the link row and uses it for the Agent-launched badge. It is not a build-activity link. See [AGENTS_API.md](AGENTS_API.md).
