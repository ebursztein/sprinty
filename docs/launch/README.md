# Sprinty launch kit

Prepared material for a small, useful launch. Posts and invitations in this folder are drafts; none have been sent.

## Assets

- [45-second captioned walkthrough](https://ebursztein.github.io/sprinty/demo.html): real dashboard captures from one illustrative website project.
- [Three project examples](../examples/README.md): copyable prompts for websites, research, and parallel agents.
- [Draft launch posts](posts.md): short announcement, Show HN draft, and a longer community post.
- [First-user process](first-users.md): a ten-person cohort, interview questions, and a manual outcome tracker.

## Recommended sequence

1. Check the public installer, demo, and one starting prompt from a fresh project.
2. Pick the first participants personally and help them get to one completed task.
3. Fix repeated onboarding failures before expanding the launch.
4. Publish a launch post in the communities you actually use, following their rules.
5. Ask for a concrete example and permission before presenting anyone's work as a customer story.

Measure first completed tasks, first finished sprints, and return usage alongside installs. No user tracking or analytics has been added to Sprinty for this launch; start with the consented feedback process in this folder. Package downloads and stars alone do not establish retained users.

## Registry follow-up

The official MCP Registry is a separate publishing step. For an npm-distributed server, its publishing guide requires an mcpName in the published package plus registry metadata and namespace authentication. Sprinty's existing npm release has not been republished for this launch kit. Do not claim a registry listing until publication and lookup verification succeed. See the [official guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx).

## Rebuild the walkthrough

The committed video is silent and captioned, with a text transcript on its page. It is a visual walkthrough of sample data, not a time-lapse or benchmark.

Requires Node.js, ffmpeg with libx264, and ffprobe:

```sh
node scripts/build-demo.mjs
node scripts/build-demo.mjs --check
```

The source captures are website/assets/launch-*.png. They come from the real dashboard's isolated marketing-demo mode. Each scene matches one benefit: overview (5s), task breakdown (10s), agents (10s), recovery notes (10s), and completed checks (10s). Refresh the captures and captions together when the product story changes.
